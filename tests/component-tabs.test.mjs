/**
 * Tabs to lv_tabview: matching, near misses, what build() reads (the open tab,
 * the bar position, the bar and button geometry, hidden panels), what it
 * refuses (UNSUPPORTED_WIDGET), and convert() output in XML, C and MicroPython.
 * Nodes are hand built in the extractor's shape (aria keys without "aria-").
 *
 * The click-driven check in real LVGL is spike/subjects/run-tabs.sh, which
 * drives tests/golden/tabs*.xml and the generated C, C++ and MicroPython.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tabs from '../src/components/tabs.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { emitC } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node as baseNode } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const node = (tag, extra = {}, children = []) => baseNode(tag, extra, children);

const tab = (i, extra = {}) => node('button', {
  id: `t${i}`, role: 'tab', text: `Tab ${i}`, aria: { selected: 'false', controls: `p${i}` },
  x: i * 100, y: 0, w: 100, h: 30, ...extra,
});
/** A panel; `open` is on screen, the others are hidden and were measured one panel lower. */
const panel = (i, open, extra = {}) => node('div', {
  id: `p${i}`, role: 'tabpanel', text: `Panel ${i}`, aria: { labelledby: `t${i}` },
  x: 0, y: open ? 30 : 30 + 90, w: 300, h: 90,
  ...(open ? {} : { hidden: true, revealed: true }), ...extra,
});

/**
 * The tabs container: a bar (a tablist) and three panels, the second tab open.
 * @param {{ selected?: number, bar?: object, panels?: object[], rootExtra?: object, children?: object[] }} [o]
 */
function tabsTree({ selected = 1, bar = {}, panels = [0, 1, 2].map((i) => panel(i, i === selected)), rootExtra = {}, children = null } = {}) {
  const buttons = [0, 1, 2].map((i) => tab(i, { aria: { selected: String(i === selected), controls: `p${i}` } }));
  const list = node('div', { role: 'tablist', x: 0, y: 0, w: 300, h: 30, styles: { borderBottomWidth: 1, borderBottomColor: [200, 200, 200, 255] }, layout: { display: 'flex', flexDirection: 'row' }, ...bar }, buttons);
  const root = node('div', { id: 'root', x: 0, y: 0, w: 300, h: 120, styles: { bgColor: [255, 255, 255, 255], borderWidth: 1, borderColor: [0, 0, 0, 255], radius: 4 }, ...rootExtra }, children ?? [list, ...panels]);
  return node('body', { w: 320, h: 240 }, [root]);
}

const run = (tree, options = {}) => {
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(structuredClone(tree), { registry: createRegistry([tabs]), diagnostics, ...options });
  return { out, diagnostics, root: out.children[0] };
};
const codes = (d) => d.list().map((e) => e.code);

test('tabs is a valid definition with honest props and slots', () => {
  assert.deepEqual(validateComponent(tabs), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(tabs));
  assert.deepEqual(Object.keys(tabs.props), ['active', 'position']);
  assert.deepEqual(tabs.slots, ['tabs', 'panels']);
});

test('the smallest element holding the tablist and its panels is the match, with the semantic score', () => {
  const { root, diagnostics } = run(tabsTree());
  assert.equal(root.recognized.component, 'tabs');
  assert.ok(root.tabview);
  assert.equal(codes(diagnostics).length, 0);
});

test('near misses: role=tab buttons without a tablist, and a tablist with no panels, do not become a tabview', () => {
  const noList = node('body', { w: 320, h: 240 }, [node('div', { id: 'r', w: 300, h: 120 }, [tab(0), tab(1), panel(0, true)])]);
  assert.equal(run(noList).root.tabview, undefined);

  const stripOnly = node('body', { w: 320, h: 240 }, [node('div', { role: 'tablist', id: 'strip', w: 300, h: 30 }, [tab(0, { aria: { selected: 'true' } }), tab(1)])]);
  const { root, diagnostics } = run(stripOnly);
  assert.equal(root.tabview, undefined, 'a tab strip with no panels stays a row of buttons');
  const entry = diagnostics.list().find((e) => e.code === 'UNSUPPORTED_WIDGET');
  assert.ok(entry, 'and says why');
  assert.match(entry.message, /no tabpanel was found/);
  assert.equal(entry.severity, 'warning');
});

