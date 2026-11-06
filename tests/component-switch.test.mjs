/**
 * Switch: each signal and its score, the state read from ARIA, the native
 * lv_switch that build() emits, the wrapper for a toggle smaller than its
 * element, and the converter output for the shipped fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateComponent, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { node } from './helpers/tree.mjs';
import switchDef from '../src/components/switch.mjs';

const ctx = (tree = null) => ({ diagnostics: createDiagnostics(), parent: null, tree });
const score = (n) => Number(switchDef.match(n, ctx()));
const page = (...children) => node('body', { w: 320, h: 240, styles: { bgColor: [255, 255, 255, 255] } }, children);
const run = (tree) => recognize(tree, { diagnostics: createDiagnostics() }).tree;
const emitted = (tree) => convert(tree, { name: 'p' }).xml;

/** A role=switch button with a round knob child, as plain ARIA pages draw it. */
const plainSwitch = (checked, extra = {}) => node('button', {
  role: 'switch', aria: { checked: String(checked) }, x: 10, y: 10, w: 44, h: 24,
  styles: { bgColor: checked ? [37, 99, 235, 255] : [203, 213, 225, 255], radius: 12 }, ...extra,
}, [node('span', { x: checked ? 33 : 13, y: 13, w: 18, h: 18, styles: { bgColor: [255, 255, 255, 255], radius: 9 } })]);

/** A Material UI Switch: 58x38 root around a 34x14 track and a 20x20 thumb. */
const muiSwitch = ({ checked = false, disabled = false } = {}) => node('span', {
  classes: ['MuiSwitch-root', 'MuiSwitch-sizeMedium'], x: 0, y: 0, w: 58, h: 38,
  layout: { display: 'flex' },
}, [
  node('span', { classes: ['MuiSwitch-switchBase', ...(checked ? ['Mui-checked'] : []), ...(disabled ? ['Mui-disabled'] : [])], x: checked ? 20 : 0, y: 0, w: 38, h: 38 }, [
    node('input', { attrs: { type: 'checkbox', checked, disabled }, role: 'switch', classes: ['MuiSwitch-input'], x: -38, y: 0, w: 114, h: 38, styles: { opacity: 0 } }),
    node('span', { classes: ['MuiSwitch-thumb'], x: checked ? 29 : 9, y: 9, w: 20, h: 20, styles: { bgColor: checked ? [25, 118, 210, 255] : [250, 250, 250, 255], radius: 10, shadow: { color: [0, 0, 0, 51], blur: 3, x: 0, y: 1, spread: 0 } } }),
  ]),
  node('span', { classes: ['MuiSwitch-track'], x: 12, y: 12, w: 34, h: 14, styles: { bgColor: checked ? [25, 118, 210, 255] : [0, 0, 0, 255], opacity: checked ? 0.5 : 0.38, radius: 7 } }),
]);

const nativeOf = (tree) => {
  const find = (n) => (n.native ? n : n.children.map(find).find(Boolean));
  return find(tree);
};

test('the definition is valid and registered as "switch"', () => {
  assert.deepEqual(validateComponent(switchDef), { ok: true, errors: [] });
  assert.equal(switchDef.name, 'switch');
});

test('role="switch" scores 1; a Material UI root 0.7; a bare element and a plain checkbox do not match', () => {
  assert.equal(score(plainSwitch(true)), 1);
  assert.equal(score(muiSwitch()), 0.7);
  assert.equal(score(node('div')), 0);
  assert.equal(score(node('input', { attrs: { type: 'checkbox' }, w: 14, h: 14 })), 0);
  assert.equal(score(node('button', { role: 'button' })), 0);
});

test('a visually hidden role=switch input is not the toggle, its wrapper is (when it has no text)', () => {
  const hiddenInput = node('input', { role: 'switch', attrs: { type: 'checkbox', checked: true }, w: 1, h: 1 });
  const slider = node('span', { x: 0, y: 0, w: 40, h: 22, styles: { bgColor: [37, 99, 235, 255] } });
  assert.equal(score(hiddenInput), 0);
  assert.equal(score(node('label', { w: 40, h: 22 }, [hiddenInput, slider])), 0.9);
  assert.equal(score(node('label', { w: 100, h: 22 }, [hiddenInput, node('span', { text: 'Wi-Fi' })])), 0, 'a label with text is a FormControlLabel, not the toggle');
});

test('a hidden node never matches', () => {
  assert.equal(score({ ...plainSwitch(true), hidden: true }), 0);
});

test('data-lv-widget="switch" with no ARIA or Material UI signal keeps the converter mapping', () => {
  const div = node('div', { widget: 'switch', x: 0, y: 0, w: 40, h: 20 });
  const tree = run(page(div));
  assert.equal(nativeOf(tree), undefined);
  assert.match(emitted(page(div)), /<lv_switch /);
});

