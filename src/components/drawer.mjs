/**
 * Drawer: a panel that slides in from a screen edge over a dimmed page
 * (Material UI Drawer, a navigation side sheet; ARIA `role="dialog"`). Told
 * apart from a Modal by GEOMETRY (overlay.mjs dockedEdge): it touches a screen
 * edge, spans nearly the whole screen along it and is narrower across it.
 *
 * Signals:
 *   1    role="dialog"/"alertdialog" whose box is docked to a screen edge
 *   1    a button whose aria-controls names such a dialog     -> the OPENER
 *   0.7  MuiDrawer-root (not the permanent `MuiDrawer-docked`) holding a
 *        docked panel: a role=dialog node or a MuiDrawer-paper
 *   0.5  any other full-screen fixed/absolute scrim holding a docked dialog
 *
 * What build() produces (verified in real LVGL 9.4, spike/subjects/xml/q4_drawer.xml):
 *
 *   scrim   a full-screen floating layer (overlayBefore the panel), dim color,
 *           `hidden` bound to the subject, tap closes: set 0 + play slide-out.
 *           The hide-binding is ONLY here. The panel must not carry one, or
 *           the slide-out would vanish instantly.
 *   panel   the drawer box, floating, at its open position, PARKED off-screen
 *           with style_translate_x/_y (left: -width, right: +width, top:
 *           -height, bottom: +height, plus the shadow reach) while closed.
 *   timelines  `<screen>_<key>_slide_in` / `_slide_out`, each one `translate_x`
 *           (left/right) or `translate_y` (top/bottom) animation of 250 ms on
 *           the panel, in `<animations>` (src/behavior.mjs, "Animations").
 *   closers every button in the panel: set subject 0 + play slide-out.
 *   opener  set subject 1 + play slide-in.
 *
 * The scrim exists for a modal drawer (a Material UI wrapper, or
 * aria-modal="true"). A drawer without one is simply slid, with no dim layer
 * and no tap-outside close.
 *
 * Initial state: closed (subject 0, panel parked) when the extractor says the
 * drawer was hidden or the panel is entirely off-screen; open otherwise.
 */
import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, withName, hasClass, classesOf } from './shared.mjs';
import { subjectFor, withBehavior, declareSubject, hiddenWhen, slideTimeline } from '../behavior.mjs';
import { ownName } from '../names.mjs';
import {
  isDialogRole, isOverlayPart, isScrimWrapper, findNode, ancestorsOf, dockedEdge, ariaModal, backdropColor, isMuiRoot,
  dialogTitle, isButtonLike, withClosers, closeEvents, openEvents, screenLayer, DEFAULT_SCRIM,
} from './overlay.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const SLIDE_MS = 250;

const ANCHOR_CLASS = /^MuiDrawer-(?:paperAnchor|anchor)(Left|Right|Top|Bottom)$/;

/** @param {import('../recognize.mjs').RecognizeContext} ctx */
const screenOf = (ctx) => ({ w: ctx.tree.w, h: ctx.tree.h });

/**
 * The edge a panel node is docked to, from its box or, failing that, from a
 * Material UI anchor class.
 * @param {UiNode} panel
 * @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {{ edge: 'left' | 'right' | 'top' | 'bottom', parked: boolean } | null}
 */
function edgeOf(panel, ctx) {
  const docked = dockedEdge(panel, screenOf(ctx));
  if (docked) return docked;
  const m = classesOf(panel).map((c) => ANCHOR_CLASS.exec(c)).find(Boolean);
  return m ? { edge: /** @type {any} */ (m[1].toLowerCase()), parked: false } : null;
}

/** The screen edge a forced (data-lv-widget) panel is closest to. */
function nearestEdge(box, screen) {
  const gaps = [['left', box.x], ['right', screen.w - (box.x + box.w)], ['top', box.y], ['bottom', screen.h - (box.y + box.h)]];
  return /** @type {'left' | 'right' | 'top' | 'bottom'} */ (gaps.sort((a, b) => a[1] - b[1])[0][0]);
}

/** A drawer-shaped dialog: role dialog, docked to an edge. */
const isDrawerDialog = (node, ctx) => isDialogRole(node) && Boolean(dockedEdge(node, screenOf(ctx)));

/** The panel inside a Material UI drawer wrapper: a dialog, else the paper. */
function panelInWrapper(wrapper, ctx) {
  return findNode(wrapper, (n) => n !== wrapper && isDrawerDialog(n, ctx))
    ?? findNode(wrapper, (n) => n !== wrapper && hasClass(n, 'MuiDrawer-paper'));
}

/** MuiDrawer-root that slides (temporary/persistent), not the permanent docked one. */
function isMuiDrawerWrapper(node, ctx) {
  if (!isMuiRoot(node, 'Drawer') || hasClass(node, 'MuiDrawer-docked')) return false;
  const panel = panelInWrapper(node, ctx);
  return Boolean(panel && edgeOf(panel, ctx));
}

/** The portal wrapper of a drawer panel: Material UI's, or any full-screen fixed scrim. */
const isDrawerWrapper = (node, ctx) => isMuiDrawerWrapper(node, ctx) || isScrimWrapper(node, screenOf(ctx), (n) => isDrawerDialog(n, ctx));

/**
 * The node that stands for the whole drawer (its key names the subject) for an
 * element id: the wrapper when there is one, else the dialog.
 * @param {UiNode | undefined} target
 * @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {UiNode | null}
 */
