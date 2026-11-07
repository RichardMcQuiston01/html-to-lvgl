/**
 * App bar tabs: working tabs whose strip sits INSIDE an app bar and whose
 * panels are elsewhere on the page (Material UI `<AppBar><Toolbar/><Tabs/></AppBar>`
 * with the `tabpanel` elements further down, or a plain ARIA
 * `<header role="banner"> ... <div role="tablist"> ... </header><main>` followed
 * by `role="tabpanel"` sections). `tabs` (an lv_tabview) cannot
 * take this shape, because its container is the page and the tab bar holds a
 * toolbar, so it keeps the default boxes and reports UNSUPPORTED_WIDGET.
 *
 * Signal (score SCORE_SEMANTIC + 0.05, so it beats `tabs` on exactly this node
 * and never ties with it): the smallest element that holds a role="tablist" and
 * every tabpanel its tabs control (what `tabs` calls the group root), where an
 * ancestor of the tablist below that element is an app bar (the same signals
 * `appbar` uses: role="banner", a page-level `<header>`, MuiAppBar-root) and NO
 * panel is inside that app bar. Anything else (the tab strip with its panels in
 * a plain container, or a strip with no panels at all) is still `tabs`' or the
 * default mapping's, unchanged. The app bar itself is recognized as `appbar`
 * afterwards, as before: pinned (floating) when fixed or sticky, elevation,
 * toolbar and title untouched.
 *
 * What build() produces. The same tree, with three edits and no new widget:
 *   - the tablist node declares one int subject, "which tab is open", whose
 *     initial value is the tab that says aria-selected="true" (else Mui-selected,
 *     else the first),
 *   - every tab button gets `subject_set_int_event` (a tap stores its index),
 *     `bind_state_if_eq checked` (LVGL keeps it CHECKED while it is the open one)
 *     and `checkable` data, which src/emit-appbar-tabs.mjs turns into the button
 *     look for each state (text colour, opacity, the Material UI indicator as the
 *     open tab's underline),
 *   - every tabpanel gets `bind_flag_if_not_eq hidden` for its own index, and is
 *     moved onto the open panel's origin (the browser measured a closed panel one
 *     panel lower, with the open one still in the layout).
 *
 * Design choice, with numbers. Real LVGL v9.4.0 (512 KB heap, 320x240) renders of
 * real Material UI 9.5 `AppBar > Toolbar + Tabs` with three panels, compared with
 * the Chromium screenshot by scripts/fidelity.mjs ("within tolerance 32"). A and B
 * were written by hand for the same page, so the renderer and fonts are the same;
 * "core" is what the converter produced before this file.
 *
 *   design                                 open tab 0 / 1 / 2    heap (hand)  taps
 *   core only (static boxes)               94.7 / 94.5 / 94.9 %  29.7 KB      nothing switches
 *   A  one lv_tabview, bar restyled,       94.9 / 94.6 / 95.0 %  30.3 KB      switch
 *      toolbar a floating child of it
 *   B  buttons in the app bar, sibling     94.9 / 94.6 / 95.0 %  32.7 KB      switch   <- this file
 *      panels, an int subject
 *   (B as the converter now emits it)                            34.9 KB (core 29.7 KB)
 *
 * Fidelity cannot separate A from B (the renders match pixel for pixel, and both
 * are only about 0.1 point above core, which already drew the open tab right);
 * what changes is that the tabs work. The decision rests on what each can express:
 *   - A needs the tabview to contain the toolbar, the strip and the pages, so the
 *     app bar stops being one box (its toolbar becomes a floating child at a
 *     negative y, its elevation moves to the tab bar), a fixed or sticky app bar
 *     cannot be pinned by itself, and anything between the app bar and the panels
 *     (a heading, other content in `<main>`) falls inside the tabview rectangle
 *     and is lost. B changes none of that: the app bar, the panels and whatever
 *     sits between them are the boxes they always were (checked on a sticky
 *     banner with a heading between it and the panels, and on a fixed MUI bar).
 *   - A's tab buttons hold one text label (tabs.mjs drops icons); B's are ordinary
 *     buttons, so an icon-over-label tab keeps its icon (fidelity 94.0 -> 95.1 % on
 *     a three-icon-tab page). The swipe-between-pages scrolling of lv_tabview is
 *     not Material UI's behavior either.
 *   - B costs 2.4 KB more heap than A on this page (one observer per bind and a
 *     `:checked` style set per button) and needs state binds, which Phase 8's IR
 *     lacked (`bindState`, added in src/behavior.mjs, with the C and MicroPython
 *     emitters).
 *   - The hybrid (a tabview used only as the strip, panels outside) cannot be
 *     expressed: lv_tabview has no value subject and XML has no tabview change
 *     event, so panel switching would need application code.
 * Both work in all four output formats; B on the pinned MicroPython binding uses
 * `obj.bind_state_if_eq` (present in the binary, probed) and the event-callback
 * stand-in for the set event that Phase 8 already generates.
 *
 * Limits (each reported or documented, none silent):
 *   - A tab panel the extractor could not measure (hidden and not named by
 *     aria-controls, or an unmounted React panel: the common MUI TabPanel renders
 *     `{value === index && children}`) shows nothing when its tab is open
 *     (UNSUPPORTED_WIDGET warning). Render all panels, hidden, to convert them.
 *   - Scrolling tab strips (`variant="scrollable"`) lose their scroll arrows and
 *     the overflowing tabs stay clipped.
 *   - One tablist per container, as for `tabs`: the first wins.
 */