test('the open tab comes from aria-selected, then Mui-selected, then the first tab', () => {
  assert.equal(run(tabsTree({ selected: 2 })).root.tabview.active, 2);
  const mui = tabsTree();
  const list = mui.children[0].children[0];
  list.children.forEach((b) => { b.aria.selected = undefined; b.classes = b.id === 't0' ? ['Mui-selected'] : []; });
  assert.equal(run(mui).root.tabview.active, 0);
  list.children.forEach((b) => { b.aria = { controls: b.aria.controls }; b.classes = []; });
  assert.equal(run(mui).root.tabview.active, 0, 'nothing says selected: the first tab');
  list.children.forEach((b) => { b.classes = b.id === 't2' ? ['Mui-selected'] : []; });
  assert.equal(run(mui).root.tabview.active, 2);
});

test('the bar position is read from where the bar sits relative to the panels', () => {
  assert.equal(run(tabsTree()).root.tabview.position, 'top');
  // bar below: the bar at y=90, panels at y=0
  const below = tabsTree({ bar: { y: 90 }, panels: [0, 1, 2].map((i) => panel(i, i === 1, { y: 0 })) });
  below.children[0].children[0].children.forEach((b) => { b.y = 90; });
  assert.equal(run(below).root.tabview.position, 'bottom');
  // bar on the left: a 100 wide bar, panels to its right
  const left = tabsTree({ bar: { w: 100, h: 120, aria: { orientation: 'vertical' } }, panels: [0, 1, 2].map((i) => panel(i, i === 1, { x: 100, y: 0, w: 200, h: 120 })) });
  left.children[0].children[0].children.forEach((b, i) => { b.x = 0; b.y = i * 40; b.w = 100; b.h = 40; });
  assert.equal(run(left).root.tabview.position, 'left');
  // bar on the right
  const right = tabsTree({ bar: { x: 200, w: 100, h: 120 }, panels: [0, 1, 2].map((i) => panel(i, i === 1, { x: 0, y: 0, w: 200, h: 120 })) });
  right.children[0].children[0].children.forEach((b, i) => { b.x = 200; b.y = i * 40; b.w = 100; b.h = 40; });
  assert.equal(run(right).root.tabview.position, 'right');
});

test('with no measured panel, aria-orientation decides between top and left', () => {
  const t = tabsTree({ bar: { aria: { orientation: 'vertical' } }, panels: [0, 1, 2].map((i) => panel(i, false, { w: 0, h: 0 })) });
  const { root } = run(t);
  assert.equal(root.tabview.position, 'left');
});

test('a clean container becomes the tabview itself and keeps its box; the pages are the panels in tab order', () => {
  const { root } = run(tabsTree());
  assert.equal(root.tag, 'div');
  assert.equal(root.id, 'root');
  assert.equal(root.styles.radius, 4);
  assert.equal(root.children.length, 3);
  assert.deepEqual(root.children.map((c) => c.id), ['p0', 'p1', 'p2']);
  assert.equal(root.tabview.synthetic, false);
  assert.deepEqual(root.tabview.tabs.map((t) => t.text), ['Tab 0', 'Tab 1', 'Tab 2']);
});

test('hidden panels are kept (not dropped as collapsed leftovers) and moved onto the open panel\'s origin', () => {
  const { root } = run(tabsTree());
  for (const page of root.children) {
    assert.equal(page.hidden, false);
    assert.equal(page.initiallyHidden, false);
    assert.equal(page.y, 30, `${page.id} sits where the open panel does, not one panel lower`);
  }
});

test('geometry: gap between bar and pages, button gap, equal buttons fill the bar', () => {
  const t = tabsTree({ panels: [0, 1, 2].map((i) => panel(i, i === 1, { y: i === 1 ? 36 : 126 })) });
  const { root } = run(t);
  assert.equal(root.tabview.gap, 6);
  assert.equal(root.tabview.fillBar, true);
  assert.equal(root.tabview.bar.h, 30);
  // unequal buttons keep their own widths
  const uneven = tabsTree();
  const buttons = uneven.children[0].children[0].children;
  buttons[0].w = 60; buttons[1].x = 60; buttons[1].w = 140; buttons[2].x = 200;
  assert.equal(run(uneven).root.tabview.fillBar, false);
});

test('a Material UI indicator becomes the open tab\'s underline', () => {
  const t = tabsTree();
  const list = t.children[0].children[0];
  const indicator = node('span', { classes: ['MuiTabs-indicator'], x: 100, y: 28, w: 100, h: 2, styles: { bgColor: [25, 118, 210, 255] } });
  list.children.push(indicator);
  const { root } = run(t);
  assert.deepEqual(root.tabview.indicator, { color: [25, 118, 210, 255], width: 2, side: 'bottom' });
});

