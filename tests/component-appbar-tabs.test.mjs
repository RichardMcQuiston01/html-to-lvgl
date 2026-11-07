/**
 * Tabs inside an app bar (src/components/appbar-tabs.mjs): matching (only the
 * AppBar > tablist + panels-outside shape, never a tie with `tabs` or `appbar`),
 * what build() attaches (the open tab as an int subject, a set event and a
 * CHECKED bind per tab button, a hidden bind per panel), what it refuses or
 * warns about, and convert() output in XML, C and MicroPython. Nodes are hand
 * built in the extractor's shape (aria keys without "aria-").
 *
 * The click-driven check in real LVGL is spike/subjects/run-appbar-tabs.sh, which
 * drives tests/golden-behavior/tabs-appbar*.xml and the generated C, C++ and
 * MicroPython (compared here too).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import appbarTabs, { SCORE_APPBAR_TABS } from '../src/components/appbar-tabs.mjs';
import appbar from '../src/components/appbar.mjs';
import tabs from '../src/components/tabs.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { emitC } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { bindState, behaviorElements, qualifyBehavior, isBehaviorElement, BEHAVIOR_TAGS } from '../src/behavior.mjs';
import { node as baseNode } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const node = (tag, extra = {}, children = []) => baseNode(tag, extra, children);

const BAR_BG = [25, 118, 210, 255];
const tab = (i, selected) => node('button', {
  id: `t${i}`, role: 'tab', text: `Tab ${i}`, aria: { selected: String(selected), controls: `p${i}` },
  x: i * 100, y: 48, w: 100, h: 48, styles: { color: [255, 255, 255, 255], opacity: selected ? 1 : 0.6 },
});
/** A panel; `open` is on screen, the others are hidden and were measured one panel lower. */
const panel = (i, open, extra = {}) => node('div', {
  id: `p${i}`, role: 'tabpanel', text: `Panel ${i}`, aria: { labelledby: `t${i}` },
  x: 0, y: open ? 96 : 96 + 40, w: 300, h: 40,
  ...(open ? {} : { hidden: true, revealed: true }), ...extra,
});

/**
 * A page: an app bar (a toolbar row and a tablist) and a main holding the panels.
 * @param {{ selected?: number, barExtra?: object, panels?: object[], strip?: object[], main?: boolean, headerTag?: string }} [o]
 */
function pageTree({ selected = 1, barExtra = { role: 'banner' }, panels = [0, 1, 2].map((i) => panel(i, i === selected)), strip = null, main = true, headerTag = 'header' } = {}) {
  const buttons = strip ?? [0, 1, 2].map((i) => tab(i, i === selected));
  const list = node('div', { role: 'tablist', x: 0, y: 48, w: 300, h: 48, layout: { display: 'flex', flexDirection: 'row' } }, buttons);
  const bar = node(headerTag, { x: 0, y: 0, w: 300, h: 96, styles: { bgColor: BAR_BG, shadow: { color: [0, 0, 0, 31], blur: 10, x: 0, y: 1, spread: 0 } }, ...barExtra }, [
    node('div', { x: 0, y: 0, w: 300, h: 48 }, [node('h6', { text: 'Dashboard', x: 16, y: 14, w: 90, h: 20 })]),
    list,
  ]);
  const body = main ? node('main', { x: 0, y: 96, w: 300, h: 130 }, panels) : null;
  const page = node('div', { id: 'page', x: 0, y: 0, w: 300, h: 240, styles: { bgColor: [250, 250, 250, 255] } }, body ? [bar, body] : [bar, ...panels]);
  return node('body', { w: 320, h: 240 }, [page]);
}

const all = () => createRegistry([appbar, tabs, appbarTabs]);
const run = (tree, registry = all()) => {
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(structuredClone(tree), { registry, diagnostics });
  return { out, diagnostics, page: out.children[0] };
};
const codes = (d) => d.list().map((e) => e.code);
/** Every node in the tree, depth first. */
const flat = (n) => [n, ...n.children.flatMap(flat)];
const byId = (root, id) => flat(root).find((n) => n.id === id);

