/**
 * C and C++ output for the behavior IR (Phase 8 lane B): subjects, events,
 * binds and library XML component instances. The committed goldens are
 * compiled and click-driven in real LVGL by spike/subjects/run-c.sh (CI job
 * validate-xml); these tests pin the text and the rules behind it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { demoRegistry } from './helpers/disclosure-demo.mjs';
import { convertInstances } from './helpers/xml-instance-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const golden = (file) => readFileSync(join(here, 'golden-behavior', file), 'utf8');
const disclosure = () => convert(JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'disclosure.json'), 'utf8')), { name: 'disclosure', screenMode: true, registry: demoRegistry() });
const opts = (name, r) => ({ name, symbol: `ui_${name}_create`, subjects: r.subjects });

test('golden: disclosure fixture emits the committed C and C++', () => {
  const r = disclosure();
  const c = emitC(r.view, opts('disclosure', r));
  const cpp = emitCpp(r.view, opts('disclosure', r));
  assert.equal(c.c, golden('ui_disclosure.c'));
  assert.equal(c.h, golden('ui_disclosure.h'));
  assert.equal(cpp.c, golden('ui_disclosure.cpp'));
  assert.equal(cpp.h, golden('ui_disclosure.hpp'));
});

test('golden: library component instances emit the committed C and C++', () => {
  const r = convertInstances();
  assert.equal(emitC(r.view, opts('acc_instances', r)).c, golden('ui_acc_instances.c'));
  assert.equal(emitCpp(r.view, opts('acc_instances', r)).c, golden('ui_acc_instances.cpp'));
});

test('subjects are initialised once, registered with the XML runtime, and reset on re-create', () => {
  const { c } = emitC(disclosure().view, { name: 'disclosure', symbol: 'ui_disclosure_create' });
  assert.match(c, /static lv_subject_t subject_disclosure_p1_open;/);
  assert.match(c, /lv_subject_init_int\(&subject_disclosure_p2_open, 1\);/);
  assert.match(c, /#if LV_USE_XML\n\s+lv_xml_register_subject\(NULL, "disclosure_p1_open", &subject_disclosure_p1_open\);/);
  assert.match(c, /lv_subject_set_int\(&subject_disclosure_dlg_open, 0\);/); // the re-create branch
  assert.match(c, /\{\n    init_subjects\(\);\n/);
});

test('events and binds use the LVGL 9.4 observer API and the XML child elements are not emitted twice', () => {
  const { c } = emitC(disclosure().view, { name: 'disclosure' });
  assert.match(c, /lv_obj_add_subject_toggle_event\(h1, &subject_disclosure_p1_open, LV_EVENT_CLICKED\);/);
  assert.match(c, /lv_obj_add_subject_set_int_event\(openbtn, &subject_disclosure_dlg_open, LV_EVENT_CLICKED, 1\);/);
  assert.match(c, /lv_obj_bind_flag_if_eq\(p1, &subject_disclosure_p1_open, LV_OBJ_FLAG_HIDDEN, 0\);/);
  assert.ok(!c.includes('unmapped attribute'));
  assert.ok(!/_w\d* = lv_obj_create|subject_toggle_event_create/.test(c));
});

test('opts.subjects is optional: subjects come from meta.behavior and a bare reference starts at 0', () => {
  const view = {
    tag: 'view', attrs: { width: 10 },
    meta: { behavior: { subjects: [{ name: 'p_a', type: 'int', initial: 3 }], events: [], binds: [{ kind: 'flag', subject: 'p_b', flag: 'clickable', op: 'gt', ref: 2 }] } },
    children: [],
  };
  const { c } = emitC(view, { name: 'p' });
  assert.match(c, /lv_subject_init_int\(&subject_p_a, 3\);/);
  assert.match(c, /lv_subject_init_int\(&subject_p_b, 0\);/);
  assert.match(c, /lv_obj_bind_flag_if_gt\(root, &subject_p_b, LV_OBJ_FLAG_CLICKABLE, 2\);/);
});

test('an event trigger other than clicked maps to its LV_EVENT_ code', () => {
  const view = { tag: 'view', attrs: {}, meta: { behavior: { subjects: [{ name: 's', type: 'int', initial: 0 }], events: [{ kind: 'toggle', subject: 's', trigger: 'value_changed' }], binds: [] } }, children: [] };
  assert.match(emitC(view, { name: 'p' }).c, /lv_obj_add_subject_toggle_event\(root, &subject_s, LV_EVENT_VALUE_CHANGED\);/);
});

test('an xmlComponent instance becomes lv_xml_create with the subject name as a prop, cast for C++', () => {
  const r = convertInstances();
  const c = emitC(r.view, opts('acc_instances', r)).c;
  const cpp = emitCpp(r.view, opts('acc_instances', r)).c;
  for (const out of [c, cpp]) {
    assert.match(out, /"subj", "acc_instances_acca_open", NULL\};/);
    assert.match(out, /lv_obj_t \* acca = \(lv_obj_t \*\)lv_xml_create\(root, "ui_acc_g", xml_attrs_1\);/);
    assert.match(out, /#if !LV_USE_XML\n#error/);
  }
});

test('output without behavior is unchanged: no subject code, no XML guard', () => {
  const r = convert(JSON.parse(readFileSync(join(here, 'fixtures', 'login.json'), 'utf8')), { name: 'login' });
  const { c } = emitC(r.view, { name: 'login' });
  assert.ok(!/subject|LV_USE_XML/.test(c));
});
