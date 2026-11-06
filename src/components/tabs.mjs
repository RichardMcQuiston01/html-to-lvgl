/**
 * Tabs: a tab bar plus one panel per tab (ARIA `role="tablist"` / `tab` /
 * `tabpanel`, Material UI Tabs, Bootstrap/Radix tab sets). Phase 9, mapped to
 * the native `lv_tabview` (COMPONENTS.md, "Component Mapping").
 *
 * Why a native widget: an `lv_tabview` already does what the page needs. A tap
 * on a tab button switches the page, the open tab is the button's CHECKED
 * state, and the pages scroll-snap. No subject, event or timeline is needed,
 * so the same output works in XML, C, C++ and MicroPython. The XML tags were
 * checked in LVGL v9.4.0 (src/others/xml/parsers/lv_xml_tabview_parser.c):
 * `<lv_tabview active tab_bar_position>`, `<lv_tabview-tab_bar>`,
 * `<lv_tabview-tab text>` (one per tab page) and `<lv_tabview-tab_button index>`.
 *
 * Signals, strongest first:
 *   1    the node is the smallest element that holds a role="tablist" AND every
 *        tabpanel its tabs control (`aria-controls`, or a panel whose
 *        `aria-labelledby` names the tab). That element becomes the tabview.
 *   2    `data-lv-widget="tabs"` on any element that holds a tablist (set by
 *        the registry itself).
 * A tablist whose panels cannot be found (a tab strip used as plain
 * navigation, with the page content elsewhere) is NOT turned into a tabview:
 * it stays a row of buttons and reports UNSUPPORTED_WIDGET.
 *
 * What build() produces. The tabview node keeps the root's box (size, fill,
 * border, radius, padding); its `children` are the tab panels, one per tab, in
 * tab order; `tabview` carries everything the emitter needs (see TabviewData):
 *   - active   the index whose tab says `aria-selected="true"` (else the
 *              Material UI `Mui-selected` class, else the first tab),
 *   - position top / bottom / left / right, read from where the tab bar sits
 *              relative to the panels in the measured layout (`aria-orientation`
 *              is the fallback when no panel was measured),
 *   - the bar and button geometry and styles, and the selected tab's style as a
 *     separate "checked" look (a Material UI `MuiTabs-indicator` becomes the
 *     checked button's underline).
 * If the tab bar and panels share their container with other content, only
 * the bar and the panels are replaced by one tabview placed where the bar was.
 *
 * Limits (each reported or documented, none silent):
 *   - lv_tabview buttons hold one text label: tab icons are dropped
 *     (UNSUPPORTED_WIDGET warning, label kept).
 *   - The browser's panel styling that sits on a wrapper around the panels
 *     (not on the tabpanel itself) is not reproduced.
 *   - A panel the extractor could not measure (hidden, and no `aria-controls`
 *     naming it) becomes an empty page (UNSUPPORTED_WIDGET warning).
 *   - Tabs in one container that share a root are not both converted: the
 *     first tablist wins.
 *   - Scrolling tab bars (MUI `variant="scrollable"`) lose their scroll arrows.
 */
import { SCORE_SEMANTIC, ariaOf, hasClass, withName } from './shared.mjs';
import { ancestorsOf, findNode } from './overlay.mjs';
import { ownName } from '../names.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

/**
 * @typedef {object} TabviewData
 * @property {number} active                       Index of the open tab.
 * @property {'top' | 'bottom' | 'left' | 'right'} position
 * @property {number} gap                          Space between the bar and the pages, px.
 * @property {{ node: UiNode, w: number, h: number, pad: { left: number, top: number, right: number, bottom: number }, gap: number }} bar
 *   `node` is a childless copy of the bar element (for its box styles).
 * @property {{ text: string, node: UiNode, textNode?: UiNode, link: string | null, href?: string | null }[]} tabs
 *   `node` is a childless copy of the tab button (for its styles and size);
 *   `textNode`, when the label is a separate element (bottom navigation), supplies the text style.
 * @property {{ color: number[], width: number, side: 'top' | 'bottom' | 'left' | 'right' } | null} indicator
 *   The Material UI underline, drawn as the checked button's border.
 * @property {boolean} fillBar                     True when the buttons split the bar equally (LVGL's default).
 * @property {boolean} synthetic                   True when the tabview was inserted next to other content.
 * @property {'column' | 'column_reverse'} [stack]  Bottom navigation: how a tab button stacks LVGL's label and the icon children.
 * @property {number} [iconGap]                    Bottom navigation: space between icon and label, px.
 */

