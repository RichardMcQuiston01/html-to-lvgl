/**
 * Snackbar: a short message bar that floats over the page, usually at the
 * bottom, with an optional action (Material UI Snackbar, Bootstrap's toast,
 * an ARIA `role="status"` / `role="alert"` live region that is positioned over
 * the content). It maps to the Phase 8 behavior IR plus the overlay machinery
 * Modal uses; LVGL has no toast widget.
 *
 * Signals and scores:
 *   1.1  `role="status"` or `role="alert"` on a box that FLOATS (position fixed
 *        or absolute) and is smaller than half the screen. This beats the
 *        Alert definition (1), which owns the same role when the box is part
 *        of the page flow.
 *   1    a button-like opener whose `aria-controls` names a snackbar
 *   0.7  `MuiSnackbar-root` (the fixed container; the `role="alert"`
 *        SnackbarContent inside it is built by the Alert definition)
 *   0.5  a floating box with a `snackbar` or `toast` class
 *
 * What build() produces:
 *   - the snackbar becomes an `overlay` node: convert() hoists it to the end of
 *     the screen and emits it `floating`, at the position the browser measured
 *     (so a bottom-anchored bar stays at the bottom);
 *   - when the page gives it a way to change (an action or close button inside
 *     it, or an opener that controls it) it gets one int subject
 *     `<screen>_<key>_open` and a `hidden` bind: every button inside sets the
 *     subject to 0 (UNDO and the close icon dismiss it) and an opener sets it
 *     to 1. The subject starts at 0 when the page had it hidden (the extractor
 *     measured it open) and at 1 otherwise. A snackbar with nothing that can
 *     change it stays a static, always-visible floating bar; a hidden one with
 *     no opener is dropped, as nothing could ever show it.
 *
 * Auto-dismiss is NOT done. Material UI hides a snackbar after
 * `autoHideDuration`, but that value lives in React state, not in the DOM, so
 * the converter cannot know it, and an XML-only timer is not available: LVGL's
 * XML runtime can play a timeline from an event, but a delayed hide would need
 * to set the subject from the timeline, which it cannot, and the
 * `screen_loaded` event fires on the screen object, not on a child. The bar is
 * therefore dismissed by its buttons only; an application that wants a timeout
 * adds an lv_timer that sets the subject to 0.
 */

import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, hasMuiRoot, hasClass, withName } from './shared.mjs';
import { subjectFor, withBehavior, declareSubject, hiddenWhen, setEvent } from '../behavior.mjs';
import { findNode, isButtonLike, withClosers, closeEvents, openEvents } from './overlay.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */
/** @typedef {import('../recognize.mjs').RecognizeContext} RecognizeContext */

/** Beats the Alert definition on a floating live region. */
const SCORE_FLOATING_LIVE_REGION = 1.1;

/** A snackbar is a strip, never a panel: at most this share of the screen height. */
const MAX_HEIGHT_SHARE = 0.5;

/** @param {UiNode} node */
const floats = (node) => node.layout?.position === 'fixed' || node.layout?.position === 'absolute';

/** @param {UiNode} node @param {RecognizeContext} ctx */
const isStrip = (node, ctx) => node.h > 0 && node.h < ctx.tree.h * MAX_HEIGHT_SHARE;

/** Already built by this definition (the registry offers the children again). @param {UiNode} node */
const isBuilt = (node) => node.recognized?.component === 'snackbar';

/**
 * Whether the node is a snackbar root.
 * @param {UiNode} node
 * @param {RecognizeContext} ctx
 * @returns {number} The score, or 0.
 */
function rootScore(node, ctx) {
  if (isBuilt(node) || node.hidden) return 0;
  if (hasMuiRoot(node, 'Snackbar')) return SCORE_MUI;
  if ((node.role === 'status' || node.role === 'alert') && floats(node) && isStrip(node, ctx)) return SCORE_FLOATING_LIVE_REGION;
  if (hasClass(node, 'snackbar', 'toast') && floats(node) && isStrip(node, ctx)) return SCORE_GENERIC_CLASS;
  return 0;
}

