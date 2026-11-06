/**
 * The converter and emitter support the Phase 9 native-widget definitions need:
 * `native` nodes, chained state and part selectors, lv_arc and the slider range
 * calls, the `disabled` state and `clickable`, in XML, C, C++ and MicroPython.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node } from './helpers/tree.mjs';
import { nativeNode, scaleToIntegers, solidColor, fillOf } from '../src/components/native.mjs';

const page = (...children) => node('body', { w: 320, h: 240 }, children);
const native = (tag, attrs, extra = {}) => ({ ...node('div', { x: 10, y: 10, w: 40, h: 20, ...extra }), recognized: { component: 'test', props: {} }, native: { tag, attrs } });
const view = (...children) => convert(page(...children), { name: 'p' }).view;

test('a native node becomes that widget, placed by its own box, and its children are not emitted', () => {
  const n = native('lv_switch', { checked: 'true' });
  n.children = [node('span', { text: 'ignored' })];
  const { xml } = convert(page(n), { name: 'p' });
  assert.match(xml, /<lv_switch name="switch" x="10" y="10" width="40" height="20" checked="true" \/>/);
  assert.equal(xml.includes('ignored'), false);
});

test('a native node is named after its widget, numbered when repeated, and keeps the author name', () => {
  const { xml } = convert(page(native('lv_slider', {}), native('lv_slider', {}), native('lv_slider', {}, { lvName: 'volume' })), { name: 'p' });
  assert.match(xml, /name="slider"/);
  assert.match(xml, /name="slider_2"/);
  assert.match(xml, /name="volume"/);
});

test('fontText picks the font and text color from the node, and centerLine centers one line', () => {
  const n = native('lv_textarea', { one_line: 'true' }, { h: 30, styles: { fontSize: 12, color: [10, 20, 30, 255] } });
  n.native.fontText = 'hello';
  n.native.centerLine = 1;
  const { xml } = convert(page(n), { name: 'p' });
  assert.match(xml, /style_text_font="montserrat_12" style_text_color="0x0a141e"/);
  assert.match(xml, /style_pad_ver="(\d+)"/);
  const pad = Number(/style_pad_ver="(\d+)"/.exec(xml)[1]);
  assert.ok(pad > 0 && pad < 15, `centered padding ${pad}`);
});

test('XML keeps the chained selector as written', () => {
  const { xml } = convert(page(native('lv_switch', { 'style_bg_color:checked:indicator': '0x2563eb' })), { name: 'p' });
  assert.match(xml, /style_bg_color:checked:indicator="0x2563eb"/);
});

const widgets = () => view(
  native('lv_switch', { checked: 'true', disabled: 'true', 'style_bg_color:checked:indicator': '0x2563eb', 'style_pad_all:knob': 0 }, { lvName: 'sw' }),
  native('lv_slider', { mode: 'range', min_value: 0, max_value: 100, value: 70, start_value: 20, 'style_bg_color:knob': '0x0f766e' }, { lvName: 'sl' }),
  native('lv_arc', { bg_start_angle: 0, bg_end_angle: 360, rotation: 270, min_value: 0, max_value: 100, value: 75, clickable: 'false', style_arc_rounded: 'false', 'style_arc_color:indicator': '0x1976d2' }, { lvName: 'ar' }),
);

test('C: chained states and parts become OR-ed selectors, the switch state calls, and lv_arc calls', () => {
  const { c } = emitC(widgets(), { name: 'p' });
  assert.match(c, /lv_obj_set_state\(sw, LV_STATE_CHECKED, true\);/);
  assert.match(c, /lv_obj_set_state\(sw, LV_STATE_DISABLED, true\);/);
  assert.match(c, /lv_obj_set_style_bg_color\(sw, lv_color_hex\(0x2563eb\), LV_STATE_CHECKED \| LV_PART_INDICATOR\);/);
  assert.match(c, /lv_obj_set_style_pad_all\(sw, 0, LV_PART_KNOB\);/);
  assert.match(c, /lv_slider_set_mode\(sl, LV_SLIDER_MODE_RANGE\);/);
  assert.match(c, /lv_slider_set_start_value\(sl, 20, LV_ANIM_OFF\);/);
  assert.match(c, /lv_obj_set_style_bg_color\(sl, lv_color_hex\(0x0f766e\), LV_PART_KNOB\);/);
  assert.match(c, /lv_arc_set_bg_start_angle\(ar, 0\);/);
  assert.match(c, /lv_arc_set_rotation\(ar, 270\);/);
  assert.match(c, /lv_arc_set_value\(ar, 75\);/);
  assert.match(c, /lv_obj_set_flag\(ar, LV_OBJ_FLAG_CLICKABLE, false\);/);
  assert.match(c, /lv_obj_set_style_arc_rounded\(ar, false, 0\);/);
  assert.equal(c.includes('unmapped attribute'), false);
});

test('C++ output is the same statements', () => {
  const { c } = emitC(widgets(), { name: 'p' });
  const { c: cpp } = emitCpp(widgets(), { name: 'p' });
  assert.equal(cpp.includes('LV_STATE_CHECKED | LV_PART_INDICATOR'), true);
  assert.equal(cpp.includes('lv_arc_set_value(ar, 75);'), true);
  assert.equal(cpp.includes('unmapped attribute'), false);
  assert.equal(c.split('lv_obj_set_style_').length, cpp.split('lv_obj_set_style_').length);
});

test('MicroPython: part selectors, the state calls, the slider range calls and the arc calls the pinned binding has', () => {
  const { py } = emitPy(widgets(), { name: 'p' });
  assert.match(py, /sw\.set_state\(lv\.STATE\.CHECKED, True\)/);
  assert.match(py, /sw\.set_state\(lv\.STATE\.DISABLED, True\)/);
  assert.match(py, /sw\.set_style_bg_color\(lv\.color_hex\(0x2563eb\), lv\.STATE\.CHECKED \| lv\.PART\.INDICATOR\)/);
  assert.match(py, /sw\.set_style_pad_all\(0, lv\.PART\.KNOB\)/);
  assert.match(py, /sl\.set_range\(0, 100\)/);
  assert.match(py, /sl\.set_mode\(lv\.slider\.MODE\.RANGE\)/);
  assert.match(py, /sl\.set_start_value\(20, False\)/);
  assert.match(py, /ar\.set_range\(0, 100\)/);
  assert.match(py, /ar\.set_bg_start_angle\(0\)/);
  assert.match(py, /ar\.set_rotation\(270\)/);
  assert.match(py, /ar\.set_value\(75\)/);
  assert.match(py, /ar\.set_flag\(lv\.obj\.FLAG\.CLICKABLE, False\)/);
  assert.match(py, /ar\.set_style_arc_rounded\(False, 0\)/, 'a Python bool, not the XML word');
  assert.equal(py.includes('min_value'), false, 'the binding has no separate min and max setters');
  assert.equal(py.includes('unmapped attribute'), false);
});

test('existing pressed-state selectors still come out as before', () => {
  const button = node('button', { x: 0, y: 0, w: 60, h: 30, text: 'Go', styles: { bgColor: [0, 0, 255, 255], pressed: { bgColor: [0, 0, 200, 255] } } });
  const v = view(button);
  assert.match(emitC(v, { name: 'p' }).c, /lv_obj_set_style_bg_color\(button, lv_color_hex\(0x0000c8\), LV_STATE_PRESSED\);/);
  assert.match(emitPy(v, { name: 'p' }).py, /set_style_bg_color\(lv\.color_hex\(0x0000c8\), lv\.STATE\.PRESSED\)/);
});

test('scaleToIntegers: the smallest power of ten that makes every number whole', () => {
  assert.deepEqual(scaleToIntegers([0, 100, 40]), { scale: 1, values: [0, 100, 40] });
  assert.deepEqual(scaleToIntegers([0, 1, 0.5]), { scale: 10, values: [0, 10, 5] });
  assert.deepEqual(scaleToIntegers([0, 1, 0.37]), { scale: 100, values: [0, 100, 37] });
  assert.deepEqual(scaleToIntegers([0, 1, 0.0004]).scale, 1000);
});

test('solidColor and fillOf fold transparency and opacity over the backdrop', () => {
  assert.deepEqual(solidColor([0, 0, 0, 97], null), [158, 158, 158]);
  assert.equal(solidColor([0, 0, 0, 0], null), null);
  assert.deepEqual(solidColor([10, 20, 30, 255], [1, 1, 1]), [10, 20, 30]);
  assert.deepEqual(fillOf({ styles: { bgColor: [0, 0, 0, 255], opacity: 0.38 } }, [255, 255, 255]), [158, 158, 158]);
  assert.equal(fillOf({ styles: { bgColor: null } }, null), null);
});

test('nativeNode drops the children and the data-lv-widget name, and can override the box', () => {
  const out = nativeNode(node('div', { widget: 'slider', x: 1, y: 2, w: 3, h: 4 }, [node('span')]), 'lv_slider', { value: 1 }, { box: { x: 5, y: 6, w: 7, h: 8 } });
  assert.deepEqual([out.x, out.y, out.w, out.h, out.children.length, out.widget], [5, 6, 7, 8, 0, null]);
  assert.deepEqual(out.native, { tag: 'lv_slider', attrs: { value: 1 } });
});