/** @param {UiNode} node */
const isTablist = (node) => node.role === 'tablist';
/** @param {UiNode} node */
const isTab = (node) => node.role === 'tab';

/** Every node inside `root` (and `root`) that passes the test, document order. @param {UiNode} root @param {(n: UiNode) => boolean} test @returns {UiNode[]} */
function collect(root, test) {
  /** @type {UiNode[]} */
  const out = [];
  (function walk(n) {
    if (test(n)) out.push(n);
    for (const c of n.children ?? []) walk(c);
  })(root);
  return out;
}

/** True when `target` is `root` or lies inside it. */
export const contains = (root, target) => root === target || (root.key !== undefined && root.key === target.key) || (root.children ?? []).some((c) => contains(c, target));

/** The text a node shows, own text first. @param {UiNode} n @returns {string} */
export const textOf = (n) => [n.text ?? '', ...(n.children ?? []).map(textOf)].join('').replace(/\s+/g, ' ').trim();

/** The tab buttons of a tablist, in document order (nested tablists are not entered). @param {UiNode} list @returns {UiNode[]} */
function tabsOf(list) {
  /** @type {UiNode[]} */
  const out = [];
  (function walk(n) {
    if (n !== list && isTablist(n)) return;
    if (isTab(n)) out.push(n);
    else for (const c of n.children ?? []) walk(c);
  })(list);
  return out;
}

/**
 * The panel a tab controls: `aria-controls` first, then a node whose
 * `aria-labelledby` names the tab. Null when neither exists.
 * @param {UiNode} tab @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {UiNode | null}
 */
function panelOf(tab, ctx) {
  const id = (ariaOf(tab, 'controls') ?? '').split(/\s+/).find(Boolean);
  if (id && ctx.byId.get(id)) return /** @type {UiNode} */ (ctx.byId.get(id));
  if (tab.id) {
    const byLabel = findNode(ctx.tree, (n) => n.role === 'tabpanel' && (ariaOf(n, 'labelledby') ?? '').split(/\s+/).includes(/** @type {string} */ (tab.id)));
    if (byLabel) return byLabel;
  }
  return null;
}

/**
 * @typedef {object} TabGroup
 * @property {UiNode} root        The element that becomes the tabview.
 * @property {UiNode} list        The role="tablist" element.
 * @property {UiNode[]} tabs
 * @property {(UiNode | null)[]} panels   One per tab; null when the tab controls nothing findable.
 */

/**
 * Describe the tab group whose tablist is `list`, with `root` the smallest
 * ancestor that holds the tablist and every panel found. Null when no panel
 * was found at all.
 * @param {UiNode} list @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {TabGroup | null}
 */
function groupOf(list, ctx) {
  const tabs = tabsOf(list);
  if (!tabs.length) return null;
  const panels = tabs.map((t) => panelOf(t, ctx));
  const found = panels.filter((p) => p !== null);
  if (!found.length) return null;
  const chain = ancestorsOf(ctx.tree, list) ?? [];
  // Deepest first: the smallest container that holds the list and every panel.
  const root = [...chain].reverse().find((a) => found.every((p) => contains(a, /** @type {UiNode} */ (p))));
  return root ? { root, list, tabs, panels } : null;
}

/** @type {WeakMap<UiNode, Map<string, TabGroup>>} */
const groupCache = new WeakMap();

/**
 * Every tab group of the page, keyed by the key of its root. One tree is
 * scanned once: match() runs for every node and the answer does not change
 * while the registry rewrites the tree below it.
 * @param {import('../recognize.mjs').RecognizeContext} ctx
 */
