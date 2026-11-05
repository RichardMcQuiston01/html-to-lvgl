/**
 * Tests for the Phase 8 behavior IR (src/behavior.mjs): API helpers, how the
 * IR survives recognize/optimize/convert, the XML it produces, the generated
 * globals.xml, componentize's per-instance subject props, and the extractor's
 * measure-while-open of collapsed targets (the only part that needs a browser).
 *
 * The converter output for the generic fixture is compared with
 * tests/golden-behavior/ (refresh with `npm run golden:update`);
 * spike/subjects/run-generic.sh drives those same files in real LVGL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BEHAVIOR_TAGS, bindFlag, declareSubject, globalsXml, hasBehavior, hiddenWhen, isBehaviorElement,
  setEvent, subjectFor, toggleEvent, withBehavior, xmlComponent,
} from '../src/behavior.mjs';
import { convert } from '../src/convert.mjs';
import { componentize } from '../src/componentize.mjs';
import { optimize } from '../src/optimize.mjs';
import { recognize, createRegistry } from '../src/recognize.mjs';
import { planFonts } from '../src/fonts-build.mjs';
import { extractPage } from '../src/extract.mjs';
import { node } from './helpers/tree.mjs';
import { demoRegistry } from './helpers/disclosure-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'disclosure.json'), 'utf8'));
const convertFixture = (extra = {}) => convert(fixture(), { name: 'disclosure', screenMode: true, registry: demoRegistry(), ...extra });

/* ------------------------------------------------------------------ API */

test('subjectFor derives a unique, identifier-safe local name from the node key', () => {
  assert.equal(subjectFor({ tag: 'div', key: '#panel1' }, 'open'), 'panel1_open');
  assert.equal(subjectFor({ tag: 'div', key: 'body/div[0]/div[2]' }, 'open'), 'body_div_0_div_2_open');
  assert.equal(subjectFor({ tag: 'div', key: 'name:x~2' }, 'open'), 'name_x_2_open');
  assert.equal(subjectFor({ tag: 'div' }, 'open'), 'div_open');
});

test('withBehavior merges lists, skips duplicates and leaves the input alone', () => {
  const base = node('div');
  const a = withBehavior(base, { subjects: [declareSubject('s', 0)], events: [toggleEvent('s')] });
  const b = withBehavior(a, { subjects: [declareSubject('s', 0)], binds: [hiddenWhen('s', 'eq', 0)], events: [setEvent('s', 1)] });
  assert.equal(base.behavior, undefined);
  assert.equal(b.behavior.subjects.length, 1);
  assert.deepEqual(b.behavior.events.map((e) => e.kind), ['toggle', 'set']);
  assert.equal(b.behavior.binds.length, 1);
  assert.ok(hasBehavior(b));
  assert.ok(!hasBehavior(base));
});

test('the helpers reject values LVGL cannot take', () => {
  assert.throws(() => setEvent('s', 1.5), /integer/);
  assert.throws(() => bindFlag('s', 'hidden', 'between', 0), /op must be one of/);
  assert.throws(() => bindFlag('s', 'hidden', 'eq', 'x'), /ref must be an integer/);
  assert.throws(() => declareSubject('', 0), /name/);
  assert.throws(() => declareSubject('s', 'a'), /integer/);
});

test('globalsXml lists every subject, and is null when there are none', () => {
  assert.equal(globalsXml([]), null);
  assert.equal(
    globalsXml([declareSubject('home_a_open', 0), declareSubject('home_b_open', 1)]),
    '<globals>\n  <subjects>\n    <int name="home_a_open" value="0"/>\n    <int name="home_b_open" value="1"/>\n  </subjects>\n</globals>\n',
  );
});

/* --------------------------------------------------- recognize / optimize */

test('a hidden disclosure target without behavior is dropped, as before', () => {
  const tree = node('body', {}, [node('div', { id: 'p', hidden: true, revealed: true, h: 60 })]);
  const { tree: out } = recognize(tree, { registry: createRegistry() });
  assert.equal(out.children.length, 0);
});

