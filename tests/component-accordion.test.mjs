/**
 * Accordion: matching, what build() attaches (events, binds, subjects), the
 * layout it changes so siblings reflow, and convert() output. Nodes are hand
 * built in the extractor's shape (aria keys without "aria-").
 *
 * The click-driven check in real LVGL is spike/subjects/run-accordion.sh,
 * which drives tests/golden-behavior/accordion.xml (compared here too).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import accordion from '../src/components/accordion.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { validateComponent, createRegistry, recognize, annotateKeys } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { linkAria } from '../src/link-aria.mjs';
import { convert } from '../src/convert.mjs';
import { node as baseNode } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** A node in the extractor's shape; `at` sets the box. */
const node = (tag, extra = {}, children = []) => baseNode(tag, extra, children);

/** A header button controlling `panel`. */
const trigger = (id, panel, expanded, extra = {}) => node('button', {
  id, text: 'Header', aria: { expanded: String(expanded), controls: panel }, x: 0, y: 0, w: 300, h: 30, ...extra,
});
/** A region with id `id`; `hidden` marks a collapsed one the extractor measured open. */
const region = (id, { hidden = false, ...extra } = {}) => node('div', {
  id, role: 'region', x: 0, y: 30, w: 300, h: 40,
  ...(hidden ? { hidden: true, revealed: true } : {}), ...extra,
}, [node('p', { text: 'Body text', x: 10, y: 40, w: 100, h: 16, ...(hidden ? { hidden: true, revealed: true } : {}) })]);

/** A plain item: wrapper holding the header and the body. */
const item = (n, expanded, extra = {}) => node('div', { classes: ['acc-item'], x: 0, y: 0, w: 300, h: expanded ? 70 : 30 }, [
  trigger(`h${n}`, `p${n}`, expanded, extra),
  region(`p${n}`, { hidden: !expanded }),
]);

const page = (children) => node('body', { x: 0, y: 0, w: 320, h: 240 }, children);

/** Run recognition with only the accordion definition. Returns the tree and diagnostics. */
function run(tree) {
  const diagnostics = createDiagnostics();
  const out = recognize(tree, { registry: createRegistry([accordion]), diagnostics });
  return { ...out, diagnostics };
}

/** match() in context: keys, ids and links as recognize() provides them. */
function scoreAt(tree, pick) {
  annotateKeys(tree);
  const byId = new Map();
  (function collect(n) { if (n.id && !byId.has(n.id)) byId.set(n.id, n); n.children.forEach(collect); })(tree);
  const links = linkAria(tree);
  const target = pick(tree);
  return Number(accordion.match(target, { tree, parent: null, byId, links, diagnostics: createDiagnostics() }));
}

const find = (n, pred) => (pred(n) ? n : n.children.map((c) => find(c, pred)).find(Boolean));
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };
const toggles = (n) => (n.behavior?.events ?? []).filter((e) => e.kind === 'toggle');

test('the accordion definition is valid, honest and registered by default', () => {
  assert.deepEqual(validateComponent(accordion), { ok: true, errors: [] });
  assert.equal(accordion.name, 'accordion');
  assert.deepEqual(accordion.slots, ['header', 'body']);
  assert.deepEqual(accordion.props, { expanded: { type: 'bool', default: false } });
  assert.ok(builtinComponents.includes(accordion));
});

test('signals: an aria-expanded trigger and its region 1, MuiAccordion-root 0.7, accordion classes 0.5, a group 0.4', () => {
  assert.equal(scoreAt(page([item(1, false)]), (t) => t.children[0]), 1);
  assert.equal(scoreAt(node('div', { classes: ['MuiPaper-root', 'MuiAccordion-root'] }), (t) => t), 0.7);
  assert.equal(scoreAt(node('div', { classes: ['accordion'] }), (t) => t), 0.5);
  assert.equal(scoreAt(node('div', { classes: ['accordion-item', 'mb-2'] }), (t) => t), 0.5);
  assert.equal(scoreAt(node('div', { className: 'accordion' }), (t) => t), 0.5, 'older extractor: first class only');
  // The ARIA link outranks the class on the same node.
  assert.equal(scoreAt(page([node('div', { classes: ['MuiAccordion-root'] }, [trigger('h', 'p', false), region('p')])]), (t) => t.children[0]), 1);
  // A parent whose children are items is the group.
  assert.equal(scoreAt(page([item(1, false), item(2, true)]), (t) => t), 0.4);
});