function groupsOf(ctx) {
  let groups = groupCache.get(ctx.tree);
  if (!groups) {
    groups = new Map();
    for (const list of collect(ctx.tree, (n) => isTablist(n) && !n.hidden)) {
      const group = groupOf(list, ctx);
      if (group?.root.key && !groups.has(group.root.key)) groups.set(group.root.key, group);
    }
    groupCache.set(ctx.tree, groups);
  }
  return groups;
}

/** The group a node is the root of, or (when forced with data-lv-widget) the one for its first tablist. @param {UiNode} node @param {import('../recognize.mjs').RecognizeContext} ctx @returns {TabGroup | null} */
function groupFor(node, ctx) {
  const known = node.key ? groupsOf(ctx).get(node.key) : undefined;
  if (known) return known;
  if (node.widget !== 'tabs') return null;
  const list = findNode(node, isTablist);
  return list ? groupOf(list, ctx) : null;
}

/** True when the node is a tablist's element for a group that has no panels at all (a tab strip used as navigation). */
const noPanelsList = (node, ctx) => isTablist(node) && !node.hidden && tabsOf(node).length > 0 && !groupOf(node, ctx);

/** @param {UiNode} n */
export const rectOf = (n) => ({ l: n.x, t: n.y, r: n.x + n.w, b: n.y + n.h });

/**
 * Which side of the pages the tab bar sits on, from the measured boxes.
 * @param {UiNode} bar @param {UiNode[]} pages @param {UiNode} list
 * @returns {'top' | 'bottom' | 'left' | 'right'}
 */
function positionOf(bar, pages, list) {
  const measured = pages.filter((p) => p.w > 0 && p.h > 0);
  const tolerance = 2;
  if (measured.length) {
    const c = rectOf(measured[0]);
    const b = rectOf(bar);
    if (b.b <= c.t + tolerance) return 'top';
    if (b.t >= c.b - tolerance) return 'bottom';
    if (b.r <= c.l + tolerance) return 'left';
    if (b.l >= c.r - tolerance) return 'right';
  }
  return ariaOf(list, 'orientation') === 'vertical' ? 'left' : 'top';
}

/**
 * Where the buttons sit in the bar and the pages sit from the bar, all from the
 * measured boxes: the bar's padding (where the first and last button start),
 * the gap between buttons, the gap between the bar and the pages, and whether
 * the buttons split the bar equally (LVGL's own default, so no per-button width
 * is needed).
 * @param {{ bar: UiNode, buttons: UiNode[], content: { l: number, t: number, r: number, b: number } | null, position: 'top' | 'bottom' | 'left' | 'right' }} input
 */
export function tabviewGeometry({ bar, buttons, content, position }) {
  const vertical = position === 'left' || position === 'right';
  const b = rectOf(bar);
  const btnRects = buttons.map(rectOf);
  const border = (bar.styles?.borderWidth ?? 0) > 0 ? bar.styles.borderWidth : 0;
  const full = (bar.styles?.borderSide ?? 'full') === 'full' && border > 0;
  const sideBorder = (/** @type {string} */ side) => (full || bar.styles?.borderSide === side ? border : 0)
    + (bar.styles?.borderBottomWidth > 0 && side === 'bottom' && border === 0 ? bar.styles.borderBottomWidth : 0);
  const pad = {
    left: Math.max(0, Math.min(...btnRects.map((r) => r.l)) - b.l - sideBorder('left')),
    top: Math.max(0, Math.min(...btnRects.map((r) => r.t)) - b.t - sideBorder('top')),
    right: Math.max(0, b.r - Math.max(...btnRects.map((r) => r.r)) - sideBorder('right')),
    bottom: Math.max(0, b.b - Math.max(...btnRects.map((r) => r.b)) - sideBorder('bottom')),
  };
  const gap = content
    ? Math.max(0, { top: content.t - b.b, bottom: b.t - content.b, left: content.l - b.r, right: b.l - content.r }[position])
    : 0;
  const buttonGap = buttons.length > 1
    ? Math.max(0, vertical ? btnRects[1].t - btnRects[0].b : btnRects[1].l - btnRects[0].r)
    : 0;
  const sizes = btnRects.map((r) => (vertical ? r.b - r.t : r.r - r.l));
  const inner = (vertical ? b.b - b.t - pad.top - pad.bottom : b.r - b.l - pad.left - pad.right) - buttonGap * (buttons.length - 1);
  const fillBar = Math.max(...sizes) - Math.min(...sizes) <= 2 && Math.abs(sizes.reduce((a, x) => a + x, 0) - inner) <= 3;
  return { pad, gap, buttonGap, fillBar };
}

