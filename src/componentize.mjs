/**
 * Componentizer: turn component boundaries (React components stamped by the
 * fiber walk, or manual data-lv-component annotations) into reusable LVGL
 * XML components with props.
 *
 * Works on the converter's element tree, where component roots carry
 * meta.component. For each group of instances with identical structure:
 *
 * - the first instance becomes a <component> definition; placement attributes
 *   (x/y/size/grid cell/margins) move to the instance elements
 * - content attributes that differ between instances (label text, slider
 *   value, ...) become string props: declared in <api>, referenced as $prop
 *   in the view, passed as attributes on each instance element
 * - instances are replaced by `<component_name x=".." prop=".."/>` elements
 *
 * Groups whose instances differ structurally, or differ in an attribute that
 * cannot be a prop (e.g. a style), are left inline with a warning.
 * The original (flattened) tree is not mutated — C emission keeps using it.
 */
import { el, render, escAttr } from './emit-xml.mjs';
import { createDiagnostics } from './diagnostics.mjs';

const PLACEMENT_ATTRS = new Set([
  'x', 'y', 'width', 'height', 'ignore_layout', 'flex_grow',
  'style_margin_left', 'style_margin_right', 'style_margin_top', 'style_margin_bottom',
  'style_grid_cell_column_pos', 'style_grid_cell_row_pos',
  'style_grid_cell_column_span', 'style_grid_cell_row_span',
]);

/** Attribute keys whose per-instance differences may become string props. */
const PROPPABLE_ATTRS = new Set(['text', 'value', 'placeholder_text', 'options', 'src', 'checked', 'selected']);

/**
 * Color attributes can be props too: $prop substitution happens before value
 * parsing, so a color-typed prop lands in lv_xml_to_color intact.
 */
const PROPPABLE_COLOR_ATTRS = new Set(['style_bg_color', 'style_text_color', 'style_border_color', 'style_bg_grad_color']);

