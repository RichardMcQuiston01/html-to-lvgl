/**
 * Pagination: a row of page buttons with previous and next, the current page
 * highlighted (`<nav aria-label="pagination">`, Material UI Pagination,
 * Bootstrap `.pagination`). LVGL has no pager widget, so this is the
 * composite the converter already makes, a flex row of buttons and labels,
 * and build() fixes what it gets wrong:
 *
 *  1. The current page must not navigate. In a multi-page run an `<a href>`
 *     that names a sibling page becomes a screen-navigation button, so a
 *     current-page link to itself would reload its own screen. build() turns
 *     the current page's anchor into a plain span (no link). Every other page
 *     keeps its link, and `data-lv-link` on any item is left alone.
 *  2. Previous and next are often an SVG chevron, which becomes an empty icon
 *     placeholder. An item with no text, an SVG, and an aria-label that says
 *     previous, next, first or last gets the glyph `<`, `>`, `<<` or `>>` as
 *     its text instead, centered in the button the browser measured.
 *  3. The "more pages" ellipsis (U+2026) is not in LVGL's built-in fonts and
 *     draws as an empty box, so it is written as three dots.
 *  4. Names: the list is `pagination`.
 *
 * The current page's highlight (Material UI's tinted circle, Bootstrap's
 * filled square) is the item's own background, which the converter already
 * keeps, so the page looks right without a state change. A page is current
 * when it, or its list item, has `aria-current` (Material UI writes "true",
 * hand-written markup "page") or a `Mui-selected` / `active` class.
 *
 * Stepping through pages on the device (previous and next incrementing a
 * subject that the page buttons bind to) is not done: LVGL's XML binds can
 * only toggle a flag or a state, not restyle one page button as "current", so
 * a faithful stepper needs one subject per page and generated styles. Each
 * button keeps its `data-lv-link` or `href` navigation instead.
 */
import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, ariaOf, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const LIST_TAGS = new Set(['ol', 'ul']);
/** "pagination", "Pagination navigation", "pager", "Page navigation" (Bootstrap's own example). */
const LABEL_SAYS_PAGINATION = /\b(pagination|pager|paging)\b|page navigation/i;
/** The direction words aria-labels use on the arrow items, with the glyph that stands for each. */
const ARROWS = [
  [/\b(first)\b/i, '<<'],
  [/\b(last)\b/i, '>>'],
  [/\b(prev|previous)\b/i, '<'],
  [/\b(next)\b/i, '>'],
];

/** The "more pages" item: U+2026 is not in LVGL's built-in fonts (it draws an empty box), three dots are. */
const ELLIPSIS_GLYPHS = /^[\u2026\u22ef]+$/;

/** @param {UiNode} node */
const isNavLandmark = (node) => node.tag === 'nav' || node.role === 'navigation';

/** @param {UiNode} node */
const labelSaysPagination = (node) => LABEL_SAYS_PAGINATION.test(String(ariaOf(node, 'label') ?? ''));

/**
 * @param {UiNode} node
 * @param {import('../recognize.mjs').RecognizeContext | { parent: null }} [ctx]
 * @returns {number | false}
 */
function match(node, ctx) {
  if (isNavLandmark(node) && labelSaysPagination(node)) return SCORE_SEMANTIC;
  if (hasMuiRoot(node, 'Pagination')) return SCORE_MUI;
  // Bootstrap puts `.pagination` on the <ul>, inside a labelled <nav>. When
  // that nav already matched, the list belongs to it: do not match twice.
  if (LIST_TAGS.has(node.tag) && hasClass(node, 'pagination')) {
    const parent = ctx?.parent;
    if (parent && match(parent, { parent: null })) return false;
    return SCORE_GENERIC_CLASS;
  }
  return false;
}

/** The first ol/ul at or below the node. @param {UiNode} node @returns {UiNode | null} */
function findList(node) {
  if (LIST_TAGS.has(node.tag)) return node;
  for (const child of node.children) {
    const found = findList(child);
    if (found) return found;
  }
  return null;
}

/** @param {UiNode} node */
const isCurrentMark = (node) => {
  const current = ariaOf(node, 'current');
  return (Boolean(current) && current !== 'false') || hasClass(node, 'Mui-selected', 'active');
};

/** A list item is the current page when it or the control inside it is marked. @param {UiNode} item */
const isCurrentItem = (item) => isCurrentMark(item) || item.children.some(isCurrentMark);

/** @param {UiNode} node @returns {boolean} */
const hasSvg = (node) => node.tag === 'svg' || node.children.some(hasSvg);

/** @param {UiNode} node @returns {boolean} */
const hasText = (node) => Boolean(node.text) || node.children.some(hasText);

/** The same subtree with links removed. @param {UiNode} node @returns {UiNode} */
function withoutLinks(node) {
  const { href, ...attrs } = node.attrs ?? {};
  return { ...node, tag: node.tag === 'a' ? 'span' : node.tag, link: null, attrs, children: node.children.map(withoutLinks) };
}

/**
 * An arrow item drawn as an SVG: the control gets the glyph as its text. The
 * control keeps its own box, color and link; only its (icon) content changes.
 * @param {UiNode} control a button or anchor
 * @returns {UiNode}
 */
function withArrowGlyph(control) {
  if (hasText(control) || !hasSvg(control)) return control;
  const label = String(ariaOf(control, 'label') ?? '');
  const arrow = ARROWS.find(([pattern]) => pattern.test(label));
  if (!arrow) return control;
  const textAlign = 'center';
  return { ...control, text: arrow[1], children: [], styles: { ...control.styles, textAlign } };
}

/** @param {UiNode} node @returns {boolean} */
const isControl = (node) => node.tag === 'button' || node.tag === 'a' || node.role === 'button' || node.role === 'link';

/**
 * Apply the two fixes to one list item (or, without a list, to a control).
 * @param {UiNode} item
 * @returns {UiNode}
 */
function fixItem(item) {
  const current = isCurrentItem(item);
  /** @param {UiNode} n @returns {UiNode} */
  const visit = (n) => {
    if (isControl(n)) return withArrowGlyph(n);
    if (n.text && ELLIPSIS_GLYPHS.test(n.text.trim())) return { ...n, text: '...' };
    return { ...n, children: n.children.map(visit) };
  };
  const fixed = visit(item);
  return current ? withoutLinks(fixed) : fixed;
}

/**
 * @param {UiNode} node
 * @returns {UiNode}
 */
function build(node) {
  const list = findList(node);
  /** @type {UiNode} */
  let rebuilt;
  let items = 0;
  let current = -1;
  if (list) {
    const children = list.children.map((item, i) => {
      items += 1;
      if (current < 0 && isCurrentItem(item)) current = i;
      return fixItem(item);
    });
    const newList = { ...list, children };
    /** @param {UiNode} n @returns {UiNode} */
    const replaceList = (n) => (n === list ? newList : { ...n, children: n.children.map(replaceList) });
    rebuilt = replaceList(node);
  } else {
    rebuilt = fixItem(node);
  }
  const out = withName(rebuilt, 'pagination');
  out.recognized = { component: 'pagination', props: { count: items, current } };
  return out;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const pagination = {
  name: 'pagination',
  match,
  props: {
    count: { type: 'number', default: 0 },
    current: { type: 'number', default: 0 },
  },
  slots: ['items'],
  build,
};

export default pagination;
