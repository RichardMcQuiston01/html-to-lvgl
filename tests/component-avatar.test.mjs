/**
 * Avatar: matching, shapes (circle, rounded square, square), initials versus
 * photo, and an end-to-end convert().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateComponent, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';

const styles = (extra = {}) => ({
  bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0,
  borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 13,
  textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
  gradient: null, shadow: null, scrollable: false, pressed: null, ...extra,
});
const layout = (extra = {}) => ({
  display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
  alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
  marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
  gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
  gridRowStart: 'auto', gridRowEnd: 'auto', ...extra,
});
/** An extractor-shaped node: `aria` keys have no "aria-" prefix. */
const node = (tag, extra = {}) => {
  const { st, lay, ...rest } = extra;
  return {
    tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
    role: null, aria: {}, classes: [], testId: null, hidden: false,
    x: 0, y: 0, w: 40, h: 40, text: null, attrs: {}, styles: styles(st), layout: layout(lay), children: [], key: 'k',
    ...rest,
  };
};
const page = (...children) => node('body', { w: 320, h: 240, st: { bgColor: [255, 255, 255, 255] }, children });
const findBy = (tree, pred) => (pred(tree) ? tree : tree.children.map((c) => findBy(c, pred)).find(Boolean) ?? null);
const run = (tree) => {
  const diagnostics = createDiagnostics();
  const out = recognize(tree, { diagnostics });
  return { ...out, diagnostics };
};
const codes = (diagnostics) => diagnostics.list().map((d) => d.code);

import avatar from '../src/components/avatar.mjs';

const ctx = () => ({ diagnostics: createDiagnostics(), parent: null, tree: null });
const score = (n) => Number(avatar.match(n, ctx()));

const muiAvatar = (extra = {}) => node('div', {
  classes: ['MuiAvatar-root', 'MuiAvatar-circular', 'MuiAvatar-colorDefault'], x: 10, y: 10, w: 40, h: 40, text: 'H',
  st: { bgColor: [255, 87, 34, 255], radius: 20, color: [255, 255, 255, 255], fontSize: 20 },
  lay: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  ...extra,
});
const photo = () => node('img', { classes: ['MuiAvatar-img'], x: 10, y: 10, w: 40, h: 40, attrs: { src: 'face.png', alt: 'Ada' } });

test('the avatar definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(avatar), { ok: true, errors: [] });
  assert.equal(avatar.name, 'avatar');
  assert.ok(builtinComponents.includes(avatar));
  assert.deepEqual(avatar.slots, ['image', 'fallback']);
});

test('MuiAvatar-root matches at 0.7; near misses do not', () => {
  assert.equal(score(muiAvatar()), 0.7);
  assert.equal(score(node('div', { className: 'MuiAvatar-root' })), 0.7);
  assert.equal(score(node('img', { classes: ['MuiAvatar-img'] })), 0, 'the image part alone');
  assert.equal(score(node('div', { classes: ['MuiAvatarGroup-root'] })), 0);
  assert.equal(score(node('div', { classes: ['avatar'] })), 0);
  assert.equal(score(muiAvatar({ hidden: true })), 0);
});

test('data-lv-widget="avatar" forces it and is consumed', () => {
  const { tree } = run(page(node('div', { widget: 'avatar', text: 'AB', st: { radius: 20, bgColor: [1, 2, 3, 255] } })));
  assert.equal(tree.children[0].recognized.component, 'avatar');
  assert.equal(tree.children[0].widget, null);
});

test('a circle gets LV_RADIUS_CIRCLE (0x7FFF), a rounded square keeps its radius, a square stays square', () => {
  const circ = run(page(muiAvatar())).tree.children[0];
  assert.equal(circ.styles.radius, 0x7fff);
  assert.equal(circ.recognized.props.shape, 'circular');
  const rounded = run(page(muiAvatar({ classes: ['MuiAvatar-root', 'MuiAvatar-rounded'], st: { bgColor: [1, 2, 3, 255], radius: 4 } }))).tree.children[0];
  assert.equal(rounded.styles.radius, 4);
  assert.equal(rounded.recognized.props.shape, 'rounded');
  const square = run(page(muiAvatar({ classes: ['MuiAvatar-root', 'MuiAvatar-square'], st: { bgColor: [1, 2, 3, 255], radius: 0 } }))).tree.children[0];
  assert.equal(square.styles.radius, 0);
  assert.equal(square.recognized.props.shape, 'square');
});

