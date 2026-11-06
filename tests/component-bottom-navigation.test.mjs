/**
 * Bottom navigation to an lv_tabview with the bar at the bottom: matching and
 * near misses, what build() reads (the open action, the icon/label stack),
 * what it refuses, navigation that must keep navigating, pinning, and the
 * XML, C and MicroPython output. Nodes are hand built in the extractor's shape.
 *
 * The click-driven check in real LVGL is spike/subjects/run-tabs.sh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bottomNavigation from '../src/components/bottom-navigation.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { emitC } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node as baseNode } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const node = (tag, extra = {}, children = []) => baseNode(tag, extra, children);

/**
 * One action: an icon above a label, 100 wide in a 56 high bar at the bottom.
 * @param {number} i @param {object} [extra]
 */
const action = (i, extra = {}) => node('button', {
  x: i * 100, y: 184, w: 100, h: 56, layout: { display: 'flex', flexDirection: 'column', rowGap: 2 },
  styles: { color: [90, 90, 90, 255] },
  ...extra,
}, [
  node('svg', { x: i * 100 + 38, y: 192, w: 24, h: 24 }),
  node('span', { text: ['Home', 'Stats', 'Settings'][i], x: i * 100 + 30, y: 218, w: 40, h: 14, styles: { color: [90, 90, 90, 255], fontSize: 12 } }),
]);

/** A bar pinned to the bottom of a 320x240 page. @param {{ tag?: string, role?: string | null, extra?: object, actions?: object[] }} [o] */
function navTree({ tag = 'nav', role = null, extra = {}, actions = [0, 1, 2].map((i) => action(i, i === 1 ? { aria: { current: 'page' } } : {})) } = {}) {
  const bar = node(tag, {
    role, x: 0, y: 184, w: 300, h: 56, layout: { display: 'flex', position: 'fixed' },
    styles: { bgColor: [255, 255, 255, 255], borderWidth: 0, borderBottomWidth: 0 }, ...extra,
  }, actions);
  return node('body', { w: 300, h: 240 }, [node('p', { text: 'Page content', x: 0, y: 0, w: 100, h: 20 }), bar]);
}
const run = (tree) => {
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(structuredClone(tree), { registry: createRegistry([bottomNavigation]), diagnostics });
  return { out, diagnostics, bar: out.children[1] };
};

test('bottom navigation is a valid definition and is registered', () => {
  assert.deepEqual(validateComponent(bottomNavigation), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(bottomNavigation));
  assert.deepEqual(Object.keys(bottomNavigation.props), ['active']);
});

test('a fixed <nav> with three icon-over-label actions at the bottom edge matches; so does role=navigation', () => {
  assert.equal(run(navTree()).bar.recognized?.component, 'bottom-navigation');
  assert.equal(run(navTree({ tag: 'div', role: 'navigation' })).bar.recognized?.component, 'bottom-navigation');
});

test('near misses: not pinned to the bottom, too few or too many actions, no icons, not a nav', () => {
  assert.equal(run(navTree({ extra: { layout: { display: 'flex', position: 'static' } } })).bar.tabview, undefined, 'a nav in the page flow');
  assert.equal(run(navTree({ extra: { y: 100 } })).bar.tabview, undefined, 'a fixed nav that is not at the bottom edge');
  assert.equal(run(navTree({ actions: [action(0), action(1)] })).bar.tabview, undefined, 'two actions');
  assert.equal(run(navTree({ actions: [0, 1, 2, 3, 4, 5].map((i) => action(i % 3)) })).bar.tabview, undefined, 'six actions');
  const noIcons = [0, 1, 2].map((i) => node('a', { text: `Link ${i}`, attrs: { href: '#' }, x: i * 100, y: 184, w: 100, h: 56 }));
  assert.equal(run(navTree({ actions: noIcons })).bar.tabview, undefined, 'text-only links are a site menu, not a bottom navigation');
  assert.equal(run(navTree({ tag: 'div' })).bar.tabview, undefined, 'a plain div is not a navigation');
});

test('Material UI: MuiBottomNavigation-root matches at 0.7 whatever its position, with 2 to 6 actions', () => {
  const actions = [0, 1].map((i) => action(i, { classes: ['MuiBottomNavigationAction-root', ...(i === 0 ? ['Mui-selected'] : [])] }));
  const tree = navTree({ tag: 'div', extra: { classes: ['MuiBottomNavigation-root'], layout: { display: 'flex', position: 'absolute' } }, actions });
  const diagnostics = createDiagnostics();
  const ctx = { diagnostics, parent: tree, tree, byId: new Map(), links: new Map() };
  assert.equal(bottomNavigation.match(tree.children[1], ctx), 0.7);
  const { bar } = run(tree);
  assert.equal(bar.tabview.tabs.length, 2);
  assert.equal(bar.tabview.active, 0, 'Mui-selected');
});

