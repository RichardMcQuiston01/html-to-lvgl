/**
 * Chip: a compact pill with a label and an optional leading icon or avatar,
 * or a delete control. See COMPONENTS.md.
 *
 * Detection: Material UI's `MuiChip-root` (0.7), or `data-lv-widget="chip"`
 * (handled by the registry). A Bootstrap `badge rounded-pill` is deliberately
 * NOT a chip: it is a plain pill label and belongs to the badge definition.
 * A chip has no ARIA role of its own (a clickable MUI chip is role="button",
 * which the converter already treats as any other element).
 *
 * What the converter gets wrong for chips, and what build() fixes:
 *  - the pill radius survives as is (the extractor keeps it, LVGL clamps a
 *    radius larger than half the height), so nothing is done there;
 *  - a <button> delete control with a transparent background would show
 *    LVGL's default blue button, so its fill is made explicitly transparent;
 *  - the converter places a node's own text BEFORE its child elements, so a
 *    chip written as `<span><i class="dot"></i>Online</span>` would put the
 *    dot after the text; the text becomes a real label child at the right place;
 *  - translucent text/border colors (`rgba(0,0,0,0.87)`) lose their alpha in
 *    the converter, so they are blended onto the solid background behind them;
 *  - margins below zero and the label's own padding are not applied by the
 *    converter, so an avatar or delete icon would collide with the label; the
 *    gaps the browser laid out are re-applied as positive margins.
 */
