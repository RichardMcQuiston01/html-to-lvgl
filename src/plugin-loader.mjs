/**
 * Plugin discovery. Finds plugins and picks one for an input file; the
 * contract itself lives in src/plugin.mjs.
 *
 * Sources, in priority order (the first plugin to claim an extension wins):
 *   1. `--plugin <package-or-path>` flags, in the order given
 *   2. html2lvgl.config.mjs next to an input file, then in the working
 *      directory (default export `{ plugins: [...] }`)
 *   3. the built-in React plugin
 *
 * Nothing here throws for a bad plugin. Every plugin goes through
 * validatePlugin(); a bad one has all its error lines reported and is
 * skipped. Plain .html has no plugin and keeps the extractPage path.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePlugin } from './plugin.mjs';
import reactPlugin from './plugins/react.mjs';

export const CONFIG_FILE = 'html2lvgl.config.mjs';

/**
 * Import a plugin module by path or package name and return its default
 * export. Specs starting with `.` or `/` (or that name an existing file) are
 * paths relative to `baseDir`; anything else is a package resolved from
 * `baseDir`.
 *
 * @param {string} spec
 * @param {string} baseDir
 * @returns {Promise<{ ok: true, plugin: unknown } | { ok: false, error: string }>}
 */
export async function importPlugin(spec, baseDir) {
  let url;
  const asPath = resolve(baseDir, spec);
  if (/^[./\\]/.test(spec) || /^[a-zA-Z]:[\\/]/.test(spec) || existsSync(asPath)) {
    if (!existsSync(asPath)) {
      return { ok: false, error: `plugin "${spec}": no such file ${asPath}` };
    }
    url = pathToFileURL(asPath).href;
  } else {
    try {
      url = pathToFileURL(createRequire(join(baseDir, 'noop.js')).resolve(spec)).href;
    } catch {
      url = spec; // ESM-only packages may not resolve through require
    }
  }
  try {
    const mod = await import(url);
    return { ok: true, plugin: mod.default ?? mod };
  } catch (err) {
    return { ok: false, error: `plugin "${spec}" could not be loaded: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Read an html2lvgl.config.mjs and return its plugin entries (objects or
 * string specs, the latter resolved relative to the config's directory).
 *
 * @param {string} configPath
 * @returns {Promise<{ ok: true, entries: Array<{ plugin: unknown, source: string }> } | { ok: false, errors: string[] }>}
 */
export async function loadConfig(configPath) {
  let mod;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (err) {
    return { ok: false, errors: [`${configPath} could not be loaded: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const config = mod.default;
  if (config === null || typeof config !== 'object' || !Array.isArray(config.plugins)) {
    return { ok: false, errors: [`${configPath}: the default export must be an object like { plugins: [...] }`] };
  }
  const entries = [];
  const errors = [];
  for (const item of config.plugins) {
    if (typeof item === 'string') {
      const r = await importPlugin(item, dirname(configPath));
      if (r.ok) entries.push({ plugin: r.plugin, source: `${configPath} (${item})` });
      else errors.push(`${configPath}: ${r.error}`);
    } else {
      entries.push({ plugin: item, source: configPath });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, entries };
}

/**
 * Collect the usable plugins for a run. Invalid ones are reported through
 * `log` (one line per error) and left out.
 *
 * @param {object} [options]
 * @param {string[]} [options.specs]     --plugin values
 * @param {string[]} [options.inputs]    input files; config is looked up next to each
 * @param {string} [options.cwd]
 * @param {(line: string) => void} [options.log]  defaults to console.error
 * @returns {Promise<{ plugins: import('./plugin.mjs').Plugin[], errors: string[] }>}
 *   `errors` holds every line that was reported.
 */
export async function loadPlugins({ specs = [], inputs = [], cwd = process.cwd(), log = (l) => console.error(l) } = {}) {
  /** @type {string[]} */
  const errors = [];
  const report = (line) => { errors.push(line); log(line); };

  /** @type {Array<{ plugin: unknown, source: string }>} */
  const candidates = [];

  for (const spec of specs) {
    const r = await importPlugin(spec, cwd);
    if (r.ok) candidates.push({ plugin: r.plugin, source: `--plugin ${spec}` });
    else report(`error: ${r.error}; skipping it`);
  }

  const configDirs = [...new Set([...inputs.map((i) => dirname(resolve(cwd, i))), resolve(cwd)])];
  const seenConfigs = new Set();
  for (const dir of configDirs) {
    const configPath = join(dir, CONFIG_FILE);
    if (seenConfigs.has(configPath) || !existsSync(configPath)) continue;
    seenConfigs.add(configPath);
    const r = await loadConfig(configPath);
    if (r.ok) candidates.push(...r.entries);
    else for (const e of r.errors) report(`error: ${e}; skipping it`);
  }

  candidates.push({ plugin: reactPlugin, source: 'built-in' });

  /** @type {import('./plugin.mjs').Plugin[]} */
  const plugins = [];
  for (const { plugin, source } of candidates) {
    const check = validatePlugin(plugin);
    if (!check.ok) {
      for (const e of check.errors) report(`error: invalid plugin from ${source}: ${e}; skipping it`);
      continue;
    }
    const p = /** @type {import('./plugin.mjs').Plugin} */ (plugin);
    if (plugins.some((x) => x.name === p.name)) continue; // earlier source wins
    plugins.push(p);
  }
  return { plugins, errors };
}

/**
 * The plugin that loads this input file, chosen by extension, or null when
 * none claims it (plain .html, which uses extractPage).
 *
 * @param {import('./plugin.mjs').Plugin[]} plugins
 * @param {string} file
 * @returns {import('./plugin.mjs').Plugin | null}
 */
export function selectPlugin(plugins, file) {
  const ext = extname(file).toLowerCase();
  if (!ext) return null;
  return plugins.find((p) => typeof p.load === 'function' && p.extensions?.some((e) => e.toLowerCase() === ext)) ?? null;
}

/**
 * Run a plugin's load hook and return the extracted tree, always releasing
 * the page handle afterwards.
 *
 * @param {import('./plugin.mjs').Plugin} plugin
 * @param {string} file
 * @param {import('./plugin.mjs').LoadOptions} options
 * @returns {Promise<{ ok: true, tree: object | null } | { ok: false, error: string }>}
 */
export async function extractWithPlugin(plugin, file, options) {
  let loaded;
  try {
    loaded = await /** @type {NonNullable<typeof plugin.load>} */ (plugin.load)(file, options);
  } catch (err) {
    return { ok: false, error: `plugin "${plugin.name}" failed to load ${file}: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    if (!loaded || typeof loaded !== 'object' || !('tree' in loaded)) {
      return { ok: false, error: `plugin "${plugin.name}" load() for ${file} did not return { tree }` };
    }
    return { ok: true, tree: loaded.tree ?? null };
  } finally {
    const h = loaded?.handle;
    if (h && typeof h.close === 'function') await h.close();
  }
}
