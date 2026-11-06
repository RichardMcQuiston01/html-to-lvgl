/**
 * The React plugin's framework stamp (annotateFramework) with a named
 * component that renders no DOM beside the real root element. Material UI
 * renders emotion's `Insertion` there, and before this was handled every
 * Material UI component came back unstamped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import reactPlugin from '../src/plugins/react.mjs';

const app = fileURLToPath(new URL('./react-live-fixtures/framework-sibling/app.jsx', import.meta.url));

function find(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) find(c, pred, out);
  return out;
}

test('an element beside a named component that renders nothing still gets the chain', async () => {
  const loaded = await reactPlugin.load(app, { width: 320, height: 240, frameworkData: true });
  await loaded.handle.close();
  const [button] = find(loaded.tree, (n) => n.tag === 'button');
  assert.ok(button.framework, 'the button must be stamped');
  assert.deepEqual(button.framework.chain.map((c) => c.name), ['Styled', 'Fancy']);
});

test('the component that is stamped is not stamped twice (a later sibling stays unstamped)', async () => {
  const loaded = await reactPlugin.load(app, { width: 320, height: 240, frameworkData: true });
  await loaded.handle.close();
  const stamped = find(loaded.tree, (n) => n.framework !== undefined);
  // The wrapping div (App) and the button; nothing else.
  assert.deepEqual(stamped.map((n) => n.tag).sort(), ['button', 'div']);
});
