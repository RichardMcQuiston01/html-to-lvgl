/**
 * Progress: how far a task has got (ARIA `role="progressbar"`, Material UI
 * LinearProgress and CircularProgress). A bar maps to the native `lv_bar`, a
 * ring to `lv_arc`.
 *
 * Signals, strongest first:
 *   1    role="progressbar" on a visible element
 *   0.7  MuiLinearProgress-root, MuiCircularProgress-root
 *   2    data-lv-widget="progress"
 * A plain `<progress>` is left to the converter, which already maps it to an
 * lv_bar, so existing pages do not change.
 *
 * Shape: Material UI says it in the class name. Otherwise an element about as
 * wide as it is tall (within 25 percent) is a ring, anything longer is a bar.
 *
 * Value: `aria-valuenow` between `aria-valuemin` (default 0) and
 * `aria-valuemax` (default 100). LVGL takes integers, so a 0 to 1 range at
 * 0.37 becomes 0 to 100 at 37. No `aria-valuenow`, or Material UI's
 * `*-indeterminate` class, means indeterminate.
 *
 * What build() emits:
 *   - bar: `lv_bar` with the root's box. The root's fill is the track and the
 *     filled child's fill is the indicator; both radii are copied. Material UI
 *     fills the bar with a child shifted by `translateX`, which the value
 *     already says, so the child is dropped.
 *   - ring: `lv_arc` at the root's box, a full circle starting at 12 o'clock
 *     (rotation 270, background angles 0 to 360), not clickable, no knob, no
 *     track, butt ends. The stroke is the element's text color, as in Material
 *     UI (`currentColor`), and its width is 3.6 of 44 of the box, Material UI's
 *     default thickness, or the element's border width.
 *   - indeterminate: lv_spinner has no XML tag in LVGL 9.4 and no binding
 *     under MicroPython, and an animation is not in a snapshot, so a bar is
 *     drawn 40 percent full and a ring as a 40 percent arc, and
 *     UNSUPPORTED_WIDGET is reported so the screen can get a real spinner in code.
 *
 * Limits: a ring track drawn by a second SVG circle (a plain ARIA ring) is
 * not in the extracted tree, so only Material UI-style rings, which have none,
 * match exactly; buffer and query variants draw as determinate bars.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasMuiRoot, hasClass, withName } from './shared.mjs';
import { solidBackdropOf } from './chip.mjs';
import { hexOf, nativeOrWrapped, findAll, findByClass, fillOf, solidColor, numberOr, scaleToIntegers } from './native.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** How full an indeterminate progress is drawn: a snapshot has no animation to show. */
const INDETERMINATE_SHARE = 0.4;
/** The part of a ring one wide stroke covers in Material UI: thickness 3.6 of a 44 unit box. */
const MUI_THICKNESS_SHARE = 3.6 / 44;

/** @param {UiNode} node */
const isMuiProgress = (node) => hasMuiRoot(node, 'LinearProgress') || hasMuiRoot(node, 'CircularProgress');

/** Whether a node is a ring rather than a bar. @param {UiNode} node */
function isCircular(node) {
  if (hasMuiRoot(node, 'CircularProgress')) return true;
  if (hasMuiRoot(node, 'LinearProgress')) return false;
  return Math.abs(node.w - node.h) <= 0.25 * Math.max(node.w, node.h);
}

/** No `aria-valuenow` (the ARIA way to say "unknown"), or Material UI's indeterminate class. @param {UiNode} node */
const isIndeterminate = (node) =>
  ariaOf(node, 'valuenow') === undefined || (node.classes ?? []).some((c) => /^Mui(Linear|Circular)Progress-indeterminate$/.test(c));

/** The filled part of a bar: the first descendant with a fill of its own. @param {UiNode} node */
const fillChild = (node) => findByClass(node, 'MuiLinearProgress-bar', 'MuiLinearProgress-bar1') ?? findAll(node, (n) => n !== node && n.styles?.bgColor && n.styles.bgColor[3] > 0)[0] ?? null;