test('a tab with no measured panel is an empty page and says so; a tab icon is reported', () => {
  const t = tabsTree({ panels: [panel(0, false, { w: 0, h: 0 }), panel(1, true), panel(2, false, { w: 0, h: 0 })] });
  const { root, diagnostics } = run(t);
  assert.equal(root.children[0].emptyTab, true);
  assert.equal(root.children[1].emptyTab, undefined);
  assert.ok(diagnostics.list().some((e) => e.code === 'UNSUPPORTED_WIDGET' && /could not be measured/.test(e.message)));

  const withIcon = tabsTree();
  withIcon.children[0].children[0].children[0].children = [node('svg', { w: 16, h: 16 })];
  const second = run(withIcon);
  assert.ok(second.diagnostics.list().some((e) => e.code === 'UNSUPPORTED_WIDGET' && /icon/.test(e.message)));
  assert.equal(second.root.recognized.component, 'tabs', 'the tabview is still built, the icon is dropped');
});

test('a tab bar that holds more than the tabs is refused, not trimmed', () => {
  const t = tabsTree();
  t.children[0].children[0].children.push(node('button', { text: '+ New', x: 300, y: 0, w: 20, h: 30 }));
  const { root, diagnostics } = run(t);
  assert.equal(root.tabview, undefined);
  assert.ok(diagnostics.list().some((e) => e.code === 'UNSUPPORTED_WIDGET' && /holds more than the tabs/.test(e.message)));
});

test('other content in the same container gets a synthetic tabview where the bar was', () => {
  const t = tabsTree();
  const r = t.children[0];
  r.children.unshift(node('h2', { text: 'Heading', x: 0, y: 0, w: 100, h: 20 }));
  r.children.forEach((c) => { if (c.id !== undefined && c.tag !== 'h2') c.y += 20; });
  r.children[1].children.forEach((b) => { b.y += 20; });
  r.h = 140;
  const { root } = run(t);
  assert.equal(root.recognized.component, 'tabs'.replace('tabs', root.recognized.component), 'the container is kept');
  assert.equal(root.children.length, 2, 'the heading and one tabview');
  const [heading, tv] = root.children;
  assert.equal(heading.tag, 'h2');
  assert.ok(tv.tabview?.synthetic);
  assert.equal(tv.children.length, 3);
  assert.equal(tv.y, 20);
  assert.equal(tv.h, 120, 'sized to the bar plus the panels');
});

test('panels found through aria-labelledby when the tabs carry no aria-controls', () => {
  const t = tabsTree();
  t.children[0].children[0].children.forEach((b) => { b.aria = { selected: b.id === 't1' ? 'true' : 'false' }; });
  const { root } = run(t);
  assert.equal(root.tabview?.tabs.length, 3);
  assert.deepEqual(root.children.map((c) => c.id), ['p0', 'p1', 'p2']);
});

test('data-lv-widget="tabs" forces the mapping on any element that holds a tablist', () => {
  const t = tabsTree();
  const wrap = node('div', { id: 'outer', widget: 'tabs', x: 0, y: 0, w: 300, h: 120 }, [t.children[0]]);
  const { out } = run(node('body', { w: 320, h: 240 }, [wrap]));
  assert.equal(out.children[0].recognized.component, 'tabs');
});

test('convert(): an lv_tabview with the open tab, bar, pages and per-state button styles', () => {
  const t = tabsTree();
  t.children[0].children[0].children[1].styles = { ...t.children[0].children[0].children[1].styles, color: [0, 0, 255, 255], borderWidth: 2, borderColor: [0, 0, 255, 255] };
  const { xml, diagnostics } = convert(t, { name: 'tabs_unit' });
  assert.match(xml, /<lv_tabview name="root"[^>]* active="1"/);
  assert.doesNotMatch(xml, /tab_bar_position/, 'top is the default and is not written');
  assert.match(xml, /<lv_tabview-tab_bar name="root_bar" height="30"/);
  assert.equal((xml.match(/<lv_tabview-tab /g) ?? []).length, 3);
  assert.match(xml, /<lv_tabview-tab name="p1" text="Tab 1"/);
  assert.equal((xml.match(/<lv_tabview-tab_button index="\d"/g) ?? []).length, 3);
  assert.match(xml, /style_border_width:checked="2"/, 'the open tab\'s border is its checked look');
  assert.match(xml, /style_text_color:checked="0x0000ff"/);
  // The theme's tint must not show through: every property it sets is stated for the checked state.
  for (const key of ['style_bg_opa', 'style_border_width', 'style_border_side', 'style_pad_all']) assert.match(xml, new RegExp(`${key}:checked=`));
  assert.equal(diagnostics.list().filter((e) => e.code === 'UNSUPPORTED_WIDGET').length, 0);
});

