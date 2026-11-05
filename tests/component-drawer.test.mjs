/**
 * Drawer component and the behavior API it needed (timelines, play events):
 * match signals and scores, the geometry that separates it from a Modal, all
 * four edges, build output (scrim with the only hide-binding, parked panel,
 * slide timelines, openers and closers), initially hidden / parked / open
 * states, and the converted XML including the `<animations>` block.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import drawer from '../src/components/drawer.mjs';
import modal from '../src/components/modal.mjs';
import { dockedEdge } from '../src/components/overlay.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert, pageXml } from '../src/convert.mjs';
import { playEvent, slideTimeline, withBehavior, qualifyBehavior, behaviorElements, animationsElement, isBehaviorElement, BEHAVIOR_TAGS } from '../src/behavior.mjs';
import { render } from '../src/emit-xml.mjs';
import { node } from './helpers/tree.mjs';
import { page, dialog, opener, button, panel } from './helpers/overlay-tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = (tree) => recognize(structuredClone(tree), { registry: createRegistry([drawer, modal]), diagnostics: createDiagnostics() }).tree;
const scoreOf = (tree, pick) => {
  let seen = null;
  const spy = { ...drawer, match: (n, ctx) => { const s = drawer.match(n, ctx); if (pick(n) && seen === null) seen = Number(s); return s; } };
  recognize(structuredClone(tree), { registry: createRegistry([spy]), diagnostics: createDiagnostics() });
  return seen;
};

/* ------------------------------------------------------- behavior API */

test('slideTimeline and playEvent build the IR and reject what LVGL cannot take', () => {
  assert.deepEqual(slideTimeline('t', 'translate_x', -200, 0, 250), { name: 't', animations: [{ prop: 'translate_x', start: -200, end: 0, duration: 250 }] });
  assert.deepEqual(playEvent('t'), { kind: 'play', timeline: 't' });
  assert.deepEqual(playEvent('t', 'pressed'), { kind: 'play', timeline: 't', trigger: 'pressed' });
  assert.throws(() => slideTimeline('t', 'translate_x', 1.5, 0), /integer/);
  assert.throws(() => slideTimeline('', 'translate_x', 0, 1), /name/);
  assert.throws(() => playEvent(''), /timeline/);
});

test('withBehavior merges timelines without duplicating and stays backward compatible', () => {
  const a = withBehavior(node('div'), { timelines: [slideTimeline('t', 'translate_x', -1, 0)] });
  const b = withBehavior(a, { timelines: [slideTimeline('t', 'translate_x', -1, 0), slideTimeline('u', 'opa', 0, 255)] });
  assert.deepEqual(b.behavior.timelines.map((t) => t.name), ['t', 'u']);
  assert.equal(withBehavior(node('div'), { events: [] }).behavior.timelines, undefined);
});

test('qualifyBehavior leaves play events and timeline names alone; behaviorElements writes play_timeline_event', () => {
  const q = qualifyBehavior({ events: [playEvent('t')], timelines: [slideTimeline('t', 'translate_x', -1, 0)] }, 'home');
  assert.deepEqual(q.events, [{ kind: 'play', timeline: 't' }]);
  assert.equal(q.timelines[0].name, 't');
  const [e] = behaviorElements(q);
  assert.equal(e.tag, 'play_timeline_event');
  assert.deepEqual(e.attrs, { target: 'self', timeline: 't', trigger: undefined });
  assert.ok(BEHAVIOR_TAGS.has('play_timeline_event'));
  assert.ok(isBehaviorElement(e));
});

test('animationsElement renders <animations><timeline><animation/>; null when there are none', () => {
  assert.equal(animationsElement([]), null);
  const xml = render(animationsElement([{ name: 't', animations: [{ prop: 'translate_x', target: 'p', start: -5, end: 0, duration: 250 }] }]));
  assert.match(xml, /<animations>\s*<timeline name="t">\s*<animation prop="translate_x" target="p" start="-5" end="0" duration="250" \/>/);
  assert.equal(pageXml({ tag: 'view', attrs: {}, children: [] }, { screenMode: true }), '<screen>\n  <view />\n</screen>\n');
});

