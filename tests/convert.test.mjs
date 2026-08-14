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
import { emitC } from '../src/emit-c.mjs';
import { render } from '../src/emit-xml.mjs';
import { optimize } from '../src/optimize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.json'));

assert.ok(fixtures.length >= 4, 'expected at least 4 fixtures');

for (const file of fixtures) {
  const react = file.endsWith('.react.json');
  const name = file.replace(/(\.react)?\.json$/, '');

  if (react) {
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
    const { view } = convert(tree, { name });
    const { c, h, unit } = emitC(view, { name });
    assert.equal(c, readFileSync(join(here, 'golden-c', `${unit}.c`), 'utf8'));
    assert.equal(h, readFileSync(join(here, 'golden-c', `${unit}.h`), 'utf8'));
  });
}

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
  assert.match(convert(wrap(mk('textarea'))).xml, /<lv_textarea/);
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
