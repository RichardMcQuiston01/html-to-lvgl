/**
 * Slider: signals and scores, the range read from ARIA or the range input,
 * integer scaling, the native lv_slider that build() emits (rail, track, knob,
 * range mode), the wrapper, and the shipped fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateComponent, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { node } from './helpers/tree.mjs';
import slider from '../src/components/slider.mjs';

const ctx = () => ({ diagnostics: createDiagnostics(), parent: null, tree: null });
const score = (n) => Number(slider.match(n, ctx()));
const page = (...children) => node('body', { w: 320, h: 240, styles: { bgColor: [255, 255, 255, 255] } }, children);
const run = (tree) => {
  const diagnostics = createDiagnostics();
  return { tree: recognize(tree, { diagnostics }).tree, diagnostics };
};
const nativeOf = (tree) => {
  const find = (n) => (n.native ? n : n.children.map(find).find(Boolean));
  return find(tree);
};

/** role=slider on a 6 px rail, with a filled child and a round thumb. */
const plain = (aria = { valuemin: '0', valuemax: '100', valuenow: '65' }) => node('div', {
  role: 'slider', aria, x: 20, y: 68, w: 280, h: 6, styles: { bgColor: [203, 213, 225, 255], radius: 3 },
}, [
  node('div', { x: 20, y: 68, w: 182, h: 6, styles: { bgColor: [13, 148, 136, 255] } }),
  node('div', { x: 194, y: 63, w: 16, h: 16, styles: { bgColor: [15, 118, 110, 255], radius: 8 } }),
]);

const thumb = (index, left, value, extra = {}) => node('span', { classes: ['MuiSlider-thumb'], x: left - 10, y: 140, w: 20, h: 20, styles: { bgColor: [25, 118, 210, 255], radius: 10 } }, [
  node('input', { attrs: { type: 'range', min: '0', max: '100', value: String(value) }, aria: { valuenow: String(value), valuemin: '0', valuemax: '100' }, x: left - 10, y: 140, w: 20, h: 20, ...extra }),
]);
/** Material UI Slider: 30 px root around a 4 px rail. */
const mui = (...values) => node('span', { classes: ['MuiSlider-root', 'MuiSlider-colorPrimary'], x: 20, y: 137, w: 280, h: 30 }, [
  node('span', { classes: ['MuiSlider-rail'], x: 20, y: 150, w: 280, h: 4, styles: { bgColor: [25, 118, 210, 255], opacity: 0.38, radius: 2 } }),
  node('span', { classes: ['MuiSlider-track'], x: 20, y: 150, w: 112, h: 4, styles: { bgColor: [25, 118, 210, 255], radius: 2 } }),
  ...values.map((v, i) => thumb(i, 20 + 2.8 * v, v)),
]);

test('the definition is valid and registered as "slider"', () => {
  assert.deepEqual(validateComponent(slider), { ok: true, errors: [] });
  assert.equal(slider.name, 'slider');
});

test('role="slider" scores 1 and a Material UI root 0.7; an <input type=range> and a plain div do not match', () => {
  assert.equal(score(plain()), 1);
  assert.equal(score(mui(40)), 0.7);
  assert.equal(score(node('input', { role: 'slider', attrs: { type: 'range' } })), 0, 'the converter already maps range inputs');
  assert.equal(score(node('div')), 0);
  assert.equal(score({ ...plain(), hidden: true }), 0);
});

test('data-lv-widget="slider" with no signal keeps the converter mapping', () => {
  const div = node('div', { widget: 'slider', x: 0, y: 0, w: 200, h: 8 });
  assert.equal(nativeOf(run(page(div)).tree), undefined);
});

test('build: min, max and value come from aria-valuemin, aria-valuemax and aria-valuenow', () => {
  const s = nativeOf(run(page(plain({ valuemin: '10', valuemax: '50', valuenow: '30' }))).tree);
  assert.equal(s.native.tag, 'lv_slider');
  assert.deepEqual([s.native.attrs.min_value, s.native.attrs.max_value, s.native.attrs.value], [10, 50, 30]);
  assert.deepEqual(s.recognized.props, { min: 10, max: 50, value: 30, disabled: false });
});

