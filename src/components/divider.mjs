/**
 * Divider: A thin separator line (`<hr>`, role=separator, Material UI Divider).
 *
 * Browsers draw these lines in many ways: an `<hr>` is a 2px inset border, a
 * Material UI Divider is a zero-height box with a translucent bottom border
 * (a vertical one a right border, which the extractor does not read), and a
 * hand-written rule is often a 1px colored box. The converter turns the first
 * two into a box with a black or double border. So every divider is rebuilt
 * the same way: a solid-color box, one pixel thick (or as thick as the source
 * line was), the full length of the original, named `divider`.
 *
 * A Divider with text (`MuiDivider-withChildren`, or a separator holding
 * children) becomes a flex row: a line that grows, the original children, and
 * another line. The two lines are CSS pseudo-elements in Material UI, which
 * the extractor cannot see, so they are drawn here in the divider's own color.
 * The children are kept as they are.
 *
 * Signals: `<hr>` (1), role="separator" (1), `MuiDivider-root` (0.7).
 * A separator that carries `aria-valuenow` is a draggable splitter, not a
 * divider, and is left alone.
 */

import { SCORE_SEMANTIC, SCORE_MUI, hasMuiRoot, hasClass, ariaOf, withName } from './shared.mjs';
import { blend, surfaceBehind, keepTextPadding } from './card.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** Material UI's divider color (rgba(0,0,0,0.12) on white), when nothing else is known. */
const DEFAULT_LINE_COLOR = [224, 224, 224, 255];
/** A box thicker than this on both sides is a block with a role, not a line. */
const MAX_LINE_BOX = 8;

/** @param {UiNode} node */
function isVertical(node) {
  const orientation = ariaOf(node, 'orientation');
  if (orientation === 'vertical') return true;
  if (orientation === 'horizontal') return false;
  return node.h > node.w;
}

/** @param {UiNode} node */
const hasContent = (node) => node.children.length > 0 || Boolean(node.text);

/**
 * The color and thickness of the line the browser drew.
 * @param {UiNode} node
 * @param {UiNode | null | undefined} parent
 * @param {boolean} vertical
 * @returns {{ color: number[], thickness: number }}
 */
function lineLook(node, parent, vertical) {
  const s = node.styles ?? {};
  const surface = surfaceBehind({ styles: {} }, parent);
  const thin = vertical ? node.w : node.h;
  /** @type {number[] | null | undefined} */
  let color = null;
  let thickness = 1;
  if (s.bgColor && s.bgColor[3] > 0) {
    color = s.bgColor;
    thickness = Math.max(1, thin);
  } else if (s.borderWidth > 0 && s.borderColor) {
    color = s.borderColor;
    thickness = Math.max(1, s.borderWidth);
  } else if (s.borderBottomWidth > 0 && s.borderBottomColor) {
    color = s.borderBottomColor;
    thickness = Math.max(1, s.borderBottomWidth);
  } else if (s.borderColor && s.borderColor[3] < 255) {
    // Material UI: color is set on all sides, the width on one the extractor
    // does not read (the right side of a vertical divider).
    color = s.borderColor;
  }
  if (!color || color[3] === 0) return { color: DEFAULT_LINE_COLOR, thickness };
  return { color: color[3] < 255 ? blend(color, surface) : color, thickness };
}

/**
 * A box with no border, shadow or padding, filled with the line color.
 * @param {UiNode} node
 * @param {Partial<UiNode>} over
 * @param {number[]} color
 * @param {number} [opacity]  Defaults to the node's own, so a faded or hidden
 *   separator stays that way; a line synthesized inside a content divider
 *   passes 1, since the container's opacity already applies to it.
 * @returns {UiNode}
 */
function lineBox(node, over, color, opacity = node.styles?.opacity ?? 1) {
  return {
    ...node,
    tag: 'div',
    text: null,
    children: [],
    ...over,
    styles: {
      ...node.styles,
      bgColor: color,
      borderColor: null, borderWidth: 0, borderBottomColor: null, borderBottomWidth: 0,
      radius: 0, shadow: null, gradient: null, opacity,
      padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    },
  };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const divider = {
  name: 'divider',
  match(node) {
    // A separator with a value is a splitter handle, which does something.
    if (ariaOf(node, 'valuenow') !== undefined) return false;
    if (node.tag === 'hr' || node.role === 'separator') return SCORE_SEMANTIC;
    if (hasMuiRoot(node, 'Divider')) return SCORE_MUI;
    return false;
  },
  props: { orientation: { type: 'string', default: 'horizontal' } },
  slots: [],
  build(node, ctx) {
    const vertical = isVertical(node);
    const recognized = { component: 'divider', props: { orientation: vertical ? 'vertical' : 'horizontal' } };
    const { color, thickness } = lineLook(node, ctx?.parent, vertical);

    if (hasContent(node) && !vertical) {
      // A line, the content, a line. The container's own border is not drawn.
      const surface = surfaceBehind(node, ctx?.parent);
      // Direct text and child elements both survive: the extractor stores them
      // apart ("Continue with <strong>email</strong>"), so keep the text, then
      // the children.
      const content = [
        ...(node.text ? [{
          ...node, tag: 'span', text: node.text, children: [], key: `${node.key}/text`,
          id: null, className: null, classes: [], lvName: null, widget: null, component: null, link: null,
          role: null, aria: {}, testId: null,
          styles: { ...node.styles, bgColor: null, borderWidth: 0, borderBottomWidth: 0 },
          layout: { ...node.layout, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 },
        }] : []),
        ...node.children.map((c) => keepTextPadding(c, surface)),
      ];
      const side = (suffix) => lineBox(node, {
        key: `${node.key}/line${suffix}`,
        id: null, className: null, classes: [], lvName: 'divider_line', widget: null, component: null, link: null,
        role: null, aria: {}, testId: null, hidden: false,
        w: 1, h: thickness,
        layout: { ...node.layout, flexGrow: 1, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 },
      }, color, 1);
      return {
        ...withName(node, 'divider'),
        tag: 'div',
        text: null,
        styles: {
          ...node.styles, bgColor: null, borderColor: null, borderWidth: 0, borderBottomColor: null, borderBottomWidth: 0,
          padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, shadow: null,
        },
        layout: { ...node.layout, display: 'flex', flexDirection: 'row', alignItems: 'center' },
        children: [side('_start'), ...content, side('_end')],
        recognized,
      };
    }

    // Not a line (a block that merely has a separator role): keep it as is.
    if (Math.min(node.w, node.h) > MAX_LINE_BOX) return { ...withName(node, 'divider'), recognized };

    const line = vertical ? { w: thickness } : { h: thickness };
    // A vertical line sits where the box's left edge was; a horizontal one at its top.
    return { ...withName(lineBox(node, line, color), 'divider'), text: node.text, children: node.children, recognized };
  },
};

export default divider;
