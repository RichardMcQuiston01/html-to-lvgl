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
import { SCORE_SEMANTIC, SCORE_MUI, hasMuiRoot, muiRoots, withName } from './shared.mjs';

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

/** Material UI roots whose text belongs to that component, not to the bar. */
const OWNED_ROOTS = ['Avatar', 'Chip', 'Badge', 'Alert', 'Card', 'Paper', 'Divider'];

/** @param {UiNode} n True when another component will recognize this child. */
const isOwnedByComponent = (n) =>
  Boolean(n.widget) || n.role === 'alert' || n.role === 'status' || muiRoots(n).some((r) => OWNED_ROOTS.includes(r));

/**
 * The title node: the first heading with text, else the first text node
 * outside a button. Buttons are skipped with their whole subtree, and so is
 * any child another component will claim (an avatar's initials, a chip's
 * label, a badge's count): that text belongs to its own widget, and naming it
 * "appbar_title" would rename the avatar or chip, because a name set here is
 * never replaced by the child's own definition. Children are not recognized
 * yet when this runs (a parent is built first), so this looks at the same
 * signals the other definitions match on.
 * @param {UiNode} node
 * @returns {UiNode | null}
 */
function findTitleNode(node) {
  /** @param {UiNode} n @param {boolean} headingsOnly @returns {UiNode | null} */
  const find = (n, headingsOnly) => {
    if (n.tag === 'button' || n.role === 'button') return null;
    if (n !== node && isOwnedByComponent(n)) return null;
    const isHeading = HEADING_TAGS.has(n.tag) || n.role === 'heading' || (n.classes ?? []).some((c) => /^MuiTypography-h[1-6]$/.test(c));
    if (n.text && n.text.trim() && (!headingsOnly || isHeading)) return n;
    for (const c of n.children) {
      const t = find(c, headingsOnly);
      if (t) return t;
    }
    return null;
  };
  return find(node, true) ?? find(node, false);
}

/** The title's text, or an empty string. @param {UiNode} node */
const findTitle = (node) => findTitleNode(node)?.text?.trim() ?? '';

/**
 * Name the title node, so the editor and the generated code can find it. The
 * node is chosen once and named by identity, never found again by its text,
 * so a button that happens to hold the same words is not mistaken for it.
 */
function nameTitleNode(node) {
  const target = findTitleNode(node);
  if (!target) return node;
  /** @param {UiNode} n @returns {UiNode} */
  const walk = (n) => (n === target ? withName(n, 'appbar_title') : { ...n, children: n.children.map(walk) });
  return { ...node, children: node.children.map(walk) };
}

/**
 * Workaround for a converter gap: convert() emits every button with LVGL's
 * default blue fill unless the page gave it a background, so a transparent
 * MUI IconButton or text Button (the normal case in an app bar) would show as
 * a blue blob. A transparent button looks exactly like whatever is behind it,
 * so give it the nearest solid color behind it: the bar's, or that of a
 * container between the bar and the button. Under a gradient or a translucent
 * layer there is no single color, so the button is left alone. Remove this
 * when convert() maps a transparent button to `style_bg_opa="0"`.
 * @param {UiNode} node
 * @param {number[] | null} behind The nearest solid color behind this node.
 * @returns {UiNode}
 */
function fillTransparentButtons(node, behind) {
  const isButton = node.tag === 'button' || node.role === 'button';
  const s = node.styles;
  const needsFill = Boolean(behind) && isButton && s && !s.bgColor && !s.gradient;
  // What sits behind this node's children.
  let next = behind;
  if (s?.gradient) next = null;
  else if (s?.bgColor) next = s.bgColor[3] === 255 ? s.bgColor : null;
  return {
    ...node,
    ...(needsFill ? { styles: { ...s, bgColor: behind } } : {}),
    children: node.children.map((c) => fillTransparentButtons(c, next)),
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
    const named = withName(nameTitleNode(fillTransparentButtons(node, node.styles?.bgColor?.[3] === 255 ? node.styles.bgColor : null)), 'appbar');
    return { ...named, recognized: { component: 'appbar', props: { title: findTitle(node), position } } };
  },
};

export default appbar;