import { SCORE_SEMANTIC } from './shared.mjs';
import { ancestorsOf, findNode } from './overlay.mjs';
import { appbarScore } from './appbar.mjs';
import { activeOf, bare, clearHidden, contains, findIndicator, groupOf, groupsOf, isTablist, rectOf, unsupported } from './tabs.mjs';
import { bindState, declareSubject, hiddenWhen, setEvent, subjectFor, withBehavior } from '../behavior.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */
/** @typedef {import('./tabs.mjs').TabGroup} TabGroup */

/** Just above `tabs`' score, so this wins on the one shape it claims (see the module comment). */
export const SCORE_APPBAR_TABS = SCORE_SEMANTIC + 0.05;

/**
 * What the emitter needs on each tab button to draw both states (see
 * src/emit-appbar-tabs.mjs).
 * @typedef {object} CheckableTab
 * @property {UiNode} selected     Childless copy of the open tab (its box and text styles are the CHECKED look).
 * @property {UiNode} unselected   Childless copy of a tab that is not open (the normal look).
 * @property {{ color: number[], width: number, side: 'top' | 'bottom' } | null} indicator
 *   The Material UI underline, drawn as the open tab's border.
 */

/**
 * The tab group of a node, or null: the group whose root is the node, or, when
 * the person forced `data-lv-widget="appbar-tabs"`, the first tablist inside it.
 * @param {UiNode} node @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {TabGroup | null}
 */
function groupFor(node, ctx) {
  const known = node.key ? groupsOf(ctx).get(node.key) : undefined;
  if (known) return known;
  if (node.widget !== 'appbar-tabs') return null;
  const list = findNode(node, isTablist);
  return list ? groupOf(list, ctx) : null;
}

/**
 * The element that will be recognized as the app bar and holds the tablist,
 * provided no panel is inside it. Null for any other shape.
 * @param {TabGroup} group @param {import('../recognize.mjs').RecognizeContext} ctx
 * @returns {UiNode | null}
 */
function appbarOf(group, ctx) {
  const chain = ancestorsOf(ctx.tree, group.list) ?? [];
  const rootAt = chain.findIndex((a) => a === group.root || (a.key !== undefined && a.key === group.root.key));
  if (rootAt < 0) return null;
  // Outermost first: a bar that holds the strip in a nested toolbar is still the bar.
  for (let i = rootAt + 1; i < chain.length; i += 1) {
    if (appbarScore(chain[i], { ...ctx, parent: chain[i - 1] }) <= 0) continue;
    const bar = chain[i];
    const panelsInside = group.panels.some((p) => p && contains(bar, p));
    return panelsInside ? null : bar;
  }
  return null;
}

/**
 * The local subject name for a group's "open tab" state. An author's own name
 * (id, data-lv-name) wins, as everywhere; otherwise a short ordinal name, since
 * a path key such as body/div[0]/div[0]/header[0]/... would make a 60-character
 * identifier in the generated code.
 * @param {TabGroup} group @param {import('../recognize.mjs').RecognizeContext} ctx
 */
function subjectNameOf(group, ctx) {
  if (group.list.lvName || group.list.id) return subjectFor(group.list, 'selected');
  const ours = [...groupsOf(ctx).values()].filter((g) => appbarOf(g, ctx));
  const ordinal = ours.findIndex((g) => g.list.key === group.list.key) + 1;
  return ordinal > 1 ? `appbar_tabs_${ordinal}_selected` : 'appbar_tabs_selected';
}

/** @param {UiNode} tab @returns {boolean} */
const hasIcon = (tab) => Boolean(findNode(tab, (n) => n !== tab && (['svg', 'img', 'i'].includes(n.tag) || n.recognized?.component === 'icon')));