/* ------------------------------------------------------------- geometry */

test('dockedEdge: each edge, parked, and the shapes that are NOT a drawer', () => {
  const screen = { w: 320, h: 240 };
  assert.deepEqual(dockedEdge({ x: 0, y: 0, w: 200, h: 240 }, screen), { edge: 'left', parked: false });
  assert.deepEqual(dockedEdge({ x: 120, y: 0, w: 200, h: 240 }, screen), { edge: 'right', parked: false });
  assert.deepEqual(dockedEdge({ x: 0, y: 0, w: 320, h: 100 }, screen), { edge: 'top', parked: false });
  assert.deepEqual(dockedEdge({ x: 0, y: 140, w: 320, h: 100 }, screen), { edge: 'bottom', parked: false });
  assert.deepEqual(dockedEdge({ x: -200, y: 0, w: 200, h: 240 }, screen), { edge: 'left', parked: true });
  assert.deepEqual(dockedEdge({ x: 320, y: 0, w: 200, h: 240 }, screen), { edge: 'right', parked: true });
  assert.equal(dockedEdge({ x: 40, y: 60, w: 240, h: 120 }, screen), null, 'a centered dialog');
  assert.equal(dockedEdge({ x: 0, y: 0, w: 320, h: 240 }, screen), null, 'a full-screen dialog');
  assert.equal(dockedEdge({ x: 0, y: 0, w: 200, h: 120 }, screen), null, 'a corner box');
});

/* ---------------------------------------------------------------- match */

test('the drawer definition is valid, registered by default, and describes props and slots', () => {
  assert.deepEqual(validateComponent(drawer), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(drawer));
  assert.deepEqual(Object.keys(drawer.props), ['anchor', 'open', 'title']);
  assert.deepEqual(drawer.slots, ['header', 'body']);
});

