/**
 * Modal: a dialog that blocks the page until it is dismissed (ARIA
 * `role="dialog"` / `role="alertdialog"`, Material UI Dialog and Modal,
 * Bootstrap's `.modal`). COMPONENTS.md, "Modal" and "The Disclosure Primitive".
 *
 * Signals, strongest first (a DRAWER-shaped dialog is left to drawer.mjs, see
 * overlay.mjs dockedEdge):
 *   1    role="dialog" or role="alertdialog"  -> the dialog itself
 *   1    a button whose aria-controls names such a dialog (aria-haspopup=
 *        "dialog" says the same)                -> the OPENER
 *   0.7  MuiDialog-root / MuiModal-root that contains a role=dialog node
 *        (the portal wrapper, with its backdrop and container)
 *   0.5  any other full-screen fixed/absolute box that contains one (a
 *        hand-written scrim); its translucent fill is the dim color
 *
 * What build() produces, as a UiNode tree (all of it pure XML in LVGL 9.4;
 * the pattern was verified in real LVGL, spike/subjects/xml/q3_modal.xml):
 *
 *   overlay   a full-screen layer, the LAST child of the screen (convert()
 *             hoists it), `floating`, at x=0 y=0, filled with the dim backdrop
 *             color (default black 50%; a Material UI backdrop's own alpha).
 *             It binds `hidden` to the dialog's subject and, for a plain modal
 *             dialog, closes it when the backdrop is tapped. A plain lv_obj is
 *             clickable, so it also blocks every click beneath it while open.
 *   dialog    the dialog box inside, at the position the browser measured
 *             (centered, because the browser centered it).
 *   closers   every button inside the dialog sets the subject to 0.
 *   opener    sets the subject to 1.
 *
 * A dialog without `aria-modal="true"` (and with no Material UI wrapper) is a
 * non-modal dialog: no backdrop, so the dialog box itself is the floating,
 * hide-bound layer.
 *
 * State: one int subject per dialog, `<screen>_<key>_open`. It starts at 0 when
 * the extractor says the dialog was hidden (`initiallyHidden`), else 1. The
 * extractor measures a hidden dialog open, so its size is real.
 *
 * Limits: the overlay covers the screen it is on (no lv_layer_top()); a wrapper
 * keeps only the dialog (its backdrop and layout container are replaced by the
 * overlay's fill and the measured position); a dialog in a scrim that is not
 * full-screen stays an ordinary box.
 */
import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, withName, hasClass } from './shared.mjs';
import { subjectFor, withBehavior, declareSubject, hiddenWhen, setEvent } from '../behavior.mjs';
import { ownName } from '../names.mjs';
import {
  isDialogRole, isOverlayPart, isScrimWrapper, findNode, ancestorsOf, dockedEdge, ariaModal, backdropColor, isMuiRoot,
  dialogTitle, isButtonLike, withClosers, closeEvents, openEvents, screenLayer, DEFAULT_SCRIM,
} from './overlay.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** @param {import('../recognize.mjs').RecognizeContext} ctx */
const screenOf = (ctx) => ({ w: ctx.tree.w, h: ctx.tree.h });

/** A dialog that is a centered or full-screen box, not a panel docked to an edge. */
function isModalDialog(node, ctx) {
  return isDialogRole(node) && !dockedEdge(node, screenOf(ctx));
}

/** MuiDialog-root / MuiModal-root (not a Drawer) with a modal dialog inside. */
function isMuiModalWrapper(node, ctx) {
  if (!(isMuiRoot(node, 'Dialog') || isMuiRoot(node, 'Modal')) || isMuiRoot(node, 'Drawer') || hasClass(node, 'MuiDrawer-modal')) return false;
  return Boolean(findNode(node, (n) => n !== node && isModalDialog(n, ctx)));
}

/** The portal wrapper of a modal dialog: Material UI's, or any full-screen fixed scrim. */
const isModalWrapper = (node, ctx) => isMuiModalWrapper(node, ctx) || isScrimWrapper(node, screenOf(ctx), (n) => isModalDialog(n, ctx));

/**
 * The node that stands for the whole modal (the one whose key names its
 * subject) for an element id: the wrapper when the dialog sits in one, else
 * the dialog. Null when the id names something that is not a modal.
 * @param {UiNode | undefined} target
 * @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {UiNode | null}
 */