import { SCORE_MUI, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/**
 * @param {UiNode} node
 * @returns {boolean}
 */
// A reversed row is left alone: its children sit right to left, so a gap
// measured in document order would be nonsense.
const isRow = (node) => Boolean(node.layout) && node.layout.display === 'flex' && node.layout.flexDirection !== 'column' &&
  node.layout.flexDirection !== 'column-reverse' && node.layout.flexDirection !== 'row-reverse';

/** @param {UiNode} node */
const isOutOfFlow = (node) => node.layout?.position === 'absolute' || node.layout?.position === 'fixed';

/**
 * The converter draws a <button> with LVGL's theme fill unless a background is
 * given. A button the page made transparent must say so explicitly.
 * @param {UiNode} node
 * @returns {UiNode}
 */
export function withTransparentButtons(node) {
  const children = node.children.map(withTransparentButtons);
  if (node.tag === 'button' && !node.styles.bgColor && !node.styles.gradient) {
    return { ...node, children, styles: { ...node.styles, bgColor: [0, 0, 0, 0] } };
  }
  return children.some((c, i) => c !== node.children[i]) ? { ...node, children } : node;
}

/**
 * Turn a node's own text into a real child label when the node also has child
 * elements, placed before or after them by where the children sit. Without
 * this the converter always emits the text first.
 *
 * Returns the node unchanged when there is no mixed content.
 * @param {UiNode} node
 * @param {string} labelName  Widget name for the new label.
 * @returns {UiNode}
 */
export function withTextAsChild(node, labelName) {
  const flowing = node.children.filter((c) => !isOutOfFlow(c) && !c.hidden);
  if (!node.text || flowing.length === 0) return node;
  const s = node.styles;
  const fontSize = s.fontSize || 14;
  const used = flowing.reduce((sum, c) => sum + c.w + (c.layout?.marginLeft ?? 0) + (c.layout?.marginRight ?? 0), 0);
  const h = Math.round(fontSize * 1.4);
  const w = Math.max(1, Math.round(node.w - 2 * s.borderWidth - s.padLeft - s.padRight - used));
  /** @type {UiNode} */
  const label = {
    tag: 'span', id: null, className: null, lvName: labelName, widget: null, component: null, link: null,
    x: node.x, y: Math.round(node.y + (node.h - h) / 2), w, h, text: node.text, attrs: {},
    key: `${node.key ?? 'node'}/text`,
    styles: {
      ...s, bgColor: null, gradient: null, shadow: null, pressed: null, borderWidth: 0, borderBottomWidth: 0,
      borderColor: null, borderBottomColor: null, radius: 0, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
      scrollable: false, opacity: 1,
    },
    layout: { ...node.layout, display: 'block', flexGrow: 0, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static' },
    children: [],
  };
  // The text sits between the children that are left of the middle and the
  // ones that are right of it: a leading icon first, a delete control last.
  const middle = node.x + node.w / 2;
  const before = flowing.filter((c) => c.x + c.w / 2 < middle).length;
  const children = [...node.children];
  const at = before === 0 ? 0 : children.indexOf(flowing[before - 1]) + 1;
  children.splice(at, 0, label);
  return { ...node, text: null, children };
}

/**
 * Re-apply the gaps the browser laid out between the chip's children as
 * positive margins, and start-align them. The converter ignores negative
 * margins and a label's own padding, both of which MUI chips rely on
 * (`margin-right: -6px` on the avatar, `padding: 0 12px` on the label).
 * @param {UiNode} node  A flex row with more than one flowing child.
 * @returns {UiNode}
 */
function withMeasuredGaps(node) {
  const flowing = node.children.filter((c) => !isOutOfFlow(c) && !c.hidden);
  if (!isRow(node) || flowing.length < 2) return node;
  let cursor = node.x + node.styles.borderWidth + node.styles.padLeft;
  const adjusted = new Map();
  for (const child of flowing) {
    const textOnly = Boolean(child.text) && child.children.length === 0;
    const padL = textOnly ? child.styles.padLeft : 0;
    const padR = textOnly ? child.styles.padRight : 0;
    const left = child.x + padL;
    const width = child.w - padL - padR;
    const gap = Math.max(0, Math.round(left - cursor));
    cursor = left + width;
    adjusted.set(child, {
      ...child,
      // Only a plain text label has its padding moved into the margin; a padded
      // container (an icon or avatar wrapper) keeps its own padding.
      styles: textOnly ? { ...child.styles, padLeft: 0, padRight: 0 } : child.styles,
      layout: { ...child.layout, marginLeft: gap, marginRight: 0 },
    });
  }
  return {
    ...node,
    layout: { ...node.layout, justifyContent: 'flex-start', columnGap: 0 },
    children: node.children.map((c) => adjusted.get(c) ?? c),
  };
}


/**
 * The converter writes colors as 0xRRGGBB and drops their alpha, so a text or
 * border color such as `rgba(0,0,0,0.87)` (Material UI's text color) would come
 * out as pure black. Blend each translucent text/border color onto the
 * background it sits on, so the solid color is what the browser showed.
 *
 * The background is the NEAREST solid one met while descending. Under a
 * gradient, a translucent layer (opacity below 1) or a translucent fill with
 * nothing solid behind it the backdrop is unknown, so nothing is changed there.
 * Opacity itself is never touched.
 *
 * @param {UiNode} node
 * @param {[number, number, number] | null} base  Solid color behind the node, if known.
 * @returns {UiNode}
 */
export function blendTranslucentColors(node, base) {
  const s = node.styles;
  let behind = base;
  if (s.gradient || s.opacity < 1) behind = null;
  else if (s.bgColor && s.bgColor[3] > 0) {
    const [r, g, b, a] = s.bgColor;
    if (a >= 255) behind = [r, g, b];
    else behind = behind ? mix([r, g, b], a, behind) : null;
  }
  /** @param {number[] | null | undefined} c */
  const solid = (c) => (c && c[3] < 255 && behind ? [...mix([c[0], c[1], c[2]], c[3], behind), 255] : c);
  const styles = { ...s, color: solid(s.color), borderColor: solid(s.borderColor), borderBottomColor: solid(s.borderBottomColor) };
  const children = node.children.map((c) => blendTranslucentColors(c, behind));
  return { ...node, styles, children };
}

/** @param {number[]} fg @param {number} alpha 0-255 @param {number[]} bg */
const mix = (fg, alpha, bg) => fg.map((v, i) => Math.round((v * alpha + bg[i] * (255 - alpha)) / 255));

/**
 * The solid color behind a node: the nearest ancestor with an opaque
 * background. Null when a gradient, a translucent fill or a translucent layer
 * (opacity below 1) is met first, or when nothing solid exists, because the
 * backdrop is then unknown. Ancestors are found by searching ctx.tree for the
 * node's key (a node does not know its parent), falling back to ctx.parent.
 * @param {{ tree?: UiNode, parent?: UiNode | null } | undefined} ctx
 * @param {UiNode} node
 * @returns {[number, number, number] | null}
 */
export function solidBackdropOf(ctx, node) {
  /** @type {UiNode[] | null} */
  let path = null;
  /** @param {UiNode} n @param {UiNode[]} trail @param {(n: UiNode) => boolean} is */
  const find = (n, trail, is) => {
    if (is(n)) { path = trail; return true; }
    return n.children.some((c) => find(c, [...trail, n], is));
  };
  // By identity first: a parent's build() may hand its children on as copies,
  // and hand-built trees reuse one key everywhere. By key as the fallback.
  if (ctx?.tree && !find(ctx.tree, [], (n) => n === node) && node.key !== undefined) {
    find(ctx.tree, [], (n) => n.key === node.key);
  }
  const ancestors = path ?? (ctx?.parent ? [ctx.parent] : []);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const s = ancestors[i].styles;
    if (!s) continue;
    if (s.gradient || s.opacity < 1) return null;
    if (s.bgColor && s.bgColor[3] > 0) return s.bgColor[3] >= 255 ? [s.bgColor[0], s.bgColor[1], s.bgColor[2]] : null;
  }
  return null;
}

/**
 * The text a chip shows: the MuiChip-label (or the label build() made from the
 * chip's own text), else the chip's own text, else the first text found
 * outside an avatar, icon, button or delete control.
 * @param {UiNode} node
 * @returns {string}
 */
function labelOf(node) {
  const label = node.children.find((c) => c.lvName === 'chip_label' || hasClass(c, 'MuiChip-label'));
  if (label) return textOf(label);
  if (node.text) return node.text;
  return textOf(node, true);
}

/** Text of a node and its descendants, optionally skipping decoration parts. */
function textOf(node, skipParts = false) {
  if (skipParts && isDecoration(node)) return '';
  if (node.text) return node.text;
  for (const c of node.children) {
    const t = textOf(c, skipParts);
    if (t) return t;
  }
  return '';
}

/** @param {UiNode} node */
const isDecoration = (node) => node.tag === 'button' || node.tag === 'svg' || node.recognized?.component === 'icon' ||
  node.lvName === 'chip_avatar' || hasClass(node, 'MuiChip-avatar', 'MuiAvatar-root', 'MuiChip-deleteIcon', 'MuiSvgIcon-root');

/** @type {import('../recognize.mjs').ComponentDef} */
const chip = {
  name: 'chip',
  match(node) {
    // A hidden chip is dropped after recognition; naming it would only burn
    // a number (chip, chip_2) for a widget that is never emitted.
    if (node.hidden) return false;
    return hasMuiRoot(node, 'Chip') ? SCORE_MUI : false;
  },
  props: {
    label: { type: 'string', default: '' },
    variant: { type: 'string', default: 'filled' },
  },
  slots: ['icon', 'delete'],
  build(node, ctx) {
    let next = { ...node, widget: node.widget === 'chip' ? null : node.widget };

    const outlined = hasClass(node, 'MuiChip-outlined') ||
      (!node.styles.bgColor && node.styles.borderWidth > 0 && !hasClass(node, 'MuiChip-filled'));
    const variant = outlined ? 'outlined' : 'filled';

    next = withTransparentButtons(next);
    next = blendTranslucentColors(next, solidBackdropOf(ctx, node));
    const beforeText = next;
    next = withTextAsChild(next, 'chip_label');
    const hadMixedText = next !== beforeText;
    // Name the label and avatar by their job; an author's own name wins.
    next = {
      ...next,
      children: next.children.map((c) => {
        if (c.lvName) return c;
        if (hasClass(c, 'MuiChip-label')) return { ...c, lvName: 'chip_label' };
        if (hasClass(c, 'MuiChip-avatar')) return { ...c, lvName: 'chip_avatar' };
        return c;
      }),
    };
    // The label made from mixed text has no measured box, so its neighbors
    // keep the margins the CSS gave them.
    if (!hadMixedText) next = withMeasuredGaps(next);

    // A chip that is only a label centers it: the pill is the box and the
    // converter would otherwise pin the text to the left padding.
    const padDiff = Math.abs(next.styles.padLeft - next.styles.padRight);
    if (next.text && next.children.length === 0 && padDiff <= 1) {
      next = { ...next, styles: { ...next.styles, textAlign: 'center' } };
    }

    next = withName(next, 'chip');
    next.recognized = { component: 'chip', props: { label: labelOf(next), variant } };
    return next;
  },
};

export default chip;
