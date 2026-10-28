import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateKeys, createRegistry, recognize } from '../src/recognize.mjs';
import { linkAria } from '../src/link-aria.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';

const styles = {
  bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0, borderBottomColor: null,
  borderBottomWidth: 0, radius: 0, fontSize: 16, fontFamily: 'sans-serif', fontWeight: 400, fontItalic: false,
  textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, gradient: null,
  shadow: null, scrollable: false, pressed: null,
};
const layout = { display: 'block', position: 'static', flexGrow: 0 };

/** A minimal node in the shape extract.mjs produces. */
function node(tag, extra = {}, children = []) {
  return {
    tag, id: null, className: null, component: null, widget: null, lvName: null, link: null,
    x: 0, y: 0, w: 100, h: 20, text: null, attrs: {}, styles: { ...styles }, layout: { ...layout },
    children, ...extra,
  };
}

/** Build a keyed tree, link it, and return both. */
function link(children, options) {
  const tree = node('body', {}, children);
  annotateKeys(tree);
  return { tree, links: linkAria(tree, options) };
}
const keyOf = (n) => n.key;

test('a node without aria links to nothing', () => {
  const { links } = link([node('div', { id: 'a' }), node('p')]);
  assert.equal(links.size, 0);
});

test('a trigger and its target link both ways', () => {
  const btn = node('button', { aria: { controls: 'p1', expanded: 'false' } });
  const panel = node('div', { id: 'p1' });
  const { links } = link([btn, panel]);
  assert.deepEqual(links.get(keyOf(btn)), { controls: [keyOf(panel)], controlledBy: [] });
  assert.deepEqual(links.get(keyOf(panel)), { controls: [], controlledBy: [keyOf(btn)] });
  assert.equal(links.size, 2);
});

test('several ids in one aria-controls, in listed order, with extra whitespace', () => {
  const btn = node('button', { aria: { controls: '  b   a ' } });
  const a = node('div', { id: 'a' });
  const b = node('div', { id: 'b' });
  const { links } = link([btn, a, b]);
  assert.deepEqual(links.get(keyOf(btn)).controls, [keyOf(b), keyOf(a)]);
});

test('a missing id is not linked, does not throw, and others still link', () => {
  const btn = node('button', { aria: { controls: 'ghost real' } });
  const real = node('div', { id: 'real' });
  const { links } = link([btn, real]);
  assert.deepEqual(links.get(keyOf(btn)).controls, [keyOf(real)]);
});

test('a node controlling itself is ignored', () => {
  const self = node('button', { id: 'me', aria: { controls: 'me' } });
  const { links } = link([self]);
  assert.equal(links.size, 0);
});

test('a duplicate id links the first node in document order', () => {
  const btn = node('button', { aria: { controls: 'dup' } });
  const first = node('div', { id: 'dup' });
  const second = node('div', { id: 'dup' });
  const { links } = link([btn, first, second]);
  assert.deepEqual(links.get(keyOf(btn)).controls, [keyOf(first)]);
  assert.equal(links.has(keyOf(second)), false);
});

test('a trigger can control several targets, and a target have several triggers', () => {
  const t1 = node('button', { aria: { controls: 'x y' } });
  const t2 = node('button', { aria: { controls: 'x' } });
  const x = node('div', { id: 'x' });
  const y = node('div', { id: 'y' });
  const { links } = link([t1, t2, x, y]);
  assert.deepEqual(links.get(keyOf(t1)).controls, [keyOf(x), keyOf(y)]);
  assert.deepEqual(links.get(keyOf(x)).controlledBy, [keyOf(t1), keyOf(t2)]);
  assert.deepEqual(links.get(keyOf(y)).controlledBy, [keyOf(t1)]);
});

test('hidden targets and targets nested deep are found', () => {
  const btn = node('button', { aria: { controls: 'body1' } });
  const body = node('div', { id: 'body1', hidden: true });
  const { links } = link([node('section', {}, [btn]), node('div', {}, [node('div', {}, [body])])]);
  assert.deepEqual(links.get(keyOf(btn)).controls, [keyOf(body)]);
  assert.deepEqual(links.get(keyOf(body)).controlledBy, [keyOf(btn)]);
});

