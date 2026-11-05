/**
 * Phase 8 lane F: timelines in the C, C++ and MicroPython emitters, the
 * BEHAVIOR_TIMELINE_CONFLICT diagnostic, the optimizer's own-layout collapse
 * decision, and text-align on buttons. The generated Drawer is click-driven in
 * real LVGL for XML, C, C++ (spike/subjects/run-components.sh, run-c.sh) and on
 * the pinned MicroPython binding (spike/micropython/driver_py.py); these tests
 * pin the text and the rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { optimize } from '../src/optimize.mjs';
import { createRegistry } from '../src/recognize.mjs';
import { slideTimeline, withBehavior, playEvent, TIMELINE_PROPS } from '../src/behavior.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { node } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const drawerTree = () => JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'drawer.json'), 'utf8'));
const drawer = () => convert(drawerTree(), { name: 'drawer', screenMode: true });
const opts = (r) => ({ name: 'drawer', symbol: 'ui_drawer_create', subjects: r.subjects });

/** A page with one opener button and one panel that slides in on click. */
function slidePage({ prop = 'translate_x', timeline = slideTimeline('slide', prop, -100, 0, 200), play = true } = {}) {
  const panel = withBehavior(node('div', { id: 'panel', lvName: 'sheet', x: 0, y: 0, w: 100, h: 100 }), { timelines: [timeline] });
  const opener = withBehavior(node('button', { id: 'opener', lvName: 'opener', text: 'Go', y: 120, w: 60, h: 30 }),
    play ? { events: [playEvent('slide')] } : {});
  const body = node('body', { w: 320, h: 240 }, [opener, panel]);
  return convert(body, { name: 'p', screenMode: true, registry: createRegistry([]) });
}