test('appbar-tabs is a valid definition with honest props and slots, registered after tabs', () => {
  assert.deepEqual(validateComponent(appbarTabs), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(appbarTabs));
  assert.ok(builtinComponents.indexOf(appbarTabs) > builtinComponents.indexOf(tabs));
  assert.deepEqual(Object.keys(appbarTabs.props), ['active']);
  assert.deepEqual(appbarTabs.slots, ['appbar', 'panels']);
  assert.equal(SCORE_APPBAR_TABS, 1.05, 'just above tabs, so it wins on this one shape and never ties');
});

test('an app bar holding the tablist with the panels outside it is claimed by appbar-tabs, not tabs, with no ambiguity', () => {
  const { page, diagnostics } = run(pageTree());
  assert.equal(page.recognized.component, 'appbar-tabs');
  assert.equal(page.tabview, undefined, 'no lv_tabview');
  assert.deepEqual(codes(diagnostics), [], 'no UNSUPPORTED_WIDGET and no RECOGNIZER_AMBIGUOUS');
});

test('the app bar is still recognized as appbar (role=banner, MuiAppBar-root, a page-level header)', () => {
  assert.equal(run(pageTree()).page.children[0].recognized.component, 'appbar');
  const mui = pageTree({ barExtra: { classes: ['MuiPaper-root', 'MuiAppBar-root', 'MuiAppBar-positionStatic'] } });
  const out = run(mui);
  assert.equal(out.page.recognized.component, 'appbar-tabs');
  assert.equal(out.page.children[0].recognized.component, 'appbar');
  assert.equal(out.page.children[0].recognized.props.position, 'static');
  // A bare <header> that is a direct child of the page root is a page header too.
  const bare = node('body', { w: 320, h: 240 }, pageTree({ barExtra: {} }).children[0].children);
  const bareRun = run(bare);
  assert.equal(bareRun.out.recognized.component, 'appbar-tabs');
  assert.equal(bareRun.out.children[0].recognized.component, 'appbar');
});

test('near misses: a header that is a section heading, no panels, panels inside the bar, or no app bar at all are not appbar-tabs', () => {
  // <header> deep inside an article is that section's heading, not the page's bar.
  const inArticle = pageTree({ barExtra: {} });
  const page = inArticle.children[0];
  page.children = [node('article', { x: 0, y: 0, w: 300, h: 240 }, page.children)];
  assert.notEqual(run(inArticle).page.children[0].recognized?.component, 'appbar-tabs');
  assert.equal(codes(run(inArticle).diagnostics).includes('RECOGNIZER_AMBIGUOUS'), false);

  // A strip with no panels anywhere: tabs reports it, nothing changes.
  const noPanels = pageTree({ main: false, panels: [] });
  const none = run(noPanels);
  assert.notEqual(none.page.recognized?.component, 'appbar-tabs');
  assert.equal(none.page.behavior, undefined);
  assert.ok(none.diagnostics.list().some((e) => e.code === 'UNSUPPORTED_WIDGET' && /no tabpanel was found/.test(e.message)));

  // Every panel INSIDE the bar: that is tabs' shape, not this one.
  const inside = pageTree({ main: false, panels: [] });
  inside.children[0].children[0].children[0].children.push(...[0, 1, 2].map((i) => panel(i, i === 1, { y: 60 })));
  assert.notEqual(run(inside).page.recognized?.component, 'appbar-tabs');

  // Tabs and panels in a plain container with no app bar: tabs keeps them, byte for byte as before.
  const plain = pageTree({ barExtra: { role: null }, headerTag: 'div' });
  const plainOut = run(plain);
  assert.notEqual(plainOut.page.recognized?.component, 'appbar-tabs');
});

