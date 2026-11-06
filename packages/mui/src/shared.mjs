/**
 * Helpers the Material UI recognizers share. Pure functions of a UiNode.
 *
 * This package must not import the core at run time (a workspace install can
 * hand a package a different copy of it than the one running the CLI), so the
 * few helpers it needs are small and live here.
 *
 * Match scores, as in the core (COMPONENTS.md, "How Recognition Works"):
 *   0.8  the React component name (`node.framework`), which survives hashed,
 *        renamed or overridden class names
 *   0.7  a Material UI class (`Mui<Name>-root`), the same signal the core uses
 *   1    ARIA, reserved for the core: nothing here scores that high, except
 *        the icon definition (0.95, see icon.mjs) when it can name a symbol
 */

/** @typedef {import('../../../src/recognize.mjs').UiNode} UiNode */

export const SCORE_FIBER = 0.8;
export const SCORE_CLASS = 0.7;

/**
 * Every class on the node, falling back to the first class of an older tree.
 * @param {UiNode} node
 * @returns {string[]}
 */
export function classesOf(node) {
  if (Array.isArray(node.classes) && node.classes.length) return node.classes;
  return node.className ? [node.className] : [];
}

/** @param {UiNode} node @param {...string} names */
export const hasClass = (node, ...names) => {
  const classes = classesOf(node);
  return names.some((n) => classes.includes(n));
};

/**
 * True when the node carries a Material UI part class whatever its prefix is:
 * `hasPart(node, 'Rating-iconFilled')` matches `MuiRating-iconFilled` and
 * `AcmeRating-iconFilled` (ClassNameGenerator.configure renames the prefix).
 * The state classes (`Mui-checked`, `Mui-disabled`) are never renamed, so they
 * are matched with hasClass.
 * @param {UiNode} node
 * @param {...string} parts  e.g. "Rating-icon".
 */
export const hasPart = (node, ...parts) => classesOf(node).some((c) => parts.some((p) => c === p || (c.endsWith(p) && /[a-z]/.test(c[c.length - p.length - 1] ?? ''))));

/**
 * The Material UI component a React component name stands for. React names
 * what a bundler left of Material UI's source: `Button2` (esbuild numbers a
 * name that is declared twice), `MuiButtonRoot` (the styled root element) and
 * `Styled(div)` (a `styled()` wrapper, never a Material UI name). Both suffixes
 * go, so every form of one component compares equal.
 * @param {string} name
 * @returns {string}
 */
export function componentName(name) {
  return name.replace(/^Mui(?=[A-Z])/, '').replace(/Root$/, '').replace(/\d+$/, '');
}

/**
 * The React components whose output root is this node, innermost first, with
 * their props (see FrameworkInfo in src/recognize.mjs). Empty when the page
 * was not loaded through a framework plugin, or for a node no component roots in.
 * @param {UiNode} node
 * @returns {Array<{ name: string, props: Record<string, string | number | boolean> }>}
 */
export function chainOf(node) {
  const chain = node.framework?.chain;
  if (!Array.isArray(chain)) return [];
  return chain.map((c) => ({ name: componentName(c.name), props: c.props ?? {} }));
}

/**
 * The props React gave component `name` when it rendered this node, or null
 * when no such component roots here. Only primitive props are listed.
 * @param {UiNode} node
 * @param {string} name  A Material UI component, e.g. "Checkbox".
 * @returns {Record<string, string | number | boolean> | null}
 */
export function propsOf(node, name) {
  // The outermost entry is the one the author wrote (`Button`), the inner ones
  // are what it renders (`ButtonBase`); a name can appear twice (the styled
  // root and the component itself), and the component itself has the props.
  const entries = chainOf(node).filter((c) => c.name === name);
  return entries.length ? entries[entries.length - 1].props : null;
}

/**
 * How well a node is Material UI component `name`: SCORE_FIBER when React says
 * so, else SCORE_CLASS when it carries `Mui<name>-root`, else false.
 * @param {UiNode} node
 * @param {string} name
 * @returns {number | false}
 */
export function muiScore(node, name) {
  if (propsOf(node, name) !== null) return SCORE_FIBER;
  if (hasClass(node, `Mui${name}-root`)) return SCORE_CLASS;
  return false;
}

