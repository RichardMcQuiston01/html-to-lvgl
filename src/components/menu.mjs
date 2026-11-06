/**
 * Menu: a button that opens a floating list of commands (ARIA `role="menu"`
 * with `menuitem` children and an `aria-haspopup="menu"` opener, Material UI
 * `MuiMenu-root`, Bootstrap's dropdown menu). COMPONENTS.md, "The Disclosure
 * Primitive".
 *
 * Choice: the Phase 8 behavior IR, not `lv_dropdown`. A dropdown replaces its
 * label with the chosen option and draws its own list with LVGL's default
 * theme, so it cannot keep an "Actions" button, rows with icons or dividers,
 * or the page's popup size, colors and shadow. The behavior IR keeps every box
 * the browser drew and verifies the same way Modal does (click-driven in real
 * LVGL): the opener sets a subject to 1, the popup is bound to hide while it is
 * 0, and a press on an item sets it back to 0. (Select, whose value is the
 * point, does use `lv_dropdown`; see select.mjs.)
 *
 * Signals and scores:
 *   1    an opener: a button-like node with `aria-haspopup="menu"` (or
 *        `"true"`, which means a menu) that names a menu with `aria-controls`,
 *        or that a menu names with `aria-labelledby` (Material UI)
 *   1    a `role="menu"` that has such an opener, or that was hidden or
 *        measured open by the extractor (a popup, not a list that is always shown)
 *   0.7  `MuiMenu-root` / `MuiPopover-root` that holds such a menu
 *
 * What build() produces (all of it behavior XML, no new widgets):
 *
 *   layer    a transparent full-screen `floating` layer, the LAST child of the
 *            screen (convert() hoists it). It holds the popup at the position
 *            the browser measured, binds `hidden` to the menu's subject and
 *            closes the menu when the area around the popup is pressed, as a
 *            Material UI backdrop does. While it is open it also blocks the
 *            page beneath it.
 *   popup    the Material UI Paper (or the `role="menu"` box itself) inside.
 *   items    each `menuitem` / `menuitemcheckbox` / `menuitemradio` sets the
 *            subject to 0, so choosing an item closes the menu. The
 *            application adds its own handler to the same widget for the
 *            action itself. An item that opens a submenu is an opener instead.
 *   opener   sets the subject to 1.
 *
 * State: one int subject per menu, `<screen>_<key>_open`, where key is the
 * wrapper's (or the menu's). It starts at 0 when the menu is hidden in the
 * page (`display:none`, `hidden`, Material UI's keepMounted `visibility:hidden`)
 * and at 1 when it was saved open.
 *
 * Limits: a closed Material UI Menu is not in the DOM unless
 * `keepMounted` is set, so it cannot be recognized (there is nothing to read);
 * the popup keeps the position it had when measured (it does not follow the
 * opener); no open/close animation; check and radio items do not track state;
 * a `role="menu"` that is always visible with no opener stays ordinary boxes.
 */

import { SCORE_SEMANTIC, SCORE_MUI, hasMuiRoot, withName } from './shared.mjs';
import { subjectFor, withBehavior, declareSubject, hiddenWhen, setEvent } from '../behavior.mjs';
import { findNode, ancestorsOf, screenLayer } from './overlay.mjs';
import { makePressable } from './accordion.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */
/** @typedef {import('../recognize.mjs').RecognizeContext} RecognizeContext */

const ITEM_ROLES = new Set(['menuitem', 'menuitemcheckbox', 'menuitemradio']);
const POPUP_ROOTS = ['Menu', 'Popover'];

/** @param {UiNode} node */
const isMenu = (node) => node.role === 'menu';

/** @param {UiNode} node */
const isPopupWrapper = (node) => POPUP_ROOTS.some((name) => hasMuiRoot(node, name)) && node.role !== 'menu';

/** @param {UiNode} tree @param {string} key @returns {UiNode | null} */
const byKey = (tree, key) => findNode(tree, (n) => n.key === key);

/** All nodes of a subtree that satisfy `test`. @param {UiNode} node @param {(n: UiNode) => boolean} test @returns {UiNode[]} */
function findAll(node, test) {
  return [...(test(node) ? [node] : []), ...node.children.flatMap((c) => findAll(c, test))];
}

/** An opener says its popup is a menu. @param {UiNode} node */
function claimsMenu(node) {
  const popup = node.aria?.haspopup;
  return (popup === 'menu' || popup === 'true') && node.role !== 'combobox';
}

/**
 * Menus an opener points at: named by its aria-controls, or naming it with
 * aria-labelledby. Returns the role=menu nodes.
 * @param {UiNode} opener
 * @param {RecognizeContext} ctx
 * @returns {UiNode[]}
 */
function menusOf(opener, ctx) {
  const found = [];
  for (const key of ctx.links?.get(opener.key)?.controls ?? []) {
    const target = byKey(ctx.tree, key);
    const menu = target && findNode(target, isMenu);
    if (menu) found.push(menu);
  }
  for (const menu of findAll(ctx.tree, isMenu)) {
    if ((ctx.links?.get(menu.key)?.labelledBy ?? []).includes(opener.key) && !found.includes(menu)) found.push(menu);
  }
  return found;
}

