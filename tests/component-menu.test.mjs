/**
 * Menu component: match signals and scores, near misses (an always-visible
 * role=menu, a combobox, a dialog opener), data-lv-widget forcing, what build()
 * returns (a transparent full-screen layer holding the popup, bound to one
 * subject, items that close it, an opener that opens it), Material UI's
 * wrapper and aria-labelledby link, the initial state, and the generated XML,
 * C and MicroPython. The committed fixture is compared with its golden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import menu from '../src/components/menu.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (children) => node('body', { w: 320, h: 240, layout: { display: 'flex', flexDirection: 'column', position: 'static' } }, children);
const opener = (extra = {}) => node('button', { id: 'btn', text: 'Actions', x: 12, y: 40, w: 70, h: 30, aria: { haspopup: 'menu', expanded: 'false', controls: 'm' }, ...extra });
const item = (text, y, extra = {}) => node('li', {
  role: 'menuitem', text, x: 12, y, w: 130, h: 27, styles: { padLeft: 14, padRight: 14, padTop: 6, padBottom: 6 }, ...extra,
});
const menuList = (extra = {}) => node('ul', {
  id: 'm', role: 'menu', hidden: true, revealed: true, x: 12, y: 90, w: 130, h: 85,
  styles: { bgColor: [255, 255, 255, 255], radius: 6 }, layout: { position: 'absolute' }, ...extra,
}, [item('Rename', 94), item('Duplicate', 121), item('Delete', 148)]);

const run = (tree, diag = createDiagnostics()) => ({ tree: recognize(structuredClone(tree), { diagnostics: diag }).tree, diag });
const scoreOf = (tree, pick) => {
  let seen = null;
  const spy = { ...menu, match: (n, ctx) => { const s = menu.match(n, ctx); if (pick(n) && seen === null) seen = Number(s); return s; } };
  recognize(structuredClone(tree), { registry: createRegistry([spy]), diagnostics: createDiagnostics() });
  return seen;
};
const layerOf = (tree) => tree.children.find((c) => c.overlay);

test('the menu definition is valid, registered by default, and describes props and slots', () => {
  assert.deepEqual(validateComponent(menu), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(menu));
  assert.deepEqual(Object.keys(menu.props), ['open']);
  assert.deepEqual(menu.slots, ['opener', 'items']);
});

test('an aria-haspopup=menu opener and its role=menu popup score 1; a MuiMenu-root wrapper 0.7', () => {
  assert.equal(scoreOf(page([opener(), menuList()]), (n) => n.id === 'btn'), 1);
  assert.equal(scoreOf(page([opener(), menuList()]), (n) => n.id === 'm'), 1);
  const wrapper = node('div', { id: 'w', classes: ['MuiPopover-root', 'MuiMenu-root'], hidden: true, revealed: true }, [node('div', {}, [menuList({ id: 'm2', aria: { labelledby: 'btn' } })])]);
  assert.equal(scoreOf(page([opener({ aria: { haspopup: 'true' } }), wrapper]), (n) => n.id === 'w'), 0.7);
});

test('aria-haspopup="true" means a menu, and aria-labelledby on the menu links it when the opener has no aria-controls', () => {
  const o = opener({ aria: { haspopup: 'true' } });
  const m = menuList({ aria: { labelledby: 'btn' } });
  assert.equal(scoreOf(page([o, m]), (n) => n.id === 'btn'), 1);
  const { tree } = run(page([o, m]));
  const overlay = layerOf(tree);
  assert.equal(overlay.behavior.subjects[0].initial, 0);
  assert.equal(tree.children.find((c) => c.id === 'btn').behavior.events[0].value, 1);
});

test('near misses: an always-visible role=menu, a combobox, a dialog opener, a listbox popup', () => {
  const visible = node('ul', { id: 'v', role: 'menu' }, [item('A', 0)]);
  assert.equal(scoreOf(page([visible]), (n) => n.id === 'v'), 0);
  assert.equal(scoreOf(page([opener({ role: 'combobox', aria: { haspopup: 'menu', controls: 'm' } }), menuList()]), (n) => n.id === 'btn'), 0);
  assert.equal(scoreOf(page([opener({ aria: { haspopup: 'dialog', controls: 'dlg' } }), node('div', { id: 'dlg', role: 'dialog' })]), (n) => n.id === 'btn'), 0);
  assert.equal(scoreOf(page([opener({ aria: { haspopup: 'listbox', controls: 'lb' } }), node('ul', { id: 'lb', role: 'listbox', hidden: true, revealed: true })]), (n) => n.id === 'btn'), 0);
});

test('match never throws on a bare node or missing context', () => {
  assert.doesNotThrow(() => menu.match(node('div'), { tree: node('body'), byId: new Map(), links: new Map() }));
  assert.doesNotThrow(() => menu.match({ tag: 'div', children: [] }, { tree: { children: [] }, byId: new Map() }));
});

test('build: a hidden menu becomes a transparent full-screen floating layer, hidden at 0, bound to one subject', () => {
  const { tree } = run(page([opener(), menuList()]));
  const layer = layerOf(tree);
  assert.deepEqual([layer.x, layer.y, layer.w, layer.h], [0, 0, 320, 240]);
  assert.equal(layer.styles.bgColor[3], 0);
  assert.equal(layer.behavior.subjects.length, 1);
  assert.equal(layer.behavior.subjects[0].initial, 0);
  assert.deepEqual(layer.behavior.binds, [{ kind: 'flag', subject: layer.behavior.subjects[0].name, flag: 'hidden', op: 'eq', ref: 0 }]);
  assert.equal(layer.behavior.events[0].value, 0, 'pressing outside the popup closes it');
  const popup = layer.children[0];
  assert.deepEqual([popup.x, popup.y, popup.w, popup.h], [12, 90, 130, 85]);
  assert.equal(popup.hidden, false);
  assert.equal(popup.children.length, 3);
});

test('build: every item sets the subject to 0 and is pressable; the opener sets it to 1', () => {
  const { tree } = run(page([opener(), menuList()]));
  const subject = layerOf(tree).behavior.subjects[0].name;
  for (const it of layerOf(tree).children[0].children) {
    assert.deepEqual(it.behavior.events, [{ kind: 'set', subject, value: 0 }]);
    assert.equal(it.lvName, 'menu_item');
    assert.equal(it.tag, 'div', 'a text-only <li> becomes a <div> so the label keeps the item padding');
  }
  assert.deepEqual(tree.children.find((c) => c.id === 'btn').behavior.events, [{ kind: 'set', subject, value: 1 }]);
});

test('build: a disabled item and an item that opens a submenu do not close the menu', () => {
  const list = menuList();
  list.children[0].aria = { disabled: 'true' };
  list.children[1].aria = { haspopup: 'menu', controls: 'sub' };
  const { tree } = run(page([opener(), list]));
  const items = layerOf(tree).children[0].children;
  assert.equal(items[0].behavior, undefined);
  assert.equal(items[1].behavior?.events?.some((e) => e.value === 0), undefined);
  assert.equal(items[2].behavior.events[0].value, 0);
});

test('build: a menu that was open when the page was saved starts at 1', () => {
  const open = menuList({ hidden: false, revealed: false, aria: {} });
  const { tree } = run(page([opener({ aria: { haspopup: 'menu', expanded: 'true', controls: 'm' } }), open]));
  assert.equal(layerOf(tree).behavior.subjects[0].initial, 1);
});

test('build: a Material UI wrapper keeps the Paper (not the invisible backdrop) inside the layer', () => {
  const backdrop = node('div', { classes: ['MuiBackdrop-root'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } });
  const paper = node('div', { classes: ['MuiPaper-root'], x: 170, y: 90, w: 138, h: 124, layout: { position: 'absolute' } }, [menuList({ id: 'basic', aria: { labelledby: 'btn' }, x: 170, y: 90, w: 138, h: 124 })]);
  const wrapper = node('div', { id: 'w', classes: ['MuiPopover-root', 'MuiMenu-root'], hidden: true, revealed: true, x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [backdrop, paper]);
  const { tree } = run(page([opener({ aria: { haspopup: 'true' } }), wrapper]));
  const layer = layerOf(tree);
  assert.equal(layer.children.length, 1);
  assert.deepEqual([layer.children[0].x, layer.children[0].y], [170, 90]);
  assert.equal(tree.children.filter((c) => c.overlay).length, 1, 'the inner role=menu is not built a second time');
});

test('two menus on a page get independent subjects', () => {
  const second = menuList({ id: 'm2' });
  const o2 = opener({ id: 'btn2', aria: { haspopup: 'menu', controls: 'm2' } });
  const { tree } = run(page([opener(), o2, menuList(), second]));
  const names = tree.children.filter((c) => c.overlay).map((l) => l.behavior.subjects[0].name);
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
});

test('data-lv-widget="menu" on a hidden list builds the layer', () => {
  const forced = menuList({ role: null, widget: 'menu', aria: {} });
  const { tree } = run(page([forced]));
  assert.ok(layerOf(tree), 'a forced hidden list still becomes a layer');
  assert.equal(layerOf(tree).behavior.subjects[0].initial, 0);
});

test('convert: the XML has the floating layer last, the bind, the item events and the opener event', () => {
  const { xml, subjects } = convert(structuredClone(page([opener(), menuList()])), { name: 'm', screenMode: true });
  assert.equal(subjects.length, 1);
  assert.match(xml, /<lv_obj name="menu"[^>]*floating="true"[^>]*width="320" height="240"/);
  assert.match(xml, /<bind_flag_if_eq subject="m_[a-z_0-9]+_open" flag="hidden" ref_value="0"/);
  assert.equal((xml.match(/<subject_set_int_event [^>]*value="0"/g) ?? []).length, 4, 'three items and the outside press');
  assert.equal((xml.match(/<subject_set_int_event [^>]*value="1"/g) ?? []).length, 1);
  assert.ok(xml.indexOf('name="menu"') > xml.indexOf('name="btn"'), 'the layer comes after the page content');
});

test('C, C++ and MicroPython carry the same events and bind', () => {
  const { view, subjects } = convert(structuredClone(page([opener(), menuList()])), { name: 'm', screenMode: true });
  const opts = { name: 'm', symbol: 'ui_m_create', subjects };
  const c = emitC(view, opts).c;
  assert.match(c, /lv_subject_init_int\(&subject_m_\w+_open, 0\);/, 'the menu subject starts closed');
  assert.equal((c.match(/lv_obj_add_subject_set_int_event\(\w+, &subject_m_\w+_open, LV_EVENT_CLICKED, 0\);/g) ?? []).length, 4);
  assert.match(c, /lv_obj_add_subject_set_int_event\(btn, &subject_m_\w+_open, LV_EVENT_CLICKED, 1\);/);
  assert.match(c, /lv_obj_bind_flag_if_eq\(menu, &subject_m_\w+_open, LV_OBJ_FLAG_HIDDEN, 0\);/);
  assert.match(emitCpp(view, opts).c, /lv_obj_bind_flag_if_eq\(menu, /);
  const py = emitPy(view, opts).py;
  assert.equal((py.match(/_set_subject\(subjects\["m_\w+_open"\], 0\)/g) ?? []).length, 4);
  assert.match(py, /btn\.add_event_cb\(_set_subject\(subjects\["m_\w+_open"\], 1\)/);
  assert.match(py, /menu\.bind_flag_if_eq\(subjects\["m_\w+_open"\], lv\.obj\.FLAG\.HIDDEN, 0\)/);
});

test('the committed C, C++ and MicroPython goldens match the fixture', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior/menu.json'), 'utf8'));
  const { view, subjects } = convert(tree, { name: 'menu', screenMode: true });
  const opts = { name: 'menu', symbol: 'ui_menu_create', subjects };
  const golden = (f) => readFileSync(join(here, 'golden-behavior', f), 'utf8');
  assert.equal(emitC(view, opts).c, golden('ui_menu.c'));
  assert.equal(emitCpp(view, opts).c, golden('ui_menu.cpp'));
  assert.equal(emitPy(view, { name: 'menu', symbol: 'ui_menu_create' }).py, golden('ui_menu.py'));
});

test('the committed fixture converts to the committed golden, with two independent subjects', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior/menu.json'), 'utf8'));
  const { xml, globalsXml } = convert(tree, { name: 'menu', screenMode: true });
  assert.equal(xml, readFileSync(join(here, 'golden-behavior/menu.xml'), 'utf8'));
  assert.equal(globalsXml, readFileSync(join(here, 'golden-behavior/menu.globals.xml'), 'utf8'));
  assert.equal((globalsXml.match(/<int /g) ?? []).length, 2);
  assert.match(globalsXml, /value="0"/);
});