test('a revealed target a component claimed is kept with its measured size and flagged initiallyHidden', () => {
  const tree = node('body', { w: 320, h: 240 }, [
    node('button', { id: 'h', aria: { expanded: 'false', controls: 'p' } }),
    node('div', { id: 'p', w: 320, h: 60, hidden: true, revealed: true }, [node('p', { text: 'body', hidden: true, revealed: true })]),
  ]);
  const { tree: out } = recognize(tree, { registry: demoRegistry() });
  const panel = out.children[1];
  assert.equal(panel.id, 'p');
  assert.equal(panel.initiallyHidden, true);
  assert.equal(panel.hidden, false);
  assert.equal(panel.h, 60);
  assert.equal(panel.children[0].hidden, false); // contents are ordinary nodes
  assert.equal(panel.children[0].initiallyHidden, undefined); // only the root is flagged
  assert.deepEqual(panel.behavior.subjects, [{ name: 'p_open', type: 'int', initial: 0 }]);
});

test('definitions see the contents of a revealed target as visible, so they can be recognized', () => {
  const seen = [];
  const spy = { name: 'spy', match: (n) => { if (n.id === 'inner') seen.push(n.hidden); return false; }, props: {}, slots: [], build: () => null };
  const tree = node('body', {}, [
    node('div', { id: 'p', hidden: true, revealed: true }, [node('div', { id: 'inner', hidden: true, revealed: true })]),
  ]);
  recognize(tree, { registry: createRegistry([spy]) });
  assert.deepEqual(seen, [false]);
  assert.equal(tree.children.length, 0); // the unclaimed root is dropped after matching
});

test('a plain hidden node (not revealed) that gets behavior is kept and unhidden too', () => {
  const claim = { name: 'claim', match: (n) => n.id === 'p', props: {}, slots: [], build: (n) => withBehavior(n, { subjects: [declareSubject('p_open', 0)], binds: [hiddenWhen('p_open', 'eq', 0)] }) };
  const tree = node('body', {}, [node('div', { id: 'p', hidden: true }, [node('p', { hidden: true, text: 'x' })])]);
  const { tree: out } = recognize(tree, { registry: createRegistry([claim]) });
  assert.equal(out.children[0].initiallyHidden, true);
  assert.equal(out.children[0].hidden, false);
  assert.equal(out.children[0].children[0].hidden, false);
});

test('the optimizer keeps an otherwise inert wrapper that carries behavior', () => {
  const wrapped = node('body', {}, [
    withBehavior(node('div', {}, [node('p', { text: 'x' })]), { events: [toggleEvent('s')] }),
  ]);
  assert.equal(optimize(structuredClone(wrapped)).removed, 0);
  const plain = node('body', {}, [node('div', {}, [node('p', { text: 'x' })])]);
  assert.equal(optimize(plain).removed, 1);
});

/* --------------------------------------------------------------- convert */

test('golden: generic disclosure fixture converts to the committed XML and globals.xml', () => {
  const { xml, globalsXml: globals } = convertFixture();
  assert.equal(xml, readFileSync(join(here, 'golden-behavior', 'disclosure.xml'), 'utf8'));
  assert.equal(globals, readFileSync(join(here, 'golden-behavior', 'disclosure.globals.xml'), 'utf8'));
});

test('convert emits toggle, set and hidden-bind elements with page-qualified subject names', () => {
  const { xml, subjects, warnings } = convertFixture();
  assert.deepEqual(subjects, [
    { name: 'disclosure_p1_open', type: 'int', initial: 0 },
    { name: 'disclosure_p2_open', type: 'int', initial: 1 },
    { name: 'disclosure_dlg_open', type: 'int', initial: 0 },
  ]);
  assert.match(xml, /<subject_toggle_event subject="disclosure_p1_open" \/>/);
  assert.match(xml, /<subject_set_int_event subject="disclosure_dlg_open" value="1" \/>/);
  assert.match(xml, /<subject_set_int_event subject="disclosure_dlg_open" value="0" \/>/);
  assert.match(xml, /<bind_flag_if_eq subject="disclosure_p1_open" flag="hidden" ref_value="0" \/>/);
  assert.deepEqual(warnings, []);
});

