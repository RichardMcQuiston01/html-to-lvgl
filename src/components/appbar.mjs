/**
 * App bar: the top bar of a screen (`<header>` with role=banner, Material UI
 * AppBar), pinned while the page scrolls.
 *
 * Signals, strongest first:
 *   1    role="banner"
 *   1    a `<header>` that is a page-level header: a direct child of the body
 *        or of the page root, or of a chain of lone wrapper divs below it (a
 *        React `#root`). A `<header>` inside article, section, main, aside or
 *        nav is that section's heading, not the page's bar, so it is not one.
 *   0.7  MuiAppBar-root
 *
 * The pinning itself (the `floating` flag, drawing the bar on top) is done by
 * convert() for a recognized app bar whose computed position is fixed or
 * sticky; this definition reports that position as a prop. The bar's colors,
 * radius and shadow come from computed styles like any other box.
 */
import { SCORE_SEMANTIC, SCORE_MUI, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const POSITIONS = new Set(['fixed', 'sticky', 'static', 'absolute', 'relative']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * The chain of nodes from the tree root down to (not including) the target,
 * found by key. Null when the node is not in the tree.
 * @param {UiNode} tree @param {UiNode} target
 * @returns {UiNode[] | null}
 */
function ancestorsOf(tree, target) {
  /** @param {UiNode} n @param {UiNode[]} path @returns {UiNode[] | null} */
  const walk = (n, path) => {
    if (n === target || (n.key && n.key === target.key)) return path;
    for (const c of n.children) {
      const found = walk(c, [...path, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []);
}

/** True for a header that belongs to the page rather than to a section. */
function isPageHeader(node, ctx) {
  if (node.tag !== 'header') return false;
  const parent = ctx?.parent;
  if (!parent) return false;
  if (parent === ctx.tree || parent.tag === 'body' || parent.tag === 'html') return true;
  // Below a mount wrapper: every ancestor between the root and the header is
  // a div that holds nothing else, so the header is still the page's.
  const chain = ctx.tree ? ancestorsOf(ctx.tree, node) : null;
  if (!chain) return false;
  return chain.every((a, i) => i === 0 || (a.tag === 'div' && !a.role && a.children.length === 1));
}

/** The heading's text, else the first text outside a button. @param {UiNode} node */
function findTitle(node) {
  /** @param {UiNode} n @param {boolean} headingsOnly @returns {string} */
  const find = (n, headingsOnly) => {
    if (n.tag === 'button' || n.role === 'button') return '';
    const isHeading = HEADING_TAGS.has(n.tag) || n.role === 'heading' || (n.classes ?? []).some((c) => /^MuiTypography-h[1-6]$/.test(c));
    if (n.text && n.text.trim() && (!headingsOnly || isHeading)) return n.text.trim();
    for (const c of n.children) {
      const t = find(c, headingsOnly);
      if (t) return t;
    }
    return '';
  };
  return find(node, true) || find(node, false);
}

/** Name the title node, so the editor and the generated code can find it. */
function nameTitleNode(node) {
  const text = findTitle(node);
  if (!text) return node;
  let done = false;
  /** @param {UiNode} n @returns {UiNode} */
  const walk = (n) => {
    if (done) return n;
    if (n.tag !== 'button' && n.role !== 'button' && n.text && n.text.trim() === text) {
      done = true;
      return withName(n, 'appbar_title');
    }
    return { ...n, children: n.children.map(walk) };
  };
  return { ...node, children: node.children.map(walk) };
}

/**
 * Workaround for a converter gap: convert() emits every button with LVGL's
 * default blue fill unless the page gave it a background, so a transparent
 * MUI IconButton or text Button (the normal case in an app bar) would show as
 * a blue blob. On an opaque bar a transparent button looks exactly like the
 * bar behind it, so give it the bar's color. Remove this when convert() maps
 * a transparent button to `style_bg_opa="0"`.
 * @param {UiNode} node @param {number[] | null} bar The bar's background color.
 * @returns {UiNode}
 */
function fillTransparentButtons(node, bar) {
  if (!bar || bar[3] < 255) return node;
  const isButton = node.tag === 'button' || node.role === 'button';
  const s = node.styles;
  const needsFill = isButton && s && !s.bgColor && !s.gradient;
  return {
    ...node,
    ...(needsFill ? { styles: { ...s, bgColor: bar } } : {}),
    children: node.children.map((c) => fillTransparentButtons(c, bar)),
  };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const appbar = {
  name: 'appbar',
  match(node, ctx) {
    if (node.role === 'banner') return SCORE_SEMANTIC;
    if (isPageHeader(node, ctx)) return SCORE_SEMANTIC;
    if (hasMuiRoot(node, 'AppBar')) return SCORE_MUI;
    return false;
  },
  props: {
    title: { type: 'string', default: '' },
    position: { type: 'string', default: 'static' },
  },
  slots: ['leading', 'title', 'actions'],
  build(node) {
    const position = POSITIONS.has(node.layout?.position) ? node.layout.position : 'static';
    const named = withName(nameTitleNode(fillTransparentButtons(node, node.styles?.bgColor ?? null)), 'appbar');
    return { ...named, recognized: { component: 'appbar', props: { title: findTitle(node), position } } };
  },
};

export default appbar;
