/**
 * The Vue plugin (packages/vue): contract, real mount in Chromium, component
 * boundaries, source mapping into TODO.txt, framework data, error paths, and
 * the real CLI. Core files are imported by relative path on purpose (the
 * repository root is not a workspace member). Golden output for the example
 * lives in tests/fixtures/vue_dashboard.react.json and is checked by
 * convert.test.mjs; here the live extraction must reproduce it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vuePlugin from '../packages/vue/src/index.mjs';
import { validatePlugin } from '../src/plugin.mjs';
import { loadPlugins, selectPlugin, extractWithPlugin } from '../src/plugin-loader.mjs';
import { convert } from '../src/convert.mjs';
import { componentize } from '../src/componentize.mjs';
import { render } from '../src/emit-xml.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const example = join(root, 'packages/vue/examples/App.vue');
const fixture = (name) => join(here, 'vue-live-fixtures', name);
const pluginPath = join(root, 'packages/vue/src/index.mjs');

const find = (node, pred) => {
  if (pred(node)) return node;
  for (const c of node.children ?? []) { const f = find(c, pred); if (f) return f; }
  return null;
};
const findAll = (node, pred, out = []) => {
  if (pred(node)) out.push(node);
  for (const c of node.children ?? []) findAll(c, pred, out);
  return out;
};

test('the vue plugin satisfies the contract and claims .vue', async () => {
  assert.deepEqual(validatePlugin(vuePlugin), { ok: true, errors: [] });
  const { plugins } = await loadPlugins({ specs: [pluginPath], cwd: root, log: () => {} });
  assert.equal(selectPlugin(plugins, 'x/Page.vue')?.name, 'vue');
  assert.equal(selectPlugin(plugins, 'x/Page.jsx')?.name, 'react'); // built-in still works
});

test('example: components, props, v-for, v-if and scoped styles render and extract', async () => {
  const loaded = await vuePlugin.load(example, { width: 320, height: 240 });
  try {
    const tree = loaded.tree;
    const cards = findAll(tree, (n) => n.component === 'StatCard');
    assert.equal(cards.length, 3, 'v-for renders three StatCard instances');
    assert.ok(find(tree, (n) => n.component === 'App'), 'root component is stamped');
    assert.ok(find(tree, (n) => n.text === 'Online'), 'v-if true branch rendered');
    assert.equal(find(tree, (n) => n.text === 'Offline'), null, 'v-if false branch absent');
    // scoped style applied before extraction reads computed styles
    assert.deepEqual(cards[0].styles.bgColor, [28, 42, 56, 255]);
    // data-lv-component is idempotent through the components() hook
    await vuePlugin.components(loaded);
    assert.equal(await loaded.handle.page.locator('[data-lv-component="StatCard"]').count(), 3);
  } finally { await loaded.handle.close(); }
});

test('example: live extraction converts to the golden componentized XML', async () => {
  const r = await extractWithPlugin(vuePlugin, example, { width: 320, height: 240 });
  assert.ok(r.ok, r.error);
  const { view } = convert(r.tree, { name: 'vue_dashboard' });
  const { view: pageView, components } = componentize(view);
  const dir = join(here, 'golden-react', 'vue_dashboard');
  assert.equal(`<component>\n${render(pageView, 1)}\n</component>\n`, readFileSync(join(dir, 'vue_dashboard.xml'), 'utf8'));
  assert.deepEqual([...components.keys()], ['stat_card'], 'the reused component becomes one shared XML component');
  assert.equal(components.get('stat_card'), readFileSync(join(dir, 'stat_card.xml'), 'utf8'));
});

test('sourceOf names the .vue file and the template line', async () => {
  const loaded = await vuePlugin.load(example, { width: 320, height: 240 });
  try {
    assert.deepEqual(await vuePlugin.sourceOf(loaded, '.bar'), { file: 'packages/vue/examples/App.vue', line: 18 });
    assert.deepEqual(await vuePlugin.sourceOf(loaded, '.card .value'), { file: 'packages/vue/examples/StatCard.vue', line: 11 });
    assert.equal(await vuePlugin.sourceOf(loaded, '.nope'), null);
    assert.equal(await vuePlugin.sourceOf(loaded, 'body/div[0]'), null, 'a non-CSS key is null, not a throw');
  } finally { await loaded.handle.close(); }
});

test('a plain <script> (options API) component works', async () => {
  const r = await extractWithPlugin(vuePlugin, fixture('plain-script.vue'), { width: 320, height: 240 });
  assert.ok(r.ok, r.error);
  assert.equal(findAll(r.tree, (n) => n.tag === 'li').length, 2);
  assert.ok(find(r.tree, (n) => n.component === 'PlainList'));
});

test('frameworkData stamps node.framework with the component chain; off by default', async () => {
  const on = await extractWithPlugin(vuePlugin, example, { width: 320, height: 240, frameworkData: true });
  const card = find(on.tree, (n) => n.component === 'StatCard');
  assert.equal(card.framework.componentName, 'StatCard');
  assert.deepEqual(card.framework.props, { label: 'Temp', value: '21 C' });
  assert.deepEqual(card.framework.chain.map((c) => c.name), ['StatCard']);
  const off = await extractWithPlugin(vuePlugin, example, { width: 320, height: 240 });
  assert.equal(find(off.tree, (n) => 'framework' in n), null);
});

test('syntax errors and unsupported blocks give descriptive errors, not a crash', async () => {
  const broken = await extractWithPlugin(vuePlugin, fixture('broken.vue'), { width: 320, height: 240 });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /plugin "vue" failed to load .*broken\.vue/);
  assert.match(broken.error, /broken\.vue:3:\d+: Vue single-file component syntax: Element is missing end tag/);
  const scss = await extractWithPlugin(vuePlugin, fixture('scss.vue'), { width: 320, height: 240 });
  assert.equal(scss.ok, false);
  assert.match(scss.error, /<style lang="scss"> is not supported/);
  const missing = await extractWithPlugin(vuePlugin, fixture('does-not-exist.vue'), { width: 320, height: 240 });
  assert.equal(missing.ok, false);
});

function cli(args, cwd = root) {
  return spawnSync(process.execPath, [join(root, 'src/cli.mjs'), ...args], { cwd, encoding: 'utf8' });
}

test('CLI: --plugin converts a .vue file; TODO.txt points at the .vue file and line', () => {
  const out = mkdtempSync(join(tmpdir(), 'h2l-vue-'));
  try {
    const r = cli([fixture('small-button.vue'), '--plugin', pluginPath, '-o', out, '--format', 'xml']);
    assert.equal(r.status, 0, r.stderr);
    const todo = readFileSync(join(out, 'TODO.txt'), 'utf8');
    assert.match(todo, /tests\/vue-live-fixtures\/small-button\.vue:4/);
    const diag = JSON.parse(readFileSync(join(out, 'diagnostics.json'), 'utf8'));
    const hit = JSON.stringify(diag);
    assert.match(hit, /small-button\.vue/);
  } finally { rmSync(out, { recursive: true }); }
});

test('CLI: the example produces a shared stat_card component and all formats', () => {
  const out = mkdtempSync(join(tmpdir(), 'h2l-vue-'));
  try {
    const r = cli([example, '--plugin', pluginPath, '-o', out, '--format', 'xml,c,cpp,py']);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['app.xml', 'stat_card.xml', 'ui_app.c', 'ui_app.cpp', 'ui_app.py']) assert.ok(existsSync(join(out, f)), f);
    assert.match(readFileSync(join(out, 'app.xml'), 'utf8'), /<stat_card name="card_3"/);
  } finally { rmSync(out, { recursive: true }); }
});

test('CLI: html2lvgl.config.mjs selects the plugin by the .vue extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h2l-vue-'));
  try {
    writeFileSync(join(dir, 'html2lvgl.config.mjs'),
      `import vue from ${JSON.stringify(pathToFileURL(pluginPath).href)};\nexport default { plugins: [vue] };\n`);
    writeFileSync(join(dir, 'Hello.vue'), readFileSync(fixture('plain-script.vue')));
    const r = cli(['Hello.vue', '-o', 'out', '--format', 'xml'], dir);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, 'out', 'hello.xml')));
  } finally { rmSync(dir, { recursive: true }); }
});

test('CLI: a syntax error exits 1 with the file, line and reason, no stack trace', () => {
  const out = mkdtempSync(join(tmpdir(), 'h2l-vue-'));
  try {
    const r = cli([fixture('broken.vue'), '--plugin', pluginPath, '-o', out]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /broken\.vue:3:\d+: Vue single-file component syntax/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  } finally { rmSync(out, { recursive: true }); }
});