test('the item is the lowest ancestor of trigger and body, not every ancestor', () => {
  const tree = page([node('div', {}, [item(1, true)])]);
  assert.equal(scoreAt(tree, (t) => t.children[0].children[0]), 1, 'the wrapper that holds both');
  assert.equal(scoreAt(tree, (t) => t.children[0]), 0.4, 'its parent only has an item child (group)');
  assert.equal(scoreAt(tree, (t) => t), 0, 'the page above that does not match');
  assert.equal(scoreAt(tree, (t) => t.children[0].children[0].children[0]), 0, 'the trigger itself does not match');
  assert.equal(scoreAt(tree, (t) => t.children[0].children[0].children[1]), 0, 'the region does not match');
});

test('near misses do not match', () => {
  const near = (t, pick = (x) => x.children[0]) => scoreAt(page(t), pick);
  // no aria-controls, or it names nothing
  assert.equal(near([node('div', {}, [node('button', { aria: { expanded: 'false' } }), region('p')])]), 0);
  assert.equal(near([node('div', {}, [trigger('h', 'missing', false), region('p')])]), 0);
  // aria-controls without aria-expanded
  assert.equal(near([node('div', {}, [node('button', { aria: { controls: 'p' } }), region('p')])]), 0);
  // a popup trigger is a menu or dialog opener (lane E), not an accordion
  assert.equal(near([node('div', {}, [trigger('h', 'p', false, { aria: { expanded: 'false', controls: 'p', haspopup: 'dialog' } }), region('p')])]), 0);
  assert.equal(near([node('div', {}, [trigger('h', 'p', false, { aria: { expanded: 'false', controls: 'p', haspopup: 'menu' } }), region('p')])]), 0);
  // a dialog, menu or modal body is not an inline panel
  for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
    assert.equal(near([node('div', {}, [trigger('h', 'p', false), region('p', { role })])]), 0, role);
  }
  assert.equal(near([node('div', {}, [trigger('h', 'p', false), region('p', { aria: { modal: 'true' } })])]), 0);
  // a combobox or tab is not a disclosure header
  assert.equal(near([node('div', {}, [trigger('h', 'p', false, { role: 'combobox' }), region('p')])]), 0);
  // class names that merely contain "accordion"
  assert.equal(near([node('div', { classes: ['accordion-button'] })]), 0);
  assert.equal(near([node('div', { classes: ['MuiAccordionSummary-root'] })]), 0);
  assert.equal(near([node('div', { classes: ['MuiAccordionDetails-root'] })]), 0);
  assert.equal(near([node('div', { classes: ['accordionish'] })]), 0);
  assert.equal(near([node('div')]), 0);
  // a trigger and body that are not inside the node
  assert.equal(scoreAt(page([node('div', {}, [trigger('h', 'p', false)]), node('div', {}, [region('p')])]), (t) => t.children[0]), 0);
  // a hidden trigger is not a header
  assert.equal(near([node('div', {}, [trigger('h', 'p', false, { hidden: true }), region('p')])]), 0);
});

test('data-lv-widget="accordion" forces the match through the registry', () => {
  const tree = page([node('div', { widget: 'accordion' })]);
  const { tree: out, recognized } = run(tree);
  assert.equal(recognized, 1);
  assert.equal(out.children[0].recognized.component, 'accordion');
});

test('build(): the trigger toggles one subject and the body hides while it is 0', () => {
  const { tree } = run(page([item(1, false)]));
  const wrapper = tree.children[0];
  const header = find(wrapper, (n) => n.id === 'h1');
  const body = find(wrapper, (n) => n.id === 'p1');
  const [event] = toggles(header);
  assert.equal(event.subject, 'p1_open');
  assert.deepEqual(body.behavior.subjects, [{ name: 'p1_open', type: 'int', initial: 0 }]);
  assert.deepEqual(body.behavior.binds, [{ kind: 'flag', subject: 'p1_open', flag: 'hidden', op: 'eq', ref: 0 }]);
  assert.equal(body.initiallyHidden, true, 'a collapsed body survives recognition because it has behavior');
  assert.equal(wrapper.lvName, 'accordion');
  assert.deepEqual(wrapper.recognized, { component: 'accordion', props: { expanded: false } });
});

