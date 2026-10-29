/**
 * Divider: every signal, orientation, what build() makes of an hr, a Material
 * UI divider and a divider with text, and convert().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import divider from '../src/components/divider.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
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
  x: 0, y: 0, w: 100, h: 50, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: 'k',
  ...extra,
});
const ctx = (parent = null) => ({ diagnostics: createDiagnostics(), parent });
const score = (n) => Number(divider.match(n, ctx()));
const grey = [189, 189, 189, 255];
const hr = (extra = {}) => node('hr', {
  x: 12, y: 40, w: 296, h: 2,
  styles: { ...styles(), borderWidth: 1, borderColor: grey, borderBottomWidth: 1, borderBottomColor: grey },
  ...extra,
});

test('the divider definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(divider), { ok: true, errors: [] });
  assert.equal(divider.name, 'divider');
  assert.deepEqual(divider.slots, []);
  assert.ok(builtinComponents.includes(divider));
});

test('signals: hr 1, role=separator 1, MuiDivider-root 0.7', () => {
  assert.equal(score(node('hr')), 1);
  assert.equal(score(node('div', { role: 'separator' })), 1);
  assert.equal(score(node('li', { role: 'separator', classes: ['MuiDivider-root'] })), 1);
  assert.equal(score(node('div', { classes: ['MuiDivider-root', 'MuiDivider-fullWidth'] })), 0.7);
  assert.equal(score(node('hr', { classes: ['MuiDivider-root'] })), 1);
});

test('near misses do not match', () => {
  assert.equal(score(node('div', { role: 'separator', aria: { valuenow: '50' } })), 0, 'a splitter handle is not a divider');
  assert.equal(score(node('div', { classes: ['divider'] })), 0);
  assert.equal(score(node('div', { classes: ['MuiDividerLike-root'] })), 0);
  assert.equal(score(node('div', { role: 'presentation' })), 0);
  assert.equal(score(node('div')), 0);
});

test('data-lv-widget="divider" forces the match', () => {
  const body = node('body', { w: 320, h: 240, children: [node('div', { widget: 'divider', h: 1, w: 200 })] });
  const { tree, recognized } = recognize(body, { registry: createRegistry([divider]) });
  assert.equal(recognized, 1);
  assert.equal(tree.children[0].lvName, 'divider');
});

test('an hr becomes a one pixel solid line of its color and length', () => {
  const out = divider.build(hr(), ctx());
  assert.equal(out.lvName, 'divider');
  assert.equal(out.tag, 'div');
  assert.deepEqual([out.x, out.y, out.w, out.h], [12, 40, 296, 1]);
  assert.deepEqual(out.styles.bgColor, grey);
  assert.equal(out.styles.borderWidth, 0);
  assert.equal(out.styles.borderBottomWidth, 0);
  assert.equal(out.recognized.props.orientation, 'horizontal');
});

test('a Material UI divider blends its translucent border onto the page', () => {
  const parent = node('body', { styles: { ...styles(), bgColor: [255, 255, 255, 255] } });
  const mui = node('hr', {
    classes: ['MuiDivider-root'], x: 0, y: 5, w: 200, h: 1,
    styles: { ...styles(), borderColor: [0, 0, 0, 31], borderWidth: 0, borderBottomColor: [0, 0, 0, 31], borderBottomWidth: 1 },
  });
  const out = divider.build(mui, ctx(parent));
  assert.deepEqual(out.styles.bgColor, [224, 224, 224, 255]);
  assert.equal(out.h, 1);
  assert.equal(out.w, 200);
});

test('a box line keeps its own color and thickness', () => {
  const sep = node('div', { role: 'separator', w: 296, h: 2, styles: { ...styles(), bgColor: [233, 30, 99, 255] } });
  const out = divider.build(sep, ctx());
  assert.deepEqual(out.styles.bgColor, [233, 30, 99, 255]);
  assert.equal(out.h, 2);
  assert.equal(out.w, 296);
});

test('vertical: aria-orientation, or taller than wide', () => {
  const byAria = divider.build(node('div', { role: 'separator', aria: { orientation: 'vertical' }, w: 1, h: 20, styles: { ...styles(), bgColor: [1, 2, 3, 255] } }), ctx());
  assert.equal(byAria.recognized.props.orientation, 'vertical');
  assert.deepEqual([byAria.w, byAria.h], [1, 20]);

  const byShape = divider.build(node('div', { role: 'separator', w: 1, h: 18, styles: { ...styles(), bgColor: [1, 2, 3, 255] } }), ctx());
  assert.equal(byShape.recognized.props.orientation, 'vertical');

  const horizontalWins = divider.build(node('div', { role: 'separator', aria: { orientation: 'horizontal' }, w: 5, h: 40 }), ctx());
  assert.equal(horizontalWins.recognized.props.orientation, 'horizontal');

  // A Material UI vertical divider: the width is on a side the extractor does not read.
  const mui = divider.build(node('hr', { classes: ['MuiDivider-root'], w: 1, h: 18, styles: { ...styles(), borderColor: [0, 0, 0, 31] } }), ctx());
  assert.deepEqual(mui.styles.bgColor, [224, 224, 224, 255]);
  assert.deepEqual([mui.w, mui.h], [1, 18]);
});

test('a divider with text becomes line, content, line; the content survives', () => {
  const label = node('span', { classes: ['MuiDivider-wrapper'], text: 'OR', w: 33, h: 12, styles: { ...styles(), padLeft: 8, padRight: 8 } });
  const withKids = node('div', {
    role: 'separator', classes: ['MuiDivider-root', 'MuiDivider-withChildren'], w: 296, h: 12,
    styles: { ...styles(), borderColor: [0, 0, 0, 31] }, children: [label],
  });
  const out = divider.build(withKids, ctx());
  assert.equal(out.children.length, 3);
  const [a, mid, b] = out.children;
  assert.equal(a.lvName, 'divider_line');
  assert.equal(b.lvName, 'divider_line');
  assert.equal(a.layout.flexGrow, 1);
  assert.equal(a.h, 1);
  assert.deepEqual(a.styles.bgColor, [224, 224, 224, 255]);
  assert.equal(out.layout.display, 'flex');
  assert.equal(out.layout.alignItems, 'center');
  assert.equal(mid.children[0].text, 'OR', 'the text is kept (padded box holding the label)');

  const plainText = divider.build(node('div', { role: 'separator', text: 'or', w: 200, h: 14 }), ctx());
  assert.equal(plainText.children[1].text, 'or');
});

test('a block with a separator role that is not line-shaped keeps its content', () => {
  const big = node('div', { role: 'separator', w: 200, h: 100, children: [node('span', { text: 'x' })] });
  const out = divider.build(big, ctx());
  assert.equal(out.lvName, 'divider');
  assert.equal(out.h, 100);
});

test('convert() emits a one pixel named divider for hr, role and Material UI', () => {
  const page = node('body', {
    w: 320, h: 240,
    children: [
      hr(),
      node('div', { role: 'separator', x: 12, y: 70, w: 296, h: 1, styles: { ...styles(), bgColor: [233, 30, 99, 255] } }),
      node('li', { classes: ['MuiDivider-root'], role: 'separator', x: 12, y: 90, w: 296, h: 1, styles: { ...styles(), borderBottomColor: [0, 0, 0, 31], borderBottomWidth: 1 } }),
      node('div', { role: 'separator', aria: { orientation: 'vertical' }, x: 100, y: 100, w: 1, h: 30, styles: { ...styles(), bgColor: [158, 158, 158, 255] } }),
    ],
  });
  const { xml } = convert(page, { name: 'dividers' });
  assert.match(xml, /<lv_obj name="divider" x="12" y="40" width="296" height="1" style_bg_color="0xbdbdbd" style_border_width="0"/);
  assert.match(xml, /<lv_obj name="divider_2" [^>]*width="296" height="1" style_bg_color="0xe91e63"/);
  assert.match(xml, /<lv_obj name="divider_3" [^>]*width="296" height="1" style_bg_color="0xe0e0e0"/);
  assert.match(xml, /<lv_obj name="divider_4" [^>]*width="1" height="30" style_bg_color="0x9e9e9e"/);
  assert.doesNotMatch(xml, /border_side/);
});
