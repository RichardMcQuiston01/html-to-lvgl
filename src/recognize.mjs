/**
 * Component recognition: a pass that runs on the extracted UI tree before
 * conversion. It finds components that no tag names (an Accordion is just
 * styled divs) by asking each registered definition whether a node matches,
 * and lets the winning definition rewrite that part of the tree.
 *
 * Recognition is ARIA-first: roles and states are a web standard, so one
 * definition works for Material UI, Bootstrap, Radix, and hand-written HTML.
 * `data-lv-widget="<name>"` on an element always wins, so a person can fix a
 * wrong guess.
 *
 * With an empty registry the pass changes nothing except two things that are
 * invisible in the output: every node gains a stable `key`, and hidden nodes
 * (see UiNode) are dropped. See COMPONENTS.md, "The Registry".
 *
 * This module is pure: no browser, no file system.
 */
import { createDiagnostics } from './diagnostics.mjs';
import { linkAria } from './link-aria.mjs';
import { builtinComponents } from './components/index.mjs';

/**
 * One node of the extracted UI tree, as src/extract.mjs produces it. Only the
 * fields recognition relies on are listed in full; the rest (x, y, w, h, text,
 * attrs, styles, layout) are documented in src/extract.mjs.
 *
 * The fields marked "extractor" are added to the extractor in Phase 6. Until
 * then they are absent, and every reader must treat a missing value as the
 * default shown.
 *
 * @typedef {object} UiNode
 * @property {string} tag                 Lower-case tag name.
 * @property {string | null} id           The `id` attribute.
 * @property {string | null} className    The first class only (older field).
 * @property {string | null} lvName       `data-lv-name`.
 * @property {string | null} widget       `data-lv-widget`.
 * @property {string | null} component    `data-lv-component`.
 * @property {string | null} link         `data-lv-link`.
 * @property {UiNode[]} children
 * @property {string | null} [role]       extractor: the `role` attribute. Default null.
 * @property {Record<string, string>} [aria]
 *   extractor: every `aria-*` attribute, keyed WITHOUT the prefix:
 *   `aria-expanded="true"` is `{ expanded: 'true' }`. Default `{}`.
 * @property {string[]} [classes]         extractor: every class. Default `[]`.
 * @property {string | null} [testId]     extractor: `data-testid`. Default null.
 * @property {boolean} [hidden]
 *   extractor: true when the element or an ancestor is not displayed
 *   (`display: none`, `visibility: hidden`, or zero size). Hidden nodes are
 *   kept in the tree so a recognizer can read them (an Accordion body, a
 *   closed Modal). Anything a recognizer does not consume is dropped before
 *   conversion. Default false.
 * @property {string} [key]
 *   added by recognize(): a stable key. See annotateKeys().
 * @property {{ component: string, props: Record<string, unknown> }} [recognized]
 *   added by recognize(): which definition matched this node, and its props.
 */

/**
 * @typedef {object} PropDef
 * @property {'string' | 'bool' | 'number' | 'color'} type
 * @property {unknown} default
 */

/**
 * The context passed to match() and build().
 * @typedef {object} RecognizeContext
 * @property {UiNode} tree                       The whole tree, hidden nodes included.
 * @property {UiNode | null} parent              The node's parent, or null at the root.
 * @property {Map<string, UiNode>} byId          Every node with an `id`, hidden ones too.
 * @property {Map<string, { controls: string[], controlledBy: string[], labelledBy?: string[], describedBy?: string[] }>} links
 *   Keyed by node key. The ARIA trigger/target links (see src/link-aria.mjs).
 *   `labelledBy` / `describedBy` hold the keys named by the node's own
 *   `aria-labelledby` / `aria-describedby` (a dialog's title and body).
 * @property {ReturnType<typeof createDiagnostics>} diagnostics
 */