test('the same fixture on two pages gets different subject names', () => {
  const a = convertFixture({ name: 'home' }).subjects.map((s) => s.name);
  const b = convertFixture({ name: 'settings' }).subjects.map((s) => s.name);
  assert.ok(a.every((n) => n.startsWith('home_')));
  assert.ok(b.every((n) => n.startsWith('settings_')));
});

test('the view keeps the final-named behavior on meta.behavior and tags emitters can recognize', () => {
  const { view } = convertFixture();
  const header = view.children.find((c) => c.attrs.name === 'h1');
  assert.deepEqual(header.meta.behavior.events, [{ kind: 'toggle', subject: 'disclosure_p1_open' }]);
  assert.ok(header.children.some(isBehaviorElement));
  assert.ok(BEHAVIOR_TAGS.has('bind_flag_if_not_eq'));
  assert.ok(!isBehaviorElement({ tag: 'lv_label' }));
});

test('a page with no behavior has no subjects and no globals.xml text', () => {
  const r = convert(fixture(), { name: 'plain', registry: createRegistry() });
  assert.deepEqual(r.subjects, []);
  assert.equal(r.globalsXml, null);
  assert.ok(!r.xml.includes('subject'));
});

test('a subject used but never declared, or declared twice with different values, is reported', () => {
  const useOnly = { name: 'u', match: (n) => n.id === 'a', props: {}, slots: [], build: (n) => withBehavior(n, { events: [toggleEvent('ghost')] }) };
  const clash = { name: 'c', match: (n) => n.id === 'b' || n.id === 'c', props: {}, slots: [], build: (n) => withBehavior(n, { subjects: [declareSubject('same', n.id === 'b' ? 0 : 1)] }) };
  const tree = node('body', {}, [node('div', { id: 'a' }), node('div', { id: 'b' }), node('div', { id: 'c' })]);
  const r = convert(tree, { name: 'p', registry: createRegistry([useOnly, clash]) });
  const codes = r.diagnostics.list().map((d) => d.code);
  assert.ok(codes.includes('BEHAVIOR_SUBJECT_UNDECLARED'));
  assert.ok(codes.includes('BEHAVIOR_SUBJECT_CONFLICT'));
  assert.equal(r.subjects.length, 1);
  assert.equal(r.subjects[0].initial, 0); // the first declaration wins
});

test('xmlComponent emits a library component instance with a qualified per-instance subject prop', () => {
  const lib = {
    name: 'lib',
    match: (n) => n.id === 'acc',
    props: {}, slots: [],
    build: (n) => withBehavior({ ...n, ...xmlComponent('ui_accordion', { title: 'Hello', subj: { subject: 'acc_open' } }) }, { subjects: [declareSubject('acc_open', 1)] }),
  };
  const tree = node('body', { w: 320, h: 240 }, [node('div', { id: 'acc', w: 320, h: 80 }, [node('p', { text: 'ignored child' })])]);
  const r = convert(tree, { name: 'home', registry: createRegistry([lib]) });
  assert.match(r.xml, /<ui_accordion name="acc"[^>]* title="Hello" subj="home_acc_open" \/>/);
  assert.ok(!r.xml.includes('ignored child'));
  assert.deepEqual(r.subjects, [{ name: 'home_acc_open', type: 'int', initial: 1 }]);
});

/* ------------------------------------------------------------ componentize */