test('build: aria-checked="true" gives checked, the track color is the page color, the knob is white', () => {
  const tree = run(page(plainSwitch(true)));
  const sw = nativeOf(tree);
  assert.equal(sw.native.tag, 'lv_switch');
  assert.equal(sw.native.attrs.checked, 'true');
  assert.equal(sw.native.attrs['style_bg_color:checked:indicator'], '0x2563eb');
  assert.equal(sw.native.attrs['style_bg_color:checked:knob'], '0xffffff');
  assert.deepEqual([sw.x, sw.y, sw.w, sw.h], [10, 10, 44, 24]);
  assert.deepEqual(sw.recognized.props, { checked: true, disabled: false });
});

test('build: aria-checked="false" gives an unchecked switch with the off colors on the plain selectors', () => {
  const sw = nativeOf(run(page(plainSwitch(false))));
  assert.equal('checked' in sw.native.attrs, false);
  assert.equal(sw.native.attrs['style_bg_color:indicator'], '0xcbd5e1');
  assert.equal(sw.native.attrs['style_bg_color:knob'], '0xffffff');
});

test('build: the track is drawn by the indicator part, so the main part is clear and padded', () => {
  const a = nativeOf(run(page(muiSwitch()))).native.attrs;
  assert.equal(a.style_bg_opa, 0);
  assert.equal(a['style_bg_opa:indicator'], 255);
  assert.equal(a['style_pad_all:knob'], 0);
  assert.equal(a.style_pad_hor, 3);
  assert.equal(a.style_pad_ver, 3);
});

test('build: Material UI state comes from the checkbox, the opacity is folded into the track color', () => {
  const on = nativeOf(run(page(muiSwitch({ checked: true }))));
  assert.equal(on.native.attrs.checked, 'true');
  assert.equal(on.native.attrs['style_bg_color:checked:indicator'], '0x8cbae8', 'primary at 50 percent over white');
  assert.equal(on.native.attrs['style_bg_color:checked:knob'], '0x1976d2');
  const off = nativeOf(run(page(muiSwitch())));
  assert.equal(off.native.attrs['style_bg_color:indicator'], '0x9e9e9e', 'black at 38 percent over white');
  assert.equal(off.native.attrs['style_bg_color:knob'], '0xfafafa');
});

test('build: the thumb shadow becomes the knob shadow', () => {
  const a = nativeOf(run(page(muiSwitch()))).native.attrs;
  assert.equal(a['style_shadow_width:knob'], 3);
  assert.equal(a['style_shadow_offset_y:knob'], 1);
});

test('build: Mui-disabled gives the disabled state', () => {
  assert.equal(nativeOf(run(page(muiSwitch({ disabled: true })))).native.attrs.disabled, 'true');
});

test('build: the toggle is 40x20 inside a wrapper that keeps the 58x38 Material UI footprint', () => {
  const tree = run(page(muiSwitch({ checked: true })));
  const wrapper = tree.children[0];
  assert.deepEqual([wrapper.w, wrapper.h], [58, 38]);
  assert.equal(wrapper.layout.display, 'block');
  const sw = wrapper.children[0];
  assert.deepEqual([sw.x, sw.y, sw.w, sw.h], [9, 9, 40, 20]);
  assert.equal(sw.native.tag, 'lv_switch');
});

test('build: the wrapper of a hidden checkbox puts the switch on the drawn slider', () => {
  const input = node('input', { role: 'switch', attrs: { type: 'checkbox', checked: true }, w: 1, h: 1 });
  const slider = node('span', { x: 20, y: 20, w: 40, h: 22, styles: { bgColor: [37, 99, 235, 255], radius: 11 } });
  const sw = nativeOf(run(page(node('label', { x: 10, y: 10, w: 60, h: 40 }, [input, slider]))));
  assert.equal(sw.native.attrs.checked, 'true');
  assert.deepEqual([sw.x, sw.y, sw.w, sw.h], [20, 20, 40, 22]);
});

test('convert: the XML has one lv_switch placed by its box, with part and state styles', () => {
  const { xml } = convert(page(plainSwitch(true)), { name: 'p' });
  assert.match(xml, /<lv_switch name="switch" x="10" y="10" width="44" height="24" checked="true"/);
  assert.match(xml, /style_bg_color:checked:indicator="0x2563eb"/);
  assert.equal(xml.match(/<lv_switch /g).length, 1);
  assert.equal(/<lv_button|<lv_checkbox/.test(xml), false, 'the knob child and the button are gone');
});

test('the shipped fixture: both ARIA and Material UI switches become lv_switch with the page state', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/switch.json', import.meta.url), 'utf8'));
  const { xml } = convert(fixture, { name: 'switch' });
  const switches = xml.match(/<lv_switch [^>]*>/g);
  assert.equal(switches.length, 4);
  assert.deepEqual(switches.map((s) => /checked="true"/.test(s)), [true, false, true, false]);
});