test('shape is read from the measured radius when the class says nothing', () => {
  const plain = (radius) => run(page(node('div', { widget: 'avatar', text: 'x', st: { radius, bgColor: [1, 2, 3, 255] } }))).tree.children[0].recognized.props.shape;
  assert.equal(plain(20), 'circular'); // half of 40
  assert.equal(plain(19), 'circular'); // rounding left a pixel short
  assert.equal(plain(8), 'rounded');
  assert.equal(plain(0), 'square');
});

test('initials are centered and reported', () => {
  const a = run(page(muiAvatar())).tree.children[0];
  assert.equal(a.styles.textAlign, 'center');
  assert.deepEqual(a.recognized.props, { shape: 'circular', initials: 'H', src: '' });
  assert.equal(a.text, 'H', 'the text is kept');
});

test('a photo avatar keeps its image, reports src, and marks the clip', () => {
  const a = run(page(muiAvatar({ text: null, children: [photo()] }))).tree.children[0];
  assert.equal(a.children.length, 1);
  assert.equal(a.children[0].tag, 'img');
  assert.deepEqual(a.recognized.props, { shape: 'circular', initials: '', src: 'face.png' });
  assert.equal(a.styles.clipCorner, true, 'marker for style_clip_corner, which convert.mjs does not emit yet');
});

test('an inlined data: URI is not copied into the props', () => {
  const img = node('img', { attrs: { src: 'data:image/png;base64,AAAA' }, w: 40, h: 40 });
  const a = run(page(muiAvatar({ text: null, children: [img] }))).tree.children[0];
  assert.equal(a.recognized.props.src, '');
});

test('initials in a child span keep their text', () => {
  const span = node('span', { x: 20, y: 20, w: 20, h: 16, text: 'AB' });
  const a = run(page(muiAvatar({ text: null, children: [span] }))).tree.children[0];
  assert.equal(a.recognized.props.initials, 'AB');
  assert.equal(a.children[0].text, 'AB');
});

test('an avatar that is also a chip part is an avatar only, and the chip around it is not ambiguous', () => {
  const inner = muiAvatar({ classes: ['MuiAvatar-root', 'MuiChip-avatar'], w: 24, h: 24, st: { bgColor: [1, 2, 3, 255], radius: 12 } });
  const chip = node('div', { classes: ['MuiChip-root'], w: 80, h: 32, st: { radius: 16, bgColor: [9, 9, 9, 255] }, children: [inner] });
  const { tree, diagnostics } = run(page(chip));
  assert.equal(tree.children[0].recognized.component, 'chip');
  assert.equal(tree.children[0].children[0].recognized.component, 'avatar');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'));
});

test('convert(): a circle is style_radius 32767, a rounded square its pixels, the label is kept', () => {
  const { xml } = convert(page(
    muiAvatar(),
    muiAvatar({ x: 60, classes: ['MuiAvatar-root', 'MuiAvatar-rounded'], text: 'N', st: { bgColor: [25, 118, 210, 255], radius: 4 } }),
  ));
  assert.match(xml, /<lv_obj name="avatar"[^>]*style_radius="32767"/);
  assert.match(xml, /<lv_obj name="avatar_3"[^>]*style_radius="4"/);
  assert.match(xml, /text="H"/);
  assert.match(xml, /text="N"/);
});

test('the measured radius wins over the variant class (circular class with border-radius:4px is rounded)', () => {
  const a = run(page(muiAvatar({ st: { bgColor: [1, 2, 3, 255], radius: 4 } }))).tree.children[0];
  assert.equal(a.styles.radius, 4);
  assert.equal(a.recognized.props.shape, 'rounded');
  const sq = run(page(muiAvatar({ classes: ['MuiAvatar-root', 'MuiAvatar-square'], st: { bgColor: [1, 2, 3, 255], radius: 20 } }))).tree.children[0];
  assert.equal(sq.recognized.props.shape, 'circular', 'a page that rounds a square avatar fully is a circle');
});
