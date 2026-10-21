/**
 * The plugin contract. Types and validation only: finding and loading
 * plugins (the --plugin flag, html2lvgl.config.mjs) is separate work.
 *
 * Rendering happens in Chromium, so the core never needs to know which
 * framework produced the DOM. A plugin supplies only the parts that need
 * framework knowledge. There are two kinds, kept separate on purpose:
 *
 *   Framework plugin (React, Vue, Angular): load, components, sourceOf.
 *   Library plugin (MUI, Bootstrap, Vuetify): recognizers.
 *
 * A library such as Bootstrap works with any framework, so a library plugin
 * must not depend on one.
 *
 * See COMPONENTS.md, "Plugins".
 */

/**
 * Bumped when this contract changes in a way old plugins cannot satisfy.
 * A plugin declares the number it was built for in `pluginApi`.
 */
export const PLUGIN_API = 1;

/**
 * Options passed to load().
 * @typedef {object} LoadOptions
 * @property {number} width           Target display width in pixels.
 * @property {number} height          Target display height in pixels.
 * @property {string} [screenshotPath] Where to save a screenshot, if wanted.
 */

/**
 * A page that has been mounted in the browser and is ready for extraction.
 * `tree` is the same extracted UI tree that extractPage() returns today.
 * @typedef {object} LoadedPage
 * @property {object} tree
 * @property {object} [handle]  Opaque value passed back to components() and
 *                              sourceOf(), for example a Playwright page.
 */

/**
 * @typedef {object} Plugin
 * @property {string} name         Short unique name, such as "react".
 * @property {number} pluginApi    The PLUGIN_API value this plugin was built for.
 * @property {string[]} [extensions] File extensions this plugin loads, with the
 *                                 leading dot: [".jsx", ".tsx"].
 * @property {(entry: string, options: LoadOptions) => Promise<LoadedPage>} [load]
 *   Bundle or mount the input and return a ready page.
 * @property {(page: LoadedPage) => Promise<void>} [components]
 *   Mark component boundaries (data-lv-component) on the mounted page, so
 *   they become reusable LVGL XML components.
 * @property {(page: LoadedPage, selector: string) => Promise<{ file?: string, line?: number } | null>} [sourceOf]
 *   The source file and line behind an element, for TODO.txt. Null when unknown.
 * @property {object[]} [recognizers]  Registry entries for library components.
 */

/**
 * The result of checking a plugin. Callers must check `ok`.
 * @typedef {object} PluginCheck
 * @property {boolean} ok
 * @property {string[]} errors  One descriptive line per problem. Empty when ok.
 */

const HOOKS = ['load', 'components', 'sourceOf'];

/**
 * Check that a value satisfies the plugin contract. Never throws: a bad
 * plugin comes back as `{ ok: false, errors }` so the caller can print every
 * problem at once and carry on without the plugin.
 *
 * @param {unknown} candidate
 * @param {{ apiVersion?: number }} [options]
 * @returns {PluginCheck}
 */
export function validatePlugin(candidate, { apiVersion = PLUGIN_API } = {}) {
  /** @type {string[]} */
  const errors = [];

  if (candidate === null || typeof candidate !== 'object') {
    return { ok: false, errors: [`a plugin must be an object, got ${candidate === null ? 'null' : typeof candidate}`] };
  }
  const plugin = /** @type {Record<string, unknown>} */ (candidate);
  const label = typeof plugin.name === 'string' && plugin.name ? `plugin "${plugin.name}"` : 'plugin';

  if (typeof plugin.name !== 'string' || !plugin.name) {
    errors.push('a plugin needs a non-empty string `name`');
  }

  if (plugin.pluginApi !== apiVersion) {
    errors.push(
      `${label} was built for plugin API ${String(plugin.pluginApi)}, but this html2lvgl uses plugin API ${apiVersion}; ` +
      'update the plugin or html2lvgl so the versions match',
    );
  }

  if (plugin.extensions !== undefined) {
    const ok = Array.isArray(plugin.extensions) &&
      plugin.extensions.every((e) => typeof e === 'string' && /^\.[^./\\]+$/.test(e));
    if (!ok) errors.push(`${label}: \`extensions\` must be an array of strings like ".jsx"`);
  }

  for (const hook of HOOKS) {
    if (plugin[hook] !== undefined && typeof plugin[hook] !== 'function') {
      errors.push(`${label}: \`${hook}\` must be a function, got ${typeof plugin[hook]}`);
    }
  }

  if (plugin.recognizers !== undefined && !Array.isArray(plugin.recognizers)) {
    errors.push(`${label}: \`recognizers\` must be an array`);
  }

  const providesAnything = HOOKS.some((h) => plugin[h] !== undefined) || plugin.recognizers !== undefined;
  if (!providesAnything) {
    errors.push(`${label} provides nothing; give it at least one of load, components, sourceOf, or recognizers`);
  }

  if (plugin.load !== undefined && (!Array.isArray(plugin.extensions) || plugin.extensions.length === 0)) {
    errors.push(`${label} has a \`load\` hook but no \`extensions\`, so no input file would ever select it`);
  }

  return { ok: errors.length === 0, errors };
}