test('aria-owns links like aria-controls, without duplicating a shared target', () => {
  const owner = node('div', { aria: { owns: 'c1 c2', controls: 'c1' } });
  const c1 = node('li', { id: 'c1' });
  const c2 = node('li', { id: 'c2' });
  const { links } = link([owner, c1, c2]);
  assert.deepEqual(links.get(keyOf(owner)).controls, [keyOf(c1), keyOf(c2)]);
  assert.deepEqual(links.get(keyOf(c1)).controlledBy, [keyOf(owner)]);
});

test('labelledBy and describedBy list the named nodes on the target', () => {
  const title = node('h2', { id: 'title' });
  const desc = node('p', { id: 'desc' });
  const dialog = node('div', { role: 'dialog', aria: { labelledby: 'title ghost', describedby: 'desc title' } });
  const { links } = link([title, desc, dialog]);
  assert.deepEqual(links.get(keyOf(dialog)), {
    controls: [], controlledBy: [], labelledBy: [keyOf(title)], describedBy: [keyOf(desc), keyOf(title)],
  });
  assert.equal(links.has(keyOf(title)), false);
});

test('a node naming itself in aria-labelledby is ignored', () => {
  const dialog = node('div', { id: 'd', aria: { labelledby: 'd' } });
  const { links } = link([dialog]);
  assert.equal(links.size, 0);
});

test('a missing aria-controls target reports ARIA_TARGET_MISSING with the trigger key', () => {
  const diagnostics = createDiagnostics();
  const btn = node('button', { aria: { controls: 'nope' } });
  const { links } = link([btn], { diagnostics });
  assert.equal(links.size, 0);
  const [entry, ...rest] = diagnostics.list();
  assert.equal(rest.length, 0);
  assert.equal(entry.code, 'ARIA_TARGET_MISSING');
  assert.equal(entry.source.selector, keyOf(btn));
  assert.match(entry.message, /nope/);
  assert.match(entry.fix, /id="nope"/);
  assert.match(entry.fix, /aria-controls/);
});

test('the diagnostics option is optional and a real link reports nothing', () => {
  const diagnostics = createDiagnostics();
  link([node('button', { aria: { controls: 'a' } }), node('div', { id: 'a' })], { diagnostics });
  assert.equal(diagnostics.list().length, 0);
  assert.doesNotThrow(() => link([node('button', { aria: { controls: 'zzz' } })]));
});

test('odd input never throws', () => {
  assert.equal(linkAria(node('body', { aria: null, children: [] })).size, 0);
  assert.equal(linkAria(node('body', { aria: { controls: 5 } })).size, 0);
  assert.equal(linkAria(null).size, 0);
});

test('output order is deterministic across runs', () => {
  const build = () => [
    node('button', { aria: { controls: 'b a' } }),
    node('button', { aria: { controls: 'a' } }),
    node('div', { id: 'a' }),
    node('div', { id: 'b' }),
  ];
  const first = link(build()).links;
  const second = link(build()).links;
  assert.deepEqual([...first], [...second]);
  assert.deepEqual([...first.keys()], [...second.keys()]);
});

test('recognize() hands the real links to match() and reports missing targets', () => {
  const btn = node('button', { aria: { controls: 'panel', labelledby: 'lbl' } });
  const panel = node('div', { id: 'panel' });
  const lbl = node('span', { id: 'lbl' });
  const orphan = node('button', { aria: { controls: 'gone' } });
  const tree = node('body', {}, [btn, panel, lbl, orphan]);
  const diagnostics = createDiagnostics();
  /** @type {Record<string, unknown>} */
  const seen = {};
  recognize(tree, {
    registry: createRegistry([{
      name: 'probe',
      match: (n, ctx) => { seen[n.key] = ctx.links.get(n.key); return false; },
      props: {},
      slots: [],
      build: () => null,
    }]),
    diagnostics,
  });
  assert.deepEqual(seen[btn.key], { controls: [panel.key], controlledBy: [], labelledBy: [lbl.key] });
  assert.deepEqual(seen[panel.key], { controls: [], controlledBy: [btn.key] });
  assert.equal(seen[orphan.key], undefined);
  const missing = diagnostics.list().filter((d) => d.code === 'ARIA_TARGET_MISSING');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].source.selector, orphan.key);
});
