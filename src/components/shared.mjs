/**
 * Helpers the Phase 7 component definitions share, so each file holds only its
 * own matching and building. Pure functions of a UiNode.
 *
 * Match scores used by the built-in components, highest wins:
 *   2    data-lv-widget="<name>" (set by the registry itself, not here)
 *   1    a native semantic signal: a role, an ARIA attribute, a landmark tag
 *   0.7  a Material UI root class (Mui<Name>-root)
 *   0.5  a generic library class (Bootstrap's `card`, `badge`, `alert`, ...)
 */

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

export const SCORE_SEMANTIC = 1;
export const SCORE_MUI = 0.7;
export const SCORE_GENERIC_CLASS = 0.5;

/**
 * Every class on the node. Falls back to the first class, which older
 * extractor output carries, so definitions also work on old fixtures.
 * @param {UiNode} node
 * @returns {string[]}
 */
export function classesOf(node) {
  if (Array.isArray(node.classes) && node.classes.length) return node.classes;
  return node.className ? [node.className] : [];
}

/**
 * The Material UI components a node is the root of: `MuiCard-root` gives
 * "Card". An element can be the root of several, since a Card is also a
 * Paper, and an Alert is a Paper too.
 * @param {UiNode} node
 * @returns {string[]}
 */
export function muiRoots(node) {
  const roots = [];
  for (const c of classesOf(node)) {
    const m = /^Mui([A-Za-z]+)-root$/.exec(c);
    if (m) roots.push(m[1]);
  }
  return roots;
}

/** @param {UiNode} node @param {string} name e.g. "Card" */
export const hasMuiRoot = (node, name) => muiRoots(node).includes(name);

/**
 * True when the node carries any of the given classes.
 * @param {UiNode} node
 * @param {string[]} names
 */
export function hasClass(node, ...names) {
  const classes = classesOf(node);
  return names.some((n) => classes.includes(n));
}

/** The node's `aria-*` value, or undefined. */
export const ariaOf = (node, key) => (node.aria && typeof node.aria === 'object' ? node.aria[key] : undefined);

/**
 * A copy of the node with a readable widget name, unless the author already
 * set one with data-lv-name. convert() numbers repeats (card, card_2, ...).
 * @param {UiNode} node
 * @param {string} name
 * @returns {UiNode}
 */
export function withName(node, name) {
  return node.lvName ? node : { ...node, lvName: name };
}
