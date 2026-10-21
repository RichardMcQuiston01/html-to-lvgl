/**
 * Icon recognition: an SVG, an icon font glyph, or a Material Icons ligature
 * cannot become a label, so it becomes a NAMED, FIXED-SIZE PLACEHOLDER: an
 * `lv_obj` called `icon_<hint>` with the icon's own size and a 1px outline,
 * plus an ICON_PLACEHOLDER diagnostic that says how to swap in the real
 * thing. See COMPONENTS.md, "Icons".
 *
 * The placeholder is a plain `div` node with an `lvName`, so convert() emits
 * it as an ordinary named `lv_obj` and needs no icon-specific code.
 *
 * Class names are read from `node.classes` (added by the extractor in
 * Phase 6) and fall back to `[node.className]` (the first class only) so the
 * definition also works on trees from an older extractor.
 */

const ICON_FONT_CLASS = /^(material-icons|material-symbols)/;
const ICON_FONT_PREFIX = /^(fa|bi-|bx-|icon)/;
const SMALL_SQUARE_MAX = 48;
const FALLBACK_HINT = 'icon';

/** @param {import('./recognize.mjs').UiNode} node */
function classesOf(node) {
  if (Array.isArray(node.classes) && node.classes.length) return node.classes;
  return node.className ? [node.className] : [];
}

/** @param {string[]} classes */
const isFontIconClass = (classes) => classes.some((c) => ICON_FONT_CLASS.test(c) || ICON_FONT_PREFIX.test(c));

/** @param {import('./recognize.mjs').UiNode} node */
function hasSvgChild(node) {
  return node.children.some((c) => c.tag === 'svg' || hasSvgChild(c));
}

/**
 * How sure we are that this node is an icon: 0 for no, higher for more
 * certain. Detection order follows the confidence of each signal.
 * @param {import('./recognize.mjs').UiNode} node
 * @returns {number}
 */
function confidence(node) {
  if (node.tag === 'svg') return 0.9;
  const classes = classesOf(node);
  if (classes.includes('MuiSvgIcon-root') || (node.testId && /Icon$/.test(node.testId))) return 0.85;
  if ((node.tag === 'i' || node.tag === 'span') && isFontIconClass(classes)) return 0.8;
  if (
    node.attrs?.['aria-hidden'] === 'true' &&
    !node.text &&
    node.w > 0 && node.h > 0 &&
    node.w <= SMALL_SQUARE_MAX && node.h <= SMALL_SQUARE_MAX &&
    Math.abs(node.w - node.h) <= 1 &&
    hasSvgChild(node)
  ) return 0.6;
  return 0;
}

/** lower_snake_case, or '' when nothing usable is left. */
function snake(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The best name for the icon: testId, aria label, ligature text, icon-font
 * class suffix, else "icon".
 * @param {import('./recognize.mjs').UiNode} node
 * @returns {string}
 */
export function iconHint(node) {
  if (node.testId) {
    const h = snake(node.testId.replace(/Icon$/, ''));
    if (h) return h;
  }
  const label = node.aria?.label ? snake(node.aria.label) : '';
  if (label) return label;
  const classes = classesOf(node);
  if (classes.some((c) => ICON_FONT_CLASS.test(c))) {
    const ligature = node.text ? snake(node.text) : '';
    if (ligature) return ligature;
  }
  for (const c of classes) {
    const m = /^(?:fa[a-z]*-|bi-|bx-|icon-)(.+)$/.exec(c);
    // Skip style modifiers such as fa-solid, fa-lg, fa-2x.
    if (m && !/^(solid|regular|brands|light|thin|duotone|fw|lg|xs|sm|spin|\dx|xl)$/.test(m[1])) {
      const h = snake(m[1]);
      if (h) return h;
    }
  }
  return FALLBACK_HINT;
}

/** @type {import('./recognize.mjs').ComponentDef} */
const icon = {
  name: 'icon',
  match: confidence,
  props: {
    hint: { type: 'string', default: FALLBACK_HINT },
  },
  slots: [],
  leaf: true,
  build(node, ctx) {
    const hint = iconHint(node);
    const name = `icon_${hint}`;
    const color = node.styles?.color ?? [128, 128, 128];
    ctx.diagnostics.add({
      code: 'ICON_PLACEHOLDER',
      message: `${node.key} is an icon; emitted as an empty ${node.w}x${node.h} outline named "${name}"`,
      fix: `Replace the lv_obj named "${name}" with an lv_image or an lv_label using an LV_SYMBOL_* or an icon font glyph, in the generated file or by supplying the image.`,
      source: { selector: node.key },
      output: { widget: name },
    });
    return {
      tag: 'div',
      id: null,
      className: null,
      lvName: name,
      widget: null,
      component: null,
      link: null,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      text: null,
      attrs: {},
      key: node.key,
      styles: { ...node.styles, bgColor: null, gradient: null, shadow: null, borderWidth: 1, borderColor: color },
      layout: node.layout ? { ...node.layout, display: 'block' } : node.layout,
      children: [],
      recognized: { component: 'icon', props: { hint } },
    };
  },
};

export default icon;
