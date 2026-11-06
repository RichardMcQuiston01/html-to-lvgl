/**
 * Source locations: `data-lv-source="file:line"` is THE supported mechanism
 * (src/plugin.mjs, `sourceOf`). The extractor copies it to node.source; the
 * converter never calls a plugin's sourceOf().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPage } from '../src/extract.mjs';
import vuePlugin from '../packages/vue/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const find = (n, pred) => {
  if (pred(n)) return n;
  for (const c of n.children ?? []) { const f = find(c, pred); if (f) return f; }
  return null;
};

test('the core never calls a plugin sourceOf hook', () => {
  const files = readdirSync(join(root, 'src'), { recursive: true }).filter((f) => f.endsWith('.mjs'));
  for (const f of files) {
    const text = readFileSync(join(root, 'src', f), 'utf8');
    assert.doesNotMatch(text, /\.sourceOf\s*\(/, `${f} calls .sourceOf(`);
  }
});

test('the plugin contract documents data-lv-source and that sourceOf takes a CSS selector', () => {
  const text = readFileSync(join(root, 'src/plugin.mjs'), 'utf8');
  assert.match(text, /`data-lv-source="<file>:<line>"`/);
  assert.match(text, /the converter never calls it/);
  assert.match(text, /CSS selector for document\.querySelector\(\)/);
});

test('extraction copies data-lv-source to node.source and splits at the last colon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'h2l-src-'));
  try {
    const page = join(dir, 'p.html');
    writeFileSync(page, `<body style="margin:0">
      <p id="a" data-lv-source="src/App.vue:12">one</p>
      <p id="b" data-lv-source="C:\\\\app\\\\View.vue:7">two</p>
      <p id="c" data-lv-source="no-line">three</p>
      <p id="d">four</p></body>`);
    const tree = await extractPage(page, { width: 320, height: 240 });
    const src = (id) => find(tree, (n) => n.id === id || n.attrs?.id === id)?.source;
    assert.deepEqual(src('a'), { file: 'src/App.vue', line: 12 });
    assert.deepEqual(src('b'), { file: 'C:\\\\app\\\\View.vue', line: 7 });
    assert.equal(src('c'), undefined, 'a value without :line is ignored, not guessed');
    assert.equal(src('d'), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('vue: load() stamps data-lv-source, so node.source equals what the sourceOf helper reports', async () => {
  const loaded = await vuePlugin.load(join(root, 'packages/vue/examples/App.vue'), { width: 320, height: 240 });
  try {
    const viaHelper = await vuePlugin.sourceOf(loaded, '.bar');
    const bar = find(loaded.tree, (n) => n.attrs?.class === 'bar' || n.classes?.includes?.('bar'));
    assert.ok(bar, 'found the .bar node');
    assert.deepEqual(bar.source, viaHelper);
    assert.equal(await vuePlugin.sourceOf(loaded, 'div:2/p:0'), null, 'a core node key is not a CSS selector: null, never a throw');
  } finally { await loaded.handle.close(); }
});