function modalRootFor(target, ctx) {
  if (!target) return null;
  if (isModalWrapper(target, ctx)) return target;
  if (!isModalDialog(target, ctx)) return null;
  // Outermost first: a Material UI wrapper holds a full-screen container that
  // also looks like a scrim, and the whole thing is one modal.
  // Outermost first: a Material UI wrapper holds a full-screen container that
  // also looks like a scrim, and the whole thing is one modal.
  const wrapper = (ancestorsOf(ctx.tree, target) ?? []).find((a) => isModalWrapper(a, ctx));
  return wrapper ?? target;
}

/** The modal an opener button points at, or null. */
function openedModal(node, ctx) {
  if (!isButtonLike(node) || !node.aria?.controls) return null;
  const id = node.aria.controls.split(/\s+/)[0];
  return modalRootFor(ctx.byId.get(id), ctx);
}

/** @type {import('../recognize.mjs').ComponentDef} */
const modal = {
  name: 'modal',
  match(node, ctx) {
    if (isOverlayPart(node)) return false;
    if (openedModal(node, ctx)) return SCORE_SEMANTIC;
    if (isMuiModalWrapper(node, ctx)) return SCORE_MUI;
    if (isModalWrapper(node, ctx)) return SCORE_GENERIC_CLASS;
    if (isModalDialog(node, ctx)) return SCORE_SEMANTIC;
    return false;
  },
  props: {
    title: { type: 'string', default: '' },
    modal: { type: 'bool', default: true },
    open: { type: 'bool', default: false },
  },
  slots: ['title', 'content', 'actions'],
  build(node, ctx) {
    const opened = openedModal(node, ctx);
    if (opened) {
      const open = subjectFor(opened, 'open');
      return { ...withBehavior(node, { events: openEvents(open) }), recognized: { component: 'modal', props: { role: 'opener' } } };
    }

    // A wrapper holds a dialog; anything else (a role=dialog node, or a div
    // forced with data-lv-widget="modal") is the dialog itself.
    const inner = isDialogRole(node) ? null : findNode(node, (n) => n !== node && isModalDialog(n, ctx));
    const isWrapper = Boolean(inner);
    const dialogNode = inner ?? node;
    const open = subjectFor(node, 'open');
    const initialOpen = node.initiallyHidden ? 0 : 1;
    const blocking = isWrapper || dialogNode.role === 'alertdialog' || ariaModal(dialogNode) === true;
    const title = dialogTitle(dialogNode, ctx);

    // The dialog box: all its buttons close it. Marked so the registry does
    // not offer it to this definition again when it recurses into children.
    const baseName = ownName(node);
    let dialog = withClosers(dialogNode, closeEvents(open));
    dialog = ownName(dialogNode) ? dialog : withName(dialog, 'dialog');
    // widget is cleared so a forced data-lv-widget="modal" does not claim the
    // child again; initiallyHidden is cleared so the overlay (which carries the
    // state) is what hides, and the recognizer does not drop the dialog as a
    // collapsed leftover.
    dialog = { ...dialog, widget: null, initiallyHidden: false, recognized: { component: 'modal', props: { part: 'dialog' } } };

    const state = { subjects: [declareSubject(open, initialOpen)], binds: [hiddenWhen(open, 'eq', 0)] };
    const props = { title, modal: blocking, open: Boolean(initialOpen) };

    if (!blocking) {
      // Non-modal: no backdrop; the dialog box is the floating layer.
      const floating = { ...dialog, layout: { ...dialog.layout, position: 'fixed' }, overlay: true };
      return { ...withBehavior(floating, state), recognized: { component: 'modal', props } };
    }

    const dismissible = dialogNode.role !== 'alertdialog';
    const layer = screenLayer(ctx.tree, {
      key: `${node.key}~overlay`,
      lvName: node.lvName ?? (/(scrim|overlay|backdrop)$/.test(baseName ?? '') ? baseName : `${baseName ?? 'modal'}_overlay`),
      color: backdropColor(node) ?? DEFAULT_SCRIM,
      children: [dialog],
    });
    // Tapping the dim area closes a dismissible dialog. The dialog box is a
    // clickable lv_obj, so taps on it never reach this handler.
    const overlay = withBehavior(layer, { ...state, events: dismissible ? [setEvent(open, 0)] : [] });
    return { ...overlay, recognized: { component: 'modal', props } };
  },
};

export default modal;