/** A copy without children, safe to keep as plain data. @param {UiNode} n @returns {UiNode} */
export const bare = (n) => ({ ...structuredClone({ ...n, children: [] }), children: [] });

/** The first Material UI indicator (a thin box) or similar inside the bar. @param {UiNode} bar @returns {UiNode | null} */
function findIndicator(bar) {
  return findNode(bar, (n) => n !== bar && n.children.length === 0 && !n.text && Boolean(n.styles?.bgColor)
    && (hasClass(n, 'MuiTabs-indicator') || (n.classes ?? []).some((c) => /indicator/i.test(c))) && n.w > 0 && n.h > 0);
}

/** @param {UiNode} tab @returns {boolean} */
const hasIcon = (tab) => Boolean(findNode(tab, (n) => n !== tab && (['svg', 'img', 'i'].includes(n.tag) || n.recognized?.component === 'icon')));

/** Which tab is open: aria-selected, then Mui-selected, else the first. @param {UiNode[]} tabs @returns {number} */
export function activeOf(tabs) {
  const byAria = tabs.findIndex((t) => ariaOf(t, 'selected') === 'true');
  if (byAria >= 0) return byAria;
  const byClass = tabs.findIndex((t) => hasClass(t, 'Mui-selected', 'active', 'selected'));
  return byClass >= 0 ? byClass : 0;
}

/** True when the node and everything in it carry no text: an empty box, an indicator, a ripple. @param {UiNode} n @returns {boolean} */
export const decorative = (n) => !n.text && (n.children ?? []).every(decorative);

/**
 * True when dropping `branch` and keeping only the `carried` nodes loses
 * nothing visible: along the way to them, every other sibling is decorative.
 * A hidden node nobody revealed is invisible anyway.
 * @param {UiNode} branch @param {UiNode[]} carried
 * @returns {boolean}
 */
function onlyDecorationBeside(branch, carried) {
  if (carried.includes(branch)) return true;
  if (branch.hidden && !branch.revealed) return true;
  if (!carried.some((c) => contains(branch, c))) return decorative(branch);
  if (branch.text) return false;
  return branch.children.every((c) => onlyDecorationBeside(c, carried));
}

/** @param {import('../recognize.mjs').RecognizeContext} ctx @param {UiNode} node @param {string} what @param {string} why @param {string} [fix] */
export function unsupported(ctx, node, what, why, fix = 'Convert it by hand, or restructure the markup so one element holds the role="tablist" and every role="tabpanel" it controls (aria-controls), with nothing else beside them.') {
  ctx.diagnostics.add({
    code: 'UNSUPPORTED_WIDGET',
    message: `${what}: ${why}`,
    fix,
    source: { selector: node.key },
  });
}

