/**
 * Breadcrumbs: a navigation trail (`<nav aria-label="breadcrumb">`, Material
 * UI Breadcrumbs, Bootstrap `.breadcrumb`).
 *
 * What the converter already does with this markup, which is why this file is
 * small: `ol`/`ul`/`li` are plain boxes, a flex row (or row_wrap) becomes an
 * lv_obj flex row, an `<a>` is a text label, and in a multi-page run an `<a
 * href>` that names a sibling page becomes a screen-navigation button. So the
 * trail already converts as a row of labels and link buttons with the
 * separators as labels. Three things are wrong without help, and build()
 * fixes them:
 *
 *  1. The current page must not be clickable. In a multi-page run, a trail
 *     whose last item is `<a href="this-page" aria-current="page">` would
 *     become a button that navigates to itself. build() turns the anchor of
 *     the current item into a plain span (no link, no href).
 *  2. CSS separators are invisible. Bootstrap draws "/" with
 *     `.breadcrumb-item + .breadcrumb-item::before`, and the extractor does
 *     not read pseudo-elements, so the "/" would be lost. For Bootstrap
 *     markup only (the default there is "/"), build() inserts separator
 *     items. Plain ARIA markup with CSS separators is NOT guessed at: add a
 *     real separator element, or the separators are missing in the output.
 *  3. The nav gets a readable name, `breadcrumbs`.
 *
 * Width: the row keeps the widths the browser laid out. MUI's `flex-wrap:
 * wrap` becomes row_wrap, so a long trail wraps onto a second line. A
 * `nowrap` trail wider than its parent is not collapsed (MUI collapses to an
 * ellipsis, this does not): the browser's item widths are kept and whatever
 * passes the parent's right edge is clipped by LVGL.
 */
import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, ariaOf, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const LIST_TAGS = new Set(['ol', 'ul']);
/** Text that is only a separator glyph. */
const SEPARATOR_TEXT = /^[/\\>»›‹·•|\-–—→‣⁄∕]$/;
const DEFAULT_SEPARATOR = '/';

/** @param {UiNode} node */
const isNavLandmark = (node) => node.tag === 'nav' || node.role === 'navigation';

/** @param {UiNode} node */
const labelSaysBreadcrumb = (node) => /breadcrumb/i.test(String(ariaOf(node, 'label') ?? ''));

/**
 * @param {UiNode} node
 * @param {import('../recognize.mjs').RecognizeContext | { parent: null }} [ctx]
 */
function match(node, ctx) {
  if (isNavLandmark(node) && labelSaysBreadcrumb(node)) return SCORE_SEMANTIC;
  if (hasMuiRoot(node, 'Breadcrumbs')) return SCORE_MUI;
  // Bootstrap puts `.breadcrumb` on the <ol>, inside a labelled <nav>. When
  // that nav already matched, the list belongs to it: do not match twice.
  if (LIST_TAGS.has(node.tag) && hasClass(node, 'breadcrumb')) {
    const parent = ctx?.parent;
    if (parent && match(parent, { parent: null }) > 0) return false;
    return SCORE_GENERIC_CLASS;
  }
  return false;
}

/** The first ol/ul at or below the node (depth first). @param {UiNode} node @returns {UiNode | null} */
function findList(node) {
  if (LIST_TAGS.has(node.tag)) return node;
  for (const child of node.children) {
    const found = findList(child);
    if (found) return found;
  }
  return null;
}

/** @param {UiNode} node @returns {boolean} */
const hasLink = (node) => Boolean(node.link) || (node.tag === 'a' && Boolean(node.attrs?.href)) || node.children.some(hasLink);

/** The text an item shows. @param {UiNode} node @returns {string} */
const textOf = (node) => (node.text ?? '') + node.children.map(textOf).join('');

/**
 * A separator is a list item that is not a page: hidden from assistive
 * technology, named "separator", or only a glyph, and without a link.
 * @param {UiNode} item
 */
function isSeparator(item) {
  if (hasLink(item)) return false;
  if (ariaOf(item, 'hidden') === 'true') return true;
  if ((item.classes ?? []).some((c) => /separator/i.test(c)) || /separator/i.test(item.className ?? '')) return true;
  return SEPARATOR_TEXT.test(textOf(item).trim());
}

/** @param {UiNode} node @returns {boolean} */
function isCurrent(node) {
  const current = ariaOf(node, 'current');
  if (current && current !== 'false') return true;
  if (hasClass(node, 'active')) return true;
  return node.children.some(isCurrent);
}

/**
 * The same subtree with links removed: an anchor becomes a span, and the
 * link overrides go away. Everything the converter reads for looks stays.
 * @param {UiNode} node
 * @returns {UiNode}
 */
function withoutLinks(node) {
  const { href, ...attrs } = node.attrs ?? {};
  return {
    ...node,
    tag: node.tag === 'a' ? 'span' : node.tag,
    link: null,
    attrs,
    children: node.children.map(withoutLinks),
  };
}

/**
 * A separator list item made from its neighbour, so it keeps the font and
 * color of the trail. Position is an estimate; the flex row places it.
 * @param {UiNode} model  The item to copy style from.
 * @param {string} text
 * @returns {UiNode}
 */
function makeSeparator(model, text) {
  const fontSize = model.styles?.fontSize ?? 16;
  const colorSource = model.children.find((c) => c.text) ?? model;
  return {
    ...model,
    tag: 'li',
    id: null,
    className: null,
    classes: ['breadcrumb-separator'],
    lvName: 'separator',
    widget: null,
    component: null,
    link: null,
    role: null,
    aria: { hidden: 'true' },
    text,
    attrs: {},
    w: Math.max(4, Math.round(fontSize * 0.5)),
    styles: { ...model.styles, color: colorSource.styles?.color ?? model.styles?.color },
    children: [],
    key: `${model.key}~separator`,
    recognized: undefined,
  };
}

/**
 * @param {UiNode} node
 * @returns {UiNode}
 */
function build(node) {
  const list = findList(node);
  if (!list) return withName(node, 'breadcrumbs');

  let items = list.children.map((item) => (isSeparator(item) || !isCurrent(item) ? item : withoutLinks(item)));

  const separatorItem = items.find(isSeparator);
  const separator = (separatorItem && textOf(separatorItem).trim()) || DEFAULT_SEPARATOR;

  const pages = items.filter((item) => !isSeparator(item));
  const bootstrap = hasClass(node, 'breadcrumb') || hasClass(list, 'breadcrumb') || pages.some((p) => hasClass(p, 'breadcrumb-item'));
  if (!separatorItem && bootstrap && pages.length > 1) {
    items = items.flatMap((item, i) => (i < items.length - 1 ? [item, makeSeparator(item, separator)] : [item]));
  }

  const rebuilt = { ...list, children: items };
  /** @param {UiNode} n @returns {UiNode} */
  const replaceList = (n) => (n === list ? rebuilt : { ...n, children: n.children.map(replaceList) });
  const out = withName(replaceList(node), 'breadcrumbs');
  out.recognized = { component: 'breadcrumbs', props: { separator } };
  return out;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const breadcrumbs = {
  name: 'breadcrumbs',
  match,
  props: {
    separator: { type: 'string', default: DEFAULT_SEPARATOR },
  },
  slots: ['items'],
  build,
};

export default breadcrumbs;
