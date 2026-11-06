/**
 * Bottom navigation: a bar of 3 to 5 icon-over-label actions pinned to the
 * bottom edge of the screen (Material UI BottomNavigation, a `<nav>` /
 * `role="navigation"` of icon buttons, mobile tab bars). Phase 9.
 *
 * Choice: an `lv_tabview` whose tab bar is at the bottom and whose pages are
 * empty, not a row of `lv_button`. Evidence, from real LVGL v9.4.0 renders of
 * examples/components/bottom-navigation.html (see the Phase 9 lane A notes):
 *   - A plain row of buttons is what the converter produced before. Its
 *     buttons carry no flex layout, so the icon and the label draw on top of
 *     each other (fidelity 93.2%, the bar visibly broken in both versions).
 *   - The tabview's tab buttons are real buttons with a CHECKED state, so the
 *     selected action is styled by LVGL and a tap moves the highlight to the
 *     tapped action with no subject or event of our own. A button row would
 *     need a subject, a toggle event per action and a bind per action for the
 *     same result.
 *   - A tab button is a flex container: `flex_flow="column_reverse"` on it
 *     puts the icon child (added after LVGL's own label) above the label, which
 *     is how Material UI stacks them.
 *   - Navigation stays: an action with data-lv-link (or an `<a href>` that
 *     names a sibling page) gets the usual screen_create_event on its tab
 *     button, so it still switches screens.
 * Limits: the icon is a static placeholder drawn in the colour it had in the
 * page, so it does not change colour when another action is tapped (only the
 * label and the button do). An action that is not a vertical icon-over-label
 * stack is not converted (UNSUPPORTED_WIDGET, the default mapping is kept).
 *
 * Signals:
 *   0.7  MuiBottomNavigation-root with 2 to 6 actions (MuiBottomNavigationAction-root)
 *   1    a `<nav>` or role="navigation" that is pinned (position fixed, sticky
 *        or absolute) to the bottom edge of its container and holds 3 to 5
 *        actions, each a pressable (button, link, role=button/link/tab) with an
 *        icon and a text label.
 * The open action is the one with `aria-current`, `aria-selected="true"` or
 * the `Mui-selected` class; its `data-lv-link` / `href` is its target.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasClass, hasMuiRoot, withName } from './shared.mjs';
import { findNode } from './overlay.mjs';
import { ownName } from '../names.mjs';
import { bare, rectOf, emptyPage, tabviewGeometry, unsupported } from './tabs.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const PINNED = new Set(['fixed', 'sticky', 'absolute']);
const PRESSABLE_ROLES = new Set(['button', 'link', 'tab', 'menuitem']);
/** Slack for "touches the bottom edge", px: the browser rounds boxes. */
const EDGE_TOLERANCE = 2;

/** @param {UiNode} n */
const isPressable = (n) => n.tag === 'button' || (n.tag === 'a' && Boolean(n.attrs?.href)) || PRESSABLE_ROLES.has(n.role ?? '') || Boolean(n.link);

/** @param {UiNode} n */
const isIconLike = (n) => ['svg', 'img', 'i'].includes(n.tag) || (n.classes ?? []).some((c) => /icon/i.test(c)) || (!n.text && n.children.length > 0 && n.children.every(isIconLike));

/** The text a node shows (own text first), whitespace collapsed. @param {UiNode} n @returns {string} */
const textOf = (n) => [n.text ?? '', ...n.children.map(textOf)].join('').replace(/\s+/g, ' ').trim();

/**
 * The action elements of a bar: its visible children, or the items of the one
 * list it wraps them in (`nav > ul > li`).
 * @param {UiNode} bar @returns {UiNode[]}
 */
function actionsOf(bar) {
  const kids = bar.children.filter((c) => !c.hidden);
  if (kids.length === 1 && ['ul', 'ol', 'div'].includes(kids[0].tag) && kids[0].children.length > 1 && !kids[0].text) {
    return kids[0].children.filter((c) => !c.hidden);
  }
  return kids;
}

/**
 * Read one action: the element that carries its box (`box`), the node with
 * the label text, the icon nodes, and its target. Null when it is not an
 * icon-and-label pressable.
 * @param {UiNode} action
 * @returns {{ box: UiNode, label: UiNode, icons: UiNode[], link: string | null, href: string | null } | null}
 */
