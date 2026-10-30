/**
 * Toolbar component: match signals and scores, near misses, data-lv-widget
 * forcing, build output, props/slots, and the converted row (leading button,
 * title with flex-grow, trailing button).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import toolbar from '../src/components/toolbar.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';

function styles(extra = {}) {
  return {
    bgColor: null, color: [10, 20, 30, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null, ...extra,
  };
}
function layout(extra = {}) {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto', ...extra,
  };
}
let keyCount = 0;
const node = (tag, extra = {}) => ({
  tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
  x: 0, y: 0, w: 320, h: 56, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: `t${++keyCount}`,
  ...extra,
});
const page = (...children) => node('body', { h: 240, children });
const score = (n) => Number(toolbar.match(n, { tree: page(n), parent: null, diagnostics: createDiagnostics() }));
const run = (tree) => recognize(structuredClone(tree), { registry: createRegistry([toolbar]), diagnostics: createDiagnostics() }).tree;

test('the toolbar definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(toolbar), { ok: true, errors: [] });
  assert.equal(toolbar.name, 'toolbar');
  assert.ok(builtinComponents.includes(toolbar));
});

test('props are empty and the one slot is items', () => {
  assert.deepEqual(toolbar.props, {});
  assert.deepEqual(toolbar.slots, ['items']);
});

test('role=toolbar scores 1; MuiToolbar-root scores 0.7', () => {
  assert.equal(score(node('div', { role: 'toolbar' })), 1);
  assert.equal(score(node('div', { classes: ['MuiToolbar-root', 'MuiToolbar-gutters'] })), 0.7);
  assert.equal(score(node('div', { role: 'toolbar', classes: ['MuiToolbar-root'] })), 1);
});

test('near misses: plain div, header, app bar, a class that only contains "toolbar"', () => {
  assert.equal(score(node('div')), 0);
  assert.equal(score(node('header')), 0);
  assert.equal(score(node('div', { role: 'banner' })), 0);
  assert.equal(score(node('div', { classes: ['MuiAppBar-root'] })), 0);
  assert.equal(score(node('div', { classes: ['toolbar'] })), 0);
  assert.equal(score(node('div', { classes: ['MuiToolbar-gutters'] })), 0);
});

test('match never throws on a bare node', () => {
  assert.doesNotThrow(() => toolbar.match({ tag: 'div', children: [] }, {}));
});

test('data-lv-widget="toolbar" forces a plain div', () => {
  const out = run(page(node('div', { widget: 'toolbar' }))).children[0];
  assert.equal(out.recognized.component, 'toolbar');
});

test('build only names the node; children survive; an author name wins', () => {
  const kids = [node('button', { text: 'a' }), node('span', { text: 'b' })];
  const out = run(page(node('div', { role: 'toolbar', children: kids }))).children[0];
  assert.equal(out.lvName, 'toolbar');
  assert.equal(out.children.length, 2);
  assert.equal(run(page(node('div', { role: 'toolbar', lvName: 'tools' }))).children[0].lvName, 'tools');
});

test('convert: a toolbar row keeps the leading button, the growing title and the trailing button in order', () => {
  const row = node('div', {
    classes: ['MuiToolbar-root'], h: 56,
    styles: styles({ padLeft: 16, padRight: 16 }),
    layout: layout({ display: 'flex', alignItems: 'center' }),
    children: [
      node('button', { text: 'Menu', w: 40, h: 40, layout: layout({ marginRight: 16 }) }),
      node('h6', { text: 'Title', w: 100, h: 24, layout: layout({ flexGrow: 1 }) }),
      node('button', { text: 'Login', w: 60, h: 28 }),
    ],
  });
  const { xml } = convert(page(row));
  assert.match(xml, /<lv_obj name="toolbar"[^>]* flex_flow="row"[^>]* style_flex_cross_place="center"/);
  assert.match(xml, /style_pad_left="16" style_pad_right="16"/);
  const menu = xml.indexOf('Menu');
  const title = xml.indexOf('Title');
  const login = xml.indexOf('Login');
  assert.ok(menu < title && title < login);
  assert.match(xml, /<lv_button[^>]* style_margin_right="16"/);
  assert.match(xml, /<lv_label[^>]* flex_grow="1"[^>]* text="Title"/);
});

test('convert: an empty toolbar (the spacer under a fixed app bar) is not dropped', () => {
  const spacer = node('div', { classes: ['MuiToolbar-root'], h: 56 });
  const { xml } = convert(page(spacer, node('div', { text: 'content', y: 56, h: 20 })));
  assert.match(xml, /<lv_obj name="toolbar"[^>]* height="56"/);
});
