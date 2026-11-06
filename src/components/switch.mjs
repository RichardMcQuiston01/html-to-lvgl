/**
 * Switch: an on/off toggle (ARIA `role="switch"`, Material UI Switch). It maps
 * to the native `lv_switch`; its checked state comes from ARIA (or the
 * checkbox behind it), so the first frame already shows the right side.
 *
 * Signals, strongest first:
 *   1    role="switch" on a visible element (a <button>, <div>, <span> or a
 *        styled <input type=checkbox>), which is the whole toggle
 *   0.9  an element with no text whose only job is to wrap a visually hidden
 *        role="switch" checkbox (the `<label><input class=sr-only><span
 *        class=slider></span></label>` pattern); the wrapper is the toggle
 *   0.7  MuiSwitch-root
 *   2    data-lv-widget="switch", but only when one of the signals above is
 *        also there. A bare annotation keeps the converter's own mapping
 *        (convert.mjs, emitForced), which sizes an lv_switch to the element.
 *
 * What build() emits (one `lv_switch`, nothing else):
 *   - checked from `aria-checked`, the checkbox's `checked`, or Material UI's
 *     `Mui-checked`; `disabled` from `aria-disabled`, `disabled` or `Mui-disabled`;
 *   - the track is drawn by the INDICATOR part, so it can be thinner than the
 *     box: the knob is taller than the track in Material UI and overhangs it.
 *     The main part is transparent and its padding insets the indicator;
 *   - colors of the state the page shows are copied (track, knob); the other
 *     state keeps LVGL's theme colors, because a snapshot cannot see it.
 *
 * The thumb's shadow (Material UI's elevation 1) is copied: its largest layer.
 *
 * Limits: a thumb that is a CSS pseudo-element (`::after`) is not in the
 * extracted tree, so the knob keeps LVGL's white; the track's border and the
 * on/off labels some designs draw are not reproduced.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasMuiRoot, hasClass } from './shared.mjs';
import { solidBackdropOf } from './chip.mjs';
import { hexOf, nativeOrWrapped, findAll, findByClass, fillOf } from './native.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const SCORE_HIDDEN_INPUT_WRAPPER = 0.9;

/** LVGL's own colors for a part the page does not show (unchecked track, white knob). */
const DEFAULT_TRACK = [0x9e, 0x9e, 0x9e];

/** @param {UiNode} node */
const isSwitchRole = (node) => node.role === 'switch';

/** A checkbox the page hides so its own drawing can replace it. @param {UiNode} node */
const isHiddenControl = (node) => node.tag === 'input' && (node.w < 12 || node.h < 8 || node.styles?.opacity === 0 || hasClass(node, 'MuiSwitch-input'));

/** The visually hidden role=switch checkbox under a node, if there is one. @param {UiNode} node */
const hiddenSwitchInput = (node) => findAll(node, (n) => n !== node && n.tag === 'input' && isSwitchRole(n) && isHiddenControl(n))[0] ?? null;

/** Text anywhere under the node. @param {UiNode} node */
const hasText = (node) => Boolean(node.text) || node.children.some(hasText);

/**
 * The `<label><input class="sr-only"><span class="slider"></span></label>`
 * pattern: a small element, with no text, whose direct child is the hidden
 * checkbox next to the thing that is drawn. Small and shallow, so a page or a
 * form that happens to contain such a toggle is not taken for it.
 * @param {UiNode} node
 */
const wrapsHiddenSwitch = (node) =>
  node.tag !== 'input' && !hasMuiRoot(node, 'Switch') && node.children.length <= 3 && node.w <= 160 && node.h <= 80
  && !hasText(node) && node.children.some((c) => c.tag === 'input' && isSwitchRole(c) && isHiddenControl(c));

/** Whether the state the page shows is "on". @param {UiNode} node */
export function isChecked(node) {
  const control = isSwitchRole(node) ? node : hiddenSwitchInput(node);
  const inputs = [node, ...(control && control !== node ? [control] : []), ...findAll(node, (n) => n.tag === 'input')];
  for (const n of inputs) {
    const aria = ariaOf(n, 'checked');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    if (n.tag === 'input' && n.attrs?.checked === true) return true;
  }
  return findAll(node, (n) => hasClass(n, 'Mui-checked')).length > 0;
}

/** @param {UiNode} node */
function isDisabled(node) {
  return ariaOf(node, 'disabled') === 'true'
    || findAll(node, (n) => n.attrs?.disabled === true || hasClass(n, 'Mui-disabled') || ariaOf(n, 'disabled') === 'true').length > 0;
}