test('build(): the initial state follows aria-expanded on the trigger', () => {
  const { tree } = run(page([item(1, false), item(2, true)]));
  assert.equal(find(tree, (n) => n.id === 'p1').behavior.subjects[0].initial, 0);
  assert.equal(find(tree, (n) => n.id === 'p2').behavior.subjects[0].initial, 1);
  assert.equal(find(tree, (n) => n.id === 'p2').initiallyHidden, undefined, 'an expanded body was visible');
  assert.deepEqual(tree.children[1].recognized.props, { expanded: true });
  // aria-expanded is the truth even when the page showed something else
  const lying = page([node('div', {}, [trigger('h', 'p', true), region('p', { hidden: true })])]);
  assert.equal(find(run(lying).tree, (n) => n.id === 'p').behavior.subjects[0].initial, 1);
});

test('several accordions and several items in one group are independent subjects', () => {
  const { tree } = run(page([
    node('div', { classes: ['accordion'] }, [item(1, false), item(2, true), item(3, false)]),
    node('div', { classes: ['accordion'] }, [item(4, false)]),
  ]));
  const subjects = all(tree, (n) => n.behavior?.subjects?.length).map((n) => n.behavior.subjects[0].name);
  assert.deepEqual(subjects, ['p1_open', 'p2_open', 'p3_open', 'p4_open']);
  const events = all(tree, (n) => toggles(n).length).map((n) => toggles(n)[0].subject);
  assert.deepEqual([...new Set(events)], ['p1_open', 'p2_open', 'p3_open', 'p4_open']);
  // a toggle never sets another item's subject (not exclusive)
  for (const n of all(tree, (x) => x.behavior?.events?.length)) {
    assert.ok(n.behavior.events.every((e) => e.kind === 'toggle'));
  }
});

test('build(): items without a wrapper are owned by their parent, each with its own subject', () => {
  const tree = page([node('div', { classes: ['accordion'] }, [
    node('h3', {}, [trigger('h1', 'p1', false)]), region('p1', { hidden: true }),
    node('h3', {}, [trigger('h2', 'p2', true)]), region('p2'),
  ])]);
  const { tree: out } = run(tree);
  const group = out.children[0];
  assert.equal(group.recognized.component, 'accordion');
  assert.deepEqual(all(out, (n) => n.behavior?.subjects?.length).map((n) => [n.behavior.subjects[0].name, n.behavior.subjects[0].initial]), [['p1_open', 0], ['p2_open', 1]]);
});

test('build(): a Material UI collapse wrapper chain is hidden as a whole', () => {
  const collapsed = (hidden) => node('div', { classes: ['MuiAccordion-root'], x: 0, y: 0, w: 300, h: 34 }, [
    node('div', { role: 'button', id: 'mh', aria: { expanded: String(!hidden), controls: 'mc' }, x: 0, y: 0, w: 300, h: 34, classes: ['MuiAccordionSummary-root'] }),
    node('div', { classes: ['MuiCollapse-root'], x: 0, y: 34, w: 300, h: 30, ...(hidden ? { hidden: true, revealed: true } : {}) }, [
      node('div', { classes: ['MuiCollapse-wrapper'], x: 0, y: 34, w: 300, h: 30, ...(hidden ? { hidden: true, revealed: true } : {}) }, [
        node('div', { id: 'mc', role: 'region', x: 0, y: 34, w: 300, h: 30, ...(hidden ? { hidden: true, revealed: true } : {}) }, [
          node('div', { text: 'Details', x: 10, y: 36, w: 80, h: 16, ...(hidden ? { hidden: true, revealed: true } : {}) }),
        ]),
      ]),
    ]),
  ]);
  for (const hidden of [true, false]) {
    const { tree } = run(page([collapsed(hidden)]));
    const bound = all(tree, (n) => n.behavior?.binds?.length);
    assert.equal(bound.length, 1);
    assert.ok(bound[0].classes.includes('MuiCollapse-root'), `hidden=${hidden}: the bind is on the outermost wrapper, not the inner region`);
    assert.equal(bound[0].behavior.subjects[0].initial, hidden ? 0 : 1);
    assert.equal(find(tree, (n) => n.id === 'mc').behavior, undefined, 'the inner region carries no behavior of its own');
  }
});