test('C: timelines use lv_anim_timeline_create/add and lv_obj_add_play_timeline_event, after the whole tree', () => {
  const r = drawer();
  const { c } = emitC(r.view, opts(r));
  assert.doesNotMatch(c, /TODO/);
  assert.equal((c.match(/lv_anim_timeline_create\(\)/g) ?? []).length, 4);
  assert.match(c, /lv_anim_set_var\(&tl_anim, nav_sheet\);\n\s+lv_anim_set_values\(&tl_anim, -216, 0\);\n\s+lv_anim_set_duration\(&tl_anim, 250\);/);
  assert.match(c, /lv_anim_timeline_add\(timeline_body_div_3_slide_in, 0, &tl_anim\);/);
  assert.match(c, /lv_obj_add_play_timeline_event\(open_plain, LV_EVENT_CLICKED, timeline_body_div_3_slide_in, 0, false\);/);
  // the opener comes before the panel it moves, so the timeline code has to come after both
  const opener = c.indexOf('lv_obj_t * open_plain =');
  const panel = c.indexOf('lv_obj_t * nav_sheet =');
  const firstTimeline = c.indexOf('lv_anim_timeline_create()');
  assert.ok(opener < panel && panel < firstTimeline);
  // a timeline is freed with the screen, and the exec callback writes the style property
  assert.match(c, /lv_obj_add_event_cb\(root, timeline_delete_cb, LV_EVENT_DELETE, timeline_body_div_3_slide_in\);/);
  assert.match(c, /static void timeline_set_translate_x\(void \* var, int32_t value\)\n\{\n    lv_obj_set_style_translate_x\(\(lv_obj_t \*\)var, value, 0\);/);
  assert.equal((c.match(/static void timeline_set_translate_x/g) ?? []).length, 1);
});

test('C++ gets the same timeline statements as C; a page without timelines gets none of it', () => {
  const r = drawer();
  const c = emitC(r.view, opts(r)).c;
  const cpp = emitCpp(r.view, opts(r)).c;
  assert.equal(cpp.replace(/\.hpp/, '.h'), c);
  const plain = emitC({ tag: 'view', attrs: {}, children: [] }, { name: 'plain' }).c;
  assert.doesNotMatch(plain, /timeline|anim/);
});

test('the committed goldens carry the timelines for C, C++ and MicroPython', () => {
  for (const file of ['ui_drawer.c', 'ui_drawer.cpp', 'ui_drawer_edges.c', 'ui_drawer_edges.cpp']) {
    assert.match(readFileSync(join(here, 'golden-behavior', file), 'utf8'), /lv_obj_add_play_timeline_event/, file);
  }
  for (const file of ['ui_drawer.py', 'ui_drawer_edges.py']) {
    assert.match(readFileSync(join(here, 'golden-behavior', file), 'utf8'), /_play_timeline\(/, file);
  }
});

test('translate_y and other integer style props go through their own setter', () => {
  const r = slidePage({ prop: 'translate_y', timeline: slideTimeline('slide', 'translate_y', 0, 50, 100) });
  const c = emitC(r.view, { name: 'p', symbol: 'ui_p_create', subjects: r.subjects }).c;
  assert.match(c, /lv_obj_set_style_translate_y\(\(lv_obj_t \*\)var, value, 0\);/);
  assert.match(c, /lv_anim_set_exec_cb\(&tl_anim, timeline_set_translate_y\);/);
  const { py } = emitPy(r.view, { name: 'p', symbol: 'ui_p_create' });
  assert.match(py, /\(sheet, "translate_y", 0, 50, 100, 0\),/);
});

test('a play event whose timeline is missing, or an animation whose target is missing, emits a comment, not a call', () => {
  const orphan = { tag: 'view', attrs: {}, meta: {}, children: [
    { tag: 'lv_obj', attrs: { name: 'b' }, children: [], meta: { behavior: { events: [{ kind: 'play', timeline: 'nope' }], subjects: [], binds: [], timelines: [] } } },
    { tag: 'lv_obj', attrs: { name: 'c' }, children: [], meta: { behavior: { events: [], subjects: [], binds: [], timelines: [{ name: 't', animations: [{ prop: 'translate_x', target: 'ghost', start: 0, end: 1, duration: 10 }] }] } } },
  ] };
  const c = emitC(orphan, { name: 'o' }).c;
  const py = emitPy(orphan, { name: 'o' }).py;
  assert.match(c, /no timeline named nope/);
  assert.match(c, /skipped an animation of translate_x on ghost \(no such widget\)/);
  assert.doesNotMatch(c, /lv_anim_set_var\(&tl_anim, ghost\)|add_play_timeline_event\(b/);
  assert.match(py, /no timeline named nope/);
  assert.match(py, /skipped an animation of translate_x on ghost/);
  assert.doesNotMatch(py, /\(ghost,/);
});

test('MicroPython: lv.anim_t list started by a click handler; objects kept alive; only binding calls', () => {
  const r = drawer();
  const { py } = emitPy(r.view, { name: 'drawer', symbol: 'ui_drawer_create' });
  assert.doesNotMatch(py, /TODO/);
  assert.match(py, /_timeline\("body_div_3_slide_in", \[\n\s+\(nav_sheet, "translate_x", -216, 0, 250, 0\),\n\s+\]\)/);
  assert.match(py, /open_plain\.add_event_cb\(_play_timeline\("body_div_3_slide_in"\), lv\.EVENT\.CLICKED, None\)/);
  assert.match(py, /anim\.set_custom_exec_cb\(_set_prop\(target, prop\)\)/); // set_exec_cb rejects a closure
  assert.match(py, /^timelines = \{\}$/m); // a collected lv.anim_t crashes the binding
  assert.doesNotMatch(py, /anim_timeline|add_play_timeline_event\(/); // neither exists in the pinned binding
  // timelines are set up after the last widget is created
  assert.ok(py.indexOf('    _timeline("body_div_4_slide_out"') > py.indexOf('    filters = lv.obj(root)'));
});

test('slideTimeline rejects a property the emitters could not drive', () => {
  assert.throws(() => slideTimeline('x', 'bg_color', 0, 1), /not an animatable integer style property/);
  assert.ok(TIMELINE_PROPS.has('translate_x') && TIMELINE_PROPS.has('opa') && !TIMELINE_PROPS.has('bg_color'));
});

test('golden-behavior C and C++ entry points are valid C identifiers (drawer-edges is drawer_edges)', () => {
  const files = readdirSync(join(here, 'golden-behavior')).filter((f) => /^ui_.*\.(c|cpp)$/.test(f));
  assert.ok(files.includes('ui_drawer_edges.c') && !files.some((f) => f.includes('-')));
  for (const f of files) {
    const symbol = /lv_obj_t \* (\S+)_create\(lv_obj_t \* parent\)/.exec(readFileSync(join(here, 'golden-behavior', f), 'utf8'))?.[1];
    assert.match(symbol ?? '', /^[A-Za-z_][A-Za-z0-9_]*$/, f);
  }
});

/* ------------------------------------------------ BEHAVIOR_TIMELINE_CONFLICT */

test('two different timelines with one name raise BEHAVIOR_TIMELINE_CONFLICT, not the subject code', () => {
  const a = withBehavior(node('div', { id: 'a' }), { timelines: [slideTimeline('same', 'translate_x', 0, 1)] });
  const b = withBehavior(node('div', { id: 'b' }), { timelines: [slideTimeline('same', 'translate_x', 0, 2)] });
  const r = convert(node('body', { w: 320, h: 240 }, [a, b]), { name: 'p', screenMode: true });
  const codes = r.diagnostics.list().map((d) => d.code);
  assert.ok(codes.includes('BEHAVIOR_TIMELINE_CONFLICT'));
  assert.ok(!codes.includes('BEHAVIOR_SUBJECT_CONFLICT'));
  assert.equal(r.timelines.length, 1);
  assert.equal(r.timelines[0].animations[0].end, 1); // the first declaration wins
  assert.equal(createDiagnostics().add({ code: 'BEHAVIOR_TIMELINE_CONFLICT', message: 'm' }).severity, 'warning');
});

test('the same timeline with the same target declared twice is not a conflict', () => {
  const timeline = { name: 'same', animations: [{ prop: 'translate_x', start: 0, end: 1, duration: 10, target: 'w' }] };
  const a = withBehavior(node('div', { id: 'a', lvName: 'w' }), { timelines: [timeline] });
  const b = withBehavior(node('div', { id: 'b', lvName: 'v' }), { timelines: [structuredClone(timeline)] });
  const r = convert(node('body', { w: 320, h: 240 }, [a, b]), { name: 'p', screenMode: true });
  assert.ok(!r.diagnostics.list().some((d) => d.code === 'BEHAVIOR_TIMELINE_CONFLICT'));
});

/* --------------------------------------------------------------- optimizer */

const wrapper = (parentDisplay, wrapperDisplay) => {
  const leaf = node('span', { x: 0, y: 0, w: 10, h: 10 });
  const inert = node('div', { layout: { display: wrapperDisplay }, w: 10, h: 10 }, [leaf]);
  const middle = node('div', { layout: { display: parentDisplay }, w: 50, h: 50, styles: { bgColor: [1, 2, 3, 255] } }, [inert]);
  return node('body', { w: 320, h: 240 }, [node('div', { layout: { display: 'block' }, w: 100, h: 100, styles: { bgColor: [9, 9, 9, 255] } }, [middle])]);
};

test('optimizer decides on the wrapper\'s own parent: collapses inside a block parent, keeps inside a flex parent', () => {
  // grandparent flex, parent block: the wrapper is NOT placed by flex, so it collapses (it was kept before the fix)
  const flexAbove = wrapper('block', 'block');
  flexAbove.children[0].layout.display = 'flex';
  assert.equal(optimize(structuredClone(flexAbove)).removed, 1);
  // grandparent block, parent flex: the flex parent places the wrapper, so it must stay (it was dropped before the fix)
  assert.equal(optimize(structuredClone(wrapper('flex', 'block'))).removed, 0);
});

/* ------------------------------------------------------ button text-align */

test('a button with text-align: left puts its label at the left, inset by its padding; the default stays centered', () => {
  const button = (textAlign, padLeft = 0, padRight = 0) => node('button', { text: 'Menu', w: 100, h: 30, styles: { textAlign, padLeft, padRight } });
  const label = (b) => /<lv_label [^>]*>/.exec(convert(node('body', { w: 320, h: 240 }, [b]), { name: 'p' }).xml)[0];
  assert.match(label(button('left', 10)), /align="left_mid" x="10"/);
  assert.match(label(button('start')), /align="left_mid"(?! x=)/);
  assert.match(label(button('right', 0, 8)), /align="right_mid" x="-8"/);
  assert.match(label(button('center')), /align="center"/);
  assert.match(label(button('justify')), /align="center"/);
});
