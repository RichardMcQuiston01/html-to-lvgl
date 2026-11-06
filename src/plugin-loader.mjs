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
import { defaultRegistry, extendRegistry } from './recognize.mjs';
import reactPlugin from './plugins/react.mjs';

export const CONFIG_FILE = 'html2lvgl.config.mjs';

let freshCounter = 0;

/**
 * Import a plugin module by path or package name and return its default
 * export. Specs starting with `.` or `/` (or that name an existing file) are
 * paths relative to `baseDir`; anything else is a package resolved from
 * `baseDir`.
 *
 * `fresh` appends a unique query so Node re-evaluates the module instead of
 * returning its cache (watch mode). Only the entry file is re-evaluated; files
 * it imports stay cached, so edit the entry or restart for those.
 *
 * @param {string} spec
 * @param {string} baseDir
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<{ ok: true, plugin: unknown, file?: string } | { ok: false, error: string }>}
 */
export async function importPlugin(spec, baseDir, { fresh = false } = {}) {
  let url;
  let file;
  const asPath = resolve(baseDir, spec);
  if (/^[./\\]/.test(spec) || /^[a-zA-Z]:[\\/]/.test(spec) || existsSync(asPath)) {
    if (!existsSync(asPath)) {
      return { ok: false, error: `plugin "${spec}": no such file ${asPath}` };
    }
    file = asPath;
    url = pathToFileURL(asPath).href;
  } else {
    try {
      file = createRequire(join(baseDir, 'noop.js')).resolve(spec);
      url = pathToFileURL(file).href;
    } catch {
      url = spec; // ESM-only packages may not resolve through require
    }
  }
  try {
    const mod = await import(fresh && url.startsWith('file:') ? `${url}?reload=${freshCounter++}` : url);
    return { ok: true, plugin: mod.default ?? mod, file };
  } catch (err) {
    return { ok: false, error: `plugin "${spec}" could not be loaded: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Read an html2lvgl.config.mjs and return its plugin entries (objects or
 * string specs, the latter resolved relative to the config's directory).
 *
 * @param {string} configPath
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<{ ok: true, entries: Array<{ plugin: unknown, source: string, file?: string }> } | { ok: false, errors: string[] }>}
 */
export async function loadConfig(configPath, { fresh = false } = {}) {
  let mod;
  try {
    const url = pathToFileURL(configPath).href;
    mod = await import(fresh ? `${url}?reload=${freshCounter++}` : url);
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
      const r = await importPlugin(item, dirname(configPath), { fresh });
      if (r.ok) entries.push({ plugin: r.plugin, source: `${configPath} (${item})`, file: r.file });
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
 * @param {boolean} [options.fresh]  re-evaluate plugin modules (watch mode)
 * @returns {Promise<{ plugins: import('./plugin.mjs').Plugin[], errors: string[], files: string[] }>}
 *   `errors` holds every line that was reported. `files` are the absolute
 *   paths of the config files and plugin modules read, for watch mode.
 */
export async function loadPlugins({ specs = [], inputs = [], cwd = process.cwd(), log = (l) => console.error(l), fresh = false } = {}) {
  /** @type {string[]} */
  const errors = [];
  const report = (line) => { errors.push(line); log(line); };

  /** @type {Array<{ plugin: unknown, source: string, file?: string }>} */
  const candidates = [];
  /** @type {Set<string>} */
  const files = new Set();

  for (const spec of specs) {
    const r = await importPlugin(spec, cwd, { fresh });
    if (r.ok) candidates.push({ plugin: r.plugin, source: `--plugin ${spec}`, file: r.file });
    else report(`error: ${r.error}; skipping it`);
  }

  const configDirs = [...new Set([...inputs.map((i) => dirname(resolve(cwd, i))), resolve(cwd)])];
  const seenConfigs = new Set();
  for (const dir of configDirs) {
    const configPath = join(dir, CONFIG_FILE);
    if (seenConfigs.has(configPath) || !existsSync(configPath)) continue;
    seenConfigs.add(configPath);
    files.add(configPath);
    const r = await loadConfig(configPath, { fresh });
    if (r.ok) candidates.push(...r.entries);
    else for (const e of r.errors) report(`error: ${e}; skipping it`);
  }

  candidates.push({ plugin: reactPlugin, source: 'built-in' });

  /** @type {import('./plugin.mjs').Plugin[]} */
  const plugins = [];
  for (const { plugin, source, file } of candidates) {
    if (file) files.add(file);
    const check = validatePlugin(plugin);
    if (!check.ok) {
      for (const e of check.errors) report(`error: invalid plugin from ${source}: ${e}; skipping it`);
      continue;
    }
    const p = /** @type {import('./plugin.mjs').Plugin} */ (plugin);
    if (plugins.some((x) => x.name === p.name)) continue; // earlier source wins
    plugins.push(p);
  }
  return { plugins, errors, files: [...files] };
}

/**
 * The registry for a run: the core components plus every loaded plugin's
 * `recognizers` (see extendRegistry for the precedence rules). Pass it to
 * convert({ registry }). Rejected definitions travel inside the registry and
 * surface as PLUGIN_RECOGNIZER_REJECTED diagnostics when recognition runs.
 * With no plugin recognizers this is equivalent to the default registry.
 *
 * @param {import('./plugin.mjs').Plugin[]} plugins
 */
export function registryFor(plugins) {
  return plugins.some((p) => p.recognizers !== undefined) ? extendRegistry(defaultRegistry, plugins) : defaultRegistry;
}

/**
 * True when any plugin's recognizers want `node.framework`, so the
 * framework plugin loading the input should supply it (LoadOptions.frameworkData).
 *
 * @param {import('./plugin.mjs').Plugin[]} plugins
 */
export function frameworkDataWanted(plugins) {
  return plugins.some((p) => p.wantsFrameworkData === true);
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
