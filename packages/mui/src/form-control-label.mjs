/**
 * FormControlLabel: with a Checkbox, one `lv_checkbox` that carries the label;
 * with a Radio or Switch, the row stays a row but is allowed to overflow.
 *
 * Material UI renders `<label><span checkbox/><span label/></label>`. The core
 * would give a box, a placeholder square and a separate label. LVGL's own
 * checkbox is exactly that pair, so the whole row becomes one `lv_checkbox`
 * whose `text` is the label: one tap target, one widget to read the state of.
 *
 * A label that holds a Radio or Switch keeps the core's row (the Radio and
 * Switch definitions draw the control) and only loses its clipping: LVGL's
 * Montserrat is wider than the page's font, and the label's box is exactly as
 * wide as the page's text, so the end of "Weekly" would be cut off.
 *
 * Signals:
 *   0.8  the React component `FormControlLabel`
 *   0.7  `MuiFormControlLabel-root`
 *
 * Geometry is copied from the page: the square sits where the Checkbox drew
 * it (left padding), the label starts where the browser put it (the gap), and
 * the row is as wide and tall as the `<label>` element.
 *
 * Limits: the label placement is the default (control first); a
 * `labelPlacement="start"` row keeps its control on the left.
 */
import { checkboxAttrs, describeCheckbox, fontForMarker } from './checkbox.mjs';
import { findFirst, hasClass, hasPart, backdropOf, muiScore, solid, withName } from './shared.mjs';

/** @typedef {import('./shared.mjs').UiNode} UiNode */

/** @param {UiNode} n */
const isCheckboxRoot = (n) => muiScore(n, 'Checkbox') !== false;

/** A Radio or Switch, which the other definitions draw. @param {UiNode} n */
const isChoiceControl = (n) => muiScore(n, 'Radio') !== false || muiScore(n, 'Switch') !== false;

/** The label text element of a FormControlLabel, if it has one. @param {UiNode} node */
const labelOf = (node) => findFirst(node, (n) => n !== node && hasPart(n, 'FormControlLabel-label'))
  ?? findFirst(node, (n) => n !== node && Boolean(n.text) && !isCheckboxRoot(n));

/** @type {import('../../../src/recognize.mjs').ComponentDef} */
const formControlLabel = {
  name: 'mui-form-control-label',
  match(node) {
    if (node.hidden || node.native) return false;
    const score = muiScore(node, 'FormControlLabel');
    if (score === false) return false;
    return (findFirst(node, (n) => n !== node && (isCheckboxRoot(n) || isChoiceControl(n)))) && labelOf(node) ? score : false;
  },
  props: {
    label: { type: 'string', default: '' },
    checked: { type: 'bool', default: false },
    disabled: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    const control = findFirst(node, (n) => n !== node && isCheckboxRoot(n));
    if (!control) {
      // Radio or Switch: only stop the row from clipping a wider label.
      const out = { ...node, styles: { ...node.styles, overflowVisible: true } };
      out.recognized = { component: 'mui-form-control-label', props: { label: labelOf(node)?.text ?? '', checked: findFirst(node, (n) => hasClass(n, 'Mui-checked')) !== null, disabled: hasClass(node, 'Mui-disabled') } };
      return out;
    }
    const label = /** @type {UiNode} */ (labelOf(node));
    const d = describeCheckbox(control, ctx);
    const disabled = d.disabled || hasClass(node, 'Mui-disabled');

    const labelFont = label.styles.fontSize || 14;
    // The marker is one line of the MAIN part's font tall, so the main font is
    // the label's; the marker is then padded up (or down) to the square's size.
    const lineHeight = Math.round(labelFont * 1.15);
    const markerLineHeight = { 10: 11, 12: 15, 14: 16, 16: 18, 18: 21, 20: 22, 22: 24, 24: 27 }[labelFont] ?? fontForMarker(d.size).lineHeight;
    const attrs = {
      ...checkboxAttrs({ ...d, disabled }, { markerFont: '', markerLineHeight }),
      text: label.text ?? '',
      // LVGL's Montserrat is wider than the page's font: a fixed width would clip the label.
      width: 'content',
      height: node.h,
      style_pad_left: Math.max(0, d.box.x - node.x),
      style_pad_top: Math.max(0, Math.round(label.y + (label.h - lineHeight) / 2 - node.y)),
      style_pad_column: Math.max(0, label.x - (d.box.x + d.box.w)),
    };
    // convert() picks the label's font and color from `styles` when fontText is
    // given, so the native widget's text is drawn like the label the page had.
    const backdrop = backdropOf(ctx, node);
    const textColor = solid(label.styles.color, backdrop) ?? [0, 0, 0];
    const out = withName({
      ...node,
      widget: null,
      children: [],
      styles: { ...node.styles, fontSize: label.styles.fontSize, fontFamily: label.styles.fontFamily, fontWeight: label.styles.fontWeight, fontItalic: label.styles.fontItalic, color: [...textColor, 255] },
      native: { tag: 'lv_checkbox', attrs, fontText: label.text ?? '' },
    }, 'checkbox');
    out.recognized = { component: 'mui-form-control-label', props: { label: label.text ?? '', checked: d.checked, disabled } };
    return out;
  },
};

export default formControlLabel;