/**
 * A component definition. Plain data plus two functions, so the future editor
 * can build its palette and property panel from `props` and `slots` without
 * running anything.
 *
 * @typedef {object} ComponentDef
 * @property {string} name        Unique, lower-case, as used in `data-lv-widget`.
 * @property {(node: UiNode, ctx: RecognizeContext) => number | boolean} match
 *   A confidence. false or 0 means no match. true means 1. A larger number
 *   wins. `data-lv-widget="<name>"` counts as 2.
 * @property {Record<string, PropDef>} props
 * @property {string[]} slots     Names of the places children can go.
 * @property {(node: UiNode, ctx: RecognizeContext) => UiNode | null | undefined} build
 *   Return a replacement node (same shape as UiNode), or null to keep the
 *   node as it is. The replacement may carry `recognized.props`.
 * @property {boolean} [leaf]     True to skip recognizing inside this node.
 */

/**
 * The result of checking a definition. Callers must check `ok`.
 * @typedef {object} ComponentCheck
 * @property {boolean} ok
 * @property {string[]} errors
 */

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PROP_TYPES = new Set(['string', 'bool', 'number', 'color']);

/**
 * Check that a value is a usable component definition. Never throws.
 * @param {unknown} candidate
 * @returns {ComponentCheck}
 */
