/**
 * Paper: matches only when it is the sole Material UI root, so Card, Alert,
 * AppBar and the rest (all MuiPaper-root too) never compete with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import paper from '../src/components/paper.mjs';
import { validateComponent, createRegistry, recognize, defaultRegistry } from '../src/recognize.mjs';
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
const score = (n) => Number(paper.match(n, ctx()));

test('the paper definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(paper), { ok: true, errors: [] });
  assert.equal(paper.name, 'paper');
  assert.deepEqual(paper.slots, ['body']);
  assert.ok(builtinComponents.includes(paper));
});

test('MuiPaper-root alone scores 0.7', () => {
  assert.equal(score(node('div', { classes: ['MuiPaper-root', 'MuiPaper-elevation1', 'MuiPaper-rounded'] })), 0.7);
  assert.equal(score(node('div', { className: 'MuiPaper-root' })), 0.7);
});

test('a Paper that is also another Material UI root does not match', () => {
  for (const other of ['MuiCard-root', 'MuiAlert-root', 'MuiAppBar-root', 'MuiAccordion-root']) {
    assert.equal(score(node('div', { classes: ['MuiPaper-root', other] })), 0, other);
  }
  assert.equal(score(node('div', { classes: ['MuiPaper-elevation1'] })), 0, 'no root class');
  assert.equal(score(node('div', { classes: ['card'] })), 0);
  assert.equal(score(node('div')), 0);
});

test('data-lv-widget="paper" forces the match', () => {
  const body = node('body', { w: 320, h: 240, children: [node('div', { widget: 'paper' })] });
  const { tree, recognized } = recognize(body, { registry: createRegistry([paper]) });
  assert.equal(recognized, 1);
  assert.equal(tree.children[0].recognized.component, 'paper');
});

test('no RECOGNIZER_AMBIGUOUS for Card, Alert or AppBar with the default registry', () => {
  const roots = ['MuiCard-root', 'MuiAlert-root', 'MuiAppBar-root', 'MuiToolbar-root'];
  const body = node('body', {
    w: 320, h: 240,
    children: [
      ...roots.map((r) => node('div', { classes: ['MuiPaper-root', r] })),
      node('div', { classes: ['MuiPaper-root'] }),
    ],
  });
  const diagnostics = createDiagnostics();
  const { tree } = recognize(body, { registry: defaultRegistry, diagnostics });
  assert.equal(diagnostics.list().filter((d) => d.code === 'RECOGNIZER_AMBIGUOUS').length, 0);
  assert.equal(tree.children[4].recognized.component, 'paper');
  assert.notEqual(tree.children[0].recognized?.component, 'paper');
});

test('build() names the paper, reports the variant and blends a translucent border', () => {
  const shadow = { color: [0, 0, 0, 31], x: 0, y: 1, blur: 3, spread: 0 };
  const elevated = paper.build(node('div', { classes: ['MuiPaper-root'], styles: { ...styles(), shadow } }), ctx());
  assert.equal(elevated.lvName, 'paper');
  assert.equal(elevated.recognized.props.variant, 'elevation');

  const outlined = paper.build(node('div', {
    classes: ['MuiPaper-root', 'MuiPaper-outlined'],
    styles: { ...styles(), bgColor: [255, 255, 255, 255], borderWidth: 1, borderColor: [0, 0, 0, 31] },
  }), ctx());
  assert.equal(outlined.recognized.props.variant, 'outlined');
  assert.deepEqual(outlined.styles.borderColor, [224, 224, 224, 255]);

  const kept = node('div', { classes: ['MuiPaper-root'], children: [node('span', { text: 'hi' })] });
  assert.equal(paper.build(kept, ctx()).children[0].text, 'hi');
});

test('convert() names a paper and keeps its text', () => {
  const page = node('body', {
    w: 320, h: 240,
    children: [node('div', {
      classes: ['MuiPaper-root', 'MuiPaper-elevation1'], x: 8, y: 8, w: 300, h: 30,
      styles: { ...styles(), bgColor: [255, 255, 255, 255], radius: 4, shadow: { color: [0, 0, 0, 31], x: 0, y: 1, blur: 3, spread: 0 } },
      children: [node('span', { text: 'A plain Paper surface', x: 20, y: 12, w: 150, h: 14 })],
    })],
  });
  const { xml } = convert(page, { name: 'paper' });
  assert.match(xml, /<lv_obj name="paper" [^>]*style_shadow_width="3"/);
  assert.match(xml, /text="A plain Paper surface"/);
});