/**
 * The toggle's box, track and knob, whatever drew them.
 * @param {UiNode} node
 * @returns {{ box: { x: number, y: number, w: number, h: number }, padX: number, padY: number, track: UiNode, thumb: UiNode | null }}
 */
function parts(node) {
  const track = findByClass(node, 'MuiSwitch-track');
  const thumb = findByClass(node, 'MuiSwitch-thumb');
  if (hasMuiRoot(node, 'Switch') && track && thumb) {
    // Material UI: a 34x14 track with a 20x20 thumb that overhangs it, so the
    // switch is as tall as the thumb and as wide as the track plus the overhang.
    const overhang = Math.max(0, Math.round((thumb.h - track.h) / 2));
    const h = Math.max(track.h, thumb.h);
    const y = thumb.h >= track.h ? thumb.y : track.y;
    return { box: { x: track.x - overhang, y, w: track.w + 2 * overhang, h }, padX: overhang, padY: Math.round((h - track.h) / 2), track, thumb };
  }
  // A hand-made toggle: the element is the track, and its first round or
  // square child with a fill of its own is the knob.
  // In the hidden-checkbox pattern the drawn toggle is a sibling of the input.
  const target = wrapsHiddenSwitch(node)
    ? findAll(node, (n) => n !== node && n.tag !== 'input' && n.styles?.bgColor && n.styles.bgColor[3] > 0 && n.w > 0)[0] ?? node
    : node;
  const knob = findAll(target, (n) => n !== target && n.styles?.bgColor && n.styles.bgColor[3] > 0 && n.w > 0 && n.h > 0 && n.tag !== 'input')[0] ?? null;
  return { box: { x: target.x, y: target.y, w: target.w, h: target.h }, padX: 0, padY: 0, track: target, thumb: knob };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const switchDef = {
  name: 'switch',
  match(node) {
    if (node.hidden || node.native) return false;
    if (isSwitchRole(node) && !isHiddenControl(node)) return SCORE_SEMANTIC;
    if (wrapsHiddenSwitch(node)) return SCORE_HIDDEN_INPUT_WRAPPER;
    if (hasMuiRoot(node, 'Switch')) return SCORE_MUI;
    return false;
  },
  props: {
    checked: { type: 'bool', default: false },
    disabled: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    const signal = isSwitchRole(node) || wrapsHiddenSwitch(node) || hasMuiRoot(node, 'Switch');
    // data-lv-widget="switch" on a plain element with no ARIA is the converter's call.
    if (!signal) return null;

    const checked = isChecked(node);
    const disabled = isDisabled(node);
    const backdrop = solidBackdropOf(ctx, node);
    const { box, padX, padY, track, thumb } = parts(node);

    const trackColor = fillOf(track, backdrop);
    const knobColor = thumb ? fillOf(thumb, backdrop) : null;
    /** @type {Record<string, string | number>} */
    const attrs = {
      ...(checked ? { checked: 'true' } : {}),
      ...(disabled ? { disabled: 'true' } : {}),
      // The main part stays clear; the indicator is the track, drawn inside its padding.
      style_bg_opa: 0,
      style_border_width: 0,
      style_pad_hor: padX,
      style_pad_ver: padY,
      'style_bg_opa:indicator': 255,
      'style_pad_all:knob': 0,
    };
    // Unchecked looks come from the plain selectors, checked ones from the :checked ones.
    const state = checked ? ':checked' : '';
    attrs[`style_bg_color${state}:indicator`] = hexOf(trackColor ?? (checked ? [0x21, 0x96, 0xf3] : DEFAULT_TRACK));
    if (checked) attrs['style_bg_color:indicator'] = hexOf(DEFAULT_TRACK); // the off side of a toggle shown on
    if (knobColor) attrs[`style_bg_color${state}:knob`] = hexOf(knobColor);
    // Material UI's pale thumb is only visible on white because of its shadow.
    const shadow = thumb?.styles?.shadow;
    if (shadow) {
      attrs['style_shadow_width:knob'] = shadow.blur;
      attrs['style_shadow_color:knob'] = hexOf(shadow.color);
      attrs['style_shadow_opa:knob'] = shadow.color[3];
      if (shadow.y) attrs['style_shadow_offset_y:knob'] = shadow.y;
    }

    const out = nativeOrWrapped(node, 'switch', 'toggle', 'lv_switch', attrs, box);
    out.recognized = { component: 'switch', props: { checked, disabled } };
    return out;
  },
};

export default switchDef;
