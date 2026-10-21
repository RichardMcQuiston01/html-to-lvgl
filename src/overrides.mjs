/**
 * Sidecar overrides: `<page>.lvgl.json` next to a page changes the generated
 * UI without editing the page's HTML, and the changes survive re-conversion.
 *
 *   {
 *     "version": 1,
 *     "nodes": {
 *       "<name>": { "attrs": { "width": 120, "style_bg_color": "0xff0000", "text": null },
 *                   "remove": true }
 *     }
 *   }
 *
 * `<name>` is the generated widget's `name` attribute. `attrs` values replace
 * or add attributes; `null` removes one; `remove: true` deletes the node and
 * its subtree. Overrides are applied to the emitted `view` element tree (the
 * tree every emitter consumes) right after convert(), BEFORE componentize(),
 * so XML, C, C++, Python and the extracted component definitions all agree.
 *
 * How stable are names? A name from `data-lv-name` or `id` is chosen by the
 * author and survives edits to the page. A name derived from the class (or
 * the tag) gets a numeric suffix when it repeats (`card`, `card_2`, ...), and
 * that suffix shifts when siblings are added, removed, or reordered, so an
 * override aimed at `card_2` can silently land on a different card. Put
 * `data-lv-name` on anything an override targets.
 *
 * This module is pure (no browser) apart from loadOverrides() reading a file.
 */
import { existsSync, readFileSync } from 'node:fs';

export const OVERRIDES_VERSION = 1;

const ATTR_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const describe = (v) => (v === undefined ? 'undefined' : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/**
 * Check a parsed sidecar. Reports every problem at once.
 * @param {unknown} value
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateOverrides(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [`top level must be an object, got ${describe(value)}`] };
  }
  if (value.version !== OVERRIDES_VERSION) {
    errors.push(`"version" must be ${OVERRIDES_VERSION}, got ${JSON.stringify(value.version) ?? 'nothing'}`);
  }
  if (!isPlainObject(value.nodes)) {
    errors.push(`"nodes" must be an object mapping widget names to overrides, got ${describe(value.nodes)}`);
    return { ok: false, errors };
  }
  for (const [name, spec] of Object.entries(value.nodes)) {
    if (!isPlainObject(spec)) {
      errors.push(`nodes.${name} must be an object, got ${describe(spec)}`);
      continue;
    }
    if ('remove' in spec && typeof spec.remove !== 'boolean') {
      errors.push(`nodes.${name}.remove must be a boolean, got ${describe(spec.remove)}`);
    }
    if ('attrs' in spec) {
      if (!isPlainObject(spec.attrs)) {
        errors.push(`nodes.${name}.attrs must be an object, got ${describe(spec.attrs)}`);
        continue;
      }
      for (const [key, v] of Object.entries(spec.attrs)) {
        if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
          errors.push(`nodes.${name}.attrs.${key} must be a string, number, boolean or null, got ${describe(v)}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Read and validate a sidecar file. Never throws. A missing file is fine
 * (no overrides); an unreadable, malformed or wrong-version one is not ok.
 * @param {string} path
 * @returns {{ ok: boolean, overrides: object | null, errors: string[] }}
 */
export function loadOverrides(path) {
  if (!existsSync(path)) return { ok: true, overrides: null, errors: [] };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, overrides: null, errors: [`cannot read ${path}: ${e.message}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, overrides: null, errors: [`${path} is not valid JSON: ${e.message}`] };
  }
  const { ok, errors } = validateOverrides(parsed);
  return ok ? { ok: true, overrides: parsed, errors: [] } : { ok: false, overrides: null, errors };
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Up to `limit` existing names closest to `target`, best first. */
function closest(target, names, limit = 3) {
  const t = target.toLowerCase();
  return names
    .map((n) => {
      const l = n.toLowerCase();
      let d = levenshtein(t, l);
      if (l.includes(t) || t.includes(l)) d = Math.min(d, 1);
      return { n, d };
    })
    .filter(({ n, d }) => d <= Math.max(2, Math.ceil(Math.max(n.length, t.length) / 3)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, limit)
    .map(({ n }) => n);
}

function collectNames(node, out = []) {
  if (typeof node.attrs?.name === 'string') out.push(node.attrs.name);
  for (const c of node.children) collectNames(c, out);
  return out;
}

/**
 * Apply overrides to a view tree and return the new tree; the input is not
 * mutated. Problems become diagnostics and the offending override is skipped.
 *
 * @param {{ tag: string, attrs: object, children: object[] }} view
 * @param {{ nodes: Record<string, { attrs?: object, remove?: boolean }> } | null} overrides
 * @param {{ diagnostics?: { add(d: object): unknown }, file?: string }} [opts]
 */
export function applyOverrides(view, overrides, { diagnostics = null, file } = {}) {
  if (!overrides || !isPlainObject(overrides.nodes) || Object.keys(overrides.nodes).length === 0) return view;
  const nodes = overrides.nodes;
  const names = collectNames(view);
  const source = file ? { file } : null;

  for (const name of Object.keys(nodes)) {
    if (names.includes(name)) continue;
    const near = closest(name, names);
    diagnostics?.add({
      code: 'OVERRIDE_TARGET_UNKNOWN',
      message: `Override targets "${name}", but no generated widget has that name.` +
        (near.length ? ` Closest names: ${near.join(', ')}.` : ' No similar names exist.'),
      fix: (near.length ? `Change the key to one of: ${near.join(', ')}. ` : '') +
        'Names come from data-lv-name, id, or class; add data-lv-name="..." to the element and target that, ' +
        'because class-derived names with a numeric suffix (card_2) shift when siblings change.',
      source,
      output: { widget: name },
    });
  }

  const rebuild = (node) => {
    const name = node.attrs?.name;
    const spec = typeof name === 'string' && Object.hasOwn(nodes, name) ? nodes[name] : null;
    if (spec?.remove === true) return null;
    let attrs = node.attrs;
    if (spec && isPlainObject(spec.attrs)) {
      attrs = { ...node.attrs };
      for (const [key, v] of Object.entries(spec.attrs)) {
        const problem = key === 'name'
          ? 'the name attribute identifies the widget and cannot be overridden'
          : !ATTR_KEY.test(key)
            ? 'attribute names may only contain letters, digits and underscores'
            : v !== null && !['string', 'number', 'boolean'].includes(typeof v)
              ? `value must be a string, number, boolean or null, got ${describe(v)}`
              : null;
        if (problem) {
          diagnostics?.add({
            code: 'OVERRIDE_ATTR_INVALID',
            message: `Override attribute "${key}" on "${name}" was ignored: ${problem}.`,
            fix: `Fix or delete nodes.${name}.attrs.${key} in the sidecar file; use null to remove an attribute.`,
            source,
            output: { widget: name },
          });
        } else if (v === null) delete attrs[key];
        else attrs[key] = typeof v === 'boolean' ? String(v) : v;
      }
    }
    return { ...node, attrs: { ...attrs }, children: node.children.map(rebuild).filter(Boolean) };
  };
  return rebuild(view);
}
