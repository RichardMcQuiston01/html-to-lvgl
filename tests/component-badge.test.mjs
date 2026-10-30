/**
 * Badge: the Material UI wrapper with a pinned count or dot, and the
 * Bootstrap inline pill. Matching, build(), and an end-to-end convert().
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

import badge from '../src/components/badge.mjs';

const ctx = () => ({ diagnostics: createDiagnostics(), parent: null, tree: null });
const score = (n) => Number(badge.match(n, ctx()));

const anchor = () => node('div', { x: 20, y: 20, w: 40, h: 40, st: { bgColor: [226, 232, 240, 255], radius: 8 } });
const pinned = (extra = {}) => node('span', {
  classes: ['MuiBadge-badge', 'MuiBadge-standard'], x: 50, y: 10, w: 20, h: 20, text: '4',
  st: { bgColor: [211, 47, 47, 255], radius: 10, color: [255, 255, 255, 255], fontSize: 12 },
  lay: { display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute' }, ...extra,
});
const muiBadge = (child = pinned()) => node('span', {
  classes: ['MuiBadge-root'], x: 20, y: 20, w: 40, h: 40, lay: { display: 'flex' }, children: [anchor(), child],
});

test('the badge definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(badge), { ok: true, errors: [] });
  assert.equal(badge.name, 'badge');
  assert.ok(builtinComponents.includes(badge));
  assert.deepEqual(badge.slots, ['anchor']);
  assert.deepEqual(Object.keys(badge.props), ['content', 'variant']);
});

test('MuiBadge-root matches at 0.7, a Bootstrap badge at 0.5', () => {
  assert.equal(score(muiBadge()), 0.7);
  assert.equal(score(node('span', { classes: ['badge', 'bg-primary', 'rounded-pill'], w: 40, h: 20 })), 0.5);
});

test('near misses do not match', () => {
  assert.equal(score(pinned()), 0, 'the pinned part alone is not the root');
  assert.equal(score(node('div', { classes: ['badge'], w: 300, h: 200 })), 0, 'a huge box with a badge class');
  assert.equal(score(node('div', { classes: ['badges'], w: 40, h: 20 })), 0);
  assert.equal(score(node('span', { classes: ['MuiBadgeFoo-root'] })), 0);
  assert.equal(score(muiBadge().children.length ? node('span', { classes: ['MuiBadge-root'], hidden: true }) : null), 0);
});

test('data-lv-widget="badge" forces it and is consumed', () => {
  const t = run(page(node('span', { widget: 'badge', text: 'New', w: 40, h: 20 }))).tree.children[0];
  assert.equal(t.recognized.component, 'badge');
  assert.equal(t.widget, null);
});

test('MUI form: content, standard variant, centered count, anchor untouched', () => {
  const before = muiBadge();
  const sameAnchor = (n) => JSON.stringify({ ...n, key: null }); // recognize() assigns keys
  const anchorBefore = sameAnchor(before.children[0]);
  const b = run(page(before)).tree.children[0];
  assert.equal(b.lvName, 'badge');
  assert.deepEqual(b.recognized.props, { content: '4', variant: 'standard' });
  assert.equal(sameAnchor(b.children[0]), anchorBefore, 'the anchor is exactly as it was');
  assert.equal(b.w, 40);
  assert.equal(b.h, 40);
  assert.equal(b.children[1].lvName, 'badge_count');
  assert.equal(b.children[1].styles.textAlign, 'center');
  assert.equal(b.children[1].text, '4');
});

test('dot variant: by class, or by a tiny empty pinned box', () => {
  const dot = pinned({ classes: ['MuiBadge-badge', 'MuiBadge-dot'], text: null, w: 8, h: 8, st: { bgColor: [25, 118, 210, 255], radius: 4 } });
  const a = run(page(muiBadge(dot))).tree.children[0];
  assert.deepEqual(a.recognized.props, { content: '', variant: 'dot' });
  assert.equal(a.children[1].lvName, 'badge_dot');
  const noClass = pinned({ classes: [], text: null, w: 10, h: 10 });
  assert.equal(run(page(muiBadge(noClass))).tree.children[0].recognized.props.variant, 'dot');
});

test('a pinned child is found by position:absolute even without the MUI class', () => {
  const b = run(page(muiBadge(pinned({ classes: [] })))).tree.children[0];
  assert.equal(b.recognized.props.content, '4');
});

test('a pinned child that leaves the anchor marks the wrapper overflowVisible', () => {
  const out = run(page(muiBadge())).tree.children[0];
  assert.equal(out.styles.overflowVisible, true);
  const inside = run(page(muiBadge(pinned({ x: 22, y: 22 })))).tree.children[0];
  assert.equal(inside.styles.overflowVisible, undefined);
});

test('Bootstrap form: the node is the pill, text centered and kept', () => {
  const b = run(page(node('span', { classes: ['badge', 'rounded-pill'], x: 10, y: 10, w: 40, h: 20, text: 'New', st: { bgColor: [13, 110, 253, 255], radius: 160 } }))).tree.children[0];
  assert.equal(b.styles.textAlign, 'center');
  assert.deepEqual(b.recognized.props, { content: 'New', variant: 'standard' });
  assert.equal(b.text, 'New');
});

test('nested: an avatar anchor inside a badge wrapper is its own component, no ambiguity', () => {
  const av = node('div', { classes: ['MuiAvatar-root'], x: 20, y: 20, w: 40, h: 40, text: 'A', st: { radius: 20, bgColor: [1, 2, 3, 255] } });
  const wrapper = node('span', { classes: ['MuiBadge-root'], x: 20, y: 20, w: 40, h: 40, children: [av, pinned()] });
  const { tree, diagnostics } = run(page(wrapper));
  assert.equal(tree.children[0].recognized.component, 'badge');
  assert.equal(tree.children[0].children[0].recognized.component, 'avatar');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'));
});

test('convert(): the pinned count is out of flow with coordinates, the anchor keeps its size', () => {
  const { xml } = convert(page(muiBadge()));
  const wrapper = /<lv_obj name="badge"[^>]*width="(\d+)" height="(\d+)"/.exec(xml);
  assert.deepEqual([wrapper[1], wrapper[2]], ['40', '40']);
  assert.match(xml, /<lv_obj name="badge_count"[^>]*x="30" y="-10" ignore_layout="true"/);
  assert.match(xml, /text="4"/);
});