export function validateComponent(candidate) {
  /** @type {string[]} */
  const errors = [];
  if (candidate === null || typeof candidate !== 'object') {
    return { ok: false, errors: [`a component definition must be an object, got ${candidate === null ? 'null' : typeof candidate}`] };
  }
  const def = /** @type {Record<string, unknown>} */ (candidate);
  const label = typeof def.name === 'string' && def.name ? `component "${def.name}"` : 'component';

  if (typeof def.name !== 'string' || !NAME_PATTERN.test(def.name)) {
    errors.push('a component needs a `name` of lower-case letters, digits, "-" or "_", starting with a letter');
  }
  if (typeof def.match !== 'function') errors.push(`${label}: \`match\` must be a function`);
  if (typeof def.build !== 'function') errors.push(`${label}: \`build\` must be a function`);

  if (def.props === null || typeof def.props !== 'object' || Array.isArray(def.props)) {
    errors.push(`${label}: \`props\` must be an object (use {} when there are none)`);
  } else {
    for (const [propName, propDef] of Object.entries(def.props)) {
      const p = /** @type {Record<string, unknown> | null} */ (propDef);
      if (p === null || typeof p !== 'object' || !PROP_TYPES.has(/** @type {string} */ (p.type))) {
        errors.push(`${label}: prop "${propName}" needs a \`type\` of string, bool, number or color`);
      } else if (!('default' in p)) {
        errors.push(`${label}: prop "${propName}" needs a \`default\``);
      }
    }
  }

  if (!Array.isArray(def.slots) || !def.slots.every((s) => typeof s === 'string')) {
    errors.push(`${label}: \`slots\` must be an array of strings (use [] when there are none)`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * A registry of component definitions. add() returns a result the caller
 * must check, so one bad definition is reported and skipped instead of
 * breaking the whole run.
 *
 * @param {ComponentDef[]} [defs]  Definitions to add. Invalid ones are skipped;
 *                                  read `rejected` to see why.
 */
export function createRegistry(defs = []) {
  /** @type {ComponentDef[]} */
  const list = [];
  /** @type {string[]} */
  const rejected = [];

  const registry = {
    /**
     * @param {ComponentDef} def
     * @returns {ComponentCheck}
     */
    add(def) {
      const check = validateComponent(def);
      if (!check.ok) return check;
      if (list.some((d) => d.name === def.name)) {
        return { ok: false, errors: [`a component named "${def.name}" is already registered`] };
      }
      list.push(def);
      return { ok: true, errors: [] };
    },
    /** @returns {ComponentDef[]} In registration order. */
    list: () => [...list],
    /** @param {string} name */
    get: (name) => list.find((d) => d.name === name) ?? null,
    /** @returns {string[]} Why definitions passed to createRegistry were skipped. */
    get rejected() {
      return [...rejected];
    },
  };

  for (const def of defs) {
    const check = registry.add(def);
    if (!check.ok) rejected.push(...check.errors);
  }
  return registry;
}

/**
 * The registry used when convert() is not given one: the components that ship
 * with html2lvgl. Empty until Phase 7 adds them (src/components/index.mjs).
 */
export const defaultRegistry = createRegistry(builtinComponents);

/**
 * The palette data the editor needs: every definition's name, props and
 * slots, as plain JSON. No functions.
 *
 * @param {ReturnType<typeof createRegistry>} registry
 */
export function describeRegistry(registry) {
  return registry.list().map((d) => ({ name: d.name, props: d.props, slots: d.slots }));
}

/**
 * Give every node a stable `key`, used to name it in diagnostics, the editor,
 * and the sidecar overrides file.
 *
 *   data-lv-name="x"  ->  name:x
 *   id="x"            ->  #x
 *   otherwise         ->  a path of tag[index] from the root: body/div[0]/button[1]
 *
 * A key an author sets (name or id) survives edits to the page. A path key
 * changes when siblings are added or removed, so it is a fallback. A repeated
 * key gets a "~2", "~3" suffix, so every key is unique.
 *
 * @param {UiNode} tree  Changed in place.
 * @returns {UiNode}
 */
export function annotateKeys(tree) {
  /** @type {Map<string, number>} */
  const seen = new Map();

  /**
   * @param {UiNode} node
   * @param {string} path
   */
  function visit(node, path) {
    const base = node.lvName ? `name:${node.lvName}` : node.id ? `#${node.id}` : path;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    node.key = count === 1 ? base : `${base}~${count}`;
    node.children.forEach((child, i) => visit(child, `${path}/${child.tag}[${i}]`));
  }

  visit(tree, tree.tag);
  return tree;
}

/** Remove every node still flagged hidden. Runs after recognition. */
function dropHidden(node) {
  node.children = node.children.filter((c) => !c.hidden);
  for (const c of node.children) dropHidden(c);
}

/**
 * A copy of the tree with every hidden node removed. Use it in any code that
 * reads the extracted tree before convert() runs (font planning, for one), so
 * text that never appears on screen does not cost anything.
 *
 * @param {UiNode} tree  Not changed.
 * @returns {UiNode}
 */
export function withoutHidden(tree) {
  const copy = structuredClone(tree);
  dropHidden(copy);
  return copy;
}

/** @param {UiNode} node @param {Map<string, UiNode>} byId */
function collectIds(node, byId) {
  if (node.id && !byId.has(node.id)) byId.set(node.id, node);
  for (const c of node.children) collectIds(c, byId);
}

/** A match() result as a number. false, 0, NaN and a throw all mean "no". */
function scoreOf(def, node, ctx, diagnostics) {
  if (node.widget === def.name) return 2;
  try {
    const result = def.match(node, ctx);
    if (result === true) return 1;
    return typeof result === 'number' && result > 0 ? result : 0;
  } catch (error) {
    diagnostics.add({
      code: 'RECOGNIZER_ERROR',
      message: `component "${def.name}": match() threw on ${node.key}: ${describe(error)}`,
      fix: `Fix the "${def.name}" definition, or add data-lv-widget to ${node.key} to choose the mapping by hand.`,
      source: { selector: node.key },
    });
    return 0;
  }
}

const describe = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Run recognition on a tree.
 *
 * Order: keys are assigned, ARIA links are computed, each node is offered to
 * every definition from the top down, and finally hidden nodes nobody used
 * are dropped.
 *
 * A definition that throws is reported as RECOGNIZER_ERROR and skipped; the
 * node stays as it was. Two definitions with the same top score are reported
 * as RECOGNIZER_AMBIGUOUS and the one registered first wins.
 *
 * @param {UiNode} tree  Changed in place. Pass a copy to keep the original.
 * @param {object} [options]
 * @param {ReturnType<typeof createRegistry>} [options.registry]
 * @param {ReturnType<typeof createDiagnostics>} [options.diagnostics]
 * @param {(tree: UiNode, options?: { diagnostics?: ReturnType<typeof createDiagnostics> }) => RecognizeContext['links']} [options.linker]
 * @returns {{ tree: UiNode, recognized: number }}
 */
export function recognize(tree, { registry = defaultRegistry, diagnostics = createDiagnostics(), linker = linkAria } = {}) {
  annotateKeys(tree);

  /** @type {Map<string, UiNode>} */
  const byId = new Map();
  collectIds(tree, byId);

  /** @type {RecognizeContext['links']} */
  let links = new Map();
  try {
    links = linker(tree, { diagnostics });
  } catch (error) {
    diagnostics.add({
      code: 'RECOGNIZER_ERROR',
      message: `the ARIA linker threw: ${describe(error)}`,
      fix: 'Components that depend on aria-controls will not be recognized until this is fixed; report it with the page that caused it.',
    });
  }

  const defs = registry.list();
  let recognized = 0;

  /**
   * @param {UiNode} node
   * @param {UiNode | null} parent
   * @returns {UiNode} The node to keep in the tree (possibly a replacement).
   */
  function visit(node, parent) {
    /** @type {RecognizeContext} */
    const ctx = { tree, parent, byId, links, diagnostics };
    let current = node;

    // data-lv-widget naming a built-in widget ("label", "switch", ...) is
    // convert()'s to honor; no registry definition may guess over it.
    const builtinChoice = Boolean(node.widget) && !defs.some((d) => d.name === node.widget);
    const scored = builtinChoice
      ? []
      : defs
        .map((def) => ({ def, score: scoreOf(def, node, ctx, diagnostics) }))
        .filter((s) => s.score > 0);

    if (scored.length) {
      const top = Math.max(...scored.map((s) => s.score));
      const winners = scored.filter((s) => s.score === top);
      const { def } = winners[0];
      if (winners.length > 1) {
        diagnostics.add({
          code: 'RECOGNIZER_AMBIGUOUS',
          message: `${node.key} matches ${winners.map((w) => `"${w.def.name}"`).join(' and ')} equally well; using "${def.name}"`,
          fix: `Add data-lv-widget="<name>" to ${node.key} to choose one.`,
          source: { selector: node.key },
        });
      }
      current = applyDefinition(def, node, ctx);
    }

    const leaf = scored.length > 0 && current.recognized && defs.find((d) => d.name === current.recognized?.component)?.leaf;
    if (!leaf) current.children = current.children.map((child) => visit(child, current));
    return current;
  }

  /**
   * @param {ComponentDef} def
   * @param {UiNode} node
   * @param {RecognizeContext} ctx
   * @returns {UiNode}
   */
  function applyDefinition(def, node, ctx) {
    let result;
    try {
      result = def.build(node, ctx);
    } catch (error) {
      diagnostics.add({
        code: 'RECOGNIZER_ERROR',
        message: `component "${def.name}": build() threw on ${node.key}: ${describe(error)}`,
        fix: `Fix the "${def.name}" definition, or add data-lv-ignore to ${node.key} to leave it out.`,
        source: { selector: node.key },
      });
      return node;
    }
    if (result === null || result === undefined) {
      node.recognized = { component: def.name, props: node.recognized?.props ?? {} };
      recognized += 1;
      return node;
    }
    if (typeof result !== 'object' || typeof result.tag !== 'string' || !Array.isArray(result.children)) {
      diagnostics.add({
        code: 'RECOGNIZER_ERROR',
        message: `component "${def.name}": build() on ${node.key} must return a node with a \`tag\` and a \`children\` array, or null`,
        fix: `Fix the "${def.name}" definition so build() returns a node of the same shape as the input.`,
        source: { selector: node.key },
      });
      return node;
    }
    result.key = result.key ?? node.key;
    result.recognized = { component: def.name, props: result.recognized?.props ?? {} };
    recognized += 1;
    return result;
  }

  const root = visit(tree, null);
  dropHidden(root);
  return { tree: root, recognized };
}
