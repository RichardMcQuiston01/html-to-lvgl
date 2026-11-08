/**
 * Checkbox: Material UI's `Checkbox` becomes a native `lv_checkbox`.
 *
 * What the core does with the real thing, measured on Material UI 9.5: a
 * Checkbox is a `<span>` holding a visually hidden `<input type=checkbox>` and
 * an SVG icon. The core maps that input to an `lv_checkbox` with no text
 * (LVGL then shows its default "Check box" label), keeps the SVG as an empty
 * outlined ICON_PLACEHOLDER, and a Radio's input becomes an `lv_textarea`
 * holding the text "on". None of it looks or behaves like a checkbox.
 *
 * Signals:
 *   0.8  the React component `Checkbox` (works when class names are hashed)
 *   0.7  `MuiCheckbox-root`
 *
 * build() keeps the 32 px root as a plain box (so siblings flow around the
 * footprint the page had) and puts one `lv_checkbox` inside it, exactly over
 * the drawn square. State comes from `Mui-checked` / `Mui-disabled`, the input
 * and the React props; colors are the ones the page painted (the root's
 * `color` is the checked blue or the grey of an unchecked box).
 *
 * Limits: an indeterminate checkbox shows LVGL's checkmark (LVGL has no
 * dash); the ripple and focus ring are not drawn.
 */
import { backdropOf, findFirst, hasClass, hasPart, hexOf, muiScore, propsOf, shapeNode, solid, withName, asPositionedBox } from './shared.mjs';

/** @typedef {import('./shared.mjs').UiNode} UiNode */

/** Line height of each built-in Montserrat size, from the core's font metrics. */
const LINE_HEIGHT = { 10: 11, 12: 15, 14: 16, 16: 18, 18: 21, 20: 22, 22: 24, 24: 27 };

/**
 * The built-in font whose line height best matches `size`, so that LVGL's
 * marker (one line high plus its padding) is `size` wide.
 * @param {number} size
 * @returns {{ font: string, lineHeight: number }}
 */
export function fontForMarker(size) {
  const fits = Object.entries(LINE_HEIGHT).filter(([, lh]) => lh <= size);
  const pool = fits.length ? fits : [['10', 11]];
  // Prefer a font that leaves an even remainder, so padding can be split evenly.
  const even = pool.filter(([, lh]) => (size - lh) % 2 === 0);
  const [px, lineHeight] = (even.length ? even : pool).reduce((a, b) => (b[1] > a[1] ? b : a));
  return { font: `montserrat_${px}`, lineHeight };
}

/**
 * Everything the page shows about a Checkbox (or the checkbox inside a
 * FormControlLabel), read from the extracted tree.
 *
 * @param {UiNode} node  The Checkbox root element.
 * @param {{ tree?: UiNode, parent?: UiNode | null }} ctx
 */
export function describeCheckbox(node, ctx) {
  const props = propsOf(node, 'Checkbox') ?? {};
  const input = findFirst(node, (n) => n.tag === 'input');
  const icon = findFirst(node, (n) => n.tag === 'svg');
  const path = icon ? findFirst(icon, (n) => n.tag === 'path' && n.w > 0) : null;
  const iconName = icon?.testId ?? '';

  const checked = hasClass(node, 'Mui-checked') || input?.attrs?.checked === true || props.checked === true || props.defaultChecked === true
    || /^(CheckBox|IndeterminateCheckBox)Icon$/.test(iconName);
  const indeterminate = hasPart(node, 'Checkbox-indeterminate') || iconName === 'IndeterminateCheckBoxIcon' || props.indeterminate === true;
  const disabled = hasClass(node, 'Mui-disabled') || input?.attrs?.disabled === true || props.disabled === true;

  // The drawn square: the icon's path when it was measured, else 3/4 of the
  // 24-unit icon (the square is 18 units inside a 24 unit viewBox).
  const size = path ? Math.max(path.w, path.h) : Math.round((icon?.w ?? node.w * 0.6) * 0.75);
  const box = path
    ? { x: path.x, y: path.y, w: path.w, h: path.h }
    : { x: Math.round(node.x + (node.w - size) / 2), y: Math.round(node.y + (node.h - size) / 2), w: size, h: size };

  const backdrop = backdropOf(ctx, node);
  const color = solid(node.styles.color, backdrop) ?? (checked ? [0x19, 0x76, 0xd2] : [0x75, 0x75, 0x75]);
  return {
    checked: checked || indeterminate, indeterminate, disabled, box, size, color, backdrop,
    stroke: Math.max(1, Math.round(((icon?.w ?? 24) / 24) * 2)),
  };
}

/**
 * The attributes of the `lv_checkbox` that draws a described checkbox.
 * @param {ReturnType<typeof describeCheckbox>} d
 * @param {{ markerFont: string, markerLineHeight: number }} font
 * @returns {Record<string, string | number>}
 */
export function checkboxAttrs(d, { markerFont, markerLineHeight }) {
  const pad = Math.max(0, Math.floor((d.size - markerLineHeight) / 2));
  /** @type {Record<string, string | number>} */
  const attrs = {
    ...(d.checked ? { checked: 'true' } : {}),
    ...(d.disabled ? { disabled: 'true' } : {}),
    // The main part is only the container; LVGL draws the square as the indicator part.
    style_bg_opa: 0,
    style_border_width: 0,
    style_pad_all: 0,
    style_pad_column: 0,
    ...(markerFont ? { style_text_font: markerFont } : {}),
    'style_pad_all:indicator': pad,
    'style_border_width:indicator': d.stroke,
    'style_radius:indicator': 2,
    'style_bg_color:indicator': hexOf(d.backdrop),
    'style_bg_opa:indicator': 255,
    'style_border_color:indicator': hexOf(d.color),
  };
  if (d.checked) {
    attrs['style_bg_color:checked:indicator'] = hexOf(d.color);
    attrs['style_border_color:checked:indicator'] = hexOf(d.color);
  }
  return attrs;
}

/** @type {import('../../../src/recognize.mjs').ComponentDef} */
const checkbox = {
  name: 'mui-checkbox',
  description: 'A Material UI Checkbox; maps to a native lv_checkbox.',
  match(node) {
    if (node.hidden || node.native) return false;
    return muiScore(node, 'Checkbox');
  },
  props: {
    checked: { type: 'bool', default: false },
    disabled: { type: 'bool', default: false },
    indeterminate: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    const d = describeCheckbox(node, ctx);
    const { font, lineHeight } = fontForMarker(d.size);
    const attrs = {
      ...checkboxAttrs(d, { markerFont: font, markerLineHeight: lineHeight }),
      // LVGL shows "Check box" for a checkbox with no text; a space draws nothing.
      text: ' ',
      width: d.box.w,
      height: d.box.h,
    };
    const inner = {
      ...shapeNode(node, `${node.key}~checkbox`, `${node.lvName ?? 'checkbox'}_box`, d.box, {}),
      native: { tag: 'lv_checkbox', attrs },
    };
    const out = asPositionedBox(withName(node, 'checkbox'), [inner]);
    out.recognized = { component: 'mui-checkbox', props: { checked: d.checked, disabled: d.disabled, indeterminate: d.indeterminate } };
    return out;
  },
};

export default checkbox;