/** @type {import('../recognize.mjs').ComponentDef} */
const tabs = {
  name: 'tabs',
  match(node, ctx) {
    if (node.key && groupsOf(ctx).has(node.key)) return SCORE_SEMANTIC;
    // A tablist with no panels anywhere: matched only to explain why it stays buttons.
    if (noPanelsList(node, ctx)) return SCORE_SEMANTIC;
    return false;
  },
  props: {
    active: { type: 'number', default: 0 },
    position: { type: 'string', default: 'top' },
  },
  slots: ['tabs', 'panels'],
  build(node, ctx) {
    if (noPanelsList(node, ctx) && !groupsOf(ctx).has(node.key ?? '')) {
      unsupported(ctx, node, `tablist "${node.key}"`, 'no tabpanel was found for any of its tabs (the page content is elsewhere), so it stays a row of buttons instead of an lv_tabview');
      return null;
    }
    const group = groupFor(node, ctx);
    if (!group) {
      unsupported(ctx, node, `tabs "${node.key}"`, 'no role="tablist" with a findable tabpanel inside it, so the default mapping is kept');
      return null;
    }
    const { root, list, tabs: buttons, panels } = group;

    // The bar is the root's child that holds the tablist; the pages are the
    // panels themselves. Anything else the bar or a panel wrapper holds
    // would be lost, so refuse rather than drop it.
    const barBranch = root === list ? list : root.children.find((c) => contains(c, list));
    if (!barBranch) {
      unsupported(ctx, node, `tabs "${node.key}"`, 'the tablist is not inside the tabs container, so the default mapping is kept');
      return null;
    }
    if (!onlyDecorationBeside(barBranch, buttons)) {
      unsupported(ctx, node, `tabs "${node.key}"`, 'the tab bar holds more than the tabs (a toolbar, extra buttons or text), which lv_tabview cannot reproduce, so the default mapping is kept');
      return null;
    }
    const panelBranches = root.children.filter((c) => c !== barBranch && panels.some((p) => p && contains(c, p)));
    for (const branch of panelBranches) {
      const found = /** @type {UiNode[]} */ (panels.filter((p) => p && contains(branch, p)));
      if (!onlyDecorationBeside(branch, found)) {
        unsupported(ctx, node, `tabs "${node.key}"`, 'a panel wrapper holds content besides the tab panels, so the default mapping is kept');
        return null;
      }
    }

    const indicatorNode = findIndicator(barBranch);
    // The reference page: the open tab's panel (it is on screen, so its place is the real one).
    const measured = (p) => Boolean(p && p.w > 0 && p.h > 0);
    const first = (measured(panels[activeOf(buttons)]) ? panels[activeOf(buttons)] : panels.find(measured)) ?? null;

    // One page per tab. A panel with no measured box (hidden and never named
    // by aria-controls) is an empty page.
    let unmeasured = 0;
    const pages = buttons.map((tab, i) => {
      const panel = panels[i];
      if (panel && panel.w > 0 && panel.h > 0) return clearHidden(panel, first);
      unmeasured += 1;
      const ref = first ?? barBranch;
      return emptyPage(ref, `${node.key}~page${i + 1}`);
    });
    if (unmeasured) {
      unsupported(ctx, node, `tabs "${node.key}"`, `${unmeasured} tab panel(s) could not be measured (hidden and not named by aria-controls), so those tabs show an empty page`);
    }
    if (buttons.some(hasIcon)) {
      unsupported(ctx, node, `tabs "${node.key}"`, 'a tab holds an icon, but lv_tabview tab buttons show only a text label; the icon is dropped and the label kept');
    }

    const position = positionOf(barBranch, pages, list);
    const vertical = position === 'left' || position === 'right';
    const active = activeOf(buttons);

    const { pad, gap, buttonGap, fillBar } = tabviewGeometry({ bar: barBranch, buttons, content: first ? rectOf(first) : null, position });

    // A Material UI indicator becomes the open tab's underline (a border on
    // the side of the button that faces the pages' opposite edge).
    let indicator = null;
    if (indicatorNode) {
      const ind = rectOf(indicatorNode);
      const sel = rectOf(buttons[active]);
      const side = vertical
        ? (Math.abs(ind.l - sel.l) <= Math.abs(ind.r - sel.r) ? 'left' : 'right')
        : (Math.abs(ind.t - sel.t) <= Math.abs(ind.b - sel.b) ? 'top' : 'bottom');
      indicator = { color: /** @type {number[]} */ (indicatorNode.styles.bgColor), width: Math.max(1, Math.round(vertical ? indicatorNode.w : indicatorNode.h)), side };
    }

    /** @type {TabviewData} */
    const data = {
      active,
      position,
      gap,
      bar: { node: bare(barBranch), w: barBranch.w, h: barBranch.h, pad, gap: buttonGap },
      tabs: buttons.map((t) => ({ text: textOf(t), node: bare(t), link: t.link ?? null })),
      indicator,
      fillBar,
      synthetic: false,
    };

    const clean = root.children.every((c) => c === barBranch || panelBranches.includes(c) || (c.hidden && !c.revealed)) && !root.text;
    let result;
    if (clean) {
      // An author's own name (id, data-lv-name, a class) wins over the generic one.
      const named = { ...root, tag: 'div', text: null };
      result = { ...(ownName(named) ? named : withName(named, 'tabs')), children: pages, tabview: data };
    } else {
      // Other content shares the container: replace just the bar and the
      // panels with one tabview at the bar's place, sized to cover both.
      const u = [rectOf(barBranch), ...pages.filter((p) => p.w > 0).map(rectOf)];
      const union = { l: Math.min(...u.map((r) => r.l)), t: Math.min(...u.map((r) => r.t)), r: Math.max(...u.map((r) => r.r)), b: Math.max(...u.map((r) => r.b)) };
      data.synthetic = true;
      const holder = withName({
        ...barBranch,
        tag: 'div', id: null, className: null, lvName: root.lvName ? null : 'tabs', component: null, widget: null, link: null,
        role: null, aria: {}, classes: [], text: null, hidden: false, revealed: false, initiallyHidden: false,
        x: union.l, y: union.t, w: union.r - union.l, h: union.b - union.t,
        styles: { ...barBranch.styles, bgColor: null, gradient: null, shadow: null, borderWidth: 0, borderBottomWidth: 0, borderSide: undefined, radius: 0, opacity: 1, scrollable: false, pressed: null, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, overflowHidden: false, overflowVisible: false },
        layout: { ...barBranch.layout, display: 'block', flexGrow: 0 },
        children: pages,
        tabview: data,
        key: `${root.key}~tabs`,
      }, 'tabs');
      const dropped = new Set([barBranch, ...panelBranches]);
      const kids = [];
      for (const c of root.children) {
        if (c === barBranch) kids.push(holder);
        else if (!dropped.has(c)) kids.push(c);
      }
      result = { ...root, children: kids };
    }
    result.recognized = { component: 'tabs', props: { active, position } };
    return result;
  },
};

