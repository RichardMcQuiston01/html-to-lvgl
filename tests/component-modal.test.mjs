/**
 * Modal component: match signals and scores, near misses (a drawer-shaped
 * dialog), data-lv-widget forcing, what build() returns, props/slots, and the
 * converted XML: the overlay is the LAST child of the screen, floating at 0,0,
 * bound to its subject, openers and closers carry set events, and an
 * initially hidden dialog starts at 0. The generated XML of the committed
 * fixture is compared with tests/golden-behavior/modal.xml.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import modal from '../src/components/modal.mjs';
import drawer from '../src/components/drawer.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { extractPage } from '../src/extract.mjs';
import { node } from './helpers/tree.mjs';
import { page, dialog, opener, button, panel } from './helpers/overlay-tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = (tree) => recognize(structuredClone(tree), { registry: createRegistry([modal, drawer]), diagnostics: createDiagnostics() }).tree;
const scoreOf = (tree, pick) => {
  const copy = structuredClone(tree);
  let seen = null;
  const spy = { ...modal, match: (n, ctx) => { const s = modal.match(n, ctx); if (pick(n) && seen === null) seen = Number(s); return s; } };
  recognize(copy, { registry: createRegistry([spy]), diagnostics: createDiagnostics() });
  return seen;
};

test('the modal definition is valid, registered by default, and describes props and slots', () => {
  assert.deepEqual(validateComponent(modal), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(modal));
  assert.deepEqual(Object.keys(modal.props), ['title', 'modal', 'open']);
  assert.deepEqual(modal.slots, ['title', 'content', 'actions']);
});

test('role=dialog and role=alertdialog score 1; a MuiDialog wrapper 0.7; a full-screen scrim 0.5', () => {
  assert.equal(scoreOf(page([dialog()]), (n) => n.id === 'dlg'), 1);
  assert.equal(scoreOf(page([dialog({ role: 'alertdialog' })]), (n) => n.id === 'dlg'), 1);
  const mui = node('div', { id: 'w', classes: ['MuiDialog-root', 'MuiModal-root'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [dialog()]);
  assert.equal(scoreOf(page([mui]), (n) => n.id === 'w'), 0.7);
  const scrim = node('div', { id: 's', x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [dialog()]);
  assert.equal(scoreOf(page([scrim]), (n) => n.id === 's'), 0.5);
});

test('a button whose aria-controls names the dialog is the opener (score 1)', () => {
  assert.equal(scoreOf(page([opener('dlg'), dialog()]), (n) => n.id === 'open'), 1);
});

test('near misses: a drawer-shaped dialog, a plain div, an opener of something else, a docked MuiDrawer', () => {
  assert.equal(scoreOf(page([panel('left')]), (n) => n.id === 'nav'), 0);
  assert.equal(scoreOf(page([node('div', { id: 'x' })]), (n) => n.id === 'x'), 0);
  assert.equal(scoreOf(page([opener('other'), node('div', { id: 'other' })]), (n) => n.id === 'open'), 0);
  const drawerRoot = node('div', { id: 'w', classes: ['MuiDrawer-root', 'MuiModal-root'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [panel('left')]);
  assert.equal(scoreOf(page([drawerRoot]), (n) => n.id === 'w'), 0);
  assert.equal(scoreOf(page([dialog({ x: 0, y: 0, w: 320, h: 240 })]), (n) => n.id === 'dlg'), 1, 'a full-screen dialog is a modal, not a drawer');
});

test('match never throws on a bare node or missing context', () => {
  assert.doesNotThrow(() => modal.match(node('div'), { tree: node('body'), byId: new Map(), links: new Map() }));
  assert.doesNotThrow(() => modal.match({ tag: 'div', children: [] }, { tree: { w: 1, h: 1, children: [] }, byId: new Map() }));
});

test('data-lv-widget="modal" forces a plain div', () => {
  const div = node('div', { widget: 'modal', x: 40, y: 60, w: 240, h: 120, aria: { modal: 'true' } });
  // a forced widget with no role still builds an overlay
  const out = run(page([div]));
  assert.equal(out.children.at(-1).recognized.component, 'modal');
});

test('build: a modal dialog becomes a full-screen overlay holding the dialog, bound to one subject', () => {
  const out = run(page([opener('dlg'), dialog()]));
  const overlay = out.children[1];
  assert.equal(overlay.overlay, true);
  assert.deepEqual([overlay.x, overlay.y, overlay.w, overlay.h], [0, 0, 320, 240]);
  assert.deepEqual(overlay.styles.bgColor, [0, 0, 0, 128]);
  assert.equal(overlay.children.length, 1);
  assert.equal(overlay.children[0].id, 'dlg');
  assert.deepEqual(overlay.recognized.props, { title: 'Delete this item?', modal: true, open: true });
  const subject = overlay.behavior.subjects[0].name;
  assert.deepEqual(overlay.behavior.binds, [{ kind: 'flag', subject, flag: 'hidden', op: 'eq', ref: 0 }]);
  assert.equal(overlay.behavior.subjects[0].initial, 1);
  // the opener sets it to 1, both dialog buttons set it to 0, backdrop tap closes (aria-modal dialog)
  assert.deepEqual(out.children[0].behavior.events, [{ kind: 'set', subject, value: 1 }]);
  const [cancel, del] = overlay.children[0].children.slice(1);
  for (const b of [cancel, del]) assert.deepEqual(b.behavior.events, [{ kind: 'set', subject, value: 0 }]);
  assert.deepEqual(overlay.behavior.events, [{ kind: 'set', subject, value: 0 }]);
});

test('an alertdialog is not dismissed by a backdrop tap', () => {
  const out = run(page([dialog({ role: 'alertdialog' })]));
  assert.equal(out.children[0].behavior.events?.length ?? 0, 0);
});

test('a hidden (initiallyHidden) dialog starts at subject 0 and keeps its measured size', () => {
  const d = dialog({ hidden: true, revealed: true });
  d.children.forEach((c) => { c.hidden = true; c.revealed = true; });
  const out = run(page([d]));
  const overlay = out.children[0];
  assert.equal(overlay.behavior.subjects[0].initial, 0);
  assert.equal(overlay.recognized.props.open, false);
  assert.deepEqual([overlay.children[0].w, overlay.children[0].h], [240, 120]);
});

test('a dialog without aria-modal is non-modal: no backdrop, the dialog itself floats and binds', () => {
  const out = run(page([dialog({ aria: {} })]));
  const d = out.children[0];
  assert.equal(d.id, 'dlg');
  assert.equal(d.overlay, true);
  assert.equal(d.behavior.binds[0].flag, 'hidden');
  assert.equal(d.recognized.props.modal, false);
});

test('a button inside the dialog that opens something else is not a closer', () => {
  const d = dialog();
  d.children.push(button('More', { id: 'more', aria: { controls: 'menu1', haspopup: 'menu' } }));
  const out = run(page([d]));
  const more = out.children[0].children[0].children.find((c) => c.id === 'more');
  assert.equal(more.behavior, undefined);
});

test('a Material UI wrapper becomes the overlay: its backdrop alpha is the dim color, container and backdrop are dropped', () => {
  const backdrop = node('div', { classes: ['MuiBackdrop-root'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' }, styles: { bgColor: [0, 0, 0, 102] } });
  const container = node('div', { classes: ['MuiDialog-container'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' } }, [dialog()]);
  const wrap = node('div', { id: 'w', classes: ['MuiDialog-root', 'MuiModal-root'], x: 0, y: 0, w: 320, h: 240, layout: { position: 'fixed' }, hidden: true, revealed: true }, [backdrop, container]);
  for (const n of [backdrop, container, container.children[0], ...container.children[0].children]) { n.hidden = true; n.revealed = true; }
  const out = run(page([opener('dlg'), wrap]));
  const overlay = out.children[1];
  assert.deepEqual(overlay.styles.bgColor, [0, 0, 0, 102]);
  assert.deepEqual(overlay.children.map((c) => c.id), ['dlg']);
  assert.equal(overlay.behavior.subjects[0].initial, 0);
  // the opener, which names the dialog inside the wrapper, shares the wrapper's subject
  assert.equal(out.children[0].behavior.events[0].subject, overlay.behavior.subjects[0].name);
});

test('convert: the overlay is the last child of the screen, floating at 0,0, even when the dialog sat deep in a flex box', () => {
  const deep = node('div', { x: 10, y: 10, w: 100, h: 100, layout: { display: 'flex' } }, [dialog()]);
  const tree = page([opener('dlg'), deep, button('After', { x: 0, y: 0 })]);
  const { xml, subjects, warnings } = convert(tree, { name: 'home', screenMode: true });
  const lines = xml.split('\n');
  const overlayLine = lines.findIndex((l) => l.includes('floating="true"') && l.includes('style_bg_opa="128"'));
  assert.ok(overlayLine > 0, xml);
  assert.match(lines[overlayLine], /ignore_layout="true"/);
  // nothing but the closing tags (and the overlay's own subtree) follows it at the same depth
  const depth = lines[overlayLine].match(/^ */)[0].length;
  const siblingsAfter = lines.slice(overlayLine + 1).filter((l) => l.match(/^ */)[0].length === depth && l.trim().startsWith('<lv_'));
  assert.equal(siblingsAfter.length, 0, xml);
  assert.match(xml, /<subject_set_int_event subject="home_[a-z0-9_]+_open" value="1" \/>/);
  assert.match(xml, /<bind_flag_if_eq subject="home_[a-z0-9_]+_open" flag="hidden" ref_value="0" \/>/);
  assert.equal(subjects.length, 1);
  assert.deepEqual(warnings.filter((w) => /subject|timeline/.test(w)), []);
});