test('build(): the whole header takes the press, not only the button box', () => {
  const summary = node('div', {
    role: 'button', id: 'mh', aria: { expanded: 'false', controls: 'mc' }, x: 0, y: 0, w: 300, h: 34,
  }, [
    node('div', { x: 10, y: 8, w: 90, h: 16 }, [node('p', { text: 'Title', x: 10, y: 8, w: 90, h: 16 })]),
    node('div', { x: 270, y: 8, w: 18, h: 18 }, [node('svg', { x: 270, y: 8, w: 18, h: 18 })]),
    node('img', { x: 250, y: 8, w: 8, h: 8 }),
  ]);
  const { tree } = run(page([node('div', { classes: ['MuiAccordion-root'] }, [summary, region('mc', { hidden: true, id: 'mc' })])]));
  const header = find(tree, (n) => n.id === 'mh');
  assert.equal(toggles(header).length, 1);
  const [content, icon, image] = header.children;
  assert.equal(toggles(content).length, 1, 'a box inside the header would swallow the press');
  assert.equal(toggles(content.children[0]).length, 0, 'a bare label is not clickable, so it needs nothing');
  assert.equal(toggles(icon).length, 1);
  assert.equal(toggles(icon.children[0]).length, 1, 'an svg becomes a placeholder box');
  assert.equal(toggles(image).length, 0, 'an image is not clickable');
  assert.ok(new Set([header, content, icon].map((n) => toggles(n)[0].subject)).size === 1, 'all of them toggle the same subject');
});

test('build(): a text-only trigger gets a box so it can be pressed', () => {
  const bare = trigger('h', 'p', false, { styles: {} });
  const { tree } = run(page([node('div', {}, [bare, region('p')])]));
  const header = find(tree, (n) => n.id === 'h');
  assert.equal(header.text, null);
  assert.equal(header.children.length, 1);
  assert.equal(header.children[0].text, 'Header', 'the label survives');
  assert.equal(toggles(header).length, 1);
  assert.equal(toggles(header.children[0]).length, 0);
  // a decorated trigger already becomes a box (convert makes a button or a padded box)
  const decorated = trigger('h', 'p', false, { styles: { bgColor: [1, 2, 3, 255] } });
  const out = find(run(page([node('div', {}, [decorated, region('p')])])).tree, (n) => n.id === 'h');
  assert.equal(out.text, 'Header');
  assert.equal(out.children.length, 0);
});

test('build(): a block item becomes a flex column of content height with the measured gaps', () => {
  const wrapper = node('div', { classes: ['acc-item'], x: 10, y: 20, w: 300, h: 70, styles: { borderWidth: 1 } }, [
    node('h3', { x: 11, y: 21, w: 298, h: 26 }, [trigger('h', 'p', true, { x: 11, y: 21, w: 298, h: 26 })]),
    region('p', { y: 51, x: 11, w: 298, h: 38 }),
  ]);
  const { tree } = run(page([wrapper]));
  const out = tree.children[0];
  assert.equal(out.layout.display, 'flex');
  assert.equal(out.layout.flexDirection, 'column');
  assert.equal(out.layout.heightContent, true);
  assert.equal(out.layout.rowGap, 0);
  assert.deepEqual(out.children.map((c) => [c.layout.marginTop, c.layout.marginLeft]), [[0, 0], [4, 0]], 'gaps are the browser gaps (a 4px gap after the heading)');
  assert.equal(tree.layout.heightContent, undefined, 'the page itself keeps its fixed size');
});

test('build(): a collapsed item records its open extent so nothing overhangs the box', () => {
  const { tree } = run(page([item(1, false)]));
  const out = tree.children[0];
  assert.equal(out.h, 70, 'header 30 + body 40, not the collapsed 30');
});

test('build(): children that are not a top-to-bottom stack are left alone', () => {
  const sideBySide = node('div', { classes: ['acc-item'], x: 0, y: 0, w: 300, h: 40 }, [
    trigger('h', 'p', false, { x: 0, y: 0, w: 100, h: 40 }),
    region('p', { x: 100, y: 0, w: 200, h: 40 }),
  ]);
  const { tree } = run(page([sideBySide]));
  const out = tree.children[0];
  assert.equal(out.layout.display, 'block', 'layout is unchanged');
  assert.equal(find(out, (n) => n.id === 'p').behavior.binds.length, 1, 'behavior is still attached');
  // an existing flex container keeps its own layout and only gains content height
  const flexItem = node('div', { classes: ['acc-item'], x: 0, y: 0, w: 300, h: 70, layout: { display: 'flex', flexDirection: 'column', rowGap: 6 } }, [trigger('h', 'p', true), region('p')]);
  const flexOut = run(page([flexItem])).tree.children[0];
  assert.equal(flexOut.layout.rowGap, 6);
  assert.equal(flexOut.layout.heightContent, true);
});

