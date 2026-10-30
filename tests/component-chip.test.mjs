/**
 * Chip: what matches, what does not, what build() changes, and an end-to-end
 * convert(). Trees are hand built in the extractor's shape.
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

import chip from '../src/components/chip.mjs';

const ctx = () => ({ diagnostics: createDiagnostics(), parent: null, tree: null });
const score = (n) => Number(chip.match(n, ctx()));

const muiChip = (extra = {}) => node('div', {
  classes: ['MuiChip-root', 'MuiChip-filled'], x: 10, y: 10, w: 60, h: 32,
  st: { bgColor: [0, 0, 0, 20], radius: 16, color: [0, 0, 0, 222] },
  lay: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  children: [node('span', { classes: ['MuiChip-label'], x: 22, y: 10, w: 36, h: 18, text: 'Basic', st: { padLeft: 12, padRight: 12, color: [0, 0, 0, 222] } })],
  ...extra,
});

test('the chip definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(chip), { ok: true, errors: [] });
  assert.equal(chip.name, 'chip');
  assert.ok(builtinComponents.includes(chip));
  assert.deepEqual(chip.slots, ['icon', 'delete']);
  assert.deepEqual(Object.keys(chip.props), ['label', 'variant']);
});

test('MuiChip-root matches at 0.7, with or without the full class list', () => {
  assert.equal(score(muiChip()), 0.7);
  assert.equal(score(node('div', { className: 'MuiChip-root' })), 0.7);
});

test('near misses do not match', () => {
  assert.equal(score(node('span', { classes: ['badge', 'rounded-pill'] })), 0, 'Bootstrap pill badge is not a chip');
  assert.equal(score(node('div', { classes: ['MuiChip-label'] })), 0, 'the label alone');
  assert.equal(score(node('div', { classes: ['MuiChipRoot'] })), 0);
  assert.equal(score(node('div', { classes: ['chip'] })), 0, 'a bare "chip" class is too generic');
  assert.equal(score(muiChip({ hidden: true })), 0);
  assert.equal(score(node('div')), 0);
});

test('data-lv-widget="chip" forces it on any element and the widget attribute is consumed', () => {
  const { tree, diagnostics } = run(page(node('span', { widget: 'chip', text: 'Tag', w: 50, h: 28 })));
  const c = tree.children[0];
  assert.equal(c.recognized.component, 'chip');
  assert.equal(c.widget, null, 'convert() must not see an unsupported widget name');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'));
});

test('build() names the chip, its label and avatar, and reports label and variant', () => {
  const avatar = node('div', { classes: ['MuiAvatar-root', 'MuiAvatar-circular', 'MuiChip-avatar'], x: 15, y: 14, w: 24, h: 24, text: 'M' });
  const label = node('span', { classes: ['MuiChip-label'], x: 45, y: 10, w: 40, h: 18, text: 'Avatar' });
  const { tree } = run(page(muiChip({ w: 90, children: [avatar, label] })));
  const c = tree.children[0];
  assert.equal(c.lvName, 'chip');
  assert.deepEqual(c.recognized.props, { label: 'Avatar', variant: 'filled' });
  assert.deepEqual(c.children.map((x) => x.lvName), ['chip_avatar', 'chip_label']);
});

test('variant: MuiChip-outlined, or a border with no fill, is outlined', () => {
  const a = run(page(muiChip({ classes: ['MuiChip-root', 'MuiChip-outlined'], st: { borderWidth: 1, borderColor: [189, 189, 189, 255], radius: 16 } }))).tree.children[0];
  assert.equal(a.recognized.props.variant, 'outlined');
  const b = run(page(muiChip({ classes: ['MuiChip-root'], st: { borderWidth: 1, borderColor: [1, 2, 3, 255], radius: 16 } }))).tree.children[0];
  assert.equal(b.recognized.props.variant, 'outlined');
  assert.equal(run(page(muiChip())).tree.children[0].recognized.props.variant, 'filled');
});

test('a translucent text color is blended onto the solid background behind the chip', () => {
  const { tree } = run(page(muiChip()));
  const label = tree.children[0].children[0];
  // rgba(0,0,0,.87) over rgba(0,0,0,.08) over white
  assert.deepEqual(label.styles.color.slice(3), [255]);
  assert.ok(label.styles.color[0] > 0 && label.styles.color[0] < 60, `got ${label.styles.color}`);
});

test('no blending when the backdrop is unknown (gradient, translucent layer, nothing solid)', () => {
  const under = (bodyStyles) => {
    const body = page(muiChip());
    body.styles = styles(bodyStyles);
    return run(body).tree.children[0].children[0].styles.color;
  };
  assert.deepEqual(under({ gradient: { from: [0, 0, 0, 255], to: [9, 9, 9, 255], dir: 'ver' } }), [0, 0, 0, 222]);
  assert.deepEqual(under({ opacity: 0.5, bgColor: [255, 255, 255, 255] }), [0, 0, 0, 222]);
  assert.deepEqual(under({}), [0, 0, 0, 222]);
});

test('the opacity of a node is never overwritten', () => {
  const faded = muiChip({ st: { bgColor: [200, 200, 200, 255], radius: 16, opacity: 0.4 } });
  assert.equal(run(page(faded)).tree.children[0].styles.opacity, 0.4);
});

test('mixed content keeps BOTH the text and the children, text where it sits', () => {
  const dot = node('i', { x: 22, y: 20, w: 8, h: 8, st: { bgColor: [22, 163, 74, 255], radius: 4 }, lay: { marginRight: 6 } });
  const mixed = node('span', {
    widget: 'chip', x: 10, y: 10, w: 80, h: 28, text: 'Online',
    st: { bgColor: [224, 231, 255, 255], radius: 14, padLeft: 12, padRight: 12 },
    lay: { display: 'flex', alignItems: 'center' }, children: [dot],
  });
  const c = run(page(mixed)).tree.children[0];
  assert.equal(c.text, null, 'the text moved into a label');
  assert.equal(c.children.length, 2);
  assert.equal(c.children[0].tag, 'i', 'the dot stays first');
  assert.equal(c.children[1].text, 'Online');
  assert.equal(c.children[1].lvName, 'chip_label');
});

test('a trailing delete control stays after the text', () => {
  const x = node('button', { x: 60, y: 14, w: 16, h: 16, text: 'x', st: { fontSize: 14 } });
  const c = run(page(node('span', {
    widget: 'chip', x: 10, y: 10, w: 80, h: 28, text: 'Tag', st: { bgColor: [224, 231, 255, 255], radius: 14 },
    lay: { display: 'flex', alignItems: 'center' }, children: [x],
  }))).tree.children[0];
  assert.deepEqual(c.children.map((n) => n.text), ['Tag', 'x']);
});

test('a <button> delete control with no background is made transparent, a filled one is left alone', () => {
  const bare = node('button', { x: 60, y: 14, w: 16, h: 16, text: 'x' });
  const filled = node('button', { x: 80, y: 14, w: 16, h: 16, text: 'y', st: { bgColor: [9, 9, 9, 255] } });
  const c = run(page(muiChip({ w: 100, children: [bare, filled] }))).tree.children[0];
  assert.deepEqual(c.children[0].styles.bgColor, [0, 0, 0, 0]);
  assert.deepEqual(c.children[1].styles.bgColor, [9, 9, 9, 255]);
});

test('a clickable chip keeps its role and tag', () => {
  const c = run(page(muiChip({ role: 'button', attrs: { tabindex: '0' } }))).tree.children[0];
  assert.equal(c.role, 'button');
  assert.equal(c.tag, 'div');
  assert.equal(c.recognized.component, 'chip');
});

test('a label-only chip with symmetric padding is centered', () => {
  const only = node('span', { widget: 'chip', w: 64, h: 28, text: 'Design', st: { bgColor: [1, 2, 3, 255], radius: 14, padLeft: 12, padRight: 12 } });
  assert.equal(run(page(only)).tree.children[0].styles.textAlign, 'center');
});

test('nested: an avatar and an icon inside a chip are recognized as themselves, no ambiguity', () => {
  const avatar = node('div', { classes: ['MuiAvatar-root', 'MuiChip-avatar'], x: 15, y: 14, w: 24, h: 24, text: 'M', st: { radius: 12 } });
  const label = node('span', { classes: ['MuiChip-label'], x: 45, y: 10, w: 40, h: 18, text: 'Delete' });
  const icon = node('svg', { classes: ['MuiSvgIcon-root', 'MuiChip-deleteIcon'], testId: 'CancelIcon', x: 90, y: 13, w: 22, h: 22 });
  const { tree, diagnostics } = run(page(muiChip({ w: 120, children: [avatar, label, icon] })));
  const c = tree.children[0];
  assert.equal(c.recognized.component, 'chip');
  assert.equal(c.children[0].recognized.component, 'avatar');
  assert.equal(c.children[2].recognized.component, 'icon');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'), codes(diagnostics).join());
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_ERROR'));
});

test('convert(): the pill radius survives (at least half the height) and nothing is dropped', () => {
  const { xml } = convert(page(muiChip({ w: 70 })));
  const m = /<lv_obj name="chip"[^>]*style_radius="(\d+)"/.exec(xml);
  assert.ok(m, xml);
  assert.ok(Number(m[1]) >= 16, `radius ${m[1]} is not a pill for a 32px chip`);
  assert.match(xml, /text="Basic"/);
  assert.match(xml, /name="chip_label"/);
});

test('convert(): an icon in a chip becomes a placeholder inside the chip', () => {
  const icon = node('svg', { classes: ['MuiSvgIcon-root'], testId: 'CancelIcon', x: 44, y: 13, w: 22, h: 22 });
  const label = node('span', { classes: ['MuiChip-label'], x: 0, y: 10, w: 40, h: 18, text: 'Del' });
  const { xml, diagnostics } = convert(page(muiChip({ w: 70, children: [label, icon] })));
  assert.match(xml, /name="icon_cancel"/);
  assert.ok(codes(diagnostics).includes('ICON_PLACEHOLDER'));
});

test('label prop: the MuiChip-label wins over avatar initials; decoration text is not a fallback', () => {
  const avatar = node('div', { classes: ['MuiAvatar-root', 'MuiChip-avatar'], x: 15, y: 14, w: 24, h: 24, text: 'M' });
  const x = node('button', { x: 80, y: 14, w: 16, h: 16, text: 'x' });
  const label = node('span', { classes: ['MuiChip-label'], x: 45, y: 10, w: 40, h: 18, text: 'Real' });
  assert.equal(run(page(muiChip({ w: 100, children: [avatar, label, x] }))).tree.children[0].recognized.props.label, 'Real');
  assert.equal(run(page(muiChip({ w: 100, children: [avatar, x] }))).tree.children[0].recognized.props.label, '', 'no label: avatar and delete text are not it');
});

test('a row-reverse chip is not given measured margins', () => {
  const a = node('span', { x: 80, y: 10, w: 20, h: 18, text: 'A' });
  const b = node('span', { x: 20, y: 10, w: 20, h: 18, text: 'B' });
  const c = run(page(muiChip({ w: 100, lay: { display: 'flex', flexDirection: 'row-reverse' }, children: [a, b] }))).tree.children[0];
  assert.deepEqual(c.children.map((n) => n.layout.marginLeft), [0, 0]);
});

test('gap correction moves padding only for plain text labels; a padded container keeps its own', () => {
  const wrap = node('div', { x: 15, y: 14, w: 30, h: 24, st: { padLeft: 3, padRight: 3 }, lay: { display: 'flex' }, children: [node('svg', { x: 18, y: 14, w: 24, h: 24 })] });
  const label = node('span', { classes: ['MuiChip-label'], x: 45, y: 10, w: 40, h: 18, text: 'Hi', st: { padLeft: 12, padRight: 12 } });
  const c = run(page(muiChip({ w: 100, children: [wrap, label] }))).tree.children[0];
  assert.equal(c.children[0].styles.padLeft, 3);
  assert.equal(c.children[0].styles.padRight, 3);
  assert.equal(c.children[1].styles.padLeft, 0);
});
