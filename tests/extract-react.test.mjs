/**
 * extractReactPage tests that need a real browser and a real esbuild
 * bundle (fiber-tree annotation and CSS handling can't be verified any
 * other way). Fixtures live under react-live-fixtures/ so esbuild's module
 * resolution finds react/react-dom in the repo's own node_modules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractReactPage } from '../src/extract-react.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function findBy(node, pred) {
  if (pred(node)) return node;
  for (const child of node.children ?? []) {
    const found = findBy(child, pred);
    if (found) return found;
  }
  return null;
}

test('a component-level CSS import is applied before extraction reads computed styles', async () => {
  const tree = await extractReactPage(join(here, 'react-live-fixtures', 'css-import', 'app.jsx'), {
    width: 320,
    height: 240,
  });
  const box = findBy(tree, (n) => n.className === 'box');
  assert.ok(box, 'expected to find the .box element in the extracted tree');
  // The stylesheet is only reachable via `import './style.css'`; if it were
  // silently dropped (or applied after extraction reads styles), this would
  // come back null instead of the imported red.
  assert.deepEqual(box.styles.bgColor, [255, 0, 0, 255]);
});