test('build: the defaults are 0 to 100 and the minimum when aria-valuenow is missing', () => {
  const s = nativeOf(run(page(plain({}))).tree);
  assert.deepEqual([s.native.attrs.min_value, s.native.attrs.max_value, s.native.attrs.value], [0, 100, 0]);
});

test('build: fractional ranges become whole numbers (0 to 1 at 0.37 is 0 to 100 at 37)', () => {
  const s = nativeOf(run(page(plain({ valuemin: '0', valuemax: '1', valuenow: '0.37' }))).tree);
  assert.deepEqual([s.native.attrs.min_value, s.native.attrs.max_value, s.native.attrs.value], [0, 100, 37]);
});

test('build: a hand-made slider copies the rail, the filled track and the round thumb colors and sizes', () => {
  const s = nativeOf(run(page(plain())).tree);
  const a = s.native.attrs;
  assert.equal(a.style_bg_color, '0xcbd5e1');
  assert.equal(a['style_bg_color:indicator'], '0x0d9488');
  assert.equal(a['style_bg_color:knob'], '0x0f766e');
  assert.equal(a['style_pad_all:knob'], 5, '(16 - 6) / 2');
  assert.deepEqual([s.x, s.y, s.w, s.h], [20, 68, 280, 6]);
});

test('build: Material UI reads the range input, folds the 38 percent rail into a solid color, and keeps a 30 px footprint', () => {
  const tree = run(page(mui(40))).tree;
  const wrapper = tree.children[0];
  assert.deepEqual([wrapper.w, wrapper.h], [280, 30]);
  const s = wrapper.children[0];
  assert.deepEqual([s.x, s.y, s.w, s.h], [20, 150, 280, 4]);
  assert.equal(s.native.attrs.value, 40);
  assert.equal(s.native.attrs.style_bg_color, '0xa8cbee', 'primary at 38 percent over white');
  assert.equal(s.native.attrs['style_bg_color:indicator'], '0x1976d2');
  assert.equal(s.native.attrs['style_pad_all:knob'], 8, '(20 - 4) / 2');
  assert.equal('mode' in s.native.attrs, false);
});

test('build: two thumbs make a range slider: the first is the start, the last the value, and start comes after value', () => {
  const s = nativeOf(run(page(mui(20, 70))).tree);
  assert.equal(s.native.attrs.mode, 'range');
  assert.equal(s.native.attrs.value, 70);
  assert.equal(s.native.attrs.start_value, 20);
  const keys = Object.keys(s.native.attrs);
  assert.ok(keys.indexOf('start_value') > keys.indexOf('value'), 'lv_bar_set_start_value clamps to the current value, so value first');
});

test('build: three thumbs report UNSUPPORTED_WIDGET and keep the first and last', () => {
  const { tree, diagnostics } = run(page(mui(10, 40, 90)));
  const s = nativeOf(tree);
  assert.deepEqual(diagnostics.list().map((d) => d.code), ['UNSUPPORTED_WIDGET']);
  assert.match(diagnostics.list()[0].message, /3 thumbs/);
  assert.equal(s.native.attrs.start_value, 10);
  assert.equal(s.native.attrs.value, 90);
});

test('build: Mui-disabled gives the disabled state', () => {
  const root = mui(40);
  root.children[0].classes.push('Mui-disabled');
  assert.equal(nativeOf(run(page(root)).tree).native.attrs.disabled, 'true');
});

test('convert: XML for a Material UI range slider', () => {
  const { xml } = convert(page(mui(20, 70)), { name: 'p' });
  assert.match(xml, /<lv_slider name="slider_control" x="0" y="13" width="280" height="4" mode="range" min_value="0" max_value="100" value="70" start_value="20"/);
});

test('the shipped fixture: three sliders, the last in range mode, values from ARIA and the range inputs', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/slider.json', import.meta.url), 'utf8'));
  const { xml } = convert(fixture, { name: 'slider' });
  const tags = xml.match(/<lv_slider [^>]*>/g);
  assert.equal(tags.length, 3);
  assert.deepEqual(tags.map((t) => / value="(\d+)"/.exec(t)[1]), ['65', '40', '70']);
  assert.equal(/mode="range"/.test(tags[2]), true);
});
