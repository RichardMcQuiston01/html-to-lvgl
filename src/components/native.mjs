/**
 * Helpers for the Phase 9 definitions that remap a component onto one native
 * LVGL widget (text field, switch, slider, progress). They only read the
 * extracted tree; the converter turns the `native` field into the widget
 * (convert.mjs, emitNativeWidget).
 */
import { ariaOf, classesOf, withName } from './shared.mjs';
import { ownName } from '../names.mjs';
import { findNode } from './overlay.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** `[r, g, b]` as the 0xRRGGBB text an LVGL XML color attribute takes. */
export const hexOf = ([r, g, b]) => `0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Replace a node with one native widget. Position and size are the node's own
 * unless `box` overrides them; the children are dropped because the widget
 * draws everything itself. The recognizer must not offer the result to a
 * definition again, so `recognized` is set by the registry as usual.
 *
 * @param {UiNode} node
 * @param {string} tag  An lv_* widget tag that lv_xml knows.
 * @param {Record<string, string | number>} attrs  Widget attributes, final values.
 * @param {{ box?: { x: number, y: number, w: number, h: number }, fontText?: string | null }} [options]
 *   `fontText`: the text the widget shows, so the converter picks its font.
 * @returns {UiNode}
 */
export function nativeNode(node, tag, attrs, { box, fontText = null } = {}) {
  return {
    ...node,
    ...(box ?? {}),
    widget: null, // the registry's name must not send the result back to a built-in mapping
    children: [],
    native: { tag, attrs, ...(fontText === null ? {} : { fontText }) },
  };
}

/** Every node under (and including) `node` that passes `test`, in document order. */
export function findAll(node, test) {
  const found = [];
  const visit = (n) => {
    if (test(n)) found.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(node);
  return found;
}

/** The first node below `node` (itself included) with one of the classes. */
export const findByClass = (node, ...names) => findNode(node, (n) => classesOf(n).some((c) => names.includes(c))) ?? null;

/** A finite number from an ARIA or HTML attribute text, or `fallback`. */
export function numberOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Whether an `aria-*` boolean reads "true". */
export const ariaTrue = (node, key) => ariaOf(node, key) === 'true';

/**
 * The color of a node's background with transparency folded in over an opaque
 * backdrop: `rgba(0,0,0,.38)` over white is #9e9e9e. Null when the node has no
 * background.
 * @param {number[] | null | undefined} color  [r, g, b, a] from the extractor.
 * @param {number[] | null} backdrop  [r, g, b] behind it, or null for unknown (white).
 * @returns {number[] | null}
 */
export function solidColor(color, backdrop) {
  if (!color || color[3] === 0) return null;
  if (color[3] >= 255) return [color[0], color[1], color[2]];
  const behind = backdrop ?? [255, 255, 255];
  const a = color[3] / 255;
  return [0, 1, 2].map((i) => Math.round(color[i] * a + behind[i] * (1 - a)));
}

/**
 * The native widget for a component, placed where the page drew it. When that
 * box is the component's own, the node simply becomes the widget. When the
 * drawn control is smaller than its element (Material UI's switch root is
 * 58x38 around a 40x20 toggle, its slider root 30 px tall around a 4 px rail),
 * the element stays as a plain box, so siblings flow around the footprint the
 * page had, and the widget sits inside it.
 *
 * @param {UiNode} node
 * @param {string} name  Readable widget name ("switch").
 * @param {string} partName  Suffix for the inner widget when there is a wrapper ("toggle").
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ fontText?: string | null }} [options]
 * @returns {UiNode}
 */
export function nativeOrWrapped(node, name, partName, tag, attrs, box, options = {}) {
  const near = (a, b) => Math.abs(a - b) <= 1;
  if (near(box.x, node.x) && near(box.y, node.y) && near(box.w, node.w) && near(box.h, node.h)) {
    return nativeNode(withName(node, name), tag, attrs, { box, ...options });
  }
  const inner = nativeNode(
    { ...node, lvName: `${ownName(node) ?? name}_${partName}`, key: `${node.key}~${partName}`, recognized: undefined, classes: [], className: null, id: null },
    tag, attrs, { box, ...options },
  );
  return withName({ ...node, widget: null, text: null, layout: { ...node.layout, display: 'block' }, children: [inner] }, name);
}

/**
 * Integer min, max and value(s) for an LVGL widget, which only takes integers.
 * A page range of 0 to 1 with 0.37 becomes 0 to 100 with 37 (the smallest
 * power of ten, at most 1000, that makes every number whole).
 * @param {number[]} numbers
 * @returns {{ scale: number, values: number[] }}
 */
export function scaleToIntegers(numbers) {
  for (const scale of [1, 10, 100, 1000]) {
    if (numbers.every((n) => Math.abs(n * scale - Math.round(n * scale)) < 1e-9)) return { scale, values: numbers.map((n) => Math.round(n * scale)) };
  }
  return { scale: 1000, values: numbers.map((n) => Math.round(n * 1000)) };
}

/** A node's fill with its own opacity and transparency folded in over the backdrop. */
export function fillOf(node, backdrop) {
  const bg = node?.styles?.bgColor;
  if (!bg) return null;
  const opacity = node.styles.opacity ?? 1;
  return solidColor([bg[0], bg[1], bg[2], Math.round(bg[3] * opacity)], backdrop);
}
