import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateKeys,
  createRegistry,
  defaultRegistry,
  describeRegistry,
  recognize,
  validateComponent,
} from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { optimize } from '../src/optimize.mjs';

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

/** A definition that matches a node by role and tags it. */
function roleDef(name, role, extra = {}) {
  return {
    name,
    match: (n) => n.role === role,
    props: {},
    slots: [],
    build: () => null,
    ...extra,
  };
}

test('an empty registry leaves the tree alone and only adds keys', () => {
  const tree = node('body', {}, [node('div'), node('p', { text: 'hi' })]);
  const before = structuredClone(tree);
  const { tree: out, recognized } = recognize(tree, { registry: createRegistry() });
  assert.equal(recognized, 0);
  const strip = (n) => ({ ...n, key: undefined, children: n.children.map(strip) });
  assert.deepEqual(strip(out), strip(before));
});

test('keys prefer data-lv-name, then id, then a path, and are unique', () => {
  const tree = node('body', {}, [
    node('div', { lvName: 'menu' }),
    node('div', { id: 'main' }),
    node('div'),
    node('div', { lvName: 'menu' }),
  ]);
  annotateKeys(tree);
  const keys = tree.children.map((c) => c.key);
  assert.deepEqual(keys, ['name:menu', '#main', 'body/div[2]', 'name:menu~2']);
  assert.equal(tree.key, 'body');
  assert.equal(new Set(keys).size, keys.length);
});

test('a matching definition marks the node and keeps it when build returns null', () => {
  const tree = node('body', {}, [node('div', { role: 'dialog' })]);
  const registry = createRegistry([roleDef('modal', 'dialog')]);
  const { tree: out, recognized } = recognize(tree, { registry });
  assert.equal(recognized, 1);
  assert.equal(out.children[0].recognized.component, 'modal');
});

test('build can replace the node', () => {
  const tree = node('body', {}, [node('div', { role: 'banner', text: 'x' })]);
  const registry = createRegistry([
    roleDef('appbar', 'banner', {
      build: (n) => ({ ...n, tag: 'header', recognized: { component: 'ignored', props: { title: 'x' } } }),
    }),
  ]);
  const { tree: out } = recognize(tree, { registry });
  assert.equal(out.children[0].tag, 'header');
  assert.deepEqual(out.children[0].recognized, { component: 'appbar', props: { title: 'x' } });
  assert.equal(out.children[0].key, 'body/div[0]');
});

test('data-lv-widget beats a higher match score', () => {
  const tree = node('body', {}, [node('div', { role: 'dialog', widget: 'card' })]);
  const registry = createRegistry([
    roleDef('modal', 'dialog', { match: () => 1.5 }),
    roleDef('card', 'never'),
  ]);
  const { tree: out } = recognize(tree, { registry });
  assert.equal(out.children[0].recognized.component, 'card');
});

test('two definitions with the same top score are reported and the first wins', () => {
  const tree = node('body', {}, [node('div', { role: 'dialog' })]);
  const registry = createRegistry([roleDef('modal', 'dialog'), roleDef('drawer', 'dialog')]);
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(tree, { registry, diagnostics });
  assert.equal(out.children[0].recognized.component, 'modal');
  const [entry] = diagnostics.list();
  assert.equal(entry.code, 'RECOGNIZER_AMBIGUOUS');
  assert.match(entry.message, /"modal" and "drawer"/);
  assert.match(entry.fix, /data-lv-widget/);
});

test('a throwing match() or build() is reported and the node survives', () => {
  const tree = node('body', {}, [node('div', { role: 'a' }), node('div', { role: 'b' })]);
  const registry = createRegistry([
    roleDef('bad-match', 'a', { match: () => { throw new Error('boom'); } }),
    roleDef('bad-build', 'b', { build: () => { throw new Error('crash'); } }),
  ]);
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(tree, { registry, diagnostics });
  assert.equal(out.children.length, 2);
  const messages = diagnostics.list().map((e) => e.message).join('\n');
  assert.match(messages, /match\(\) threw on body\/div\[0\]: boom/);
  assert.match(messages, /build\(\) threw on body\/div\[1\]: crash/);
});

test('a build() that returns a non-node is reported and ignored', () => {
  const tree = node('body', {}, [node('div', { role: 'a' })]);
  const registry = createRegistry([roleDef('bad', 'a', { build: () => 'nope' })]);
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(tree, { registry, diagnostics });
  assert.equal(out.children[0].tag, 'div');
  assert.match(diagnostics.list()[0].message, /must return a node/);
});

test('hidden nodes are readable during recognition and dropped afterwards', () => {
  const body = node('div', { id: 'panel', hidden: true, text: 'details' });
  const tree = node('body', {}, [node('div', { role: 'region' }, [body]), node('p', { hidden: true })]);
  let seenHidden = null;
  const registry = createRegistry([
    roleDef('accordion', 'region', {
      build: (n, ctx) => {
        seenHidden = ctx.byId.get('panel')?.text;
        return null;
      },
    }),
  ]);
  const { tree: out } = recognize(tree, { registry });
  assert.equal(seenHidden, 'details');
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].children.length, 0);
});