/**
 * A panel node that will be a tab page: shown, kept even though it was hidden,
 * and moved onto the reference page's origin. The extractor measures a closed
 * panel where it would sit with the OPEN panel still in the layout, which is
 * one panel lower; every page of a tabview is in the same place.
 * @param {UiNode} panel @param {UiNode | null} reference @returns {UiNode}
 */
function clearHidden(panel, reference) {
  const copy = structuredClone(panel);
  const dx = reference ? reference.x - panel.x : 0;
  const dy = reference ? reference.y - panel.y : 0;
  (function unhide(n) {
    n.hidden = false;
    n.revealed = false;
    n.x += dx;
    n.y += dy;
    for (const c of n.children ?? []) unhide(c);
  })(copy);
  copy.initiallyHidden = false;
  return copy;
}

/** An empty tab page the size of a reference box. @param {UiNode} ref @param {string} key @returns {UiNode} */
export function emptyPage(ref, key) {
  return {
    ...structuredClone({ ...ref, children: [] }),
    tag: 'div', id: null, className: null, lvName: null, component: null, widget: null, link: null,
    role: 'tabpanel', aria: {}, classes: [], text: null, attrs: {}, hidden: false, revealed: false, initiallyHidden: false, emptyTab: true,
    styles: { ...ref.styles, bgColor: null, gradient: null, shadow: null, borderWidth: 0, borderBottomWidth: 0, radius: 0, opacity: 1 },
    children: [], key,
  };
}

export default tabs;
