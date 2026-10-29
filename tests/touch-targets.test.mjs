/**
 * Touch-target check: which elements count, the size boundary, hidden and
 * nested nodes, the option, the message text, and an end-to-end convert().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTouchTargets, isTouchTarget } from '../src/touch-targets.mjs';
import { createDiagnostics, formatTodo } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';

function styles() {
  return {
    bgColor: null, color: [10, 20, 30, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null,
  };
}
function layout() {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto',
  };
}
let counter = 0;
const node = (tag, extra = {}) => ({
  tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
  x: 0, y: 0, w: 100, h: 40, text: null, attrs: {}, styles: styles(), layout: layout(),
  children: [], key: `n${++counter}`, ...extra,
});
const root = (...children) => node('body', { w: 320, h: 240, children, key: 'root' });
const run = (tree, opts = {}) => {
  const diagnostics = createDiagnostics();
  const added = checkTouchTargets(tree, { diagnostics, ...opts });
  return { added, list: diagnostics.list() };
};
const small = (tag, extra = {}) => node(tag, { w: 20, h: 20, ...extra });

test('each kind of target is reported when small', () => {
  const kinds = [
    small('button'),
    small('a', { attrs: { href: 'x.html' } }),
    small('input', { attrs: { type: 'checkbox' } }),
    small('input', { attrs: { type: 'radio' } }),
    small('input', { attrs: { type: 'range' } }),
    small('input', { attrs: { type: 'button' } }),
    small('input', { attrs: { type: 'submit' } }),
    small('select'),
    small('textarea'),
    small('div', { role: 'button' }),
    small('div', { role: 'link' }),
    small('div', { role: 'checkbox' }),
    small('div', { role: 'radio' }),
    small('div', { role: 'switch' }),
    small('div', { role: 'slider' }),
    small('div', { role: 'tab' }),
    small('div', { role: 'menuitem' }),
    small('div', { role: 'option' }),
    small('div', { link: 'other.html' }),
    small('div', { widget: 'switch' }),
    small('div', { widget: 'checkbox' }),
    small('div', { widget: 'slider' }),
  ];
  const { added, list } = run(root(...kinds));
  assert.equal(added, kinds.length);
  assert.ok(list.every((d) => d.code === 'TOUCH_TARGET_SMALL' && d.severity === 'info'));
});

test('non-targets are ignored', () => {
  const others = [
    small('div'),
    small('span', { text: 'hi' }),
    small('a'), // no href
    small('a', { attrs: { href: '' } }),
    small('input', { attrs: { type: 'text' } }),
    small('div', { role: 'img' }),
    small('div', { widget: 'bar' }),
  ];
  assert.equal(run(root(...others)).added, 0);
  assert.equal(isTouchTarget(small('input')), false);
});

test('boundary: exactly minSize passes, minSize - 1 fails, width or height alone is enough', () => {
  assert.equal(run(root(node('button', { w: 30, h: 30 }))).added, 0);
  assert.equal(run(root(node('button', { w: 29, h: 30 }))).added, 1);
  assert.equal(run(root(node('button', { w: 30, h: 29 }))).added, 1);
  assert.equal(run(root(node('button', { w: 44, h: 44 })), { minSize: 48 }).added, 1);
  assert.equal(run(root(node('button', { w: 48, h: 48 })), { minSize: 48 }).added, 0);
});

test('minSize 0 disables the check', () => {
  assert.equal(run(root(small('button')), { minSize: 0 }).added, 0);
});

test('hidden targets and their subtrees are skipped', () => {
  const hiddenButton = small('button', { hidden: true });
  const hiddenParent = node('div', { hidden: true, children: [small('button')] });
  assert.equal(run(root(hiddenButton, hiddenParent)).added, 0);
});

test('a target inside a target is not reported twice', () => {
  const inner = small('span', { role: 'button', text: 'x' });
  const outer = node('button', { w: 20, h: 20, children: [inner, small('a', { attrs: { href: '#' } })] });
  const { list } = run(root(outer));
  assert.equal(list.length, 1);
  assert.match(list[0].message, /<button>/);
});

test('a big target containing a small target reports nothing (the outer one is pressed)', () => {
  const outer = node('button', { w: 100, h: 40, children: [small('span', { role: 'button' })] });
  assert.equal(run(root(outer)).added, 0);
});

test('an icon placeholder inside a button is not a target', () => {
  const icon = node('div', {
    w: 16, h: 16, lvName: 'icon_menu', recognized: { component: 'icon', props: {} },
  });
  const button = node('button', { w: 100, h: 40, children: [icon] });
  assert.equal(run(root(button)).added, 0);
});

test('message and fix say what, how big, the minimum, and what to do', () => {
  const b = node('button', {
    w: 24, h: 18, key: '#save', lvName: 'save_btn', text: 'Save', aria: { label: 'Save document' },
  });
  const [d] = run(root(b)).list;
  assert.match(d.message, /<button> "Save document"/);
  assert.match(d.message, /#save/);
  assert.match(d.message, /24x18 px/);
  assert.match(d.message, /at least 30 px/);
  assert.match(d.fix, /at least 30x30 px/);
  assert.match(d.fix, /padding|hit area/);
  assert.match(d.fix, /save_btn/);
  assert.deepEqual(d.source, { selector: '#save' });
  assert.deepEqual(d.output, { widget: 'save_btn' });
});

test('visible text is the label when there is no aria-label; input shows its type', () => {
  const withText = node('button', { w: 10, h: 10, children: [node('span', { text: 'Go', w: 5, h: 5 })] });
  const input = small('input', { attrs: { type: 'checkbox' } });
  const { list } = run(root(withText, input));
  assert.match(list[0].message, /<button> "Go"/);
  assert.match(list[1].message, /<input type="checkbox">/);
  assert.equal(list[1].output, null);
});

function pageTree(...children) {
  return {
    ...node('body', { w: 320, h: 240, key: 'root' }),
    children,
  };
}

test('convert() adds the diagnostic, keeps warnings and output unchanged', () => {
  const tree = pageTree(node('button', { x: 10, y: 10, w: 20, h: 20, text: 'OK', key: '#ok' }));
  const on = convert(tree, { name: 'page' });
  const off = convert(tree, { name: 'page', minTouchTarget: 0 });
  const found = on.diagnostics.list().filter((d) => d.code === 'TOUCH_TARGET_SMALL');
  assert.equal(found.length, 1);
  assert.equal(off.diagnostics.list().filter((d) => d.code === 'TOUCH_TARGET_SMALL').length, 0);
  assert.equal(on.xml, off.xml);
  assert.deepEqual(on.warnings, off.warnings);
  const todo = formatTodo(on.diagnostics.list());
  assert.match(todo, /\[TOUCH_TARGET_SMALL\]/);
  assert.match(todo, /20x20 px/);
  assert.match(todo, /Fix: Make the element at least 30x30 px/);
  assert.equal(convert(tree, { name: 'page', minTouchTarget: 20 }).diagnostics.list().length, 0);
});
