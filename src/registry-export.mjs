/**
 * Registry export: every component definition's `props` and `slots` (plus the
 * facts an editor needs around them) as plain, deterministic JSON, so a
 * palette and a property panel can be built from the same data the converter
 * uses. Pure: no browser, no file system, no clock. The same registry always
 * gives the same bytes, on any machine.
 *
 * The format is versioned and described by src/schemas/registry-export.schema.json
 * (JSON Schema 2020-12). Summary of schemaVersion 1:
 *
 *   {
 *     "schemaVersion": 1,
 *     "components": [{
 *       "name": "alert",                 // as used in data-lv-widget
 *       "source": "core",                // "core" | "plugin:<plugin name>" | "custom"
 *       "overrides": false,              // true: a plugin definition that replaced a core one
 *       "description": "..." | null,
 *       "leaf": false,                   // true: nothing inside is recognized
 *       "props": [{ "name", "type": "string"|"bool"|"number"|"color", "default",
 *                   "enum"?: [...], "description": "..." | null }],
 *       "slots": ["icon", "message", "action"],
 *       "signals": [{ "name", "kind": "subject"|"timeline", "type"?: "int", "description" }]
 *     }],
 *     "widgets": [{ "name": "button", "lvgl": "lv_button", "description", "component": null }]
 *   }
 *
 * `components` keep the registry's offer order (core first, then plugins in
 * load order), which is what breaks match-score ties, so it is part of the
 * data. `props` keep the order the definition wrote them, which is the order
 * a property panel should show them. `widgets` are the names
 * `data-lv-widget` accepts that are not components (the converter maps them
 * straight to one LVGL widget); `component` names the registry component with
 * the same name, if any (switch, slider).
 *
 * Where the extra facts come from: an optional `description` / `signals` on a
 * definition and `description` / `enum` on a prop win; for core definitions
 * src/registry-meta.mjs fills in the rest. Nothing is guessed: a missing
 * description is `null`, a component with no signals has `[]`.
 */
import { builtinComponents } from './components/index.mjs';
import { CORE_COMPONENT_META } from './registry-meta.mjs';

/** Bump when the shape of the export changes (and the schema file with it). */
export const REGISTRY_SCHEMA_VERSION = 1;

/**
 * The widgets `data-lv-widget` maps directly (emitForced in src/convert.mjs).
 * tests/registry-export.test.mjs converts each one and checks the first LVGL
 * tag, and that any other name raises WIDGET_UNSUPPORTED, so this list cannot
 * drift from the converter.
 *
 * @type {ReadonlyArray<{ name: string, lvgl: string, description: string }>}
 */
export const FORCED_WIDGETS = [
  { name: 'button', lvgl: 'lv_button', description: 'A button; the element\'s text becomes a label inside it.' },
  { name: 'label', lvgl: 'lv_label', description: 'A text label.' },
  { name: 'dropdown', lvgl: 'lv_dropdown', description: 'A drop-down list; the options come from the element\'s options attribute.' },
  { name: 'bar', lvgl: 'lv_bar', description: 'A progress bar.' },
  { name: 'table', lvgl: 'lv_table', description: 'A table.' },
  { name: 'image', lvgl: 'lv_image', description: 'An image.' },
  { name: 'switch', lvgl: 'lv_switch', description: 'An on/off switch.' },
  { name: 'checkbox', lvgl: 'lv_checkbox', description: 'A checkbox.' },
  { name: 'slider', lvgl: 'lv_slider', description: 'A slider.' },
  { name: 'textarea', lvgl: 'lv_textarea', description: 'A text area.' },
];

/**
 * @typedef {object} ExportedProp
 * @property {string} name
 * @property {'string' | 'bool' | 'number' | 'color'} type
 * @property {unknown} default
 * @property {Array<string | number>} [enum]
 * @property {string | null} description
 *
 * @typedef {object} ExportedComponent
 * @property {string} name
 * @property {string} source
 * @property {boolean} overrides
 * @property {string | null} description
 * @property {boolean} leaf
 * @property {ExportedProp[]} props
 * @property {string[]} slots
 * @property {Array<{ name: string, kind: 'subject' | 'timeline', type?: 'int', description: string }>} signals
 *
 * @typedef {object} RegistryExport
 * @property {number} schemaVersion
 * @property {ExportedComponent[]} components
 * @property {Array<{ name: string, lvgl: string, description: string, component: string | null }>} widgets
 */

/**
 * Export a registry.
 *
 * @param {{ list: () => import('./recognize.mjs').ComponentDef[] }} registry
 *   defaultRegistry, or registryFor(plugins) from src/plugin-loader.mjs.
 * @param {{ plugins?: Array<{ name: string, recognizers?: unknown }> }} [options]
 *   The plugins the registry was built from. They only attribute a definition
 *   to its plugin (by identity); without them, a non-core definition is "custom".
 * @returns {RegistryExport}
 */
export function exportRegistry(registry, { plugins = [] } = {}) {
  const coreByName = new Map(builtinComponents.map((d) => [d.name, d]));
  /** @type {Map<unknown, string>} */
  const pluginOf = new Map();
  for (const plugin of plugins) {
    if (!Array.isArray(plugin.recognizers)) continue;
    for (const def of plugin.recognizers) if (!pluginOf.has(def)) pluginOf.set(def, plugin.name);
  }

  const defs = registry.list();
  const components = defs.map((def) => {
    const isCore = coreByName.get(def.name) === def;
    const plugin = pluginOf.get(def);
    const source = isCore ? 'core' : plugin !== undefined ? `plugin:${plugin}` : 'custom';
    const meta = isCore ? CORE_COMPONENT_META[def.name] : undefined;
    return exportComponent(def, source, !isCore && coreByName.has(def.name), meta);
  });

  const componentNames = new Set(defs.map((d) => d.name));
  const widgets = FORCED_WIDGETS.map((w) => ({ ...w, component: componentNames.has(w.name) ? w.name : null }));
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, components, widgets };
}

/**
 * @param {import('./recognize.mjs').ComponentDef} def
 * @param {string} source
 * @param {boolean} overrides
 * @param {import('./registry-meta.mjs').ComponentMeta | undefined} meta
 * @returns {ExportedComponent}
 */
function exportComponent(def, source, overrides, meta) {
  const props = Object.entries(def.props).map(([name, p]) => {
    const extra = meta?.props?.[name];
    const allowed = p.enum ?? extra?.enum;
    /** @type {ExportedProp} */
    return {
      name,
      type: p.type,
      default: p.default ?? null,
      ...(allowed ? { enum: [...allowed] } : {}),
      description: p.description ?? extra?.description ?? null,
    };
  });
  return {
    name: def.name,
    source,
    overrides,
    description: def.description ?? meta?.description ?? null,
    leaf: def.leaf === true,
    props,
    slots: [...def.slots],
    signals: (def.signals ?? meta?.signals ?? []).map((s) => ({ ...s })),
  };
}

/**
 * The export as the exact text the CLI writes and the golden stores: two-space
 * indented JSON with a trailing newline. Key order is fixed by exportRegistry.
 *
 * @param {RegistryExport} data
 */
export function stringifyRegistryExport(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}