function drawerRootFor(target, ctx) {
  if (!target) return null;
  if (isDrawerWrapper(target, ctx)) return target;
  const isPaper = hasClass(target, 'MuiDrawer-paper');
  if (!isDrawerDialog(target, ctx) && !isPaper) return null;
  // Outermost first, as in modal.mjs.
  const wrapper = (ancestorsOf(ctx.tree, target) ?? []).find((a) => isDrawerWrapper(a, ctx));
  if (wrapper) return wrapper;
  return isDrawerDialog(target, ctx) ? target : null;
}

function openedDrawer(node, ctx) {
  if (!isButtonLike(node) || !node.aria?.controls) return null;
  return drawerRootFor(ctx.byId.get(node.aria.controls.split(/\s+/)[0]), ctx);
}

/** How far past its own size a closed panel is parked, so its shadow does not peek in. */
function shadowReach(panel) {
  const sh = panel.styles?.shadow;
  return sh ? Math.ceil((sh.blur ?? 0) + (sh.spread ?? 0) + Math.max(Math.abs(sh.x ?? 0), Math.abs(sh.y ?? 0))) : 0;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const drawer = {
  name: 'drawer',
  match(node, ctx) {
    if (isOverlayPart(node)) return false;
    if (openedDrawer(node, ctx)) return SCORE_SEMANTIC;
    if (isMuiDrawerWrapper(node, ctx)) return SCORE_MUI;
    if (isDrawerWrapper(node, ctx)) return SCORE_GENERIC_CLASS;
    if (isDrawerDialog(node, ctx)) return SCORE_SEMANTIC;
    return false;
  },
  props: {
    anchor: { type: 'string', default: 'left' },
    open: { type: 'bool', default: false },
    title: { type: 'string', default: '' },
  },
  slots: ['header', 'body'],
  build(node, ctx) {
    const opened = openedDrawer(node, ctx);
    if (opened) {
      const open = subjectFor(opened, 'open');
      return {
        ...withBehavior(node, { events: openEvents(open, subjectFor(opened, 'slide_in')) }),
        recognized: { component: 'drawer', props: { role: 'opener' } },
      };
    }

    // A wrapper holds the panel; anything else (a docked role=dialog node, or a
    // div forced with data-lv-widget="drawer") is the panel itself.
    const inner = isDrawerDialog(node, ctx) ? null : panelInWrapper(node, ctx);
    const isWrapper = Boolean(inner);
    const panelNode = inner ?? node;
    const screen = screenOf(ctx);
    const { edge, parked } = edgeOf(panelNode, ctx) ?? { edge: nearestEdge(panelNode, screen), parked: false };
    const horizontal = edge === 'left' || edge === 'right';
    const prop = horizontal ? 'translate_x' : 'translate_y';

    // Open position: pinned to its edge even when the browser measured it
    // parked outside the screen.
    const open = { x: panelNode.x, y: panelNode.y };
    if (edge === 'left') open.x = 0;
    if (edge === 'right') open.x = screen.w - panelNode.w;
    if (edge === 'top') open.y = 0;
    if (edge === 'bottom') open.y = screen.h - panelNode.h;

    // Where the closed panel is parked, relative to its open position.
    const distance = (horizontal ? panelNode.w : panelNode.h) + shadowReach(panelNode);
    const park = edge === 'left' || edge === 'top' ? -distance : distance;

    const subject = subjectFor(node, 'open');
    const slideIn = subjectFor(node, 'slide_in');
    const slideOut = subjectFor(node, 'slide_out');
    const initiallyOpen = !(node.initiallyHidden || parked);
    const blocking = isWrapper || ariaModal(panelNode) === true || panelNode.role === 'alertdialog';
    const baseName = ownName(node);

    let panel = withClosers(panelNode, closeEvents(subject, slideOut));
    panel = ownName(panelNode) ? panel : withName(panel, 'drawer');
    panel = {
      ...panel,
      // Not hidden-by-the-extractor any more (the scrim carries the state), and no
      // longer forced, so a data-lv-widget="drawer" panel is not claimed twice.
      widget: null, initiallyHidden: false,
      x: open.x, y: open.y,
      layout: { ...panel.layout, position: 'fixed' },
      overlay: true,
      ...(initiallyOpen ? {} : { styleTranslate: horizontal ? { x: park } : { y: park } }),
      recognized: { component: 'drawer', props: { anchor: edge, open: initiallyOpen, title: dialogTitle(panelNode, ctx) } },
    };
    panel = withBehavior(panel, {
      subjects: [declareSubject(subject, initiallyOpen ? 1 : 0)],
      timelines: [slideTimeline(slideIn, prop, park, 0, SLIDE_MS), slideTimeline(slideOut, prop, 0, park, SLIDE_MS)],
    });

    if (blocking) {
      const scrim = screenLayer(ctx.tree, {
        key: `${node.key}~scrim`,
        lvName: /(scrim|overlay|backdrop)$/.test(baseName ?? '') ? baseName : `${baseName ?? 'drawer'}_scrim`,
        color: backdropColor(node) ?? DEFAULT_SCRIM,
      });
      panel.overlayBefore = [withBehavior(scrim, {
        subjects: [declareSubject(subject, initiallyOpen ? 1 : 0)],
        binds: [hiddenWhen(subject, 'eq', 0)],
        events: closeEvents(subject, slideOut),
      })];
    }
    return panel;
  },
};

export default drawer;
