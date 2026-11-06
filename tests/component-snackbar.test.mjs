/**
 * Snackbar component: match signals and scores (and that a floating live
 * region beats Alert while an in-flow one does not), near misses, data-lv-widget
 * forcing, what build() returns (a floating overlay at the measured position,
 * one subject, closers and an opener), static and hidden-without-opener cases,
 * Material UI's root with an inner role=alert, and the generated XML, C and
 * MicroPython. The committed fixture is compared with its goldens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import snackbar from '../src/components/snackbar.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (children) => node('body', { w: 320, h: 240, layout: { display: 'flex', flexDirection: 'column', position: 'static' } }, children);
const floating = { position: 'fixed' };
const button = (text, extra = {}) => node('button', { text, w: 50, h: 24, ...extra });
const bar = (extra = {}, children = [button('Undo', { x: 240, y: 200 })]) => node('div', {
  id: 'bar', role: 'status', x: 12, y: 190, w: 296, h: 40, layout: floating,
  styles: { bgColor: [50, 50, 50, 255], radius: 4 }, text: null, ...extra,
}, [node('span', { text: 'Note archived', x: 24, y: 200, w: 100, h: 16 }), ...children]);
const opener = (target, extra = {}) => button('Show', { id: 'show', aria: { controls: target }, x: 12, y: 40, ...extra });

const run = (tree, diag = createDiagnostics()) => ({ tree: recognize(structuredClone(tree), { diagnostics: diag }).tree, diag });
const scoreOf = (tree, pick, def = snackbar) => {
  let seen = null;
  const spy = { ...def, match: (n, ctx) => { const s = def.match(n, ctx); if (pick(n) && seen === null) seen = Number(s); return s; } };
  recognize(structuredClone(tree), { registry: createRegistry([spy]), diagnostics: createDiagnostics() });
  return seen;
};
const barOf = (tree) => tree.children.find((c) => c.recognized?.component === 'snackbar' && c.overlay);

test('the snackbar definition is valid, registered by default, and describes props and slots', () => {
  assert.deepEqual(validateComponent(snackbar), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(snackbar));
  assert.deepEqual(Object.keys(snackbar.props), ['message', 'open']);
  assert.deepEqual(snackbar.slots, ['message', 'action']);
});

test('a floating role=status or role=alert strip scores 1.1; MuiSnackbar-root 0.7; a floating toast class 0.5', () => {
  assert.equal(scoreOf(page([bar()]), (n) => n.id === 'bar'), 1.1);
  assert.equal(scoreOf(page([bar({ role: 'alert' })]), (n) => n.id === 'bar'), 1.1);
  const mui = node('div', { id: 'root', classes: ['MuiSnackbar-root'], x: 8, y: 188, w: 304, h: 44, layout: floating }, [node('div', { role: 'alert', text: 'Hi' })]);
  assert.equal(scoreOf(page([mui]), (n) => n.id === 'root'), 0.7);
  assert.equal(scoreOf(page([bar({ role: null, classes: ['toast'] })]), (n) => n.id === 'bar'), 0.5);
});

test('a button whose aria-controls names the snackbar is the opener (score 1)', () => {
  assert.equal(scoreOf(page([opener('bar'), bar({ hidden: true, revealed: true })]), (n) => n.id === 'show'), 1);
});

test('the floating strip beats Alert in the default registry; an in-flow role=alert stays an Alert', () => {
  const defs = createRegistry(builtinComponents);
  const flow = node('div', { id: 'a', role: 'alert', x: 0, y: 0, w: 296, h: 40, text: 'Careful' });
  const out = recognize(structuredClone(page([bar(), flow])), { registry: defs, diagnostics: createDiagnostics() }).tree;
  assert.equal(out.children.find((c) => c.id === 'bar').recognized.component, 'snackbar');
  assert.equal(out.children.find((c) => c.id === 'a').recognized.component, 'alert');
});

test('near misses: an in-flow status, a tall floating panel, a plain fixed box', () => {
  assert.equal(scoreOf(page([bar({ layout: { position: 'static' } })]), (n) => n.id === 'bar'), 0);
  assert.equal(scoreOf(page([bar({ h: 200 })]), (n) => n.id === 'bar'), 0);
  assert.equal(scoreOf(page([bar({ role: null })]), (n) => n.id === 'bar'), 0);
  assert.equal(scoreOf(page([node('button', { id: 'b', aria: { controls: 'other' } }), node('div', { id: 'other' })]), (n) => n.id === 'b'), 0);
});

test('match never throws on a bare node or missing context', () => {
  assert.doesNotThrow(() => snackbar.match(node('div'), { tree: node('body'), byId: new Map(), links: new Map() }));
  assert.doesNotThrow(() => snackbar.match({ tag: 'div', children: [] }, { tree: { h: 1, children: [] }, byId: new Map() }));
});

test('build: an open bar floats at its measured position; its button sets the subject to 0; the subject starts at 1', () => {
  const { tree } = run(page([bar()]));
  const b = barOf(tree);
  assert.equal(b.overlay, true);
  assert.deepEqual([b.x, b.y, b.w, b.h], [12, 190, 296, 40]);
  assert.equal(b.lvName, 'snackbar');
  assert.equal(b.behavior.subjects[0].initial, 1);
  assert.deepEqual(b.behavior.binds, [{ kind: 'flag', subject: b.behavior.subjects[0].name, flag: 'hidden', op: 'eq', ref: 0 }]);
  const undo = b.children.find((c) => c.tag === 'button');
  assert.deepEqual(undo.behavior.events, [{ kind: 'set', subject: b.behavior.subjects[0].name, value: 0 }]);
  assert.equal(b.recognized.props.message, 'Note archived Undo');
});

test('build: a hidden bar with an opener starts at 0 and the opener sets 1', () => {
  const { tree } = run(page([opener('bar'), bar({ hidden: true, revealed: true })]));
  const b = barOf(tree);
  assert.equal(b.behavior.subjects[0].initial, 0);
  assert.deepEqual(tree.children.find((c) => c.id === 'show').behavior.events, [{ kind: 'set', subject: b.behavior.subjects[0].name, value: 1 }]);
});

test('build: a bar with no button and no opener stays a static, always-visible floating bar', () => {
  const { tree } = run(page([bar({}, [])]));
  const b = barOf(tree);
  assert.equal(b.overlay, true);
  assert.equal(b.behavior, undefined);
});

test('build: a hidden bar that nothing can show is dropped', () => {
  const { tree } = run(page([bar({ hidden: true, revealed: true }, [])]));
  assert.equal(tree.children.length, 0);
});

test('build: Material UI keeps the root as the floating box and lets Alert build the inner role=alert', () => {
  const content = node('div', { role: 'alert', classes: ['MuiPaper-root', 'MuiSnackbarContent-root'], x: 8, y: 188, w: 304, h: 44, styles: { bgColor: [50, 50, 50, 255], radius: 4 } }, [
    node('div', { text: 'Note archived', x: 24, y: 196, w: 100, h: 20 }),
    button('Undo', { x: 240, y: 192 }),
  ]);
  const root = node('div', { id: 'root', classes: ['MuiSnackbar-root'], x: 8, y: 188, w: 304, h: 44, layout: floating }, [content]);
  const { tree } = run(page([root]));
  const b = barOf(tree);
  assert.equal(b.id, 'root');
  assert.equal(b.children[0].recognized.component, 'alert');
  assert.equal(b.children[0].children.find((c) => c.tag === 'button').behavior.events[0].value, 0);
});

test('build: Material UI opener that names the inner content controls the root', () => {
  const content = node('div', { id: 'inner', role: 'alert', x: 8, y: 188, w: 304, h: 44 }, [button('Undo')]);
  const root = node('div', { id: 'root', classes: ['MuiSnackbar-root'], x: 8, y: 188, w: 304, h: 44, layout: floating, hidden: true, revealed: true }, [{ ...content, hidden: true, revealed: true }]);
  const { tree } = run(page([opener('inner'), root]));
  const b = barOf(tree);
  assert.equal(b.behavior.subjects[0].initial, 0);
  assert.equal(tree.children.find((c) => c.id === 'show').behavior.events[0].value, 1);
});

test('data-lv-widget="snackbar" forces a plain div', () => {
  const div = node('div', { id: 'f', widget: 'snackbar', x: 12, y: 190, w: 296, h: 40, text: 'Saved' });
  const { tree } = run(page([div]));
  assert.equal(barOf(tree).id, 'f');
});

test('convert: the bar is the last, floating child, with the bind and its closer', () => {
  const { xml, subjects } = convert(structuredClone(page([opener('bar'), bar({ hidden: true, revealed: true })])), { name: 's', screenMode: true });
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].initial, 0);
  assert.match(xml, /<lv_obj name="snackbar"[^>]*floating="true"[^>]*width="296" height="40"/);
  assert.match(xml, /<bind_flag_if_eq subject="s_\w+_open" flag="hidden" ref_value="0" \/>/);
  assert.match(xml, /value="1"/);
});

test('C, C++ and MicroPython carry the same events and bind', () => {
  const { view, subjects } = convert(structuredClone(page([opener('bar'), bar({ hidden: true, revealed: true })])), { name: 's', screenMode: true });
  const opts = { name: 's', symbol: 'ui_s_create', subjects };
  const c = emitC(view, opts).c;
  assert.match(c, /lv_subject_init_int\(&subject_s_\w+_open, 0\);/);
  assert.match(c, /lv_obj_bind_flag_if_eq\(snackbar, &subject_s_\w+_open, LV_OBJ_FLAG_HIDDEN, 0\);/);
  assert.match(emitCpp(view, opts).c, /lv_obj_bind_flag_if_eq\(snackbar, /);
  assert.match(emitPy(view, opts).py, /snackbar\.bind_flag_if_eq\(subjects\["s_\w+_open"\], lv\.obj\.FLAG\.HIDDEN, 0\)/);
});

test('the committed fixture converts to the committed goldens in all four formats', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior/snackbar.json'), 'utf8'));
  const { xml, globalsXml, view, subjects } = convert(tree, { name: 'snackbar', screenMode: true });
  const golden = (f) => readFileSync(join(here, 'golden-behavior', f), 'utf8');
  assert.equal(xml, golden('snackbar.xml'));
  assert.equal(globalsXml, golden('snackbar.globals.xml'));
  assert.match(globalsXml, /snackbar_toast_open" value="0"/);
  assert.match(globalsXml, /snackbar_body_div_4_open" value="1"/);
  const opts = { name: 'snackbar', symbol: 'ui_snackbar_create', subjects };
  assert.equal(emitC(view, opts).c, golden('ui_snackbar.c'));
  assert.equal(emitCpp(view, opts).c, golden('ui_snackbar.cpp'));
  assert.equal(emitPy(view, { name: 'snackbar', symbol: 'ui_snackbar_create' }).py, golden('ui_snackbar.py'));
});
