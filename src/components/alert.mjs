/**
 * Alert: a status message with an optional icon and action.
 *
 * Detection, highest first:
 *  - `role="alert"` (1): the ARIA signal, and what Material UI always sets;
 *  - `role="status"` (0.8), but only when the element looks like a box (has a
 *    background or a border). A bare status region, a screen-reader-only
 *    live region, is plain text and is left alone;
 *  - `MuiAlert-root` (0.7);
 *  - Bootstrap's `alert` class (0.5);
 *  - `data-lv-widget="alert"` (registry).
 *
 * A Material UI Alert is also a Paper (`MuiPaper-root`). Real MUI markup always
 * carries role="alert", so it scores 1 and beats the Paper definition; an
 * Alert written without the role would tie with Paper at 0.7.
 *
 * What the converter gets wrong for an alert row, and what build() fixes:
 *  - a text-only message with vertical padding is read as multi-line (its
 *    height includes the padding) and gets a fixed width, which wraps a
 *    one-line message when LVGL measures it a pixel wider: the height used for
 *    that decision is reduced to the text's own;
 *  - the message's vertical padding is not applied, so a one-line message
 *    sticks to the top of the row: the row is centered instead, only when no
 *    message is multi-line (an icon beside a multi-line message stays on top);
 *  - a <button> action with a transparent background shows LVGL's blue;
 *  - the node's own text is placed before its child elements by the converter;
 *    it becomes a real label child at the right place.
 */
import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, classesOf, hasClass, hasMuiRoot, withName } from './shared.mjs';
import { blendTranslucentColors, solidBackdropOf, withTextAsChild, withTransparentButtons } from './chip.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const SCORE_ROLE_STATUS_BOX = 0.8;

/** @param {UiNode} node */
const looksLikeBox = (node) => Boolean(node.styles?.bgColor) || (node.styles?.borderWidth > 0 && Boolean(node.styles?.borderColor));

const SEVERITIES = [
  ['error', /error|danger/i],
  ['warning', /warn/i],
  ['success', /success/i],
  ['info', /info/i],
];

/**
 * The severity named by a class: MuiAlert-standardError, MuiAlert-colorWarning,
 * alert-danger, or any class with the word in it. Defaults to "info".
 * @param {UiNode} node
 * @returns {'error' | 'warning' | 'info' | 'success'}
 */
function severityOf(node) {
  const classes = classesOf(node);
  // MUI's own classes first: a custom class must not outvote them.
  const ordered = [...classes.filter((c) => c.startsWith('MuiAlert-')), ...classes.filter((c) => !c.startsWith('MuiAlert-'))];
  for (const c of ordered) {
    for (const [severity, pattern] of SEVERITIES) {
      if (pattern.test(c)) return /** @type {'error' | 'warning' | 'info' | 'success'} */ (severity);
    }
  }
  return 'info';
}

/** @param {UiNode} node @returns {'standard' | 'filled' | 'outlined'} */
function variantOf(node) {
  const classes = classesOf(node);
  if (classes.some((c) => /^MuiAlert-filled/.test(c))) return 'filled';
  if (classes.some((c) => /^MuiAlert-outlined/.test(c))) return 'outlined';
  return 'standard';
}

/** A text-only child whose own text fits on one line. @param {UiNode} node */
function isSingleLineText(node) {
  if (!node.text || node.children.length > 0) return false;
  const content = node.h - node.styles.padTop - node.styles.padBottom;
  return content < (node.styles.fontSize || 14) * 2;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const alert = {
  name: 'alert',
  match(node) {
    if (node.hidden) return false;
    if (node.role === 'alert') return SCORE_SEMANTIC;
    if (node.role === 'status' && looksLikeBox(node)) return SCORE_ROLE_STATUS_BOX;
    if (hasMuiRoot(node, 'Alert')) return SCORE_MUI;
    if (hasClass(node, 'alert')) return SCORE_GENERIC_CLASS;
    return false;
  },
  props: {
    severity: { type: 'string', default: 'info' },
    variant: { type: 'string', default: 'standard' },
  },
  slots: ['icon', 'message', 'action'],
  build(node, ctx) {
    let next = { ...node, widget: node.widget === 'alert' ? null : node.widget };

    next = withTransparentButtons(next);
    next = blendTranslucentColors(next, solidBackdropOf(ctx, node));
    next = withTextAsChild(next, 'alert_message');

    const isRow = next.layout?.display === 'flex' && !String(next.layout.flexDirection).startsWith('column');
    const hasMultiLine = next.children.some((c) => c.text && c.children.length === 0 && !isSingleLineText(c));

    next = {
      ...next,
      children: next.children.map((c) => {
        let child = c;
        // A one-line message must not look multi-line to the converter
        // because of its padding.
        if (isSingleLineText(c)) {
          const content = c.h - c.styles.padTop - c.styles.padBottom;
          child = { ...child, h: content, styles: { ...child.styles, padTop: 0, padBottom: 0 } };
        }
        if (!child.lvName) {
          if (hasClass(c, 'MuiAlert-icon')) child = { ...child, lvName: 'alert_icon' };
          else if (hasClass(c, 'MuiAlert-message')) child = { ...child, lvName: 'alert_message' };
          else if (hasClass(c, 'MuiAlert-action')) child = { ...child, lvName: 'alert_action' };
        }
        return child;
      }),
    };

    // Vertical centering stands in for the message's padding (see the header).
    if (isRow && !hasMultiLine && next.children.some((c) => c.text && c.children.length === 0)) {
      next = { ...next, layout: { ...next.layout, alignItems: 'center' } };
    }

    const severity = severityOf(next);
    const variant = variantOf(next);
    next = withName(next, 'alert');
    next.recognized = { component: 'alert', props: { severity, variant } };
    return next;
  },
};

export default alert;
