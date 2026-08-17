/**
 * Golden-file tests: converting each committed extraction fixture must
 * reproduce the committed LVGL XML exactly. No browser needed.
 *
 * On an intentional converter change, refresh with `npm run golden:update`
 * and review the XML diff like any other code change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { componentize } from '../src/componentize.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { render } from '../src/emit-xml.mjs';
import { optimize } from '../src/optimize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.json'));

assert.ok(fixtures.length >= 4, 'expected at least 4 fixtures');

const navScreens = new Set(fixtures.filter((f) => f.endsWith('.nav.json')).map((f) => f.replace(/\.nav\.json$/, '')));

for (const file of fixtures) {
  const react = file.endsWith('.react.json');
  const nav = file.endsWith('.nav.json');
  const name = file.replace(/(\.react|\.nav)?\.json$/, '');
  const convertOpts = { name, screenMode: nav, screens: nav ? navScreens : null };

  if (nav) {
    test(`golden nav: ${name}`, () => {
      const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
      const { xml } = convert(tree, convertOpts);
      assert.equal(xml, readFileSync(join(here, 'golden-nav', `${name}.xml`), 'utf8'));
      assert.match(xml, /^<screen>/); // screens are loadable roots, not components
    });
  } else if (react) {
    test(`golden react: ${name}`, () => {
      const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
      const { view } = convert(tree, { name });
      const { view: pageView, components } = componentize(view);
      const dir = join(here, 'golden-react', name);
      const pageXml = `<component>\n${render(pageView, 1)}\n</component>\n`;
      assert.equal(pageXml, readFileSync(join(dir, `${name}.xml`), 'utf8'));
      const goldenFiles = readdirSync(dir).filter((f) => f !== `${name}.xml`);
      assert.deepEqual([...components.keys()].sort(), goldenFiles.map((f) => f.replace('.xml', '')).sort());
      for (const [cname, cxml] of components) {
        assert.equal(cxml, readFileSync(join(dir, `${cname}.xml`), 'utf8'));
      }
    });
  } else {
    test(`golden xml: ${name}`, () => {
      const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
      const { xml } = convert(tree, { name });
      const golden = readFileSync(join(here, 'golden', `${name}.xml`), 'utf8');
      assert.equal(xml, golden);
    });
  }

  test(`golden c: ${name}`, () => {
    const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
    const { view } = convert(tree, convertOpts);
    const cName = nav ? `nav_${name}` : name;
    const symbol = nav ? `ui_${name}_create` : 'ui_create';
    const { c, h, unit } = emitC(view, { name: cName, symbol });
    assert.equal(c, readFileSync(join(here, 'golden-c', `${unit}.c`), 'utf8'));
    assert.equal(h, readFileSync(join(here, 'golden-c', `${unit}.h`), 'utf8'));
  });

  test(`golden cpp: ${name}`, () => {
    const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
    const { view } = convert(tree, convertOpts);
    const cName = nav ? `nav_${name}` : name;
    const symbol = nav ? `ui_${name}_create` : 'ui_create';
    const { c, h, unit } = emitCpp(view, { name: cName, symbol });
    assert.equal(c, readFileSync(join(here, 'golden-cpp', `${unit}.cpp`), 'utf8'));
    assert.equal(h, readFileSync(join(here, 'golden-cpp', `${unit}.hpp`), 'utf8'));
    // Emitted body must not differ from the C output — only the header's
    // linkage wrapping and the extern declarations' "C" linkage should.
    const cGolden = readFileSync(join(here, 'golden-c', `${unit}.c`), 'utf8');
    const cBody = cGolden.replace(/^#include ".*"\n/m, '').replace(/extern (?!"C")/g, 'extern "C" ');
    const cppBody = c.replace(/^#include ".*"\n/m, '');
    assert.equal(cppBody, cBody, 'emitCpp must emit the same statements as emitC, only extern linkage differs');
  });
}

test('links to sibling screens become navigation buttons', () => {
  const link = (href, text) => ({
    tag: 'a', x: 10, y: 10, w: 120, h: 30, text, attrs: { href },
    styles: base(), layout: block(), children: [],
  });
  const tree = {
    tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {},
    styles: base(), layout: block(),
    children: [link('settings.html', 'Settings'), link('./deep/settings.html#top', 'Anchor'), link('https://lvgl.io', 'External'), link('missing.html', 'Missing')],
  };
  const { xml } = convert(tree, { screens: new Set(['settings']), screenMode: true });

  // Both forms of the resolvable link navigate; hash and path are stripped
  assert.equal(xml.match(/<screen_create_event screen="settings" \/>/g).length, 2);
  assert.match(xml, /<lv_button name="to_settings"/);
  // External and unresolvable links stay plain text
  assert.match(xml, /<lv_label[^>]*text="External"/);
  assert.match(xml, /<lv_label[^>]*text="Missing"/);
});

test('screen mode wraps the view in <screen>, component mode in <component>', () => {
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [] };
  assert.match(convert(tree, { screenMode: true }).xml, /^<screen>[\s\S]*<\/screen>\n$/);
  assert.match(convert(tree).xml, /^<component>[\s\S]*<\/component>\n$/);
});

test('componentizer parameterizes text and color, keeps structure', () => {
  const label = (name, text) => ({ tag: 'lv_label', attrs: { name, text, style_text_color: '0xffffff' }, children: [] });
  const card = (n, text, bg) => ({
    tag: 'lv_obj',
    attrs: { name: `card_${n}`, x: n * 100, y: 0, width: 90, height: 40, style_bg_color: bg },
    children: [label(`t_${n}`, text)],
    meta: { component: 'StatCard' },
  });
  const view = { tag: 'view', attrs: { width: 320, height: 240 }, children: [card(1, 'A', '0x111111'), card(2, 'B', '0x222222')] };
  const { view: page, components, warnings } = componentize(view);
  assert.equal(warnings.length, 0);
  assert.ok(components.has('stat_card'));
  const xml = components.get('stat_card');
  assert.match(xml, /<prop type="color" name="[^"]+" default="0x111111"\/>/);
  assert.match(xml, /<prop type="string" name="[^"]+" default="A"\/>/);
  assert.equal(page.children[0].tag, 'stat_card');
  assert.equal(page.children[1].attrs.x, 200); // placement stays on the instance
});

test('componentizer bails on structural differences', () => {
  const a = { tag: 'lv_obj', attrs: { name: 'a' }, children: [{ tag: 'lv_label', attrs: { name: 'l', text: 'x' }, children: [] }], meta: { component: 'Card' } };
  const b = { tag: 'lv_obj', attrs: { name: 'b' }, children: [], meta: { component: 'Card' } };
  const view = { tag: 'view', attrs: {}, children: [a, b] };
  const { components, warnings } = componentize(view);
  assert.equal(components.size, 0);
  assert.ok(warnings.some((w) => w.includes('structurally')));
});

test('warnings surface unsupported tags', () => {
  const tree = {
    tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {},
    styles: base(), layout: block(),
    children: [
      { tag: 'canvas', x: 0, y: 0, w: 100, h: 100, text: null, attrs: {}, styles: base(), layout: block(), children: [] },
    ],
  };
  const { warnings, xml } = convert(tree);
  assert.ok(warnings.some((w) => w.includes('<canvas>')));
  assert.ok(!xml.includes('canvas'));
});

test('optimizer collapses inert single-child wrappers', () => {
  const label = { tag: 'span', x: 10, y: 10, w: 50, h: 12, text: 'hi', attrs: {}, styles: base(), layout: block(), children: [] };
  const wrapper = { tag: 'div', x: 5, y: 5, w: 100, h: 20, text: null, attrs: {}, styles: base(), layout: block(), children: [label] };
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [wrapper] };
  const { tree: out, removed } = optimize(structuredClone(tree));
  assert.equal(removed, 1);
  assert.equal(out.children[0].tag, 'span'); // wrapper gone, label hoisted
});

test('optimizer keeps wrappers that carry visuals or manage layout', () => {
  const label = { tag: 'span', x: 10, y: 10, w: 50, h: 12, text: 'hi', attrs: {}, styles: base(), layout: block(), children: [] };
  const styled = { tag: 'div', x: 5, y: 5, w: 100, h: 20, text: null, attrs: {}, styles: { ...base(), bgColor: [255, 0, 0, 255] }, layout: block(), children: [label] };
  const flex = { tag: 'div', x: 5, y: 30, w: 100, h: 20, text: null, attrs: {}, styles: base(), layout: { ...block(), display: 'flex' }, children: [structuredClone(label)] };
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [styled, flex] };
  const { removed } = optimize(structuredClone(tree));
  assert.equal(removed, 0);
});

test('optimizer keeps wrappers annotated with data-lv-widget or data-lv-name', () => {
  const inertChild = { tag: 'span', x: 10, y: 10, w: 50, h: 12, text: null, attrs: {}, styles: base(), layout: block(), children: [] };
  const widgetWrapper = {
    tag: 'div', widget: 'bar', x: 5, y: 5, w: 100, h: 20, text: null, attrs: {},
    styles: base(), layout: block(), children: [structuredClone(inertChild)],
  };
  const namedWrapper = {
    tag: 'div', lvName: 'pump_enable', x: 5, y: 30, w: 100, h: 20, text: null, attrs: {},
    styles: base(), layout: block(), children: [structuredClone(inertChild)],
  };
  const tree = {
    tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(),
    children: [widgetWrapper, namedWrapper],
  };
  // Otherwise-inert wrappers must survive when the optimizer would strip
  // them before convert.mjs/uid() ever see the data-lv-widget/data-lv-name
  // annotation they carry.
  const { tree: out, removed } = optimize(structuredClone(tree));
  assert.equal(removed, 0);
  assert.equal(out.children[0].widget, 'bar');
  assert.equal(out.children[1].lvName, 'pump_enable');
});

test('data-lv-name overrides id/class for the widget name', () => {
  const node = {
    tag: 'div', id: 'ignored-id', className: 'ignored-class', lvName: 'pump_enable',
    x: 10, y: 10, w: 44, h: 24, text: null, attrs: {}, styles: base(), layout: block(), children: [],
  };
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [node] };
  const { xml } = convert(tree);
  assert.match(xml, /name="pump_enable"/);
  assert.doesNotMatch(xml, /ignored/);
});

test('data-lv-widget forces the widget mapping', () => {
  const mk = (widget) => ({
    tag: 'div', widget, x: 10, y: 10, w: 44, h: 24, text: null, attrs: {},
    styles: base(), layout: block(), children: [],
  });
  const wrap = (child) => ({ tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [child] });

  // A styled div would normally become lv_obj
  assert.match(convert(wrap(mk('switch'))).xml, /<lv_switch/);
  assert.match(convert(wrap(mk('slider'))).xml, /<lv_slider/);
  assert.match(convert(wrap(mk('bar'))).xml, /<lv_bar[^>]*max_value="100"/);
  assert.match(convert(wrap(mk('checkbox'))).xml, /<lv_checkbox/);
  // "textarea" means a multi-line box; single-line is what <input type=text> maps to
  assert.match(convert(wrap(mk('textarea'))).xml, /<lv_textarea[^>]*one_line="false"/);
});

test('an unknown data-lv-widget warns and falls back', () => {
  const node = {
    tag: 'div', widget: 'hologram', x: 0, y: 0, w: 40, h: 20, text: null, attrs: {},
    styles: base(), layout: block(), children: [],
  };
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [node] };
  const { xml, warnings } = convert(tree);
  assert.ok(warnings.some((w) => w.includes('hologram')));
  assert.match(xml, /<lv_obj/); // default mapping still applied
});

test('emitC does not mistake a custom font key for a built-in Montserrat name', () => {
  // A custom family literally named "Montserrat" produces a key like
  // "montserrat_400_16" (family-slug + weight + size), which shares the
  // "montserrat_" prefix with real built-ins but is a different symbol —
  // built-ins are named just "montserrat_<size>", nothing else.
  const label = {
    tag: 'lv_label',
    attrs: { name: 'label', text: 'hi', style_text_font: 'montserrat_400_16' },
    children: [],
  };
  const view = { tag: 'view', attrs: { width: 320, height: 240 }, children: [label] };
  const { c, h } = emitC(view, { name: 'page' });

  // Must reference its own generated symbol, not the nonexistent built-in
  // &lv_font_montserrat_400_16 (built-ins only exist at the plain sizes,
  // e.g. lv_font_montserrat_16).
  assert.match(c, /lv_obj_set_style_text_font\(label, &montserrat_400_16, 0\);/);
  assert.doesNotMatch(c, /&lv_font_montserrat_400_16/);
  assert.match(c, /extern const lv_font_t montserrat_400_16;/);

  // A genuine built-in still gets the lv_font_ prefix and no extern decl
  const builtinLabel = { tag: 'lv_label', attrs: { name: 'l2', text: 'x', style_text_font: 'montserrat_16' }, children: [] };
  const { c: c2 } = emitC({ tag: 'view', attrs: {}, children: [builtinLabel] }, { name: 'page2' });
  assert.match(c2, /&lv_font_montserrat_16/);
  assert.doesNotMatch(c2, /extern const lv_font_t montserrat_16;/);
  void h; // header content isn't under test here
});

test('emitC turns screen_create_event into a real navigation callback', () => {
  const button = {
    tag: 'lv_button',
    attrs: { name: 'to_settings' },
    children: [{ tag: 'screen_create_event', attrs: { screen: 'settings' }, children: [] }],
  };
  const view = { tag: 'view', attrs: { width: 320, height: 240 }, children: [button] };
  const { c } = emitC(view, { name: 'home', symbol: 'ui_home_create' });

  // The target screen's real entry point (matching cli.mjs's ui_<screen>_create
  // convention) is declared extern and actually called, not left as a comment.
  assert.match(c, /extern lv_obj_t \* ui_settings_create\(lv_obj_t \* parent\);/);
  assert.match(c, /static void nav_to_settings_cb\(lv_event_t \* e\)/);
  assert.match(c, /lv_obj_t \* scr = ui_settings_create\(NULL\);/);
  assert.match(c, /lv_screen_load\(scr\);/);
  assert.match(c, /lv_obj_add_event_cb\(to_settings, nav_to_settings_cb, LV_EVENT_CLICKED, NULL\);/);
  assert.doesNotMatch(c, /\/\* navigation ->/);

  // Two links to the same screen share one callback instead of redeclaring it.
  const twoLinks = {
    tag: 'view',
    attrs: { width: 320, height: 240 },
    children: [button, { ...button, attrs: { name: 'to_settings_2' } }],
  };
  const { c: c2 } = emitC(twoLinks, { name: 'home2' });
  assert.equal((c2.match(/static void nav_to_settings_cb/g) || []).length, 1);
  assert.equal((c2.match(/extern lv_obj_t \* ui_settings_create/g) || []).length, 1);
});

test('emitCpp declares the navigation target extern "C"', () => {
  const button = {
    tag: 'lv_button',
    attrs: { name: 'to_settings' },
    children: [{ tag: 'screen_create_event', attrs: { screen: 'settings' }, children: [] }],
  };
  const view = { tag: 'view', attrs: { width: 320, height: 240 }, children: [button] };
  const { c } = emitCpp(view, { name: 'home', symbol: 'ui_home_create' });
  assert.match(c, /extern "C" lv_obj_t \* ui_settings_create\(lv_obj_t \* parent\);/);
});

test('emitC honors a custom lvInclude for the generated header', () => {
  const view = { tag: 'view', attrs: { width: 320, height: 240 }, children: [] };
  const { h } = emitC(view, { name: 'page', lvInclude: 'lvgl/lvgl.h' });
  assert.match(h, /#include "lvgl\/lvgl\.h"/);
});

function base() {
  return {
    bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null,
  };
}
function block() {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto',
  };
}
