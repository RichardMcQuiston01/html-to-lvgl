/**
 * Avatar: a circle (or rounded square) holding a photo or initials.
 *
 * Detection: Material UI's `MuiAvatar-root` (0.7), or `data-lv-widget="avatar"`
 * (handled by the registry). There is no ARIA role for an avatar.
 *
 * Findings behind build():
 *  - The extractor resolves `border-radius: 50%` to half the box, and LVGL 9.4
 *    clamps any radius larger than half the shorter side, so half the size is
 *    already a circle. The XML has no keyword for it (lv_xml_to_size only knows
 *    "content" and percentages) but LV_RADIUS_CIRCLE is 0x7FFF, so
 *    `style_radius="32767"` is a circle whatever size the editor later gives
 *    the avatar. build() writes that value for a circular avatar and keeps the
 *    measured radius for a rounded square.
 *  - Initials written straight in the circle (MUI does this) become a label
 *    the converter pins to the left edge, because it reads `text-align`, not
 *    the flex centering the browser used. The text is centered here.
 *  - A photo is a square `lv_image` that LVGL does not clip to the circle.
 *    The style that does it is `style_clip_corner="true"` on the parent (LVGL
 *    docs, "clip_corner"; lv_xml_style.c reads `style_clip_corner`). The
 *    converter does NOT emit it today and this lane may not edit convert.mjs,
 *    so build() only sets the marker `styles.clipCorner = true` on an avatar
 *    that holds an image, for a converter hunk to read (see the lane report).
 *    Until then the photo keeps its square corners.
 */
import { SCORE_MUI, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** LVGL's LV_RADIUS_CIRCLE (lv_draw_rect.h): drawn as a full circle whatever the size. */
const LV_RADIUS_CIRCLE = 0x7fff;

/** @param {UiNode} node */
const findImage = (node) => {
  for (const c of node.children) {
    if (c.tag === 'img') return c;
    const nested = findImage(c);
    if (nested) return nested;
  }
  return null;
};

/** @param {UiNode} node @returns {string} */
const firstText = (node) => node.text || node.children.map(firstText).find(Boolean) || '';

/** @type {import('../recognize.mjs').ComponentDef} */
const avatar = {
  name: 'avatar',
  match(node) {
    if (node.hidden) return false;
    return hasMuiRoot(node, 'Avatar') ? SCORE_MUI : false;
  },
  props: {
    shape: { type: 'string', default: 'circular' },
    initials: { type: 'string', default: '' },
    src: { type: 'string', default: '' },
  },
  slots: ['image', 'fallback'],
  build(node) {
    const s = node.styles;
    const half = Math.ceil(Math.min(node.w, node.h) / 2);

    /** @type {'circular' | 'rounded' | 'square'} */
    let shape;
    // The MEASURED radius decides: a page can override the variant class with
    // its own border-radius, and the extractor already resolved 50% to half.
    if (s.radius > 0 && s.radius >= half - 1) shape = 'circular';
    else shape = s.radius > 0 ? 'rounded' : 'square';

    const image = findImage(node);
    const textOnly = Boolean(node.text) && node.children.length === 0;
    const styles = { ...s };
    if (shape === 'circular') styles.radius = LV_RADIUS_CIRCLE;
    if (textOnly) styles.textAlign = 'center';
    if (image && styles.radius > 0) styles.clipCorner = true;

    // An inlined data: URI would bloat the props the editor reads.
    const rawSrc = image?.attrs?.src ? String(image.attrs.src) : '';
    const imageSrc = rawSrc.startsWith('data:') ? '' : rawSrc;

    let next = { ...node, widget: node.widget === 'avatar' ? null : node.widget, styles };
    next = withName(next, 'avatar');
    next.recognized = {
      component: 'avatar',
      props: { shape, initials: image ? '' : firstText(node), src: imageSrc },
    };
    return next;
  },
};

export default avatar;