/** @type {import('../recognize.mjs').ComponentDef} */
const appbarTabs = {
  name: 'appbar-tabs',
  match(node, ctx) {
    const group = groupFor(node, ctx);
    return group && appbarOf(group, ctx) ? SCORE_APPBAR_TABS : false;
  },
  props: {
    active: { type: 'number', default: 0 },
  },
  slots: ['appbar', 'panels'],
  build(node, ctx) {
    const group = groupFor(node, ctx);
    const appbar = group ? appbarOf(group, ctx) : null;
    if (!group || !appbar) {
      unsupported(ctx, node, `appbar tabs "${node.key}"`, 'no app bar holding a role="tablist" with every tabpanel outside it, so the default mapping is kept',
        'Put the role="tablist" inside the app bar (role="banner", <header>, MuiAppBar) and every role="tabpanel" it controls outside the bar, or drop data-lv-widget="appbar-tabs".');
      return null;
    }
    const { list, tabs: buttons, panels } = group;
    const active = activeOf(buttons);
    const subject = subjectNameOf(group, ctx);

    // The panel the browser had open is where every panel belongs: it is on
    // screen, so its place is the real one.
    const measured = (/** @type {UiNode | null} */ p) => Boolean(p && p.w > 0 && p.h > 0);
    const reference = (measured(panels[active]) ? panels[active] : panels.find(measured)) ?? null;
    const unmeasured = panels.filter((p) => p && !measured(p)).length;
    if (unmeasured) {
      unsupported(ctx, node, `appbar tabs "${node.key}"`, `${unmeasured} tab panel(s) could not be measured (hidden and not named by aria-controls, or never rendered), so those tabs show nothing`,
        'Render every tabpanel, hidden, with aria-controls on its tab, so each panel has content to show.');
    }
    if (buttons.some(hasIcon)) {
      unsupported(ctx, node, `appbar tabs "${node.key}"`, 'a tab holds an icon; it is kept in the button, but keeps the colour it had when the page loaded in both states (only the button\'s opacity follows the open tab)',
        'Use a text-only tab if the icon colour must follow the open state.');
    }

    // The Material UI indicator is one absolutely placed box that follows the
    // open tab; as a loose box it would stay put when another tab opens. It
    // becomes the open tab's underline (a border on the checked button).
    const indicatorNode = findIndicator(appbar);
    /** @type {CheckableTab['indicator']} */
    let indicator = null;
    if (indicatorNode) {
      const ind = rectOf(indicatorNode);
      const sel = rectOf(buttons[active]);
      indicator = {
        color: /** @type {number[]} */ (indicatorNode.styles.bgColor),
        width: Math.max(1, Math.round(indicatorNode.h)),
        side: Math.abs(ind.t - sel.t) < Math.abs(ind.b - sel.b) ? 'top' : 'bottom',
      };
    }
    /** @type {CheckableTab} */
    const checkable = {
      selected: bare(buttons[active]),
      unselected: bare(buttons.find((_, i) => i !== active) ?? buttons[active]),
      indicator,
    };

    const tabAt = new Map(buttons.map((b, i) => [b.key, i]));
    /** @type {Map<string | undefined, number>} */
    const panelAt = new Map();
    panels.forEach((p, i) => { if (p && !panelAt.has(p.key)) panelAt.set(p.key, i); });

    /** @param {UiNode} n @returns {UiNode | null} */
    const rewrite = (n) => {
      if (indicatorNode && n.key === indicatorNode.key) return null;
      if (panelAt.has(n.key)) {
        const i = /** @type {number} */ (panelAt.get(n.key));
        return withBehavior(clearHidden(n, reference), { binds: [hiddenWhen(subject, 'not_eq', i)] });
      }
      const kids = n.children.map(rewrite).filter((c) => c !== null);
      let out = { ...n, children: /** @type {UiNode[]} */ (kids) };
      if (tabAt.has(n.key)) {
        const i = /** @type {number} */ (tabAt.get(n.key));
        out = withBehavior({ ...out, checkable }, { events: [setEvent(subject, i)], binds: [bindState(subject, 'checked', 'eq', i)] });
      }
      // Declared once, on the strip every tab belongs to.
      if (n.key === list.key) out = withBehavior(out, { subjects: [declareSubject(subject, active)] });
      return out;
    };

    const rewritten = /** @type {UiNode} */ (rewrite(node));
    return { ...rewritten, recognized: { component: 'appbar-tabs', props: { active } } };
  },
};

export default appbarTabs;
