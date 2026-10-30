/**
 * Avatar: a circle (or rounded square) holding a photo or initials.
 *
 * Detection: Material UI's `MuiAvatar-root` (0.7), or `data-lv-widget="avatar"`
 * (handled by the registry). There is no ARIA role for an avatar.
 *
 * Findings behind build():
 *  - The extractor resolves `border-radius: 50%` to half the box, and LVGL 9.4
 *    clamps any radius larger than half the shorter side, so `style_radius`
 *    set to half the size is already a circle. LV_RADIUS_CIRCLE (0x7FFF, the
 *    same value as `style_radius="32767"`) gives the same result; the explicit
 *    half is kept because it reads better in the XML. build() only raises a
 *    radius that rounding left a pixel short.
 *  - Initials written straight in the circle (MUI does this) become a label
 *    the converter pins to the left edge, because it reads `text-align`, not
 *    the flex centering the browser used. The text is centered here.
 *  - A photo is a square `lv_image` that LVGL does not clip to the circle.
 *    The style that does it is `style_clip_corner="true"` on the parent (LVGL
 *    docs, "clip_corner"; verified in the XML runtime). The converter has no
 *    way to carry that yet, so build() sets `styles.clipCorner = true` on an
 *    avatar that holds an image, and the converter can read it (see the lane
 *    report). Until then the photo keeps its square corners.
 */
import { SCORE_MUI, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

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
    if (hasClass(node, 'MuiAvatar-square')) shape = 'square';
    else if (hasClass(node, 'MuiAvatar-rounded')) shape = 'rounded';
    else if (hasClass(node, 'MuiAvatar-circular') || (s.radius > 0 && s.radius >= half - 1)) shape = 'circular';
    else shape = s.radius > 0 ? 'rounded' : 'square';

    const image = findImage(node);
    const textOnly = Boolean(node.text) && node.children.length === 0;
    const styles = { ...s };
    if (shape === 'circular') styles.radius = Math.max(s.radius, half);
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