function readAction(action) {
  // li > a (or li > button): the pressable inside is the action's real box.
  let box = action;
  if (!isPressable(action) && !action.text && action.children.length === 1 && isPressable(action.children[0])) box = action.children[0];
  else if (!isPressable(action)) {
    const inner = findNode(action, (n) => n !== action && isPressable(n));
    if (!inner && !hasClass(action, 'MuiBottomNavigationAction-root')) return null;
    if (inner && !hasClass(action, 'MuiBottomNavigationAction-root')) box = inner;
  }
  const label = box.text ? box : findNode(box, (n) => n !== box && Boolean(n.text) && n.children.length === 0);
  if (!label || !label.text) return null;
  const icons = box.children.filter((c) => c !== label && !c.hidden && isIconLike(c));
  if (!icons.length) return null;
  // data-lv-link is explicit (an unknown target is reported); an <a href> only navigates when it names a sibling page.
  const link = box.link ?? action.link ?? null;
  const href = box.tag === 'a' ? box.attrs?.href ?? null : null;
  return { box, label, icons, link, href };
}

/**
 * Whether the action stacks its icon above the label (`column_reverse`: LVGL's
 * own label comes first, so the icon added after it must be drawn above) or
 * below it (`column`), from the measured boxes. A label that is the button's
 * own text has no box of its own: the icon is above it when the icon's
 * centre is above the button's centre.
 * @param {{ box: UiNode, label: UiNode, icons: UiNode[] }} read
 * @returns {'column' | 'column_reverse' | null}
 */
function stackOf(read) {
  const icon = rectOf(read.icons[0]);
  if (read.label === read.box) {
    const mid = read.box.y + read.box.h / 2;
    const iconMid = (icon.t + icon.b) / 2;
    if (iconMid < mid - EDGE_TOLERANCE) return 'column_reverse';
    if (iconMid > mid + EDGE_TOLERANCE) return 'column';
    return null;
  }
  const label = rectOf(read.label);
  if (icon.b <= label.t + EDGE_TOLERANCE) return 'column_reverse';
  if (label.b <= icon.t + EDGE_TOLERANCE) return 'column';
  return null;
}

/** The space between the icon and the label: measured, or the button's CSS row gap when the text is the button's own. @param {{ box: UiNode, label: UiNode, icons: UiNode[] }} read @param {string} stack */
function iconGapOf(read, stack) {
  if (read.label === read.box) return Math.max(0, read.box.layout?.rowGap ?? 0);
  const icon = rectOf(read.icons[0]);
  const label = rectOf(read.label);
  return Math.max(0, stack === 'column_reverse' ? label.t - icon.b : icon.t - label.b);
}

/** Is this action the open one? Looks at the action and the pressable inside it. @param {UiNode} action @param {UiNode} box @returns {boolean} */
function isCurrent(action, box) {
  return [action, box].some((n) => {
    const current = ariaOf(n, 'current');
    return (current !== undefined && current !== 'false') || ariaOf(n, 'selected') === 'true' || hasClass(n, 'Mui-selected');
  });
}

/**
 * Does the bar touch the bottom edge of the box it sits in (its parent), or of
 * the page? An absolute or fixed bar is positioned against that edge.
 * @param {UiNode} node @param {import('../recognize.mjs').RecognizeContext | { parent: UiNode | null, tree?: UiNode }} ctx
 */
function pinnedToBottom(node, ctx) {
  if (!PINNED.has(node.layout?.position ?? '')) return false;
  const edge = ctx.parent ? ctx.parent.y + ctx.parent.h : (ctx.tree?.h ?? 0);
  const pageEdge = ctx.tree ? ctx.tree.y + ctx.tree.h : edge;
  return [edge, pageEdge].some((e) => Math.abs(node.y + node.h - e) <= EDGE_TOLERANCE + (ctx.parent?.styles?.borderWidth ?? 0));
}