test('build(): a group of items is a content-height column too, unless it is the page', () => {
  const group = node('div', { classes: ['accordion'], x: 0, y: 0, w: 300, h: 110 }, [
    node('div', { classes: ['acc-item'], x: 0, y: 0, w: 300, h: 30 }, [trigger('h1', 'p1', false), region('p1', { hidden: true })]),
    node('div', { classes: ['acc-item'], x: 0, y: 34, w: 300, h: 70 }, [trigger('h2', 'p2', true, { y: 34 }), region('p2', { y: 64 })]),
  ]);
  const { tree } = run(page([group]));
  const out = tree.children[0];
  assert.equal(out.layout.display, 'flex');
  assert.equal(out.layout.heightContent, true);
  assert.equal(out.children[1].layout.marginTop, 4);

  const asPage = node('div', { classes: ['accordion'], x: 0, y: 0, w: 300, h: 110 }, group.children);
  const { tree: root } = run(asPage);
  assert.equal(root.layout.display, 'flex');
  assert.equal(root.layout.heightContent, undefined, 'the root view keeps its fixed size');
});

test('a collapsed body without behavior would be dropped; the accordion keeps it', () => {
  const { tree } = run(page([item(1, false)]));
  assert.ok(find(tree, (n) => n.id === 'p1'), 'the collapsed body is still in the tree');
  const unclaimed = recognize(page([item(1, false)]), { registry: createRegistry([]) }).tree;
  assert.equal(find(unclaimed, (n) => n.id === 'p1'), undefined, 'without the accordion definition it is dropped');
});

test('nothing in the item is lost: header text and body text survive', () => {
  const { tree } = run(page([item(1, false)]));
  const texts = all(tree, (n) => n.text).map((n) => n.text);
  assert.deepEqual(texts, ['Header', 'Body text']);
});

test('an accordion with no linkable body is kept as an accordion without behavior', () => {
  const { tree } = run(page([node('div', { classes: ['MuiAccordion-root'] }, [node('div', { text: 'Only a summary' })])]));
  const out = tree.children[0];
  assert.equal(out.recognized.component, 'accordion');
  assert.equal(out.behavior, undefined);
});

test('convert(): emits toggle events, hidden binds, content height and globals', () => {
  const tree = page([item(1, false), item(2, true)]);
  const { xml, subjects, globalsXml, warnings } = convert(tree, { name: 'faq', screenMode: true });
  assert.deepEqual(subjects, [
    { name: 'faq_p1_open', type: 'int', initial: 0 },
    { name: 'faq_p2_open', type: 'int', initial: 1 },
  ]);
  assert.match(globalsXml, /<int name="faq_p1_open" value="0"\/>/);
  assert.match(globalsXml, /<int name="faq_p2_open" value="1"\/>/);
  assert.match(xml, /<subject_toggle_event subject="faq_p1_open" \/>/);
  assert.match(xml, /<bind_flag_if_eq subject="faq_p1_open" flag="hidden" ref_value="0" \/>/);
  assert.match(xml, /<bind_flag_if_eq subject="faq_p2_open" flag="hidden" ref_value="0" \/>/);
  assert.equal(xml.match(/height="content"/g).length, 2, 'the two items (the page root, their group, keeps its height)');
  assert.ok(xml.includes('name="p1"'), 'the collapsed body is emitted');
  assert.deepEqual(warnings.filter((w) => /BEHAVIOR/.test(w.code ?? '')), []);
});

test('convert(): the collapsed body is emitted at its open size so it can appear', () => {
  const { xml } = convert(page([item(1, false)]), { name: 'faq', screenMode: true });
  assert.match(xml, /<lv_obj name="p1"[^>]*width="300" height="40"/);
});

test('golden: the accordion fixture converts to the committed XML and globals.xml', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'accordion.json'), 'utf8'));
  const { xml, globalsXml } = convert(tree, { name: 'accordion', screenMode: true });
  assert.equal(xml, readFileSync(join(here, 'golden-behavior', 'accordion.xml'), 'utf8'));
  assert.equal(globalsXml, readFileSync(join(here, 'golden-behavior', 'accordion.globals.xml'), 'utf8'));
});

test('the accordion fixture holds a collapsed and an expanded item in both styles', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures-behavior', 'accordion.json'), 'utf8'));
  const { subjects } = convert(tree, { name: 'accordion', screenMode: true });
  assert.deepEqual(subjects.map((s) => s.initial), [0, 1, 0, 1]);
  assert.deepEqual(subjects.map((s) => s.name), [
    'accordion_plain_p1_open', 'accordion_plain_p2_open', 'accordion_mui1_content_open', 'accordion_mui2_content_open',
  ]);
});
