/**
 * The React plugin's opt-in framework data: node.framework on DOM nodes, so a
 * library plugin can match components whose class names are hashed. Off by
 * default so existing output is unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import reactPlugin from '../src/plugins/react.mjs';
import { registryFor } from '../src/plugin-loader.mjs';
import { recognize } from '../src/recognize.mjs';
import examplePlugin from './helpers/example-library-plugin.mjs';

const app = fileURLToPath(new URL('./react-live-fixtures/framework-data/app.jsx', import.meta.url));

async function treeOf(options) {
  const loaded = await reactPlugin.load(app, { width: 320, height: 240, ...options });
  await loaded.handle.close();
  return loaded.tree;
}
function find(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) find(c, pred, out);
  return out;
}

test('by default no node carries framework data', async () => {
  const tree = await treeOf({});
  assert.deepEqual(find(tree, (n) => n.framework !== undefined), []);
});

test('with frameworkData the button carries its component chain, innermost first', async () => {
  const tree = await treeOf({ frameworkData: true });
  const [button] = find(tree, (n) => n.tag === 'button');
  assert.equal(button.framework.componentName, 'ButtonRoot');
  assert.deepEqual(button.framework.chain.map((c) => c.name), ['ButtonRoot', 'ButtonBase', 'FancyButton']);
  // memo(forwardRef(F)) is one entry, and primitives props only (never children/ref)
  assert.equal(button.framework.chain[2].props.variant, 'contained');
  assert.equal('children' in button.framework.chain[2].props, false);
  assert.ok(button.classes.includes('css-1abcd9'), 'the class is hashed, so only the chain identifies the component');
});

test('only the first host node of a component is stamped; later siblings are not', async () => {
  const tree = await treeOf({ frameworkData: true });
  const span = find(tree, (n) => n.tag === 'span')[0];
  assert.equal(span.framework, undefined);
  // Row's first host node is the wrapper div; App renders Row, so it is in the chain too.
  const div = find(tree, (n) => n.tag === 'div' && n.framework)[0];
  assert.deepEqual(div.framework.chain.map((c) => c.name), ['Row', 'App']);
});

test('a library plugin recognizes a hashed-class component through node.framework', async () => {
  const tree = await treeOf({ frameworkData: true });
  const { tree: out } = recognize(structuredClone(tree), { registry: registryFor([examplePlugin]) });
  const [button] = find(out, (n) => n.tag === 'button');
  assert.equal(button.recognized.component, 'fancy-button');
  assert.equal(button.recognized.props.variant, 'contained');
});
