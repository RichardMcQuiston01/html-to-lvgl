/**
 * Slider: pick a value on a line (ARIA `role="slider"`, Material UI Slider).
 * It maps to the native `lv_slider`, with its range and value read from ARIA.
 *
 * Signals, strongest first:
 *   1    role="slider" on a visible element that is not an <input type=range>
 *        (that one already maps to an lv_slider in the converter)
 *   0.7  MuiSlider-root
 *   2    data-lv-widget="slider", but only with one of the signals above;
 *        a bare annotation keeps the converter's own mapping (emitForced)
 *
 * Values: `aria-valuemin` (default 0), `aria-valuemax` (default 100) and
 * `aria-valuenow`. Material UI puts them on the `<input type=range>` inside
 * each thumb, so a root reads them from there (the input's `min`, `max` and
 * `value` count too). LVGL takes integers, so a 0 to 1 slider at 0.37 becomes
 * 0 to 100 at 37.
 *
 * What build() emits (one `lv_slider`):
 *   - the widget is the rail, so its height is the rail's and the knob is
 *     drawn bigger than it with the knob part's padding, as the thumb is
 *     bigger than the rail in Material UI. Rail, filled track and thumb colors
 *     are copied; rail transparency (Material UI draws it at 38%) is folded
 *     into a solid color over the background;
 *   - a vertical slider (taller than wide) keeps that shape, LVGL picks the
 *     orientation from the box;
 *   - two thumbs (a Material UI range slider) become `mode="range"` with a
 *     start value, the second thumb being the end value;
 *   - disabled from `aria-disabled` or `Mui-disabled`.
 *
 * Limits: marks, value labels and the step are not reproduced (a LVGL slider
 * moves by one unit); three or more thumbs report UNSUPPORTED_WIDGET and keep
 * the first and last; a thumb shadow or focus ring is not drawn.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasMuiRoot, hasClass } from './shared.mjs';
import { solidBackdropOf } from './chip.mjs';
import { hexOf, nativeOrWrapped, findAll, findByClass, fillOf, numberOr, scaleToIntegers } from './native.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** LVGL's slider colors, used for a part the page does not show. */
const DEFAULT_RAIL = [0xe0, 0xe0, 0xe0];
const DEFAULT_ACCENT = [0x21, 0x96, 0xf3];

/** @param {UiNode} node */
const isRangeInput = (node) => node.tag === 'input' && String(node.attrs?.type).toLowerCase() === 'range';

/** The numbers one thumb says: from its ARIA, else from the range input's attributes. @param {UiNode} source */
function reading(source) {
  const input = source.tag === 'input' ? source : findAll(source, isRangeInput)[0] ?? source;
  const pick = (aria, attr) => numberOr(ariaOf(input, aria) ?? ariaOf(source, aria), numberOr(input.attrs?.[attr], undefined));
  return { min: pick('valuemin', 'min'), max: pick('valuemax', 'max'), now: pick('valuenow', 'value') };
}

/**
 * The pieces of a slider as drawn: the rail (the widget's box), the filled
 * track, and the thumbs.
 * @param {UiNode} node
 */