test('a plain AppBar without tabs is unaffected', () => {
  const bar = node('header', { role: 'banner', x: 0, y: 0, w: 300, h: 48, styles: { bgColor: BAR_BG } }, [node('h6', { text: 'Title', w: 60, h: 20 })]);
  const tree = node('body', { w: 320, h: 240 }, [node('div', { id: 'page', w: 300, h: 240 }, [bar, node('p', { text: 'x', y: 60 })])]);
  const out = run(tree);
  assert.equal(out.page.recognized, undefined);
  assert.equal(out.page.children[0].recognized.component, 'appbar');
  assert.equal(out.page.behavior, undefined);
  assert.deepEqual(codes(out.diagnostics), []);
});

test('the open tab comes from aria-selected, then Mui-selected, then the first tab (the subject starts there)', () => {
  const initialOf = (tree) => flat(run(tree).page).find((n) => n.role === 'tablist').behavior.subjects[0].initial;
  assert.equal(initialOf(pageTree({ selected: 2 })), 2);
  assert.equal(initialOf(pageTree({ selected: 0 })), 0, 'the first tab can be the open one');
  const mui = pageTree();
  const buttons = flat(mui).filter((n) => n.role === 'tab');
  buttons.forEach((b) => { b.aria = { controls: b.aria.controls }; b.classes = b.id === 't2' ? ['Mui-selected'] : []; });
  assert.equal(initialOf(mui), 2);
  buttons.forEach((b) => { b.classes = []; });
  assert.equal(initialOf(mui), 0, 'nothing says selected: the first tab');
});

test('each tab sets the subject to its index and is CHECKED while it is the open one; each panel hides unless it is', () => {
  const { page } = run(pageTree({ selected: 1 }));
  const subject = 'appbar_tabs_selected';
  const list = flat(page).find((n) => n.role === 'tablist');
  assert.deepEqual(list.behavior.subjects, [{ name: subject, type: 'int', initial: 1 }], 'declared once, on the strip');
  const buttons = flat(page).filter((n) => n.role === 'tab');
  assert.equal(buttons.length, 3);
  buttons.forEach((b, i) => {
    assert.deepEqual(b.behavior.events, [{ kind: 'set', subject, value: i }]);
    assert.deepEqual(b.behavior.binds, [{ kind: 'state', subject, state: 'checked', op: 'eq', ref: i }]);
    assert.equal(b.behavior.subjects, undefined, 'only the strip declares');
  });
  [0, 1, 2].forEach((i) => {
    assert.deepEqual(byId(page, `p${i}`).behavior.binds, [{ kind: 'flag', subject, flag: 'hidden', op: 'not_eq', ref: i }]);
  });
});

test('hidden panels are kept and moved onto the open panel\'s origin, so every tab shows its panel in the same place', () => {
  const { page } = run(pageTree({ selected: 1 }));
  for (const i of [0, 1, 2]) {
    const p = byId(page, `p${i}`);
    assert.equal(p.hidden, false);
    assert.equal(p.initiallyHidden, false);
    assert.equal(p.y, 96, `p${i} sits where the open panel does, not one panel lower`);
  }
});

test('a tab button carries checkable data: an open copy, a closed copy and the Material UI indicator as an underline', () => {
  const tree = pageTree({ selected: 1 });
  const strip = flat(tree).find((n) => n.role === 'tablist');
  strip.children.push(node('span', { classes: ['MuiTabs-indicator'], x: 100, y: 94, w: 100, h: 2, styles: { bgColor: [156, 39, 176, 255] } }));
  const { page } = run(tree);
  const list = flat(page).find((n) => n.role === 'tablist');
  assert.equal(list.children.some((c) => c.classes?.includes('MuiTabs-indicator')), false, 'the loose indicator box would not follow the open tab, so it is dropped');
  const button = byId(page, 't0');
  assert.equal(button.checkable.selected.id, 't1');
  assert.equal(button.checkable.unselected.id, 't0');
  assert.deepEqual(button.checkable.indicator, { color: [156, 39, 176, 255], width: 2, side: 'bottom' });
  assert.deepEqual(byId(page, 't2').checkable, button.checkable, 'one look for the whole strip');
});

