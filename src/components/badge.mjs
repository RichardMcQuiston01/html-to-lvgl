/**
 * Badge: a small count or dot pinned to a corner of another element, or (the
 * Bootstrap way) an inline pill label.
 *
 * Detection:
 *  - `MuiBadge-root` (0.7): the wrapper holding the anchor and the pinned
 *    `MuiBadge-badge`;
 *  - a `badge` class (0.5), the Bootstrap form, which is just a pill label.
 *    Only on a small box, so a layout that happens to use the class name for
 *    something big is left alone;
 *  - `data-lv-widget="badge"` (registry).
 *
 * Findings behind build():
 *  - The pinned element is `position: absolute`, which the converter treats
 *    as out of flow: it is placed by coordinates and the anchor keeps its own
 *    size (checked on the example page). The wrapper's size is the anchor's.
 *  - LVGL clips a child to its parent unless the parent has the
 *    `overflow_visible` flag, and a badge always sticks out of its anchor. The
 *    converter cannot carry that flag yet, so build() sets
 *    `styles.overflowVisible = true` on a wrapper whose pinned child leaves
 *    its box, for the converter to read (see the lane report). Until then the
 *    pinned part is cut off at the anchor's edge.
 *  - The count is a label inside a flex-centered pill. The converter reads
 *    `text-align`, not that centering, so the text is centered here.
 */
import { SCORE_MUI, SCORE_GENERIC_CLASS, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const INLINE_BADGE_MAX_HEIGHT = 48;
const DOT_MAX = 12;

/** @param {UiNode} node */
const isOutOfFlow = (node) => node.layout?.position === 'absolute' || node.layout?.position === 'fixed';

/** @param {UiNode} node @returns {string} */
const firstText = (node) => node.text || node.children.map(firstText).find(Boolean) || '';

/**
 * True when the box lies at least partly outside the other.
 * @param {UiNode} inner
 * @param {UiNode} outer
 */
const sticksOut = (inner, outer) =>
  inner.x < outer.x || inner.y < outer.y || inner.x + inner.w > outer.x + outer.w || inner.y + inner.h > outer.y + outer.h;

/**
 * Center the text of a node that is only a label, since the browser did it
 * with flex or text-align and the converter reads only text-align.
 * @param {UiNode} node
 * @returns {UiNode}
 */
function centered(node) {
  if (!node.text || node.children.length > 0) return node;
  return { ...node, styles: { ...node.styles, textAlign: 'center' } };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const badge = {
  name: 'badge',
  match(node) {
    if (node.hidden) return false;
    if (hasMuiRoot(node, 'Badge')) return SCORE_MUI;
    if (hasClass(node, 'badge') && node.h > 0 && node.h <= INLINE_BADGE_MAX_HEIGHT) return SCORE_GENERIC_CLASS;
    return false;
  },
  props: {
    content: { type: 'string', default: '' },
    variant: { type: 'string', default: 'standard' },
  },
  slots: ['anchor'],
  build(node) {
    let next = { ...node, widget: node.widget === 'badge' ? null : node.widget };

    const pinnedIndex = next.children.findIndex((c) => hasClass(c, 'MuiBadge-badge') || (isOutOfFlow(c) && !c.hidden));
    if (pinnedIndex < 0) {
      // The inline form: the node is the pill.
      const text = firstText(next);
      next = withName(centered(next), 'badge');
      next.recognized = { component: 'badge', props: { content: text, variant: 'standard' } };
      return next;
    }

    const pinned = next.children[pinnedIndex];
    const content = firstText(pinned);
    const variant = hasClass(pinned, 'MuiBadge-dot') || (!content && pinned.w <= DOT_MAX && pinned.h <= DOT_MAX) ? 'dot' : 'standard';
    let renamed = centered(pinned);
    if (!renamed.lvName) renamed = { ...renamed, lvName: variant === 'dot' ? 'badge_dot' : 'badge_count' };

    const children = [...next.children];
    children[pinnedIndex] = renamed;
    next = { ...next, children };
    if (sticksOut(pinned, next)) next = { ...next, styles: { ...next.styles, overflowVisible: true } };

    next = withName(next, 'badge');
    next.recognized = { component: 'badge', props: { content, variant } };
    return next;
  },
};

export default badge;