/** @type {import('../recognize.mjs').ComponentDef} */
const progress = {
  name: 'progress',
  match(node) {
    if (node.hidden || node.native) return false;
    if (node.role === 'progressbar') return SCORE_SEMANTIC;
    if (isMuiProgress(node)) return SCORE_MUI;
    return false;
  },
  props: {
    variant: { type: 'string', default: 'linear' },
    value: { type: 'number', default: 0 },
    min: { type: 'number', default: 0 },
    max: { type: 'number', default: 100 },
    indeterminate: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    if (node.role !== 'progressbar' && !isMuiProgress(node)) return null; // a bare data-lv-widget="progress": nothing to read

    const ring = isCircular(node);
    const indeterminate = isIndeterminate(node);
    const backdrop = solidBackdropOf(ctx, node);
    const min = numberOr(ariaOf(node, 'valuemin'), 0);
    const max = numberOr(ariaOf(node, 'valuemax'), 100);
    const now = indeterminate ? min + (max - min) * INDETERMINATE_SHARE : Math.min(max, Math.max(min, numberOr(ariaOf(node, 'valuenow'), min)));
    const { values: [iMin, iMax, iNow] } = scaleToIntegers([min, max, now]);

    if (indeterminate) {
      ctx.diagnostics.add({
        code: 'UNSUPPORTED_WIDGET',
        message: `${ring ? 'circular' : 'linear'} progress ${node.key} is indeterminate; LVGL XML has no animated progress (lv_spinner has no XML tag), so it is drawn as a static ${ring ? 'arc, 40 percent of the circle' : 'bar, 40 percent full'}`,
        fix: ring
          ? 'Create an lv_spinner in application code at this position, or give the element aria-valuenow so it converts as a determinate ring.'
          : 'Animate the bar value in application code (lv_anim on lv_bar_set_value), or give the element aria-valuenow so it converts as a determinate bar.',
        source: { selector: node.key },
      });
    }

    const props = { variant: ring ? 'circular' : 'linear', value: now, min, max, indeterminate };
    if (ring) {
      const color = solidColor(node.styles.color, backdrop) ?? [0x19, 0x76, 0xd2];
      const stroke = Math.max(1, Math.round(node.styles.borderWidth || Math.min(node.w, node.h) * MUI_THICKNESS_SHARE));
      /** @type {Record<string, string | number>} */
      const attrs = {
        // Angles first: the value is turned into an angle with them.
        bg_start_angle: 0,
        bg_end_angle: 360,
        rotation: 270,
        min_value: iMin,
        max_value: iMax,
        value: iNow,
        clickable: 'false',
        style_bg_opa: 0,
        style_border_width: 0,
        style_pad_all: 0,
        style_arc_opa: 0, // Material UI has no track behind the ring
        style_arc_width: stroke,
        style_arc_rounded: 'false',
        'style_arc_width:indicator': stroke,
        'style_arc_rounded:indicator': 'false',
        'style_arc_color:indicator': hexOf(color),
        'style_bg_opa:knob': 0,
        'style_pad_all:knob': 0,
      };
      const out = nativeOrWrapped(node, 'progress', 'ring', 'lv_arc', attrs, { x: node.x, y: node.y, w: node.w, h: node.h });
      out.recognized = { component: 'progress', props };
      return out;
    }

    const fill = fillChild(node);
    const trackColor = fillOf(node, backdrop) ?? [0xe0, 0xe0, 0xe0];
    const indicatorColor = fillOf(fill, backdrop) ?? [0x21, 0x96, 0xf3];
    const radius = Math.min(node.styles.radius ?? 0, Math.floor(Math.min(node.w, node.h) / 2));
    /** @type {Record<string, string | number>} */
    const attrs = {
      min_value: iMin,
      max_value: iMax,
      value: iNow,
      style_bg_color: hexOf(trackColor),
      style_bg_opa: 255,
      style_radius: radius,
      'style_bg_color:indicator': hexOf(indicatorColor),
      'style_radius:indicator': radius,
    };
    const out = nativeOrWrapped(node, 'progress', 'bar', 'lv_bar', attrs, { x: node.x, y: node.y, w: node.w, h: node.h });
    out.recognized = { component: 'progress', props };
    return withName(out, 'progress');
  },
};

export default progress;