test('a tab panel that could not be measured, and a tab icon, are reported', () => {
  const unmeasured = run(pageTree({ panels: [panel(0, false, { w: 0, h: 0 }), panel(1, true), panel(2, false, { w: 0, h: 0 })] }));
  assert.equal(unmeasured.page.recognized.component, 'appbar-tabs', 'still converted');
  const entry = unmeasured.diagnostics.list().find((e) => e.code === 'UNSUPPORTED_WIDGET');
  assert.ok(entry);
  assert.match(entry.message, /2 tab panel\(s\) could not be measured/);
  assert.equal(entry.severity, 'warning');

  const withIcon = pageTree();
  flat(withIcon).find((n) => n.id === 't0').children = [node('svg', { w: 16, h: 16 })];
  const iconRun = run(withIcon);
  assert.ok(iconRun.diagnostics.list().some((e) => e.code === 'UNSUPPORTED_WIDGET' && /icon/.test(e.message)));
  assert.equal(iconRun.page.recognized.component, 'appbar-tabs');
});

test('the subject name: an own id wins, otherwise short ordinal names so two tab sets on one page differ', () => {
  const first = pageTree();
  const named = pageTree();
  flat(named).find((n) => n.role === 'tablist').id = 'sections';
  assert.equal(flat(run(named).page).find((n) => n.role === 'tablist').behavior.subjects[0].name, 'sections_selected');
  assert.equal(flat(run(first).page).find((n) => n.role === 'tablist').behavior.subjects[0].name, 'appbar_tabs_selected');

  // two groups under one body: ids differ, each group's root is its own wrapper
  const g = (suffix, y) => {
    const t = pageTree().children[0];
    flat(t).forEach((n) => { if (n.id) n.id = `${n.id}${suffix}`; if (n.aria?.controls) n.aria = { ...n.aria, controls: `${n.aria.controls}${suffix}` }; if (n.aria?.labelledby) n.aria = { ...n.aria, labelledby: `${n.aria.labelledby}${suffix}` }; });
    flat(t).forEach((n) => { n.y += y; });
    t.id = `page${suffix}`;
    return t;
  };
  const two = node('body', { w: 320, h: 480 }, [g('a', 0), g('b', 250)]);
  const names = flat(run(two).out).filter((n) => n.role === 'tablist').map((n) => n.behavior.subjects[0].name);
  assert.deepEqual(names, ['appbar_tabs_selected', 'appbar_tabs_2_selected']);
});

test('data-lv-widget="appbar-tabs" on a shape it cannot take is reported and leaves the default mapping', () => {
  const t = pageTree({ main: false, panels: [] });
  t.children[0].widget = 'appbar-tabs';
  const { page, diagnostics } = run(t);
  assert.equal(page.behavior, undefined);
  const entry = diagnostics.list().find((e) => e.code === 'UNSUPPORTED_WIDGET' && /appbar tabs/.test(e.message));
  assert.ok(entry);
  assert.match(entry.fix, /role="tablist" inside the app bar/);
});

/* ---------------------------------------------------------------- behavior IR: state binds */

test('bindState builds a state bind, validates its input and shows up as bind_state_if_<op> elements', () => {
  assert.deepEqual(bindState('s', 'checked', 'eq', 2), { kind: 'state', subject: 's', state: 'checked', op: 'eq', ref: 2 });
  assert.throws(() => bindState('s', 'checked', 'near', 2), /op must be one of/);
  assert.throws(() => bindState('s', 'sparkly', 'eq', 2), /state must be one of/);
  assert.throws(() => bindState('s', 'checked', 'eq', 1.5), /integer/);
  const q = qualifyBehavior({ binds: [bindState('s', 'checked', 'eq', 2)] }, 'home');
  const [element] = behaviorElements(q);
  assert.equal(element.tag, 'bind_state_if_eq');
  assert.deepEqual(element.attrs, { subject: 'home_s', state: 'checked', ref_value: 2 });
  assert.ok(BEHAVIOR_TAGS.has('bind_state_if_not_eq'));
  assert.ok(isBehaviorElement(element), 'the C and Python emitters skip it and render meta.behavior instead');
});