/** Every node under (and including) `node` that passes `test`, in document order. */
export function findAll(node, test) {
  /** @type {UiNode[]} */
  const found = [];
  const visit = (n) => {
    if (test(n)) found.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(node);
  return found;
}

/** The first node under `node` that passes `test`, or null. */
export const findFirst = (node, test) => findAll(node, test)[0] ?? null;

/** `[r, g, b]` as the 0xRRGGBB text an LVGL XML color attribute takes. */
export const hexOf = ([r, g, b]) => `0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** @param {number[]} fg @param {number} alpha 0-255 @param {number[]} bg */
const mix = (fg, alpha, bg) => [0, 1, 2].map((i) => Math.round((fg[i] * alpha + bg[i] * (255 - alpha)) / 255));

/**
 * The solid color behind a node: the nearest ancestor with an opaque fill, or
 * white when the page shows none (what a browser paints under everything). A
 * translucent fill is folded onto what is behind it.
 * @param {{ tree?: UiNode, parent?: UiNode | null } | undefined} ctx
 * @param {UiNode} node
 * @returns {[number, number, number]}
 */
export function backdropOf(ctx, node) {
  /** @type {UiNode[] | null} */
  let path = null;
  const find = (n, trail) => {
    if (n === node) { path = trail; return true; }
    return n.children.some((c) => find(c, [...trail, n]));
  };
  if (ctx?.tree) find(ctx.tree, []);
  const ancestors = path ?? (ctx?.parent ? [ctx.parent] : []);
  /** @type {[number, number, number]} */
  let behind = [255, 255, 255];
  // Walk from the page down to the node, so a translucent layer lands on what is under it.
  for (const a of ancestors) {
    const bg = a.styles?.bgColor;
    if (!bg || bg[3] === 0) continue;
    behind = bg[3] >= 255 ? [bg[0], bg[1], bg[2]] : /** @type {[number, number, number]} */ (mix(bg, bg[3], behind));
  }
  return behind;
}

/**
 * A color with its alpha folded onto a backdrop. The converter writes colors
 * as 0xRRGGBB and drops the alpha, so Material UI's `rgba(0,0,0,0.54)` would
 * come out black.
 * @param {number[] | null | undefined} color  [r, g, b, a]
 * @param {[number, number, number]} backdrop
 * @returns {[number, number, number] | null}
 */
export function solid(color, backdrop) {
  if (!color || color[3] === 0) return null;
  if (color[3] >= 255) return [color[0], color[1], color[2]];
  return /** @type {[number, number, number]} */ (mix(color, color[3], backdrop));
}

/** lower_snake_case, or '' when nothing usable is left. */
export function snake(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * A name unless the author already set one with data-lv-name.
 * @param {UiNode} node
 * @param {string} name
 * @returns {UiNode}
 */
export const withName = (node, name) => (node.lvName ? node : { ...node, lvName: name });

/**
 * A new leaf node that draws one box, positioned by its own x/y/w/h. It starts
 * from `template` for the fields every node needs and clears everything that
 * would draw or lay out, so only `styles` given here show.
 *
 * @param {UiNode} template  A node of the component, for its default fields.
 * @param {string} key       Unique key for the new node.
 * @param {string} lvName    Widget name.
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {Partial<UiNode['styles']>} styles
 * @returns {UiNode}
 */
export function shapeNode(template, key, lvName, box, styles) {
  return {
    tag: 'span', id: null, className: null, classes: [], lvName, widget: null, component: null, link: null,
    role: null, aria: {}, testId: null, hidden: false,
    ...box, text: null, attrs: {}, key,
    styles: {
      ...template.styles,
      bgColor: null, gradient: null, shadow: null, pressed: null, borderWidth: 0, borderBottomWidth: 0,
      borderColor: null, borderBottomColor: null, borderSide: null, radius: 0, opacity: 1, scrollable: false,
      overflowHidden: false, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, color: null,
      ...styles,
    },
    layout: {
      ...template.layout, display: 'block', position: 'static', flexGrow: 0,
      marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
    },
    children: [],
  };
}

/**
 * The same node as a plain box that keeps its footprint and holds `children`
 * placed by their own coordinates. Use it when the control drawn is smaller
 * than its element (a 32 px checkbox root around a 15 px box), so the
 * surrounding layout still flows around the size the page had.
 * @param {UiNode} node
 * @param {UiNode[]} children
 * @returns {UiNode}
 */
export const asPositionedBox = (node, children) => ({
  ...node,
  widget: null,
  text: null,
  // The element's own paint (a ripple tint, a pressed color) belongs to the
  // hit area, not to the drawing, so it stays; only what the children replace goes.
  layout: { ...node.layout, display: 'block' },
  children,
});