test('convert: a pinned app bar stays below the overlay in the child order', () => {
  const bar = node('header', { id: 'bar', classes: ['MuiAppBar-root'], x: 0, y: 0, w: 320, h: 40, layout: { position: 'fixed' } });
  const { xml } = convert(page([bar, dialog(), button('x')]), { name: 'p', screenMode: true });
  assert.ok(xml.indexOf('name="appbar"') < xml.indexOf('style_bg_opa="128"'), xml);
});

test('golden: the Modal fixture (plain alertdialog open on load, Material UI dialog closed) converts to the committed XML', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'modal.json'), 'utf8'));
  const { xml, globalsXml, diagnostics } = convert(tree, { name: 'modal', screenMode: true });
  assert.equal(xml, readFileSync(join(here, 'golden-behavior', 'modal.xml'), 'utf8'));
  assert.equal(globalsXml, readFileSync(join(here, 'golden-behavior', 'modal.globals.xml'), 'utf8'));
  assert.deepEqual(diagnostics.list().filter((d) => d.code.startsWith('BEHAVIOR_')), []);
  assert.match(xml, /name="scrim" x="-12" y="-12" ignore_layout="true" floating="true"/);
});

test('extractor: a hidden MuiDialog wrapper is measured open and flagged revealed', async () => {
  const tree = await extractPage(join(here, '..', 'examples', 'components', 'modal.html'));
  const wrapper = tree.children.find((c) => c.classes?.includes('MuiDialog-root'));
  assert.ok(wrapper, 'the hidden wrapper stays in the tree');
  assert.equal(wrapper.hidden, true);
  assert.equal(wrapper.revealed, true);
  assert.deepEqual([wrapper.w, wrapper.h], [320, 240]);
  const paper = JSON.stringify(wrapper).match(/"id": ?"mui-dialog"[\s\S]*?"w": ?(\d+)/);
  assert.ok(paper, 'the dialog inside carries a measured size');
});
