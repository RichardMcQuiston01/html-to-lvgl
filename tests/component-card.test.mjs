/**
 * Card: matching, variants, what build() fixes inside a card, and convert().
 * Nodes are hand built in the extractor's shape (aria keys without "aria-").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import card from '../src/components/card.mjs';
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
const score = (n) => Number(card.match(n, ctx()));

test('the card definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(card), { ok: true, errors: [] });
  assert.equal(card.name, 'card');
  assert.deepEqual(card.slots, ['header', 'body', 'actions']);
  assert.ok(builtinComponents.includes(card));
});

test('signals: MuiCard-root 0.7, a generic card class 0.5', () => {
  assert.equal(score(node('div', { classes: ['MuiPaper-root', 'MuiCard-root'] })), 0.7);
  assert.equal(score(node('div', { classes: ['card', 'mb-3'] })), 0.5);
  assert.equal(score(node('div', { className: 'card' })), 0.5); // older extractor: first class only
  assert.equal(score(node('div', { classes: ['MuiCard-root', 'card'] })), 0.7);
});

test('near misses do not match', () => {
  assert.equal(score(node('div', { classes: ['MuiPaper-root'] })), 0, 'a bare Paper is not a Card');
  assert.equal(score(node('div', { classes: ['MuiAlert-root', 'MuiPaper-root'] })), 0);
  assert.equal(score(node('div', { classes: ['card-body'] })), 0);
  assert.equal(score(node('div', { classes: ['card-title'] })), 0);
  assert.equal(score(node('div', { classes: ['MuiCardContent-root'] })), 0);
  assert.equal(score(node('div', { classes: ['discard'] })), 0);
  assert.equal(score(node('div')), 0);
});

test('data-lv-widget="card" forces the match through the registry', () => {
  const body = node('body', { w: 320, h: 240, children: [node('div', { widget: 'card' })] });
  const { tree, recognized } = recognize(body, { registry: createRegistry([card]) });
  assert.equal(recognized, 1);
  assert.equal(tree.children[0].recognized.component, 'card');
});

test('build() names the card and reports the variant', () => {
  const shadow = { color: [0, 0, 0, 31], x: 0, y: 1, blur: 8, spread: 0 };
  const elevated = card.build(node('div', { classes: ['MuiCard-root', 'MuiPaper-elevation3'], styles: { ...styles(), shadow } }), ctx());
  assert.equal(elevated.lvName, 'card');
  assert.equal(elevated.recognized.props.variant, 'elevation');

  const outlinedClass = card.build(node('div', { classes: ['MuiCard-root', 'MuiPaper-outlined'] }), ctx());
  assert.equal(outlinedClass.recognized.props.variant, 'outlined');

  const bordered = card.build(node('div', { classes: ['card'], styles: { ...styles(), borderWidth: 1, borderColor: [222, 226, 230, 255] } }), ctx());
  assert.equal(bordered.recognized.props.variant, 'outlined', 'a visible border and no shadow reads as outlined');

  assert.equal(card.build(node('div', { classes: ['card'], lvName: 'mine' }), ctx()).lvName, 'mine', 'an author-chosen name wins');
});

test('build() blends a translucent outlined border onto the surface', () => {
  const parent = node('body', { styles: { ...styles(), bgColor: [250, 250, 250, 255] } });
  const out = card.build(node('div', {
    classes: ['MuiCard-root', 'MuiPaper-outlined'],
    styles: { ...styles(), bgColor: [255, 255, 255, 255], borderWidth: 1, borderColor: [0, 0, 0, 31] },
  }), ctx(parent));
  assert.deepEqual(out.styles.borderColor, [224, 224, 224, 255]); // 255 * (1 - 31/255)
  assert.equal(out.styles.borderWidth, 1);
  // With no opaque surface on the card itself, the parent's color is used.
  const out2 = card.build(node('div', { classes: ['MuiCard-root'], styles: { ...styles(), borderWidth: 1, borderColor: [0, 0, 0, 128] } }), ctx(parent));
  assert.equal(out2.styles.borderColor[3], 255);
  assert.deepEqual(out2.styles.borderColor, [125, 125, 125, 255]);
  // A solid border is left alone.
  const solid = node('div', { classes: ['card'], styles: { ...styles(), borderWidth: 1, borderColor: [1, 2, 3, 255] } });
  assert.deepEqual(card.build(solid, ctx()).styles.borderColor, [1, 2, 3, 255]);
});

const padded = (extra) => node('div', {
  classes: ['MuiCardContent-root'], text: 'Body text', x: 10, y: 20, w: 120, h: 30,
  styles: { ...styles(), padLeft: 12, padRight: 12, padTop: 4, padBottom: 6, color: [0, 0, 0, 153] },
  ...extra,
});

test('build() slots: named, padded text kept, actions buttons made transparent', () => {
  const header = node('div', { classes: ['MuiCardHeader-root'], children: [node('span', { text: 'Title' })] });
  const button = node('button', { text: 'SHARE' });
  const filled = node('button', { text: 'OK', styles: { ...styles(), bgColor: [25, 118, 210, 255] } });
  const actions = node('div', { classes: ['MuiCardActions-root'], children: [button, filled] });
  const other = node('div', { classes: ['custom'] });
  const out = card.build(node('div', {
    classes: ['MuiCard-root'], styles: { ...styles(), bgColor: [255, 255, 255, 255] }, children: [header, padded({}), actions, other],
  }), ctx());
  const [h, b, a, o] = out.children;
  assert.deepEqual([h.lvName, b.lvName, a.lvName, o.lvName], ['card_header', 'card_body', 'card_actions', null]);

  // the text moved into a child placed inside the padding
  assert.equal(b.text, null);
  assert.equal(b.children.length, 1);
  const label = b.children[0];
  assert.equal(label.text, 'Body text');
  assert.deepEqual([label.x, label.y, label.w, label.h], [22, 24, 96, 20]);
  assert.deepEqual(label.styles.color, [102, 102, 102, 255], 'translucent text is blended onto the card surface');
  assert.equal(b.styles.padLeft, 12, 'the box keeps its padding values for flex layout');

  assert.deepEqual(a.children[0].styles.bgColor, [0, 0, 0, 0]);
  assert.deepEqual(a.children[1].styles.bgColor, [25, 118, 210, 255], 'a filled button is untouched');
  // nothing is lost
  assert.equal(h.children[0].text, 'Title');
  assert.equal(out.children.length, 4);
});

test('build() leaves unpadded text and decorated text alone', () => {
  const plain = node('div', { classes: ['card-body'], text: 'x' });
  const decorated = node('div', { classes: ['card-footer'], text: 'x', styles: { ...styles(), padLeft: 8, bgColor: [1, 2, 3, 255] } });
  const out = card.build(node('div', { classes: ['card'], children: [plain, decorated] }), ctx());
  assert.equal(out.children[0].text, 'x');
  assert.equal(out.children[0].children.length, 0);
  assert.equal(out.children[1].text, 'x');
  assert.equal(out.children[1].children.length, 0);
});

test('a Card is not also a Paper and raises no ambiguity', () => {
  const body = node('body', { w: 320, h: 240, children: [node('div', { classes: ['MuiPaper-root', 'MuiCard-root'] })] });
  const diagnostics = createDiagnostics();
  const { tree } = recognize(body, { registry: defaultRegistry, diagnostics });
  assert.equal(tree.children[0].recognized.component, 'card');
  assert.equal(diagnostics.list().filter((d) => d.code === 'RECOGNIZER_AMBIGUOUS').length, 0);
});

test('convert() emits a named card with its border color, shadow and padded text', () => {
  const surface = { ...styles(), bgColor: [255, 255, 255, 255], radius: 4, borderWidth: 1, borderColor: [0, 0, 0, 31] };
  const flexColumn = { ...layout(), display: 'flex', flexDirection: 'column' };
  const page = node('body', {
    w: 320, h: 240,
    children: [
      node('div', {
        classes: ['MuiPaper-root', 'MuiCard-root', 'MuiPaper-outlined'], x: 8, y: 8, w: 150, h: 80, styles: surface,
        layout: flexColumn,
        children: [padded({ x: 9, y: 9 })],
      }),
      node('div', {
        classes: ['MuiPaper-root', 'MuiCard-root', 'MuiPaper-elevation3'], x: 170, y: 8, w: 140, h: 80,
        styles: { ...surface, borderWidth: 0, borderColor: null, shadow: { color: [0, 0, 0, 31], x: 0, y: 1, blur: 8, spread: 0 } },
        layout: flexColumn,
      }),
    ],
  });
  const { xml } = convert(page, { name: 'cards' });
  assert.match(xml, /<lv_obj name="card" [^>]*style_border_width="1" style_border_color="0xe0e0e0"/);
  assert.match(xml, /<lv_obj name="card_2" [^>]*style_shadow_width="8"/);
  assert.match(xml, /name="card_body"/);
  assert.match(xml, /<lv_label [^>]*text="Body text"/);
  assert.doesNotMatch(xml, /muipaper|muicard/);
});