/* ---------------------------------------------------------------- output */

const convertPage = (tree, name = 'demo') => convert(structuredClone(tree), { name, screenMode: true });

test('XML: the set event, the CHECKED bind and the hidden bind, with the checked look on the button and none on the label', () => {
  const { xml, globalsXml, subjects } = convertPage(pageTree({ selected: 1 }));
  assert.deepEqual(subjects, [{ name: 'demo_appbar_tabs_selected', type: 'int', initial: 1 }]);
  assert.match(globalsXml, /<int name="demo_appbar_tabs_selected" value="1"\/>/);
  assert.equal((xml.match(/<subject_set_int_event subject="demo_appbar_tabs_selected" value="\d"/g) ?? []).length, 3);
  assert.equal((xml.match(/<bind_state_if_eq subject="demo_appbar_tabs_selected" state="checked" ref_value="\d"/g) ?? []).length, 3);
  assert.equal((xml.match(/<bind_flag_if_not_eq subject="demo_appbar_tabs_selected" flag="hidden" ref_value="\d"/g) ?? []).length, 3);
  const button = xml.split('\n').find((l) => l.includes('<lv_button name="t0"'));
  // The text style is on the button, so the label inherits it in either state.
  assert.match(button, /style_text_color="0xffffff"/);
  assert.match(button, /style_text_font="/);
  // Restated for CHECKED: the theme's CHECKED style sets a teal background AND white text.
  assert.match(button, /style_text_color:checked="0xffffff"/);
  // MUI's 60% on the unchecked tab returns to opaque when the tab is open.
  assert.match(button, /style_opa="153"/);
  assert.match(button, /style_opa:checked="255"/);
  const label = xml.split('\n').find((l) => l.includes('<lv_label name="t0_2"'));
  assert.doesNotMatch(label, /style_text_color|style_text_font/);
});

test('XML: a Material UI indicator is the open tab\'s underline, as a bottom border for the CHECKED state only', () => {
  const tree = pageTree({ selected: 1 });
  flat(tree).find((n) => n.role === 'tablist').children.push(node('span', { classes: ['MuiTabs-indicator'], x: 100, y: 94, w: 100, h: 2, styles: { bgColor: [156, 39, 176, 255] } }));
  const { xml } = convertPage(tree);
  const button = xml.split('\n').find((l) => l.includes('<lv_button name="t2"'));
  assert.match(button, /style_border_width="0"/);
  assert.match(button, /style_border_width:checked="2"/);
  assert.match(button, /style_border_color:checked="0x9c27b0"/);
  assert.match(button, /style_border_side:checked="bottom"/);
  assert.equal(xml.includes('indicator'), false, 'no loose indicator box');
});

test('a tab with an icon is a flex box: the flow is stated and reversed when the icon was above the label', () => {
  const tree = pageTree();
  const strip = flat(tree).find((n) => n.role === 'tablist');
  for (const b of strip.children) {
    b.layout = { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', rowGap: 0, columnGap: 0 };
    b.children = [node('svg', { x: b.x + 40, y: b.y + 6, w: 20, h: 20, styles: { color: [255, 255, 255, 255] } })];
  }
  const { xml } = convertPage(tree);
  const button = xml.split('\n').find((l) => l.includes('<lv_button name="t0"'));
  assert.match(button, /flex_flow="column_reverse"/, 'LVGL\'s label is the first child, so the icon above it needs the reversed flow');
  const label = xml.split('\n').find((l) => l.includes('<lv_label name="t0_2"'));
  assert.doesNotMatch(label, /align="/, 'a flex child is placed by the flow, not aligned');
});

test('a fixed or sticky app bar stays pinned (floating) and the panels stay ordinary boxes', () => {
  const tree = pageTree({ barExtra: { role: 'banner', layout: { position: 'fixed' } } });
  const { xml } = convertPage(tree);
  const appbarLine = xml.split('\n').find((l) => l.includes('name="appbar"'));
  assert.match(appbarLine, /floating="true"/);
  const panelLine = xml.split('\n').find((l) => l.includes('name="p0"'));
  assert.doesNotMatch(panelLine, /floating/);
});

test('C and MicroPython: lv_obj_bind_state_if_eq and obj.bind_state_if_eq, plus the existing set and hidden binds', () => {
  const { view, subjects } = convertPage(pageTree({ selected: 1 }));
  const c = emitC(view, { name: 'demo', symbol: 'ui_demo_create', subjects }).c;
  assert.match(c, /lv_obj_bind_state_if_eq\(t0, &subject_demo_appbar_tabs_selected, LV_STATE_CHECKED, 0\);/);
  assert.match(c, /lv_obj_add_subject_set_int_event\(t2, &subject_demo_appbar_tabs_selected, LV_EVENT_CLICKED, 2\);/);
  assert.match(c, /lv_obj_bind_flag_if_not_eq\(p1, &subject_demo_appbar_tabs_selected, LV_OBJ_FLAG_HIDDEN, 1\);/);
  assert.match(c, /lv_obj_set_style_text_color\(t0, lv_color_hex\(0xffffff\), LV_STATE_CHECKED\);/);
  const py = emitPy(view, { name: 'demo', symbol: 'ui_demo_create' }).py;
  assert.match(py, /t0\.bind_state_if_eq\(subjects\["demo_appbar_tabs_selected"\], lv\.STATE\.CHECKED, 0\)/);
  assert.match(py, /t2\.add_event_cb\(_set_subject\(subjects\["demo_appbar_tabs_selected"\], 2\), lv\.EVENT\.CLICKED, None\)/);
  assert.match(py, /p1\.bind_flag_if_not_eq\(subjects\["demo_appbar_tabs_selected"\], lv\.obj\.FLAG\.HIDDEN, 1\)/);
});

/* ---------------------------------------------------------------- goldens */

for (const name of ['tabs-appbar', 'tabs-appbar-mui']) {
  test(`golden: the ${name} fixture converts to the committed XML, globals.xml, C, C++ and MicroPython`, () => {
    const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior', `${name}.json`), 'utf8'));
    const { xml, globalsXml, view, subjects } = convert(tree, { name, screenMode: true });
    const golden = (file) => readFileSync(join(here, 'golden-behavior', file), 'utf8');
    assert.equal(xml, golden(`${name}.xml`));
    assert.equal(globalsXml, golden(`${name}.globals.xml`));
    const unit = name.replace(/-/g, '_');
    const opts = { name: unit, symbol: `ui_${unit}_create`, subjects };
    assert.equal(emitC(view, opts).c, golden(`ui_${unit}.c`));
    assert.equal(emitPy(view, opts).py, golden(`ui_${unit}.py`));
  });
}

test('the plain fixture holds two tab sets with different open tabs and the Material UI one a later open tab', () => {
  const plain = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'tabs-appbar.json'), 'utf8'));
  assert.deepEqual(convert(plain, { name: 'tabs-appbar', screenMode: true }).subjects.map((s) => s.initial), [1, 1]);
  const mui = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'tabs-appbar-mui.json'), 'utf8'));
  const { subjects, xml } = convert(mui, { name: 'tabs-appbar-mui', screenMode: true });
  assert.deepEqual(subjects.map((s) => s.initial), [2]);
  assert.match(xml, /floating="true"/, 'the fixed app bar is pinned');
});
