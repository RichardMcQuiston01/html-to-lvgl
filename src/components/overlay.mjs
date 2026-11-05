/**
 * Helpers Modal (modal.mjs) and Drawer (drawer.mjs) share. Not a component:
 * it is not registered in index.mjs. Pure functions of a UiNode.
 *
 * Both components turn a dialog into an OVERLAY: a node flagged
 * `overlay: true` that convert() moves to the end of the screen root
 * (hoistOverlays in src/convert.mjs) and emits as a `floating` object. Extra
 * UiNode fields used here and read by convert():
 *
 *   overlay         true: hoist to the end of the screen, emit `floating`.
 *   overlayBefore   UiNode[]: nodes emitted right before this one (a
 *                   drawer's scrim), so the panel draws above them.
 *   styleTranslate  { x?, y? }: emitted as style_translate_x / _y (the
 *                   parked position of a drawer panel).
 */
import { withBehavior, setEvent, playEvent } from '../behavior.mjs';
import { classesOf, muiRoots } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/** Pixels of slack when comparing a rectangle with a screen edge. */
const EDGE_TOLERANCE = 2;

/** A drawer covers at least this share of the screen along its edge. */
const SPAN = 0.9;

/** Default dim color of the layer behind a dialog: black at 50 percent. */
export const DEFAULT_SCRIM = Object.freeze([0, 0, 0, 128]);

/** @param {UiNode} node */
export const isDialogRole = (node) => node.role === 'dialog' || node.role === 'alertdialog';

/** True for components that already claimed this node as part of a dialog. @param {UiNode} node */
export const isOverlayPart = (node) => node.recognized?.component === 'modal' || node.recognized?.component === 'drawer';

/**
 * The first node in `node`'s subtree (itself included) that satisfies `test`.
 * @param {UiNode} node
 * @param {(n: UiNode) => boolean} test
 * @returns {UiNode | null}
 */
export function findNode(node, test) {
  if (test(node)) return node;
  for (const c of node.children ?? []) {
    const found = findNode(c, test);
    if (found) return found;
  }
  return null;
}

/**
 * The nodes from the tree root down to, not including, the target.
 * @param {UiNode} tree @param {UiNode} target
 * @returns {UiNode[] | null}
 */
