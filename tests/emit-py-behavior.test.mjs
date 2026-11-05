/**
 * MicroPython output for the Phase 8 behavior IR (src/emit-py.mjs). The
 * generated module is executed for real in CI (spike/micropython/
 * run_py_behavior.py, pinned lv_binding_micropython); these tests pin its text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { demoRegistry } from './helpers/disclosure-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'disclosure.json'), 'utf8'));
const { view } = convert(fixture, { name: 'disclosure', screenMode: true, registry: demoRegistry() });
const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const { py, unit } = emitPy(view, { name: 'disclosure', symbol: 'ui_disclosure_create' });

test('golden: behavior fixture emits the committed MicroPython module', () => {
  assert.equal(py, readFileSync(join(here, 'golden-behavior', `${unit}.py`), 'utf8'));
});

test('subjects are created before any widget, with their initial values', () => {
  const body = py.slice(py.indexOf('def ui_disclosure_create'));
  const firstWidget = body.indexOf('root = lv.obj');
  for (const [name, initial] of [['disclosure_p1_open', 0], ['disclosure_p2_open', 1], ['disclosure_dlg_open', 0]]) {
    const at = body.indexOf(`_subject("${name}", ${initial})`);
    assert.ok(at > 0 && at < firstWidget, `${name} declared up front`);
  }
});

test('events and binds come from meta.behavior; no XML behavior elements leak into the Python', () => {
  assert.match(py, /\.add_event_cb\(_toggle_subject\(subjects\["disclosure_p1_open"\]\), lv\.EVENT\.CLICKED, None\)/);
  assert.match(py, /\.add_event_cb\(_set_subject\(subjects\["disclosure_dlg_open"\], 1\), lv\.EVENT\.CLICKED, None\)/);
  assert.match(py, /\.bind_flag_if_eq\(subjects\["disclosure_p1_open"\], lv\.obj\.FLAG\.HIDDEN, 0\)/);
  assert.doesNotMatch(code(py), /unmapped attribute|subject_toggle_event|bind_flag_if_eq"/);
});

test('only calls the pinned binding actually has: no lv_obj_add_subject_*_event', () => {
  assert.doesNotMatch(code(py), /add_subject_(toggle|set_int)_event/);
  assert.match(py, /Stand-in for lv_obj_add_subject_toggle_event/);
});

test('a page without behavior gets no subject machinery', () => {
  const plain = emitPy({ tag: 'view', attrs: {}, children: [] }, { name: 'plain' }).py;
  assert.doesNotMatch(plain, /subject/);
});

test('a library XML component instance becomes a comment, not a nonexistent lv.<tag>', () => {
  const out = emitPy({ tag: 'view', attrs: {}, children: [{ tag: 'ui_accordion', attrs: { name: 'a' }, children: [] }] }, { name: 'x' }).py;
  assert.match(out, /# unsupported: <ui_accordion>/);
  assert.doesNotMatch(out, /lv\.ui_accordion/);
});