test('the open action comes from aria-current, aria-selected or Mui-selected; the position is the bottom', () => {
  assert.equal(run(navTree()).bar.tabview.active, 1);
  const bySelected = navTree({ actions: [0, 1, 2].map((i) => action(i, i === 2 ? { aria: { selected: 'true' } } : {})) });
  assert.equal(run(bySelected).bar.tabview.active, 2);
  const none = navTree({ actions: [0, 1, 2].map((i) => action(i)) });
  assert.equal(run(none).bar.tabview.active, 0, 'nothing said selected: the first');
  assert.equal(run(navTree()).bar.tabview.position, 'bottom');
});

test('aria-current="false" is not current', () => {
  const t = navTree({ actions: [0, 1, 2].map((i) => action(i, { aria: { current: i === 2 ? 'true' : 'false' } })) });
  assert.equal(run(t).bar.tabview.active, 2);
});

test('build keeps the icons as children of the action buttons and the label as the tab text', () => {
  const { bar } = run(navTree());
  assert.deepEqual(bar.tabview.tabs.map((t) => t.text), ['Home', 'Stats', 'Settings']);
  const buttons = bar.children.filter((c) => c.tabButton);
  const pages = bar.children.filter((c) => !c.tabButton);
  assert.equal(buttons.length, 3);
  assert.equal(pages.length, 3);
  assert.ok(pages.every((p) => p.emptyTab), 'the pages hold nothing: the app\'s own content is elsewhere');
  assert.ok(buttons.every((b) => b.children.length === 1 && b.children[0].tag === 'svg' || b.children[0]?.recognized), 'the label span is not a child any more');
  assert.equal(bar.tabview.stack, 'column_reverse', 'the icon is above the label');
  assert.equal(bar.tabview.iconGap, 2);
});

test('an action whose label is its own text (a button with an svg inside) is read from the icon\'s side of the button', () => {
  const own = (i) => node('button', {
    text: ['Home', 'Stats', 'Settings'][i], x: i * 100, y: 184, w: 100, h: 56, layout: { display: 'flex', flexDirection: 'column', rowGap: 3 },
  }, [node('svg', { x: i * 100 + 38, y: 192, w: 24, h: 24 })]);
  const { bar, diagnostics } = run(navTree({ actions: [own(0), own(1), own(2)] }));
  assert.equal(bar.tabview.stack, 'column_reverse');
  assert.equal(bar.tabview.iconGap, 3, 'the button\'s CSS row gap');
  assert.deepEqual(diagnostics.list(), []);
});

test('an icon beside its label is refused with UNSUPPORTED_WIDGET and the default mapping is kept', () => {
  const side = (i) => node('button', { x: i * 100, y: 184, w: 100, h: 56, layout: { display: 'flex', flexDirection: 'row' } }, [
    node('svg', { x: i * 100 + 6, y: 200, w: 24, h: 24 }),
    node('span', { text: 'Item', x: i * 100 + 40, y: 200, w: 40, h: 24 }),
  ]);
  const { bar, diagnostics } = run(navTree({ actions: [side(0), side(1), side(2)] }));
  assert.equal(bar.tabview, undefined);
  const entry = diagnostics.list().find((e) => e.code === 'UNSUPPORTED_WIDGET');
  assert.ok(entry);
  assert.match(entry.message, /beside its label/);
  assert.equal(entry.severity, 'warning');
});

test('a recognized bar that is fixed or sticky is pinned like an app bar: floating, and moved after its siblings', () => {
  const tree = navTree();
  // The bar is listed before the content here: it must still end up last, so it draws on top.
  tree.children.reverse();
  const { xml } = convert(tree, { name: 'u' });
  const tabview = xml.indexOf('<lv_tabview ');
  const content = xml.indexOf('text="Page content"');
  assert.ok(content > -1 && tabview > content, 'the bar comes after the page content');
  assert.match(xml, /<lv_tabview [^>]*floating="true"/);
});

test('convert(): the bar is a bottom tabview with the open action, flex-stacked buttons and no page content', () => {
  const { xml } = convert(navTree(), { name: 'u' });
  assert.match(xml, /<lv_tabview name="bottom_nav"[^>]* tab_bar_position="bottom" active="1"/);
  assert.match(xml, /<lv_tabview-tab_bar name="bottom_nav_bar" height="56"/);
  assert.match(xml, /<lv_tabview-tab name="bottom_nav_page" text="Home" scrollable="false" \/>/);
  assert.match(xml, /<lv_tabview-tab_button index="0"[^>]*flex_flow="column_reverse"[^>]*style_flex_cross_place="center"/);
  assert.match(xml, /style_pad_row="2"/);
});