/** @param {UiNode} node @param {import('../recognize.mjs').RecognizeContext} ctx @returns {{ actions: UiNode[], mui: boolean } | null} */
function candidate(node, ctx) {
  if (hasMuiRoot(node, 'BottomNavigation')) {
    const actions = actionsOf(node);
    return actions.length >= 2 && actions.length <= 6 ? { actions, mui: true } : null;
  }
  if (node.tag !== 'nav' && node.role !== 'navigation') return null;
  const actions = actionsOf(node);
  if (actions.length < 3 || actions.length > 5) return null;
  if (!pinnedToBottom(node, ctx)) return null;
  if (!actions.every((a) => readAction(a))) return null;
  return { actions, mui: false };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const bottomNavigation = {
  name: 'bottom-navigation',
  match(node, ctx) {
    const found = candidate(node, ctx);
    if (!found) return false;
    return found.mui ? SCORE_MUI : SCORE_SEMANTIC;
  },
  props: {
    active: { type: 'number', default: 0 },
  },
  slots: ['actions'],
  build(node, ctx) {
    const found = candidate(node, ctx) ?? (node.widget === 'bottom-navigation' ? { actions: actionsOf(node), mui: false } : null);
    const reads = found ? found.actions.map((a) => ({ action: a, read: readAction(a) })) : [];
    if (!found || reads.some((r) => !r.read)) {
      unsupported(ctx, node, `bottom navigation "${node.key}"`, 'an action is not an icon above a text label inside a pressable, so the default mapping (a row of buttons) is kept', 'Give each action an icon above a text label inside one button or link, or build the bar by hand with a row of lv_button.');
      return null;
    }
    const actions = /** @type {{ action: UiNode, read: NonNullable<ReturnType<typeof readAction>> }[]} */ (reads);

    // Each action must stack its icon above (or below) its label, the one
    // arrangement a tab button's column flex can reproduce.
    const stacks = actions.map(({ read }) => stackOf(read));
    if (stacks.some((s) => s === null) || new Set(stacks).size > 1) {
      unsupported(ctx, node, `bottom navigation "${node.key}"`, 'an action lays its icon beside its label (or the actions differ), which a tab button cannot reproduce, so the default mapping is kept', 'Stack the icon above the label in every action, or build the bar by hand with a row of lv_button.');
      return null;
    }
    const stack = /** @type {string} */ (stacks[0]);

    const boxes = actions.map(({ read }) => read.box);
    const active = Math.max(0, actions.findIndex(({ action, read }) => isCurrent(action, read.box)));
    const iconGap = iconGapOf(actions[0].read, stack);

    // The tab buttons are the actions' boxes, with the label text node left to LVGL's own label.
    const buttons = actions.map(({ read }, i) => {
      const box = read.box;
      const rest = box.children.filter((c) => c !== read.label);
      return {
        ...structuredClone({ ...box, children: [] }),
        text: null,
        children: rest,
        tabButton: true,
        key: box.key ?? `${node.key}~action${i + 1}`,
      };
    });
    const barNode = bare(node);
    const { pad, buttonGap, fillBar } = tabviewGeometry({ bar: node, buttons: boxes, content: null, position: 'bottom' });

    const pages = actions.map((_, i) => emptyPage(node, `${node.key}~page${i + 1}`));
    /** @type {import('./tabs.mjs').TabviewData} */
    const data = {
      active,
      position: 'bottom',
      gap: 0,
      bar: { node: barNode, w: node.w, h: node.h, pad, gap: buttonGap },
      tabs: actions.map(({ read }, i) => ({ text: textOf(read.label), node: bare(boxes[i]), textNode: bare(read.label), link: read.link, href: read.href })),
      indicator: null,
      fillBar,
      synthetic: false,
      stack,
      iconGap,
    };
    // The tabview itself is the bar's footprint with no look of its own: the
    // fill, border and shadow belong to the tab bar inside it.
    const shell = {
      ...node,
      tag: 'div', text: null, role: null, aria: {}, hidden: false, revealed: false, initiallyHidden: false,
      styles: { ...node.styles, bgColor: null, gradient: null, shadow: null, borderWidth: 0, borderBottomWidth: 0, borderSide: undefined, radius: 0, opacity: 1, scrollable: false, pressed: null, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, overflowVisible: false, overflowHidden: false },
      layout: { ...node.layout, display: 'block' },
      children: [...pages, ...buttons],
      tabview: data,
    };
    // An author's own name (id, data-lv-name, a class) wins over the generic one.
    const holder = ownName(shell) ? shell : withName(shell, 'bottom_nav');
    holder.recognized = { component: 'bottom-navigation', props: { active } };
    return holder;
  },
};

export default bottomNavigation;