test('componentize turns the differing subject into ONE per-instance string prop used by toggle and bind', () => {
  const instance = (n, title) => node('div', {
    component: 'Section', w: 320, h: 100, layout: { display: 'flex', flexDirection: 'column', position: 'static' },
  }, [
    node('button', { id: `h${n}`, text: title, w: 320, h: 32, aria: { expanded: 'false', controls: `p${n}` } }),
    node('div', { id: `p${n}`, w: 320, h: 60, hidden: true, revealed: true }),
  ]);
  const tree = node('body', { w: 320, h: 240, layout: { display: 'flex', flexDirection: 'column', position: 'static' } }, [instance(1, 'One'), instance(2, 'Two')]);
  const { view } = convert(tree, { name: 'home', registry: demoRegistry() });
  const { components, view: pageView, warnings } = componentize(view);
  assert.deepEqual(warnings, []);
  const xml = components.get('section');
  assert.ok(xml, 'a section component is generated');
  assert.match(xml, /<prop type="string" name="subject" default="home_p1_open"\/>/);
  assert.equal([...xml.matchAll(/<prop /g)].length, 2); // text + subject, not one per tag
  assert.match(xml, /<subject_toggle_event subject="\$subject" \/>/);
  assert.match(xml, /<bind_flag_if_eq subject="\$subject" flag="hidden" ref_value="0" \/>/);
  const instances = pageView.children.filter((c) => c.tag === 'section');
  assert.deepEqual(instances.map((i) => i.attrs.subject), ['home_p1_open', 'home_p2_open']);
});

/* ------------------------------------------------------------------ fonts */

test('the font plan includes the text of a revealed (collapsed) target but not of plain hidden nodes', () => {
  const tree = node('body', {}, [
    node('p', { text: 'visible' }),
    node('div', { hidden: true, revealed: true }, [node('p', { text: 'collapsed', hidden: true, revealed: true })]),
    node('p', { text: 'zzz-never', hidden: true }),
  ]);
  const chars = new Set(planFonts(tree).flatMap((e) => [...e.chars]));
  assert.ok(chars.has('c') && chars.has('v'));
  assert.ok(!chars.has('z'));
});

/* -------------------------------------------------------------- extractor */

async function extractHtml(html) {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-behavior-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, html);
  return extractPage(file);
}
const find = (n, pred) => (pred(n) ? n : n.children.map((c) => find(c, pred)).find(Boolean) ?? null);

test('the extractor measures collapsed aria-controls targets open, flags them, and leaves the page untouched', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <button id="b1" aria-expanded="false" aria-controls="p1" style="display:block;width:320px;height:32px">One</button>
    <div id="p1" style="display:none;height:60px;width:300px"><span>inside one</span></div>
    <button id="b2" aria-expanded="false" aria-controls="p2" style="display:block;width:320px;height:32px">Two</button>
    <div id="p2" hidden style="height:40px"><span>inside two</span></div>
    <button id="b3" aria-expanded="false" aria-controls="p3" style="display:block;width:320px;height:32px">Three</button>
    <div id="p3" style="max-height:0;overflow:hidden;visibility:hidden"><div style="height:50px">inside three</div></div>
    <div id="plain" style="display:none"><span>never</span></div>
    <p id="after">after</p>
  </body></html>`);
  const p1 = find(tree, (n) => n.id === 'p1');
  assert.equal(p1.hidden, true);
  assert.equal(p1.revealed, true);
  assert.equal(p1.h, 60);
  assert.equal(p1.w, 300);
  assert.equal(find(p1, (n) => n.text === 'inside one').revealed, true);
  const p2 = find(tree, (n) => n.id === 'p2');
  assert.equal(p2.revealed, true);
  assert.equal(p2.h, 40);
  const p3 = find(tree, (n) => n.id === 'p3');
  assert.equal(p3.revealed, true);
  assert.ok(p3.h >= 50, `collapsed max-height region measured at ${p3.h}`);
  const plain = find(tree, (n) => n.id === 'plain');
  assert.equal(plain.hidden, true);
  assert.equal(plain.revealed, undefined); // nobody controls it: no size, as before
  // Geometry of later content is that of the page as it really is: all three collapsed.
  assert.equal(find(tree, (n) => n.id === 'after').y, 96 + 16); // three 32px buttons + the paragraph's 16px margin
});