test('convert(): the icon inside a tab button lets taps through to the button (it must not swallow them)', () => {
  const { xml } = convert(navTree(), { name: 'u' });
  const icon = /<lv_tabview-tab_button index="0"[\s\S]*?<\/lv_tabview-tab_button>/.exec(xml)[0];
  assert.match(icon, /<lv_obj [^>]*clickable="false"/, 'a plain lv_obj is clickable and does not pass the tap up, so a tap on the icon would not switch tabs');
});

test('navigation keeps working: an action with data-lv-link or a sibling-page href navigates; the open page\'s own action does not reload it', () => {
  const tree = navTree({
    actions: [
      action(0, { link: 'home.html' }),
      action(1, { aria: { current: 'page' }, tag: 'a', attrs: { href: 'stats.html' } }),
      action(2, { link: 'settings.html' }),
    ],
  });
  const { xml, diagnostics } = convert(tree, { name: 'stats', screens: new Set(['home', 'stats', 'settings']), screenMode: true });
  assert.match(xml, /<lv_tabview-tab_button index="0"[^>]*>[\s\S]*?<screen_create_event screen="home" \/>/);
  assert.match(xml, /<lv_tabview-tab_button index="2"[^>]*>[\s\S]*?<screen_create_event screen="settings" \/>/);
  assert.doesNotMatch(xml, /screen="stats"/, 'the page that is already open is not re-created');
  assert.equal(diagnostics.list().filter((e) => e.code === 'LINK_TARGET_UNKNOWN').length, 0);
  // C and MicroPython carry the navigation too.
  const { view } = convert(tree, { name: 'stats', screens: new Set(['home', 'stats', 'settings']), screenMode: true });
  assert.match(emitC(view, { name: 'stats' }).c, /lv_obj_add_event_cb\([a-z_0-9]+, nav_to_home_cb, LV_EVENT_CLICKED, NULL\);/);
  assert.match(emitPy(view, { name: 'stats' }).py, /add_event_cb\(_nav_to_settings, lv\.EVENT\.CLICKED, None\)/);
});

test('without the other pages in the run, a link target is reported and ignored as it is for any link', () => {
  const tree = navTree({ actions: [action(0, { link: 'home.html' }), action(1), action(2)] });
  const { xml, diagnostics } = convert(tree, { name: 'only', screens: new Set(['only']) });
  assert.doesNotMatch(xml, /screen_create_event/);
  assert.ok(diagnostics.list().some((e) => e.code === 'LINK_TARGET_UNKNOWN'));
});

test('C and MicroPython output use the tabview calls, with the icon children created inside the button', () => {
  const { view } = convert(navTree(), { name: 'u' });
  const { c } = emitC(view, { name: 'u' });
  assert.match(c, /lv_tabview_set_tab_bar_position\([a-z_0-9]+, LV_DIR_BOTTOM\);/);
  assert.match(c, /lv_tabview_get_tab_button\([a-z_0-9]+, 1\);/);
  assert.match(c, /lv_obj_set_flex_flow\([a-z_0-9]+, LV_FLEX_FLOW_COLUMN_REVERSE\);/);
  assert.match(c, /lv_obj_set_flag\([a-z_0-9]+, LV_OBJ_FLAG_CLICKABLE, false\);/);
  const { py } = emitPy(view, { name: 'u' });
  assert.match(py, /\.set_tab_bar_position\(lv\.DIR\.BOTTOM\)/);
  assert.match(py, /\.set_flag\(lv\.obj\.FLAG\.CLICKABLE, False\)/);
  assert.match(py, /\.set_flex_flow\(lv\.FLEX_FLOW\.COLUMN_REVERSE\)/);
  assert.doesNotMatch(py, /unmapped attribute/);
  assert.doesNotMatch(c, /unmapped attribute/);
});

test('the fixture converts both versions, each with its open action and no refusals', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures', 'bottom_navigation.json'), 'utf8'));
  const { xml, diagnostics } = convert(tree, { name: 'bottom_navigation' });
  assert.equal((xml.match(/<lv_tabview /g) ?? []).length, 2);
  assert.equal((xml.match(/ active="1"/g) ?? []).length, 2, 'aria-current on one, Mui-selected on the other');
  assert.equal((xml.match(/tab_bar_position="bottom"/g) ?? []).length, 2);
  assert.deepEqual(diagnostics.list().filter((e) => e.code === 'UNSUPPORTED_WIDGET'), []);
  assert.match(xml, /style_text_color:checked="0x1976d2"/, 'the Material UI selected colour is the checked look');
});