/** @param {UiNode} tree @param {string} key @returns {UiNode | null} */
const byKey = (tree, key) => findNode(tree, (n) => n.key === key);

/** The snackbar an opener button controls, or null. @param {UiNode} node @param {RecognizeContext} ctx */
function openedSnackbar(node, ctx) {
  if (isBuilt(node) || !isButtonLike(node) || !node.aria?.controls) return null;
  for (const key of ctx.links?.get(node.key)?.controls ?? []) {
    const target = byKey(ctx.tree, key);
    if (target && rootScore(target, ctx) > 0) return target;
    // A Material UI snackbar names its inner SnackbarContent, not the root.
    const outer = target && ancestorSnackbar(target, ctx);
    if (outer) return outer;
  }
  return null;
}

/** The snackbar root that contains `target`, or null. */
function ancestorSnackbar(target, ctx) {
  /** @param {UiNode} n @param {UiNode[]} path @returns {UiNode | null} */
  const walk = (n, path) => {
    if (n.key === target.key) return [...path].reverse().find((a) => rootScore(a, ctx) > 0) ?? null;
    for (const c of n.children) {
      const found = walk(c, [...path, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(ctx.tree, []);
}

/** True when a button inside the node would dismiss it. @param {UiNode} node */
function hasCloser(node) {
  return node.children.some((c) => (isButtonLike(c) && !c.aria?.controls && !c.aria?.haspopup && !c.link) || hasCloser(c));
}

/** @param {UiNode} node @returns {UiNode} Same subtree with `hidden` cleared. */
function shown(node) {
  return { ...node, hidden: false, children: node.children.map(shown) };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const snackbar = {
  name: 'snackbar',
  match(node, ctx) {
    if (openedSnackbar(node, ctx)) return SCORE_SEMANTIC;
    return rootScore(node, ctx);
  },
  props: {
    message: { type: 'string', default: '' },
    open: { type: 'bool', default: true },
  },
  slots: ['message', 'action'],
  build(node, ctx) {
    const opened = openedSnackbar(node, ctx);
    if (opened) {
      const open = subjectFor(opened, 'open');
      return { ...withBehavior(node, { events: openEvents(open) }), recognized: { component: 'snackbar', props: { role: 'opener' } } };
    }

    const open = subjectFor(node, 'open');
    const closed = Boolean(node.initiallyHidden);
    const openers = [...(ctx.links?.get(node.key)?.controlledBy ?? [])];
    // A Material UI opener names the inner SnackbarContent, which the root contains.
    const innerOpened = findNode(node, (n) => n !== node && (ctx.links?.get(n.key)?.controlledBy ?? []).length > 0);
    const canChange = hasCloser(node) || openers.length > 0 || Boolean(innerOpened);

    let bar = shown(node);
    bar = { ...bar, hidden: false, initiallyHidden: false, widget: null, overlay: true, layout: { ...bar.layout, position: 'fixed' } };
    bar = withName(bar, 'snackbar');
    const message = textOf(bar);
    const props = { message, open: !closed };
    // Marked so the registry does not offer this node to the definition again.
    bar = { ...bar, recognized: { component: 'snackbar', props } };

    if (!canChange) {
      // Nothing can ever change it: a hidden one would never show, so it goes.
      return closed ? { ...bar, hidden: true, initiallyHidden: true } : bar;
    }
    bar = withClosers(bar, closeEvents(open));
    bar = withBehavior(bar, { subjects: [declareSubject(open, closed ? 0 : 1)], binds: [hiddenWhen(open, 'eq', 0)] });
    return bar;
  },
};

/** All own text under a node, joined. @param {UiNode} node @returns {string} */
function textOf(node) {
  return [node.text, ...node.children.map(textOf)].filter((t) => t && t.trim()).map((t) => t.trim()).join(' ');
}

export default snackbar;