export function ancestorsOf(tree, target) {
  /** @param {UiNode} n @param {UiNode[]} path @returns {UiNode[] | null} */
  const walk = (n, path) => {
    if (n === target || (n.key && n.key === target.key)) return path;
    for (const c of n.children) {
      const found = walk(c, [...path, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(tree, []);
}

/**
 * Which screen edge a rectangle is docked against, if it is a drawer-shaped
 * panel: it touches the edge, spans nearly the whole screen along it and is
 * clearly narrower than the screen across it. `parked` is true when the
 * panel is entirely outside the screen (a closed drawer that was only moved
 * off-screen with a CSS transform).
 *
 * This is the geometry that tells a Drawer from a Modal: a centered dialog
 * touches no edge, and a full-screen dialog covers the screen across too.
 *
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {{ w: number, h: number }} screen
 * @returns {{ edge: 'left' | 'right' | 'top' | 'bottom', parked: boolean } | null}
 */
export function dockedEdge(box, screen) {
  const t = EDGE_TOLERANCE;
  const tall = box.h >= screen.h * SPAN;
  const wide = box.w >= screen.w * SPAN;
  const narrow = box.w < screen.w * 0.95;
  const short = box.h < screen.h * 0.95;
  if (tall && narrow) {
    if (box.x + box.w <= t) return { edge: 'left', parked: true };
    if (box.x >= screen.w - t) return { edge: 'right', parked: true };
    if (box.x <= t) return { edge: 'left', parked: false };
    if (box.x + box.w >= screen.w - t) return { edge: 'right', parked: false };
  }
  if (wide && short) {
    if (box.y + box.h <= t) return { edge: 'top', parked: true };
    if (box.y >= screen.h - t) return { edge: 'bottom', parked: true };
    if (box.y <= t) return { edge: 'top', parked: false };
    if (box.y + box.h >= screen.h - t) return { edge: 'bottom', parked: false };
  }
  return null;
}

/**
 * A node's `aria-modal`: true, false, or null when it does not say.
 * @param {UiNode} node
 */
export function ariaModal(node) {
  const v = node.aria?.modal;
  return v === 'true' ? true : v === 'false' ? false : null;
}

/**
 * A full-screen fixed or absolute box that holds a dialog: the portal scrim a
 * page puts around its dialog (Bootstrap's `.modal`, a hand-written
 * `.overlay`). Its own fill, if translucent, is the dim color.
 * @param {UiNode} node
 * @param {{ w: number, h: number }} screen
 * @param {(inner: UiNode) => boolean} isInner  Recognizes the dialog inside.
 */
export function isScrimWrapper(node, screen, isInner) {
  if (isDialogRole(node)) return false;
  const position = node.layout?.position;
  if (position !== 'fixed' && position !== 'absolute') return false;
  if (node.w < screen.w * 0.95 || node.h < screen.h * 0.95) return false;
  return Boolean(findNode(node, (n) => n !== node && isInner(n)));
}

/**
 * The translucent color of the backdrop of a dialog wrapper: a Material UI
 * backdrop inside it, else the wrapper's own translucent fill. Null when
 * neither exists (the caller uses DEFAULT_SCRIM).
 * @param {UiNode} wrapper
 * @returns {number[] | null}
 */
export function backdropColor(wrapper) {
  const backdrop = findNode(wrapper, (n) => n !== wrapper && classesOf(n).includes('MuiBackdrop-root'));
  const c = backdrop?.styles?.bgColor ?? wrapper.styles?.bgColor;
  return c && c[3] > 0 && c[3] < 255 ? c : null;
}

/** True for a Material UI root of the given component. @param {UiNode} node @param {string} name */
export const isMuiRoot = (node, name) => muiRoots(node).includes(name);

/**
 * The text of the node(s) a dialog names with aria-labelledby, else its
 * aria-label, else the first heading inside it. Empty string when none.
 * @param {UiNode} dialog
 * @param {import('../recognize.mjs').RecognizeContext} ctx
 */
export function dialogTitle(dialog, ctx) {
  const labelled = ctx.links?.get(dialog.key)?.labelledBy ?? [];
  /** @param {UiNode} n @param {string} key @returns {UiNode | null} */
  const byKey = (n, key) => (n.key === key ? n : n.children.map((c) => byKey(c, key)).find(Boolean) ?? null);
  const texts = labelled.map((key) => byKey(ctx.tree, key)).map((n) => n && textOf(n)).filter(Boolean);
  if (texts.length) return texts.join(' ');
  if (dialog.aria?.label) return dialog.aria.label;
  const heading = findNode(dialog, (n) => /^h[1-6]$/.test(n.tag) || n.role === 'heading');
  return heading ? textOf(heading) : '';
}

/** All own text of a subtree, joined. @param {UiNode} node @returns {string} */
function textOf(node) {
  return [node.text, ...node.children.map(textOf)].filter((t) => t && t.trim()).map((t) => t.trim()).join(' ');
}

/** True for a pressable control: button, role=button, input button/submit. @param {UiNode} node */
export function isButtonLike(node) {
  if (node.tag === 'button' || node.role === 'button') return true;
  return node.tag === 'input' && (node.attrs?.type === 'button' || node.attrs?.type === 'submit');
}

/**
 * Give every button inside `root` the `events` that close the dialog, except a
 * button that already does something else: it opens another dialog or menu
 * (aria-controls / aria-haspopup) or navigates (data-lv-link). Returns a copy;
 * `root` itself is never given events.
 *
 * Why every button: a dialog's actions (OK, Cancel, Agree, Delete, the X in
 * the title) all dismiss it in the common case, and a static page has no
 * other way to say which ones do not. The application adds its own handler to
 * the same widget for the real action.
 *
 * @param {UiNode} root
 * @param {import('../behavior.mjs').BehaviorEvent[]} events
 * @returns {UiNode}
 */
export function withClosers(root, events) {
  /** @param {UiNode} n @param {boolean} isRoot @returns {UiNode} */
  const walk = (n, isRoot) => {
    let out = { ...n, children: n.children.map((c) => walk(c, false)) };
    const opensSomething = Boolean(n.aria?.controls || n.aria?.haspopup) || Boolean(n.link);
    if (!isRoot && isButtonLike(n) && !opensSomething) out = withBehavior(out, { events });
    return out;
  };
  return walk(root, true);
}

/** The set-to-0 (and slide-out) events a closer carries. */
export const closeEvents = (open, slideOut) => [setEvent(open, 0), ...(slideOut ? [playEvent(slideOut)] : [])];

/** The set-to-1 (and slide-in) events an opener carries. */
export const openEvents = (open, slideIn) => [setEvent(open, 1), ...(slideIn ? [playEvent(slideIn)] : [])];

/**
 * A synthetic full-screen node for the layer behind a dialog. Styled from the
 * screen root so it has every field the converter reads.
 *
 * @param {UiNode} root     The tree root (the screen).
 * @param {object} fields   key, lvName, color, children.
 * @returns {UiNode}
 */
export function screenLayer(root, { key, lvName, color = DEFAULT_SCRIM, children = [] }) {
  return {
    tag: 'div', id: null, className: null, component: null, widget: null, lvName, link: null,
    role: null, aria: {}, classes: [], testId: null, hidden: false, key,
    x: root.x ?? 0, y: root.y ?? 0, w: root.w, h: root.h, text: null, attrs: {},
    styles: {
      ...root.styles,
      bgColor: [...color], gradient: null, borderColor: null, borderWidth: 0, borderBottomColor: null,
      borderBottomWidth: 0, radius: 0, shadow: null, opacity: 1, padLeft: 0, padRight: 0, padTop: 0,
      padBottom: 0, scrollable: false, pressed: null, overflowHidden: false,
    },
    layout: { ...root.layout, display: 'block', position: 'fixed', flexGrow: 0, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 },
    children,
    overlay: true,
  };
}