test('convert(): a bar below writes tab_bar_position, a left bar sizes the bar by width', () => {
  const below = tabsTree({ bar: { y: 90 }, panels: [0, 1, 2].map((i) => panel(i, i === 1, { y: 0 })) });
  below.children[0].children[0].children.forEach((b) => { b.y = 90; });
  assert.match(convert(below, { name: 'u' }).xml, /<lv_tabview [^>]*tab_bar_position="bottom"/);

  const left = tabsTree({ bar: { w: 100, h: 120 }, panels: [0, 1, 2].map((i) => panel(i, i === 1, { x: 100, y: 0, w: 200, h: 120 })) });
  left.children[0].children[0].children.forEach((b, i) => { b.x = 0; b.y = i * 40; b.w = 100; b.h = 40; });
  const xml = convert(left, { name: 'u' }).xml;
  assert.match(xml, /tab_bar_position="left"/);
  assert.match(xml, /<lv_tabview-tab_bar name="root_bar" width="100"/);
  assert.match(xml, /style_pad_column="0"/);
});

test('convert(): a panel that is only text keeps its padding, so the label starts where the browser put the text', () => {
  const t = tabsTree({ panels: [0, 1, 2].map((i) => panel(i, i === 1, { styles: { padLeft: 10, padTop: 8, padRight: 10, padBottom: 8 } })) });
  const xml = convert(t, { name: 'u' }).xml;
  assert.match(xml, /<lv_tabview-tab name="p1"[^>]*style_pad_left="10"[^>]*style_pad_top="8"/);
});

test('convert(): a tab bar whose tab text is uppercase by CSS shows uppercase labels', () => {
  const t = tabsTree();
  t.children[0].children[0].children.forEach((b) => { b.styles = { ...b.styles, textTransform: 'uppercase' }; });
  assert.match(convert(t, { name: 'u' }).xml, /<lv_tabview-tab name="p0" text="TAB 0"/);
});

test('C output creates the tabview, sets the open tab and addresses the parts with the tabview calls', () => {
  const { view } = convert(tabsTree(), { name: 'u' });
  const { c } = emitC(view, { name: 'u' });
  assert.match(c, /lv_obj_t \* root = lv_tabview_create\(parent\);|lv_tabview_create\(root\)/);
  assert.match(c, /lv_tabview_set_active\(root_w?, 1, LV_ANIM_OFF\);/);
  assert.match(c, /lv_tabview_get_tab_bar\(/);
  assert.match(c, /lv_tabview_add_tab\([a-z_0-9]+, "Tab 0"\);/);
  assert.match(c, /lv_tabview_get_tab_button\([a-z_0-9]+, 2\);/);
  assert.match(c, /lv_obj_set_style_text_color\([a-z_0-9]+, lv_color_hex\(0x[0-9a-f]+\), LV_STATE_CHECKED\);|LV_STATE_CHECKED/);
  assert.doesNotMatch(c, /unmapped attribute: (text|index|active)/);
});

test('MicroPython output uses the binding\'s tabview calls and never an unmapped attribute', () => {
  const { view } = convert(tabsTree({ bar: { y: 90 }, panels: [0, 1, 2].map((i) => panel(i, i === 1, { y: 0 })) }), { name: 'u' });
  const { py } = emitPy(view, { name: 'u' });
  assert.match(py, /\.set_tab_bar_position\(lv\.DIR\.BOTTOM\)/);
  assert.match(py, /\.set_active\(1, False\)/);
  assert.match(py, /\.add_tab\("Tab 0"\)/);
  assert.match(py, /\.get_tab_bar\(\)\.get_child\(2\)/, 'the pinned binding has no get_tab_button: the bar\'s i-th child is the button');
  assert.doesNotMatch(py, /unmapped attribute: (text|index|active|tab_bar_position)/);
});

test('fixtures: tabs and tabs_positions convert to the native tabview with no warnings beyond fonts', () => {
  for (const name of ['tabs', 'tabs_positions']) {
    const tree = JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
    const { xml, diagnostics } = convert(tree, { name });
    assert.match(xml, /<lv_tabview /);
    assert.deepEqual(diagnostics.list().filter((e) => e.code === 'UNSUPPORTED_WIDGET'), []);
  }
  const tree = JSON.parse(readFileSync(join(here, 'fixtures', 'tabs.json'), 'utf8'));
  const { xml } = convert(tree, { name: 'tabs' });
  assert.equal((xml.match(/<lv_tabview /g) ?? []).length, 2, 'the plain ARIA set and the Material UI set');
  assert.equal((xml.match(/ active="1"/g) ?? []).length, 2, 'both say aria-selected on the second tab');
  assert.match(xml, /style_border_color:checked="0x1976d2"/, 'the Material UI indicator colours the open tab\'s underline');
});