test('an edge-docked role=dialog scores 1; the opener 1; a MuiDrawer wrapper 0.7; a scrim 0.5; centered dialog 0', () => {
  assert.equal(scoreOf(page([panel('left')]), (n) => n.id === 'nav'), 1);
  assert.equal(scoreOf(page([opener('nav'), panel('left')]), (n) => n.id === 'open'), 1);
  const mui = node('div', { id: 'w', classes: ['MuiDrawer-root', 'MuiDrawer-modal'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [panel('right')]);
  assert.equal(scoreOf(page([mui]), (n) => n.id === 'w'), 0.7);
  const scrim = node('div', { id: 's', x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [panel('left')]);
  assert.equal(scoreOf(page([scrim]), (n) => n.id === 's'), 0.5);
  assert.equal(scoreOf(page([dialog()]), (n) => n.id === 'dlg'), 0);
  const docked = node('div', { id: 'w', classes: ['MuiDrawer-root', 'MuiDrawer-docked'], x: 0, y: 0, w: 200, h: 240 }, [node('div', { classes: ['MuiDrawer-paper'], x: 0, y: 0, w: 200, h: 240 })]);
  assert.equal(scoreOf(page([docked]), (n) => n.id === 'w'), 0, 'a permanent drawer is page layout, not an overlay');
});

test('match never throws on a bare node or missing context', () => {
  assert.doesNotThrow(() => drawer.match(node('div'), { tree: node('body'), byId: new Map(), links: new Map() }));
  assert.doesNotThrow(() => drawer.match({ tag: 'div', children: [] }, { tree: { w: 1, h: 1, children: [] }, byId: new Map() }));
});

/* ---------------------------------------------------------------- build */

test('build (left, closed by the extractor): scrim first with the only hide-binding, panel parked, two timelines', () => {
  const p = panel('left', { hidden: true, revealed: true });
  p.children.forEach((c) => { c.hidden = true; c.revealed = true; });
  const out = run(page([opener('nav'), p]));
  const panelNode = out.children[1];
  assert.equal(panelNode.id, 'nav');
  assert.equal(panelNode.overlay, true);
  assert.deepEqual(panelNode.styleTranslate, { x: -200 });
  assert.equal(panelNode.behavior.binds, undefined, 'the panel must not carry a hide-binding');
  const scrim = panelNode.overlayBefore[0];
  const subject = scrim.behavior.subjects[0].name;
  assert.equal(scrim.behavior.subjects[0].initial, 0);
  assert.deepEqual(scrim.behavior.binds, [{ kind: 'flag', subject, flag: 'hidden', op: 'eq', ref: 0 }]);
  const [inName, outName] = panelNode.behavior.timelines.map((t) => t.name);
  assert.match(inName, /slide_in$/);
  assert.deepEqual(scrim.behavior.events, [{ kind: 'set', subject, value: 0 }, { kind: 'play', timeline: outName }]);
  assert.deepEqual(panelNode.behavior.timelines[0].animations, [{ prop: 'translate_x', start: -200, end: 0, duration: 250 }]);
  assert.deepEqual(panelNode.behavior.timelines[1].animations, [{ prop: 'translate_x', start: 0, end: -200, duration: 250 }]);
  assert.deepEqual(out.children[0].behavior.events, [{ kind: 'set', subject, value: 1 }, { kind: 'play', timeline: inName }]);
  const close = panelNode.children.find((c) => c.tag === 'button');
  assert.deepEqual(close.behavior.events, [{ kind: 'set', subject, value: 0 }, { kind: 'play', timeline: outName }]);
  assert.deepEqual(panelNode.recognized.props, { anchor: 'left', open: false, title: '' });
});

test('build: right, top and bottom edges park on the right axis and pin to their edge', () => {
  const cases = { right: ['translate_x', 200, 120, 0], top: ['translate_y', -100, 0, 0], bottom: ['translate_y', 100, 0, 140] };
  for (const [edge, [prop, park, x, y]] of Object.entries(cases)) {
    const p = panel(edge, { hidden: true, revealed: true });
    p.children.forEach((c) => { c.hidden = true; c.revealed = true; });
    const out = run(page([p])).children[0];
    assert.equal(out.recognized.props.anchor, edge);
    assert.deepEqual(prop === 'translate_x' ? out.styleTranslate.x : out.styleTranslate.y, park, edge);
    assert.deepEqual(out.behavior.timelines[0].animations[0], { prop, start: park, end: 0, duration: 250 }, edge);
    assert.deepEqual([out.x, out.y], [x, y], edge);
  }
});

test('build: the shadow reach is added to the parked distance', () => {
  const p = panel('left', { hidden: true, revealed: true, styles: { shadow: { color: [0, 0, 0, 64], x: 4, y: 0, blur: 12, spread: 0 } } });
  const out = run(page([p])).children[0];
  assert.deepEqual(out.styleTranslate, { x: -216 });
});

test('build: open on load (visible dialog) starts at 1 and is not parked; a panel off-screen is closed and pinned to its edge', () => {
  const o = run(page([panel('left')])).children.at(-1);
  assert.equal(o.styleTranslate, undefined);
  assert.equal(o.overlayBefore[0].behavior.subjects[0].initial, 1);
  assert.equal(o.recognized.props.open, true);
  const parked = run(page([panel('left', { x: -200 })])).children.at(-1);
  assert.equal(parked.x, 0);
  assert.deepEqual(parked.styleTranslate, { x: -200 });
  assert.equal(parked.overlayBefore[0].behavior.subjects[0].initial, 0);
});

test('build: a panel that is not modal gets no scrim (slides, no dim layer)', () => {
  const out = run(page([panel('left', { aria: {} })])).children.at(-1);
  assert.equal(out.overlayBefore, undefined);
  assert.equal(out.behavior.timelines.length, 2);
});

test('data-lv-widget="drawer" forces a plain div and picks the nearest edge', () => {
  const div = node('div', { widget: 'drawer', x: 120, y: 0, w: 200, h: 100, aria: { modal: 'true' } });
  const out = run(page([div])).children.at(-1);
  assert.equal(out.recognized.component, 'drawer');
  assert.equal(out.recognized.props.anchor, 'right');
});

/* -------------------------------------------------------------- convert */

test('convert: scrim then panel, last in the screen, translate attributes, <animations> before <view>, no undeclared warnings', () => {
  const p = panel('left', { hidden: true, revealed: true });
  p.children.forEach((c) => { c.hidden = true; c.revealed = true; });
  const result = convert(page([opener('nav'), p, button('after')]), { name: 'home', screenMode: true });
  const { xml, timelines, subjects } = result;
  assert.ok(xml.indexOf('<animations>') < xml.indexOf('<view'), xml);
  assert.equal(timelines.length, 2);
  assert.equal(timelines[0].animations[0].target, 'nav');
  assert.match(xml, /<animation prop="translate_x" target="nav" start="-200" end="0" duration="250" \/>/);
  assert.match(xml, /name="nav" x="0" y="0" ignore_layout="true" floating="true" style_translate_x="-200"/);
  assert.ok(xml.indexOf('style_bg_opa="128"') < xml.indexOf('name="nav"'), 'scrim before panel');
  assert.ok(xml.indexOf('name="after"') < xml.indexOf('style_bg_opa="128"'), 'both after normal content');
  assert.match(xml, /<play_timeline_event target="self" timeline="home_?[a-z0-9_]*slide_in" \/>|<play_timeline_event target="self" timeline="[a-z0-9_]*slide_in" \/>/);
  assert.equal(subjects.length, 1);
  assert.deepEqual(result.warnings.filter((w) => /subject|timeline/.test(w)), []);
  assert.deepEqual(result.view.children.at(-1).meta.behavior.timelines[0].animations[0].target, 'nav');
});

test('convert: two drawers keep separate subjects and timelines; a repeated timeline name is reported', () => {
  const a = panel('left', { id: 'a' });
  const b = panel('right', { id: 'b' });
  const { timelines, subjects } = convert(page([a, b]), { name: 'home', screenMode: true });
  assert.equal(subjects.length, 2);
  assert.equal(new Set(timelines.map((t) => t.name)).size, 4);
  const dup = withBehavior(node('div', { id: 'd1' }), { timelines: [slideTimeline('same', 'translate_x', 0, 1)] });
  const dup2 = withBehavior(node('div', { id: 'd2' }), { timelines: [slideTimeline('same', 'translate_x', 0, 2)] });
  const r = convert(page([dup, dup2]), { name: 'home', screenMode: true });
  assert.ok(r.diagnostics.list().some((d) => /timeline same is declared twice/.test(d.message)));
});

test('convert without a drawer emits no <animations> and is unchanged for a page with behavior only', () => {
  const { xml, animations, timelines } = convert(page([dialog()]), { name: 'home', screenMode: true });
  assert.equal(animations, null);
  assert.deepEqual(timelines, []);
  assert.ok(!xml.includes('<animations>'));
});

test('golden: the Drawer fixture (plain left sheet, Material UI right panel, both closed on load) converts to the committed XML', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'drawer.json'), 'utf8'));
  const { xml, globalsXml, diagnostics } = convert(tree, { name: 'drawer', screenMode: true });
  assert.equal(xml, readFileSync(join(here, 'golden-behavior', 'drawer.xml'), 'utf8'));
  assert.equal(globalsXml, readFileSync(join(here, 'golden-behavior', 'drawer.globals.xml'), 'utf8'));
  assert.deepEqual(diagnostics.list().filter((d) => d.code.startsWith('BEHAVIOR_')), []);
});

test('golden: top and bottom sheets convert to the committed XML', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'drawer-edges.json'), 'utf8'));
  const { xml, globalsXml } = convert(tree, { name: 'drawer-edges', screenMode: true });
  assert.equal(xml, readFileSync(join(here, 'golden-behavior', 'drawer-edges.xml'), 'utf8'));
  assert.equal(globalsXml, readFileSync(join(here, 'golden-behavior', 'drawer-edges.globals.xml'), 'utf8'));
  assert.match(xml, /prop="translate_y" target="top_sheet" start="-126"/);
  assert.match(xml, /prop="translate_y" target="bottom_sheet" start="126"/);
});