test('a leaf definition stops recognition inside it', () => {
  const tree = node('body', {}, [node('div', { role: 'dialog' }, [node('div', { role: 'inner' })])]);
  const registry = createRegistry([roleDef('modal', 'dialog', { leaf: true }), roleDef('inner', 'inner')]);
  const { tree: out, recognized } = recognize(tree, { registry });
  assert.equal(recognized, 1);
  assert.equal(out.children[0].children[0].recognized, undefined);
});

test('nested definitions are both recognized by default', () => {
  const tree = node('body', {}, [node('div', { role: 'dialog' }, [node('div', { role: 'inner' })])]);
  const registry = createRegistry([roleDef('modal', 'dialog'), roleDef('inner', 'inner')]);
  assert.equal(recognize(tree, { registry }).recognized, 2);
});

test('a linker that throws is reported and recognition carries on', () => {
  const tree = node('body', {}, [node('div', { role: 'dialog' })]);
  const diagnostics = createDiagnostics();
  const { recognized } = recognize(tree, {
    registry: createRegistry([roleDef('modal', 'dialog')]),
    diagnostics,
    linker: () => { throw new Error('bad links'); },
  });
  assert.equal(recognized, 1);
  assert.match(diagnostics.list()[0].message, /ARIA linker threw: bad links/);
});

test('links from the linker reach match() through the context', () => {
  const tree = node('body', {}, [node('button', { aria: { controls: 'p' } }), node('div', { id: 'p' })]);
  let seen = null;
  recognize(tree, {
    registry: createRegistry([roleDef('x', 'none', { match: (n, ctx) => { seen = ctx.links.get('body/button[0]'); return false; } })]),
    linker: () => new Map([['body/button[0]', { controls: ['#p'], controlledBy: [] }]]),
  });
  assert.deepEqual(seen, { controls: ['#p'], controlledBy: [] });
});

test('validateComponent reports every problem at once and never throws', () => {
  assert.equal(validateComponent(null).ok, false);
  const result = validateComponent({ name: 'Bad Name', match: 1, props: { x: { type: 'blob' } }, slots: 'no' });
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  assert.match(text, /`name` of lower-case/);
  assert.match(text, /`match` must be a function/);
  assert.match(text, /`build` must be a function/);
  assert.match(text, /prop "x" needs a `type`/);
  assert.match(text, /`slots` must be an array/);
});

test('a registry rejects duplicates and bad definitions without throwing', () => {
  const registry = createRegistry([roleDef('modal', 'dialog'), roleDef('modal', 'other'), { name: 'x' }]);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.rejected.length >= 2, true);
  assert.match(registry.rejected.join('\n'), /already registered/);
  assert.equal(registry.get('modal').name, 'modal');
  assert.equal(registry.get('missing'), null);
});

test('describeRegistry exports palette data with no functions', () => {
  const registry = createRegistry([
    roleDef('card', 'article', { props: { title: { type: 'string', default: '' } }, slots: ['body'] }),
  ]);
  const described = describeRegistry(registry);
  assert.deepEqual(described, [{ name: 'card', props: { title: { type: 'string', default: '' } }, slots: ['body'] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(described)), described);
});

test('the built-in registry holds only the icon placeholder until Phase 7', () => {
  assert.deepEqual(defaultRegistry.list().map((d) => d.name), ['icon']);
});

test('the optimizer keeps a recognized wrapper that would otherwise collapse', () => {
  const inner = node('p', { text: 'x' });
  const wrapper = node('div', { recognized: { component: 'card', props: {} } }, [inner]);
  const plain = node('div', {}, [node('p', { text: 'y' })]);
  const root = node('body', {}, [wrapper, plain]);
  const { tree } = optimize(root);
  assert.equal(tree.children[0].tag, 'div'); // kept
  assert.equal(tree.children[1].tag, 'p'); // collapsed
});

test('convert() accepts a registry and a recognized node reaches the output', () => {
  const tree = node('body', { w: 320, h: 240 }, [node('p', { role: 'note', text: 'Hello', w: 80, h: 20 })]);
  const registry = createRegistry([
    roleDef('note', 'note', { build: (n) => ({ ...n, text: 'Rewritten' }) }),
  ]);
  const withDef = convert(tree, { registry });
  const without = convert(tree, { registry: createRegistry() });
  assert.match(withDef.xml, /Rewritten/);
  assert.doesNotMatch(without.xml, /Rewritten/);
  assert.match(without.xml, /Hello/);
});

test('recognition diagnostics reach convert()\'s diagnostics', () => {
  const tree = node('body', { w: 320, h: 240 }, [node('p', { role: 'a', text: 'x' })]);
  const registry = createRegistry([roleDef('bad', 'a', { match: () => { throw new Error('nope'); } })]);
  const { diagnostics, warnings } = convert(tree, { registry });
  assert.equal(diagnostics.list()[0].code, 'RECOGNIZER_ERROR');
  assert.match(warnings[0], /match\(\) threw/);
});

test('withoutHidden returns a copy and leaves the original alone', async () => {
  const { withoutHidden } = await import('../src/recognize.mjs');
  const tree = node('body', {}, [node('p', { hidden: true }), node('p')]);
  const copy = withoutHidden(tree);
  assert.equal(copy.children.length, 1);
  assert.equal(tree.children.length, 2);
});