export function componentize(view, { diagnostics: shared = null } = {}) {
  const diagnostics = createDiagnostics();
  const root = structuredClone(view);
  const components = new Map(); // snake_name -> xml

  // Collect instance sites, innermost first, so outer component definitions
  // reference inner instance elements.
  const groups = new Map(); // snake_name -> [{parent, index}]
  (function collect(node) {
    node.children.forEach((child, index) => {
      collect(child);
      if (child.meta?.component) {
        const name = snake(child.meta.component);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push({ parent: node, index });
      }
    });
  })(root);

  for (const [name, sites] of groups) {
    const instances = sites.map((s) => s.parent.children[s.index]);

    // The mounted App component spans the whole page — it IS the page, not a
    // reusable part (and its name would collide with the page file).
    if (sites.length === 1 && sites[0].parent === root && root.children.length === 1) {
      continue;
    }

    const sig = signature(instances[0]);
    if (!instances.every((inst) => signature(inst) === sig)) {
      diagnostics.add({
        code: 'COMPONENT_INLINE',
        message: `component ${name}: instances differ structurally; left inline`,
        fix: `Make every instance of ${name} render the same element structure (same children in the same order), or remove its data-lv-component marker so it stays inline on purpose.`,
        output: { widget: name },
      });
      continue;
    }

    // Find aligned attributes that differ across instances.
    const props = [];
    let bail = null;
    walkAligned(instances, (els, path) => {
      const isInstanceEl = components.has(els[0].tag); // nested component ref
      for (const key of Object.keys(els[0].attrs)) {
        if (key === 'name') continue;
        // signature() ignores placement at every depth (see below), so the
        // prop scan must too — otherwise a child that only moved position
        // bails the whole group with a misleading "non-proppable" warning.
        // Only the root instance's placement is carried per-instance (see
        // the replacement loop below); a *nested* child's placement is fixed
        // in the shared definition from the first instance, so a genuine
        // per-instance difference there is silently flattened. Surface that
        // instead of staying quiet about it.
        if (PLACEMENT_ATTRS.has(key)) {
          if (path.length > 0 && new Set(els.map((e) => String(e.attrs[key]))).size > 1) {
            diagnostics.add({
              code: 'COMPONENT_NESTED_DIFFERS',
              message: `component ${name}: nested "${key}" differs across instances; only the first instance's value is kept`,
              fix: `In the generated ${name}.xml, move the nested "${key}" into a prop, or set it per instance by hand after the component is created.`,
              output: { widget: name },
            });
          }
          continue;
        }
        const values = els.map((e) => String(e.attrs[key]));
        if (new Set(values).size <= 1) continue;
        if (PROPPABLE_ATTRS.has(key) || PROPPABLE_COLOR_ATTRS.has(key) || isInstanceEl) {
          const type = PROPPABLE_COLOR_ATTRS.has(key) ? 'color' : 'string';
          props.push({ prop: propName(els[0], key, props), path, key, values, type });
        } else {
          bail = { key };
        }
      }
    });
    if (bail) {
      diagnostics.add({
        code: 'COMPONENT_ATTR_NOT_PROPPABLE',
        message: `component ${name}: instances differ in non-proppable attribute "${bail.key}"; left inline`,
        fix: `Give every instance of ${name} the same "${bail.key}" value, or style it with a shared class so it is identical, then convert again.`,
        output: { widget: name },
      });
      continue;
    }

    // Build the definition from the first instance.
    const def = structuredClone(instances[0]);
    delete def.meta;
    for (const p of props) {
      getAt(def, p.path).attrs[p.key] = `$${p.prop}`;
    }
    const viewAttrs = { ...(def.tag !== 'lv_obj' ? { extends: def.tag } : {}) };
    for (const [k, v] of Object.entries(def.attrs)) {
      if (k !== 'name' && !PLACEMENT_ATTRS.has(k)) viewAttrs[k] = v;
    }
    const viewEl = el('view', viewAttrs, def.children);
    const api = props.length
      ? `  <api>\n${props.map((p) => `    <prop type="${p.type}" name="${p.prop}" default="${escAttr(p.values[0])}"/>`).join('\n')}\n  </api>\n`
      : '';
    components.set(name, `<component>\n${api}${render(viewEl, 1)}\n</component>\n`);

    // Replace each instance with a reference element.
    sites.forEach((site, i) => {
      const inst = site.parent.children[site.index];
      const attrs = { name: inst.attrs.name };
      for (const [k, v] of Object.entries(inst.attrs)) {
        if (PLACEMENT_ATTRS.has(k)) attrs[k] = v;
      }
      for (const p of props) {
        if (p.path.length === 0) attrs[p.prop] = p.values[i]; // root-level prop
      }
      // Non-root props still need per-instance values.
      for (const p of props.filter((p) => p.path.length > 0)) {
        attrs[p.prop] = p.values[i];
      }
      site.parent.children[site.index] = el(name, attrs);
    });
  }

  if (shared) shared.merge(diagnostics);
  return { view: root, components, warnings: diagnostics.toWarningStrings(), diagnostics };
}

/* ----------------------------------------------------------------- utils */

const snake = (s) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_');

/** Structural signature: tags + attribute keys (not values), recursively. */
function signature(node) {
  const keys = Object.keys(node.attrs)
    .filter((k) => k !== 'name' && !PLACEMENT_ATTRS.has(k))
    .sort();
  return JSON.stringify([node.tag, keys, node.children.map(signature)]);
}

/** Visit structurally aligned element tuples across all instances. */
function walkAligned(instances, fn, path = []) {
  fn(instances, path);
  const childCount = instances[0].children.length;
  for (let i = 0; i < childCount; i++) {
    walkAligned(instances.map((inst) => inst.children[i]), fn, [...path, i]);
  }
}

function getAt(node, path) {
  return path.reduce((n, i) => n.children[i], node);
}

function propName(node, key, existing) {
  let base = (node.attrs.name || key).replace(/_\d+$/, '');
  if (key !== 'text') base = `${base}_${key}`;
  let name = base;
  let n = 2;
  while (existing.some((p) => p.prop === name)) name = `${base}_${n++}`;
  return name;
}
