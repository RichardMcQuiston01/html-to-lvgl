/**
 * Progress: signals and scores, the bar and ring shapes, value scaling,
 * indeterminate handling and UNSUPPORTED_WIDGET, the native lv_bar and lv_arc
 * that build() emits, and the shipped fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateComponent, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { node } from './helpers/tree.mjs';
import progress from '../src/components/progress.mjs';

const ctx = () => ({ diagnostics: createDiagnostics(), parent: null, tree: null });
const score = (n) => Number(progress.match(n, ctx()));
const page = (...children) => node('body', { w: 320, h: 240, styles: { bgColor: [255, 255, 255, 255] } }, children);
const run = (tree) => {
  const diagnostics = createDiagnostics();
  return { tree: recognize(tree, { diagnostics }).tree, diagnostics };
};
const nativeOf = (tree) => {
  const find = (n) => (n.native ? n : n.children.map(find).find(Boolean));
  return find(tree);
};

const bar = (aria = { valuemin: '0', valuemax: '100', valuenow: '70' }, extra = {}) => node('div', {
  role: 'progressbar', aria, x: 16, y: 58, w: 288, h: 8, styles: { bgColor: [226, 232, 240, 255], radius: 4 }, ...extra,
}, [node('div', { x: 16, y: 58, w: 200, h: 8, styles: { bgColor: [22, 163, 74, 255], radius: 4 } })]);
const muiBar = (aria) => node('span', { classes: ['MuiLinearProgress-root', 'MuiLinearProgress-determinate'], role: 'progressbar', aria, x: 16, y: 124, w: 288, h: 4, styles: { bgColor: [187, 222, 251, 255] } },
  [node('span', { classes: ['MuiLinearProgress-bar'], x: -100, y: 124, w: 288, h: 4, styles: { bgColor: [25, 118, 210, 255] } })]);
const ring = (aria, classes = ['MuiCircularProgress-root', 'MuiCircularProgress-determinate']) => node('span', {
  classes, role: 'progressbar', aria, x: 16, y: 136, w: 40, h: 40, styles: { color: [25, 118, 210, 255] },
}, [node('svg', { x: 16, y: 136, w: 40, h: 40 }, [node('circle', { x: 18, y: 138, w: 36, h: 36 })])]);

test('the definition is valid and registered as "progress"', () => {
  assert.deepEqual(validateComponent(progress), { ok: true, errors: [] });
  assert.equal(progress.name, 'progress');
});

test('role="progressbar" scores 1; Material UI roots without the role 0.7; a <progress> and a plain div do not match', () => {
  assert.equal(score(bar()), 1);
  assert.equal(score(node('span', { classes: ['MuiLinearProgress-root'] })), 0.7);
  assert.equal(score(node('span', { classes: ['MuiCircularProgress-root'] })), 0.7);
  assert.equal(score(node('progress', { attrs: { value: 3, max: 10 } })), 0, 'the converter already maps <progress>');
  assert.equal(score(node('div')), 0);
  assert.equal(score({ ...bar(), hidden: true }), 0);
});

test('data-lv-widget="progress" with no ARIA or Material UI signal builds nothing', () => {
  const div = node('div', { widget: 'progress', x: 0, y: 0, w: 100, h: 8 });
  assert.equal(nativeOf(run(page(div)).tree), undefined);
});

test('build: a determinate bar is an lv_bar with the ARIA value and the page colors and radius', () => {
  const b = nativeOf(run(page(bar())).tree);
  assert.equal(b.native.tag, 'lv_bar');
  const a = b.native.attrs;
  assert.deepEqual([a.min_value, a.max_value, a.value], [0, 100, 70]);
  assert.equal(a.style_bg_color, '0xe2e8f0');
  assert.equal(a['style_bg_color:indicator'], '0x16a34a');
  assert.equal(a.style_radius, 4);
  assert.deepEqual(b.recognized.props, { variant: 'linear', value: 70, min: 0, max: 100, indeterminate: false });
});

test('build: aria-valuemin and aria-valuemax set the range and a value out of range is clamped', () => {
  const a = nativeOf(run(page(bar({ valuemin: '20', valuemax: '80', valuenow: '95' }))).tree).native.attrs;
  assert.deepEqual([a.min_value, a.max_value, a.value], [20, 80, 80]);
});

test('build: fractional values become whole numbers', () => {
  const a = nativeOf(run(page(bar({ valuemin: '0', valuemax: '1', valuenow: '0.25' }))).tree).native.attrs;
  assert.deepEqual([a.min_value, a.max_value, a.value], [0, 100, 25]);
});

test('build: Material UI LinearProgress drops its shifted bar child and uses the value', () => {
  const b = nativeOf(run(page(muiBar({ valuenow: '60', valuemin: '0', valuemax: '100' }))).tree);
  assert.equal(b.native.attrs.value, 60);
  assert.equal(b.native.attrs.style_bg_color, '0xbbdefb');
  assert.equal(b.native.attrs['style_bg_color:indicator'], '0x1976d2');
  assert.equal(b.children.length, 0);
});

test('build: a ring is an lv_arc: a full circle from 12 o\'clock, not clickable, no knob, no track, butt ends', () => {
  const r = nativeOf(run(page(ring({ valuenow: '75', valuemin: '0', valuemax: '100' }))).tree);
  assert.equal(r.native.tag, 'lv_arc');
  const a = r.native.attrs;
  assert.deepEqual([a.bg_start_angle, a.bg_end_angle, a.rotation], [0, 360, 270]);
  assert.deepEqual([a.min_value, a.max_value, a.value], [0, 100, 75]);
  assert.equal(a.clickable, 'false');
  assert.equal(a['style_bg_opa:knob'], 0);
  assert.equal(a.style_arc_opa, 0);
  assert.equal(a['style_arc_rounded:indicator'], 'false');
  assert.equal(a['style_arc_color:indicator'], '0x1976d2');
  assert.equal(a['style_arc_width:indicator'], 3, '3.6 of 44 of a 40 px ring');
  const keys = Object.keys(a);
  assert.ok(keys.indexOf('bg_start_angle') < keys.indexOf('value'), 'the angles are set before the value is turned into one');
});

test('build: a ring with no aria-valuenow is indeterminate: a static 40 percent arc and UNSUPPORTED_WIDGET', () => {
  const { tree, diagnostics } = run(page(ring({}, ['MuiCircularProgress-root', 'MuiCircularProgress-indeterminate'])));
  assert.equal(nativeOf(tree).native.attrs.value, 40);
  assert.deepEqual(diagnostics.list().map((d) => d.code), ['UNSUPPORTED_WIDGET']);
  assert.equal(diagnostics.list()[0].severity, 'warning');
  assert.match(diagnostics.list()[0].message, /lv_spinner/);
  assert.match(diagnostics.list()[0].fix, /lv_spinner/);
});

test('build: an indeterminate bar is a static 40 percent bar and reports UNSUPPORTED_WIDGET', () => {
  const { tree, diagnostics } = run(page(bar({})));
  assert.equal(nativeOf(tree).native.attrs.value, 40);
  assert.deepEqual(diagnostics.list().map((d) => d.code), ['UNSUPPORTED_WIDGET']);
});

test('a determinate progress reports nothing', () => {
  assert.deepEqual(run(page(bar(), ring({ valuenow: '10' }))).diagnostics.list(), []);
});

test('shape: an element about as wide as tall is a ring, a long one a bar', () => {
  const square = node('div', { role: 'progressbar', aria: { valuenow: '30' }, x: 0, y: 0, w: 36, h: 36 });
  assert.equal(nativeOf(run(page(square)).tree).native.tag, 'lv_arc');
  assert.equal(nativeOf(run(page(bar())).tree).native.tag, 'lv_bar');
});

test('convert: XML for a bar and a ring', () => {
  const { xml } = convert(page(bar(), ring({ valuenow: '75' })), { name: 'p' });
  assert.match(xml, /<lv_bar name="progress" x="16" y="58" width="288" height="8" min_value="0" max_value="100" value="70"/);
  assert.match(xml, /<lv_arc name="progress_2" x="16" y="136" width="40" height="40" bg_start_angle="0" bg_end_angle="360" rotation="270"/);
});

test('the shipped fixture: two bars and two rings, the last ring indeterminate', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/progress.json', import.meta.url), 'utf8'));
  const { xml, diagnostics } = convert(fixture, { name: 'progress' });
  assert.equal((xml.match(/<lv_bar /g) ?? []).length, 2);
  assert.equal((xml.match(/<lv_arc /g) ?? []).length, 2);
  assert.deepEqual(diagnostics.list().filter((d) => d.code === 'UNSUPPORTED_WIDGET').length, 1);
});