/** The openers of a menu. @param {UiNode} menu @param {RecognizeContext} ctx @returns {UiNode[]} */
function openersOf(menu, ctx) {
  const keys = new Set([
    ...(ctx.links?.get(menu.key)?.controlledBy ?? []),
    ...(ctx.links?.get(menu.key)?.labelledBy ?? []),
  ]);
  for (const ancestor of ancestorsOf(ctx.tree, menu) ?? []) {
    for (const k of ctx.links?.get(ancestor.key)?.controlledBy ?? []) keys.add(k);
  }
  return [...keys].map((k) => byKey(ctx.tree, k)).filter((n) => n && claimsMenu(n) && n !== menu);
}

/**
 * The node that stands for the whole popup (its key names the subject): the
 * Material UI Popover/Menu wrapper around the menu, else the menu itself.
 * @param {UiNode} menu
 * @param {RecognizeContext} ctx
 * @returns {UiNode}
 */
function popupRootFor(menu, ctx) {
  const wrapper = [...(ancestorsOf(ctx.tree, menu) ?? [])].reverse().find(isPopupWrapper);
  return wrapper ?? menu;
}

/** A menu that is a popup: it has an opener, or the page keeps it hidden. */
function isPopupMenu(menu, ctx) {
  if (menu.recognized?.component === 'menu') return false;
  return openersOf(menu, ctx).length > 0 || Boolean(menu.hidden || menu.initiallyHidden);
}

/** The opener's menu popup root, or null. */
function openedPopup(node, ctx) {
  if (node.recognized?.component === 'menu' || !claimsMenu(node)) return null;
  const menu = menusOf(node, ctx)[0];
  return menu ? popupRootFor(menu, ctx) : null;
}

/** @param {UiNode} node @returns {UiNode} Same subtree with `hidden` cleared. */
function shown(node) {
  return { ...node, hidden: false, children: node.children.map(shown) };
}

/**
 * Give each menu item the event that closes the popup, and make it pressable.
 * @param {UiNode} node
 * @param {import('../behavior.mjs').BehaviorEvent} close
 * @returns {UiNode}
 */
function withItemClosers(node, close) {
  let out = { ...node, children: node.children.map((c) => withItemClosers(c, close)) };
  const opensSomething = Boolean(node.aria?.controls) || claimsMenu(node);
  if (ITEM_ROLES.has(node.role ?? '') && !opensSomething && !node.behavior?.events?.length && node.aria?.disabled !== 'true') {
    // A text-only <li> would be emitted as a plain container whose label ignores
    // the item's padding; as a <div> the converter puts the label inside, inset.
    if (out.tag === 'li' && out.text && !out.children.length) out = { ...out, tag: 'div' };
    out = makePressable(withName(out, 'menu_item'), close);
  }
  return out;
}

/** Flag the popup and the menu inside it as already built. @param {UiNode} node @returns {UiNode} */
function markParts(node) {
  const children = node.children.map(markParts);
  return isMenu(node) || node.children.length !== children.length || children.some((c, i) => c !== node.children[i])
    ? { ...node, children, recognized: { component: 'menu', props: { part: isMenu(node) ? 'menu' : 'popup' } } }
    : node;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const menu = {
  name: 'menu',
  match(node, ctx) {
    if (node.recognized?.component === 'menu') return false;
    if (openedPopup(node, ctx)) return SCORE_SEMANTIC;
    if (isMenu(node) && isPopupMenu(node, ctx)) return SCORE_SEMANTIC;
    if (isPopupWrapper(node)) {
      const inner = findNode(node, (n) => n !== node && isMenu(n));
      if (inner && isPopupMenu(inner, ctx)) return SCORE_MUI;
    }
    return false;
  },
  props: {
    open: { type: 'bool', default: false },
  },
  slots: ['opener', 'items'],
  build(node, ctx) {
    const opened = openedPopup(node, ctx);
    if (opened) {
      const open = subjectFor(opened, 'open');
      return { ...withBehavior(node, { events: [setEvent(open, 1)] }), recognized: { component: 'menu', props: { role: 'opener' } } };
    }

    // The popup root is this node: a wrapper that holds the menu, or the menu.
    const wrapper = isPopupWrapper(node);
    const inner = wrapper ? findNode(node, (n) => n !== node && isMenu(n)) : node;
    const open = subjectFor(node, 'open');
    const closed = Boolean(node.hidden || node.initiallyHidden);
    const initialOpen = closed ? 0 : 1;

    // The Paper (or the menu) that is the visible popup: the wrapper's child that
    // holds the menu, which leaves the invisible backdrop behind.
    const popupBox = wrapper ? node.children.find((c) => c === inner || findNode(c, (n) => n === inner)) ?? inner : node;
    const items = withItemClosers(shown(popupBox), setEvent(open, 0));
    // Every part is marked so the registry does not offer the inner role=menu to this definition again.
    const popup = markParts({ ...items, widget: null, initiallyHidden: false, hidden: false });

    const layer = screenLayer(ctx.tree, {
      key: `${node.key}~layer`,
      lvName: node.lvName ?? 'menu',
      color: [0, 0, 0, 0],
      children: [withName(popup, 'menu_popup')],
    });
    const result = withBehavior(layer, {
      subjects: [declareSubject(open, initialOpen)],
      binds: [hiddenWhen(open, 'eq', 0)],
      // Pressing outside the popup closes it, as Material UI's backdrop does.
      events: [setEvent(open, 0)],
    });
    return { ...result, recognized: { component: 'menu', props: { open: Boolean(initialOpen) } } };
  },
};

export default menu;
