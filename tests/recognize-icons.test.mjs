/**
 * Icon recognition: each detection rule, the hint order, the placeholder
 * shape, the diagnostic, and an end-to-end convert(). Trees are hand built;
 * some carry the Phase 6 extractor fields (classes, aria, testId) and some
 * omit them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import icon, { iconHint } from '../src/recognize-icons.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics, formatTodo } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
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
const node = (tag, extra = {}) => ({
  tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
  x: 0, y: 0, w: 24, h: 24, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: 'k',
  ...extra,
});
const ctx = () => ({ diagnostics: createDiagnostics() });
const score = (n) => Number(icon.match(n, ctx()));

test('the icon definition is valid, leaf, and registered by default', () => {
  assert.deepEqual(validateComponent(icon), { ok: true, errors: [] });
  assert.equal(icon.name, 'icon');
  assert.equal(icon.leaf, true);
  assert.ok(builtinComponents.includes(icon));
  assert.equal(createRegistry([icon]).rejected.length, 0);
});

test('rule 1: an svg node', () => {
  assert.ok(score(node('svg')) > 0);
});

test('rule 2: Material UI svg icon, by class or data-testid', () => {
  assert.ok(score(node('span', { classes: ['MuiSvgIcon-root', 'x'] })) > 0);
  assert.ok(score(node('span', { className: 'MuiSvgIcon-root' })) > 0); // no classes field
  assert.ok(score(node('div', { testId: 'MenuIcon' })) > 0);
  assert.equal(score(node('div', { testId: 'Header' })), 0);
  assert.ok(score(node('svg')) > score(node('div', { testId: 'MenuIcon' })));
});

test('rule 3: icon font classes on i or span only', () => {
  for (const c of ['material-icons', 'material-icons-outlined', 'material-symbols-rounded', 'fa', 'fas', 'fa-home', 'bi-gear', 'bx-user', 'icon-close']) {
    assert.ok(score(node('i', { classes: ['x', c] })) > 0, c);
  }
  assert.ok(score(node('span', { className: 'material-icons', text: 'menu' })) > 0);
  assert.equal(score(node('div', { classes: ['material-icons'] })), 0);
  assert.equal(score(node('span', { classes: ['label'], text: 'hi' })), 0);
});

test('rule 4: aria-hidden small square with no text and an svg child', () => {
  const inner = node('svg');
  assert.ok(score(node('div', { attrs: { 'aria-hidden': 'true' }, children: [inner] })) > 0);
  assert.equal(score(node('div', { attrs: { 'aria-hidden': 'true' }, children: [] })), 0);
  assert.equal(score(node('div', { attrs: { 'aria-hidden': 'true' }, w: 60, h: 60, children: [inner] })), 0);
  assert.equal(score(node('div', { attrs: { 'aria-hidden': 'true' }, w: 40, h: 20, children: [inner] })), 0);
  assert.equal(score(node('div', { attrs: { 'aria-hidden': 'true' }, text: 'hi', children: [inner] })), 0);
  assert.equal(score(node('div', { attrs: {}, children: [inner] })), 0);
});

test('a non-icon is not matched', () => {
  assert.equal(score(node('div')), 0);
  assert.equal(score(node('button', { text: 'Save' })), 0);
  assert.equal(score(node('img')), 0);
});

test('hint order: testId, aria label, ligature, class suffix, fallback', () => {
  assert.equal(iconHint(node('svg', { testId: 'MenuIcon', aria: { label: 'Open' }, classes: ['fa-home'] })), 'menu');
  assert.equal(iconHint(node('svg', { testId: 'ArrowBackIosNewIcon' })), 'arrow_back_ios_new');
  assert.equal(iconHint(node('svg', { aria: { label: 'Open menu' }, classes: ['fa-home'] })), 'open_menu');
  assert.equal(iconHint(node('span', { classes: ['material-icons'], text: 'menu', className: 'material-icons' })), 'menu');
  assert.equal(iconHint(node('span', { className: 'material-icons', text: 'Add Circle' })), 'add_circle');
  assert.equal(iconHint(node('i', { classes: ['fa', 'fa-solid', 'fa-home'] })), 'home');
  assert.equal(iconHint(node('i', { classes: ['bi', 'bi-gear'] })), 'gear');
  assert.equal(iconHint(node('i', { classes: ['bx', 'bx-user'] })), 'user');
  assert.equal(iconHint(node('svg')), 'icon');
  assert.equal(iconHint(node('i', { className: 'fa-home' })), 'home'); // no classes field
});

test('build() returns a fixed-size outlined named div and one diagnostic', () => {
  const c = ctx();
  const src = node('svg', {
    x: 5, y: 6, w: 20, h: 22, testId: 'MenuIcon', key: 'body/svg[0]', children: [node('path')],
    styles: { ...styles(), bgColor: [1, 2, 3, 255] },
  });
  const out = icon.build(src, c);
  assert.equal(out.tag, 'div');
  assert.equal(out.lvName, 'icon_menu');
  assert.deepEqual([out.x, out.y, out.w, out.h], [5, 6, 20, 22]);
  assert.equal(out.styles.borderWidth, 1);
  assert.deepEqual(out.styles.borderColor, [10, 20, 30, 255]);
  assert.equal(out.styles.bgColor, null);
  assert.deepEqual(out.children, []);
  assert.equal(out.text, null);

  const [d] = c.diagnostics.list();
  assert.equal(d.code, 'ICON_PLACEHOLDER');
  assert.equal(d.output.widget, 'icon_menu');
  assert.equal(d.source.selector, 'body/svg[0]');
  assert.match(d.fix, /lv_obj named "icon_menu"/);
  assert.match(d.fix, /lv_image/);
  assert.match(d.fix, /LV_SYMBOL_\*/);
  assert.ok(d.message.length > 10);
});

test('recognize() replaces the icon and does not look inside it', () => {
  const body = node('body', { w: 320, h: 240, children: [node('svg', { children: [node('path', { className: 'material-icons' })] })] });
  const diagnostics = createDiagnostics();
  const { tree, recognized } = recognize(body, { registry: createRegistry([icon]), diagnostics });
  assert.equal(recognized, 1);
  assert.equal(tree.children[0].lvName, 'icon_icon');
  assert.equal(tree.children[0].children.length, 0);
  assert.equal(diagnostics.list().length, 1);
});

test('convert() emits a named lv_obj, ICON_PLACEHOLDER, and a TODO fix line', () => {
  const page = node('body', {
    w: 320, h: 240,
    children: [
      node('svg', { x: 8, y: 8, testId: 'MenuIcon' }),
      node('svg', { x: 40, y: 8, testId: 'MenuIcon' }),
      node('i', { x: 72, y: 8, classes: ['fa', 'fa-home'] }),
    ],
  });
  const { xml, diagnostics, warnings } = convert(page);
  assert.match(xml, /<lv_obj[^>]*name="icon_menu"[^>]*>/);
  assert.match(xml, /name="icon_menu_2"/); // convert() numbers duplicates
  assert.match(xml, /name="icon_home"/);
  assert.match(xml, /style_border_width="1"/);
  const list = diagnostics.list();
  assert.equal(list.filter((d) => d.code === 'ICON_PLACEHOLDER').length, 3);
  assert.ok(!list.some((d) => d.code === 'TAG_UNSUPPORTED'));
  assert.equal(warnings.length, 3);
  const todo = formatTodo(list);
  assert.match(todo, /\[ICON_PLACEHOLDER\] icon_menu/);
  assert.match(todo, /Fix: Replace the lv_obj named "icon_menu" with an lv_image/);
});
