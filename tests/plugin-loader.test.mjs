import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins, selectPlugin, extractWithPlugin, CONFIG_FILE } from '../src/plugin-loader.mjs';
import reactPlugin from '../src/plugins/react.mjs';
import { validatePlugin } from '../src/plugin.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'h2l-loader-'));
const pluginSrc = (name, ext = '.foo', api = 1) =>
  `export default { name: ${JSON.stringify(name)}, pluginApi: ${api}, extensions: [${JSON.stringify(ext)}], load: async () => ({ tree: { tag: 'x' } }) };\n`;
const quiet = { log: () => {} };

test('the built-in react plugin satisfies the contract', () => {
  assert.deepEqual(validatePlugin(reactPlugin), { ok: true, errors: [] });
});

test('selects by extension; html has no plugin', async () => {
  const dir = tmp();
  try {
    const { plugins, errors } = await loadPlugins({ cwd: dir, ...quiet });
    assert.deepEqual(errors, []);
    assert.equal(selectPlugin(plugins, 'a/panel.jsx')?.name, 'react');
    assert.equal(selectPlugin(plugins, 'Panel.TSX')?.name, 'react');
    assert.equal(selectPlugin(plugins, 'page.html'), null);
    assert.equal(selectPlugin(plugins, 'noext'), null);
  } finally { rmSync(dir, { recursive: true }); }
});

test('--plugin path is loaded and takes priority', async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'foo.mjs'), pluginSrc('foo'));
    writeFileSync(join(dir, 'myreact.mjs'), pluginSrc('myreact', '.jsx'));
    const { plugins } = await loadPlugins({ specs: ['./foo.mjs', join(dir, 'myreact.mjs')], cwd: dir, ...quiet });
    assert.equal(selectPlugin(plugins, 'x.foo')?.name, 'foo');
    assert.equal(selectPlugin(plugins, 'x.jsx')?.name, 'myreact');
    const r = await extractWithPlugin(selectPlugin(plugins, 'x.foo'), 'x.foo', { width: 1, height: 1 });
    assert.deepEqual(r, { ok: true, tree: { tag: 'x' } });
  } finally { rmSync(dir, { recursive: true }); }
});

test('invalid plugin prints every error and is skipped', async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'bad.mjs'), `export default { pluginApi: 99, load: 'nope' };\n`);
    const lines = [];
    const { plugins, errors } = await loadPlugins({ specs: ['./bad.mjs', './missing.mjs'], cwd: dir, log: (l) => lines.push(l) });
    assert.deepEqual(lines, errors);
    assert.ok(errors.length >= 4, errors.join('\n'));
    assert.ok(errors.some((e) => /non-empty string `name`/.test(e)));
    assert.ok(errors.some((e) => /plugin API 99/.test(e)));
    assert.ok(errors.some((e) => /missing\.mjs.*no such file/.test(e)));
    assert.deepEqual(plugins.map((p) => p.name), ['react']);
  } finally { rmSync(dir, { recursive: true }); }
});

test('config file next to the input and in cwd is discovered', async () => {
  const dir = tmp();
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'bar.mjs'), pluginSrc('bar', '.bar'));
    writeFileSync(join(sub, 'baz.mjs'), pluginSrc('baz', '.baz'));
    writeFileSync(join(sub, CONFIG_FILE), `import baz from './baz.mjs';\nexport default { plugins: ['./bar.mjs', baz] };\n`);
    writeFileSync(join(dir, CONFIG_FILE), `export default { plugins: [{ name: 'broken', pluginApi: 1 }] };\n`);
    const { plugins, errors } = await loadPlugins({ inputs: [join(sub, 'a.bar')], cwd: dir, ...quiet });
    assert.equal(selectPlugin(plugins, 'a.bar')?.name, 'bar');
    assert.equal(selectPlugin(plugins, 'a.baz')?.name, 'baz');
    assert.ok(errors.some((e) => /provides nothing/.test(e)), errors.join('\n'));
  } finally { rmSync(dir, { recursive: true }); }
});

test('a malformed config is reported, not fatal', async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, CONFIG_FILE), `export default 42;\n`);
    const { plugins, errors } = await loadPlugins({ cwd: dir, ...quiet });
    assert.ok(errors.some((e) => /\{ plugins: \[\.\.\.\] \}/.test(e)));
    assert.equal(selectPlugin(plugins, 'a.jsx')?.name, 'react');
  } finally { rmSync(dir, { recursive: true }); }
});

test('extractWithPlugin reports a failing load and closes the handle', async () => {
  const boom = { name: 'boom', pluginApi: 1, extensions: ['.b'], load: async () => { throw new Error('kaput'); } };
  const r = await extractWithPlugin(boom, 'x.b', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /boom.*x\.b.*kaput/);
  let closed = false;
  const ok = { name: 'ok', pluginApi: 1, extensions: ['.o'], load: async () => ({ tree: null, handle: { close: () => { closed = true; } } }) };
  assert.deepEqual(await extractWithPlugin(ok, 'x.o', {}), { ok: true, tree: null });
  assert.ok(closed);
});
