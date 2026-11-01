/**
 * Card: A container with a raised or outlined surface (Material UI Card, Bootstrap card).
 *
 * The converter already turns a card's computed style into an `lv_obj` with
 * its background, radius, border and the largest elevation shadow layer, and
 * lays its children out in a flex column. What it gets wrong, and what this
 * definition fixes, is three small things inside a card:
 *
 *   1. A translucent border (`rgba(0,0,0,0.12)`, Material UI's outlined
 *      variant) loses its alpha and renders solid black, because LVGL has no
 *      per-border opacity here. The border is blended onto the surface color.
 *   2. A text-only block that has padding (CardContent) becomes a bare label,
 *      which cannot hold padding, so the text slides to the card's edge. It is
 *      wrapped in a box that keeps the padding.
 *   3. A text button with no background (CardActions, or a CardHeader action
 *      IconButton) gets LVGL's default blue fill, so its background is made
 *      transparent. This covers every button below the card, not only the
 *      actions row.
 *
 * Signals: Material UI `MuiCard-root` (0.7), a generic `card` class as
 * Bootstrap uses it (0.5). A node that is only a `MuiPaper-root` is a Paper,
 * not a Card (see paper.mjs).
 */

import { SCORE_MUI, SCORE_GENERIC_CLASS, hasClass, hasMuiRoot, classesOf, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** Slot class names, for Material UI parts and Bootstrap's `card-*` parts. */
const SLOT_CLASSES = {
  header: ['MuiCardHeader-root', 'card-header'],
  body: ['MuiCardContent-root', 'card-body'],
  actions: ['MuiCardActions-root', 'card-footer'],
};

/**
 * The color of a translucent `color` laid over `background`, as an opaque
 * [r, g, b, 255].
 * @param {number[]} color     [r, g, b, a] with a in 0..255.
 * @param {number[]} background [r, g, b, a]; its own alpha is ignored.
 * @returns {number[]}
 */
export function blend(color, background) {
  const a = color[3] / 255;
  return [0, 1, 2].map((i) => Math.round(color[i] * a + background[i] * (1 - a))).concat(255);
}

/**
 * The opaque color behind a node: its own background, else its parent's, else
 * white (a browser page's default canvas).
 * @param {UiNode} node
 * @param {UiNode | null | undefined} parent
 * @returns {number[]}
 */
export function surfaceBehind(node, parent) {
  for (const n of [node, parent]) {
    const bg = n?.styles?.bgColor;
    if (bg && bg[3] === 255) return bg;
  }
  return [255, 255, 255, 255];
}

/**
 * Replace a translucent border with the opaque color it looks like. Returns
 * the styles object unchanged when the border is solid or absent.
 * @param {UiNode} node
 * @param {UiNode | null | undefined} parent
 * @returns {UiNode['styles']}
 */
export function solidBorderStyles(node, parent) {
  const s = node.styles;
  if (!s || !s.borderColor || s.borderColor[3] >= 255) return s;
  return { ...s, borderColor: blend(s.borderColor, surfaceBehind(node, parent)) };
}

/**
 * True when a visible border is drawn: a width and a color that is not fully
 * transparent.
 * @param {UiNode} node
 */
export function hasVisibleBorder(node) {
  const s = node.styles;
  return Boolean(s && s.borderWidth > 0 && s.borderColor && s.borderColor[3] > 0);
}

/**
 * 'outlined' when the surface is drawn with a border instead of a shadow:
 * Material UI's `MuiPaper-outlined`, or a visible border with no shadow.
 * @param {UiNode} node
 * @returns {'elevation' | 'outlined'}
 */
export function surfaceVariant(node) {
  if (hasClass(node, 'MuiPaper-outlined')) return 'outlined';
  return hasVisibleBorder(node) && !node.styles.shadow ? 'outlined' : 'elevation';
}

/**
 * A text-only block with padding: the converter makes it a label and the
 * padding is lost. Returns it as a padded box holding a label-sized child
 * placed where the browser drew the text. Other nodes come back unchanged.
 * @param {UiNode} n
 * @param {number[]} surface  Opaque color behind the text, for translucent text colors.
 * @returns {UiNode}
 */
export function keepTextPadding(n, surface) {
  const s = n.styles;
  if (!n.text || n.children.length || !s) return n;
  const { padLeft = 0, padRight = 0, padTop = 0, padBottom = 0 } = s;
  if (!(padLeft || padRight || padTop || padBottom)) return n;
  if (s.bgColor || (s.borderWidth > 0 && s.borderColor) || (s.borderBottomWidth > 0 && s.borderBottomColor)) return n;
  const label = {
    ...n,
    tag: 'span',
    id: null, className: null, classes: [], lvName: null, widget: null, component: null, link: null,
    role: null, aria: {}, testId: null,
    x: n.x + padLeft,
    y: n.y + padTop,
    w: Math.max(1, n.w - padLeft - padRight),
    h: Math.max(1, n.h - padTop - padBottom),
    // Secondary text is usually rgba(0,0,0,0.6); LVGL text color has no alpha
    // here, so use the opaque color it looks like over the surface.
    styles: {
      ...s,
      ...(s.color && s.color[3] < 255 ? { color: blend(s.color, surface) } : {}),
      padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    },
    layout: { ...n.layout, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, flexGrow: 0 },
    children: [],
    key: `${n.key}/text`,
  };
  return { ...n, text: null, children: [label] };
}

/**
 * A text button with no fill must not take LVGL's default button color.
 * @param {UiNode} n
 * @returns {UiNode}
 */
export function transparentTextButtons(n) {
  if ((n.tag === 'button' || n.role === 'button') && !n.styles?.bgColor && !n.styles?.gradient) {
    return { ...n, styles: { ...n.styles, bgColor: [0, 0, 0, 0] } };
  }
  if (n.children.length === 0) return n;
  return { ...n, children: n.children.map(transparentTextButtons) };
}

/**
 * Which slot a direct child fills, or null.
 * @param {UiNode} child
 * @returns {'header' | 'body' | 'actions' | null}
 */
function slotOf(child) {
  const classes = classesOf(child);
  for (const [slot, names] of Object.entries(SLOT_CLASSES)) {
    if (names.some((c) => classes.includes(c))) return /** @type {'header' | 'body' | 'actions'} */ (slot);
  }
  return null;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const card = {
  name: 'card',
  match(node) {
    if (hasMuiRoot(node, 'Card')) return SCORE_MUI;
    if (hasClass(node, 'card')) return SCORE_GENERIC_CLASS;
    return false;
  },
  props: { variant: { type: 'string', default: 'elevation' } },
  slots: ['header', 'body', 'actions'],
  build(node, ctx) {
    const surface = surfaceBehind(node, ctx?.parent);
    // A header action (an IconButton) or a button in the body is as likely as
    // one in the actions row, so every button below the card is covered.
    const children = node.children.map(transparentTextButtons).map((child) => {
      const slot = slotOf(child);
      if (!slot) return child;
      let next = withName(child, `card_${slot}`);
      if (slot !== 'actions') next = keepTextPadding(next, surface);
      return next;
    });
    return {
      ...withName(node, 'card'),
      styles: solidBorderStyles(node, ctx?.parent),
      children,
      recognized: { component: 'card', props: { variant: surfaceVariant(node) } },
    };
  },
};

export default card;