function parts(node) {
  const rail = findByClass(node, 'MuiSlider-rail');
  if (hasMuiRoot(node, 'Slider') && rail) {
    return {
      rail,
      track: findByClass(node, 'MuiSlider-track'),
      thumbs: findAll(node, (n) => hasClass(n, 'MuiSlider-thumb')),
      sources: findAll(node, (n) => hasClass(n, 'MuiSlider-thumb')).map((t) => t),
    };
  }
  // A hand-made slider: the element is the rail. A child shaped like a circle
  // or square is the thumb; any other child with a fill is the filled track.
  const filled = findAll(node, (n) => n !== node && n.styles?.bgColor && n.styles.bgColor[3] > 0 && n.w > 0 && n.h > 0);
  const roundish = (n) => Math.abs(n.w - n.h) <= 2;
  const thumb = filled.find(roundish) ?? null;
  return { rail: node, track: filled.find((n) => n !== thumb) ?? null, thumbs: thumb ? [thumb] : [], sources: [node] };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const slider = {
  name: 'slider',
  match(node) {
    if (node.hidden || node.native) return false;
    if (node.role === 'slider' && !isRangeInput(node)) return SCORE_SEMANTIC;
    if (hasMuiRoot(node, 'Slider')) return SCORE_MUI;
    return false;
  },
  props: {
    min: { type: 'number', default: 0 },
    max: { type: 'number', default: 100 },
    value: { type: 'number', default: 0 },
    disabled: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    const signal = (node.role === 'slider' && !isRangeInput(node)) || hasMuiRoot(node, 'Slider');
    if (!signal) return null; // data-lv-widget="slider" on a plain element keeps the converter's mapping

    const { rail, track, thumbs, sources } = parts(node);
    const backdrop = solidBackdropOf(ctx, node);

    // One reading per thumb; a hand-made slider has one, on the element itself.
    let readings = sources.map(reading);
    if (readings.length > 2) {
      ctx.diagnostics.add({
        code: 'UNSUPPORTED_WIDGET',
        message: `slider ${node.key} has ${readings.length} thumbs; lv_slider supports one, or two in range mode, so only the first and the last are kept`,
        fix: 'Reduce the slider to one or two thumbs, or build the extra handles by hand from lv_obj widgets in the generated file.',
        source: { selector: node.key },
      });
      readings = [readings[0], readings[readings.length - 1]];
    }
    const first = readings[0] ?? {};
    const min = numberOr(first.min, 0);
    const max = numberOr(first.max, 100);
    const now = numberOr(readings[readings.length - 1]?.now, min);
    const start = readings.length > 1 ? numberOr(readings[0].now, min) : null;
    const { scale, values } = scaleToIntegers([min, max, now, ...(start === null ? [] : [start])]);
    const [iMin, iMax, iNow, iStart] = values;

    const railColor = fillOf(rail, backdrop) ?? DEFAULT_RAIL;
    const trackColor = fillOf(track, backdrop) ?? fillOf(thumbs[0], backdrop) ?? DEFAULT_ACCENT;
    const thumbColor = fillOf(thumbs[0], backdrop) ?? trackColor;
    const railThickness = Math.max(1, Math.min(rail.w, rail.h));
    const thumbSize = thumbs.length ? Math.max(thumbs[0].w, thumbs[0].h) : railThickness;
    const knobPad = Math.max(0, Math.round((thumbSize - railThickness) / 2));
    const radius = Math.ceil(thumbSize / 2);
    const disabled = ariaOf(node, 'disabled') === 'true' || findAll(node, (n) => hasClass(n, 'Mui-disabled')).length > 0;

    /** @type {Record<string, string | number>} */
    const attrs = {
      ...(start === null ? {} : { mode: 'range' }),
      min_value: iMin,
      max_value: iMax,
      value: iNow,
      // LVGL clamps the start to the current value (lv_bar_set_start_value), so it comes after it.
      ...(start === null ? {} : { start_value: iStart }),
      ...(disabled ? { disabled: 'true' } : {}),
      style_bg_color: hexOf(railColor),
      style_bg_opa: 255,
      style_radius: Math.ceil(railThickness / 2),
      'style_bg_color:indicator': hexOf(trackColor),
      'style_radius:indicator': Math.ceil(railThickness / 2),
      'style_bg_color:knob': hexOf(thumbColor),
      'style_radius:knob': radius,
      'style_pad_all:knob': knobPad,
    };

    const out = nativeOrWrapped(node, 'slider', 'control', 'lv_slider', attrs, { x: rail.x, y: rail.y, w: rail.w, h: rail.h });
    out.recognized = { component: 'slider', props: { min, max, value: now, disabled } };
    return out;
  },
};

export default slider;
