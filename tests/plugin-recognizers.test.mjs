/**
 * Library-plugin recognizers wired into the real pipeline: registry
 * assembly and precedence, degradation to diagnostics, plain-HTML CLI runs,
 * the framework-data opt-in, and watch-mode reload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PLUGIN_API, validatePlugin } from '../src/plugin.mjs';
import { defaultRegistry, createRegistry, extendRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { loadPlugins, registryFor, frameworkDataWanted } from '../src/plugin-loader.mjs';
import { startPreview } from '../src/preview.mjs';
import examplePlugin, { fancyButton } from './helpers/example-library-plugin.mjs';
import { node, page } from './helpers/ui-node.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');
const examplePath = join(here, 'helpers', 'example-library-plugin.mjs');
const tmp = (p) => mkdtempSync(join(tmpdir(), `h2l-${p}-`));

const def = (name, score, extra = {}) => ({
  name, match: () => score, props: {}, slots: [],
  build: (n) => ({ ...n, lvName: name }), ...extra,
});
const lib = (name, ...recognizers) => ({ name, pluginApi: PLUGIN_API, recognizers });
const codes = (d) => d.list().map((e) => e.code);
const run = (tree, registry) => {
  const diagnostics = createDiagnostics();
  const { tree: out } = recognize(structuredClone(tree), { registry, diagnostics });
  return { out, diagnostics };
};

test('the example plugin is a valid library plugin', () => {
  assert.deepEqual(validatePlugin(examplePlugin), { ok: true, errors: [] });
  assert.equal(frameworkDataWanted([examplePlugin]), true);
  assert.equal(frameworkDataWanted([lib('x')]), false);
  assert.match(validatePlugin({ ...lib('x'), wantsFrameworkData: 'yes' }).errors[0], /wantsFrameworkData/);
});

test('no plugin recognizers: the default registry is returned untouched', () => {
  assert.equal(registryFor([]), defaultRegistry);
  assert.equal(registryFor([{ name: 'fw', pluginApi: PLUGIN_API, load() {}, extensions: ['.x'] }]), defaultRegistry);
});

test('plugin recognizers join the core registry without changing it', () => {
  const before = defaultRegistry.list().length;
  const registry = registryFor([examplePlugin]);
  assert.equal(registry.list().length, before + 1);
  assert.equal(defaultRegistry.list().length, before);
  assert.equal(registry.list().at(-1).name, 'fancy-button');
  assert.deepEqual(registry.rejected, []);
});

test('a plugin recognizer matches on plain HTML data (classes) with no framework plugin', () => {
  const tree = page(node('button', { classes: ['fancy-btn'], text: 'Go' }));
  const { out } = run(tree, registryFor([examplePlugin]));
  assert.equal(out.children[0].recognized.component, 'fancy-button');
  assert.equal(out.children[0].lvName, 'fancy_button');
});

test('a recognizer can match on node.framework when present', () => {
  const framework = { componentName: 'FancyButton', chain: [{ name: 'FancyButton', props: { variant: 'contained' } }] };
  const tree = page(node('div', { classes: ['css-1x2y3z'], framework }));
  const { out } = run(tree, registryFor([examplePlugin]));
  assert.equal(out.children[0].recognized.props.variant, 'contained');
});

test('a recognizer that needs node.framework is simply inert without it', () => {
  const tree = page(node('div', { classes: ['css-1x2y3z'] }));
  const { out, diagnostics } = run(tree, registryFor([examplePlugin]));
  assert.equal(out.children[0].recognized, undefined);
  assert.deepEqual(codes(diagnostics), []);
});

test('highest score wins; explicit data-lv-widget beats any score', () => {
  const plugin = lib('p', def('low', 1.5), def('high', 9));
  const registry = extendRegistry(defaultRegistry, [plugin]);
  const n = (extra) => page(node('div', extra));
  assert.equal(run(n({}), registry).out.children[0].recognized.component, 'high');
  // The person's choice cannot be outbid by a plugin returning a big number.
  assert.equal(run(n({ widget: 'low' }), registry).out.children[0].recognized.component, 'low');
});

test('equal scores: core first, then plugins in load order; reported as ambiguous', () => {
  const core = createRegistry([def('core-a', 1)]);
  const registry = extendRegistry(core, [lib('p1', def('first', 1)), lib('p2', def('second', 1))]);
  const { out, diagnostics } = run(page(node('div')), registry);
  assert.equal(out.children[0].recognized.component, 'core-a');
  // Every node (body and div) ties the same way.
  assert.deepEqual([...new Set(codes(diagnostics))], ['RECOGNIZER_AMBIGUOUS']);
  assert.match(diagnostics.list()[0].message, /"core-a" and "first" and "second"/);
});

test('a plugin name equal to a core name is rejected unless override is set', () => {
  const core = createRegistry([def('card', 1, { build: (n) => ({ ...n, lvName: 'core' }) })]);
  const plain = extendRegistry(core, [lib('p', def('card', 5, { build: (n) => ({ ...n, lvName: 'plugin' }) }))]);
  assert.equal(plain.list().length, 1);
  assert.equal(plain.get('card').match(), 1, 'the core definition is still the one registered');
  assert.match(plain.rejected[0], /plugin "p" recognizer "card".*core component.*override: true/);

  const over = extendRegistry(core, [lib('p', def('card', 5, { override: true, build: (n) => ({ ...n, lvName: 'plugin' }) }))]);
  assert.equal(over.list().length, 1);
  assert.equal(over.get('card').match(), 5);
  assert.deepEqual(over.rejected, []);
  assert.equal(run(page(node('div')), over).out.children[0].lvName, 'plugin');
});

test('override keeps the core definition position in the offer order', () => {
  const core = createRegistry([def('a', 1), def('b', 1)]);
  const registry = extendRegistry(core, [lib('p', def('a', 1, { override: true }))]);
  assert.deepEqual(registry.list().map((d) => d.name), ['a', 'b']);
});

test('two plugins cannot share a name, even with override: the earlier plugin wins', () => {
  const core = createRegistry([def('card', 1)]);
  const registry = extendRegistry(core, [
    lib('p1', def('x', 1), def('card', 4, { override: true })),
    lib('p2', def('x', 2), def('card', 7, { override: true })),
  ]);
  assert.equal(registry.get('x').match(), 1);
  assert.equal(registry.get('card').match(), 4);
  assert.equal(registry.rejected.length, 2);
  assert.match(registry.rejected[0], /plugin "p2".*earlier plugin already registered "x"/);
});

test('an invalid recognizer is skipped with a diagnostic; its siblings still register', () => {
  const plugin = lib('p', { name: 'Bad Name', match: 'nope' }, null, def('ok', 1));
  const registry = extendRegistry(defaultRegistry, [plugin]);
  assert.ok(registry.get('ok'));
  assert.ok(registry.rejected.length >= 3, registry.rejected.join('\n'));
  assert.ok(registry.rejected.every((l) => l.startsWith('plugin "p" recognizer #')));
  const { diagnostics } = run(page(node('div')), registry);
  assert.equal(codes(diagnostics).filter((c) => c === 'PLUGIN_RECOGNIZER_REJECTED').length, registry.rejected.length);
});

test('recognizers that are not an array, or a throwing getter, are reported not thrown', () => {
  const getter = { name: 'g', pluginApi: PLUGIN_API, get recognizers() { throw new Error('boom'); } };
  const registry = extendRegistry(defaultRegistry, [{ name: 'n', recognizers: 'x' }, getter]);
  assert.equal(registry.rejected.length, 2);
  assert.match(registry.rejected[0], /plugin "n".*must be an array/);
  assert.match(registry.rejected[1], /plugin "g".*threw: boom/);
});

test('a throwing match() or build() degrades to RECOGNIZER_ERROR; the page still converts', () => {
  const plugin = lib('p',
    def('bad-match', 0, { match() { throw new Error('match blew up'); } }),
    def('bad-build', 1, { build() { throw new Error('build blew up'); } }));
  const registry = extendRegistry(defaultRegistry, [plugin]);
  const tree = page(node('div', { text: 'hello' }));
  const converted = convert(tree, { registry });
  const errors = converted.diagnostics.list().filter((d) => d.code === 'RECOGNIZER_ERROR');
  assert.ok(errors.some((e) => /match\(\) threw.*match blew up/.test(e.message)));
  assert.ok(errors.some((e) => /build\(\) threw.*build blew up/.test(e.message)));
  assert.match(converted.xml, /hello/);
});

test('convert() reports rejected plugin recognizers as diagnostics', () => {
  const registry = extendRegistry(defaultRegistry, [lib('p', { name: 'x' })]);
  const converted = convert(page(node('div', { text: 'hi' })), { registry });
  assert.ok(codes(converted.diagnostics).includes('PLUGIN_RECOGNIZER_REJECTED'));
  assert.match(converted.xml, /hi/);
});

test('loadPlugins + registryFor: --plugin recognizers reach convert()', async () => {
  const { plugins, errors } = await loadPlugins({ specs: [examplePath], cwd: here, log: () => {} });
  assert.deepEqual(errors, []);
  assert.ok(plugins.some((p) => p.name === 'example-library'));
  const tree = page(node('button', { classes: ['fancy-btn'], text: 'Go' }));
  const converted = convert(tree, { registry: registryFor(plugins) });
  assert.match(converted.xml, /fancy_button/);
  assert.doesNotMatch(convert(tree).xml, /fancy_button/, 'without the plugin nothing changes');
});

test('loadPlugins reports watched files, and fresh re-evaluates the module', async () => {
  const dir = tmp('fresh');
  const file = join(dir, 'p.mjs');
  const src = (n) => `export default { name: 'p', pluginApi: ${PLUGIN_API}, recognizers: [{ name: 'n${n}', match: () => 0, props: {}, slots: [], build: () => null }] };\n`;
  writeFileSync(file, src(1));
  const first = await loadPlugins({ specs: [file], cwd: dir, log: () => {} });
  assert.deepEqual(first.files, [file]);
  writeFileSync(file, src(2));
  const cached = await loadPlugins({ specs: [file], cwd: dir, log: () => {} });
  assert.equal(cached.plugins[0].recognizers[0].name, 'n1', 'normal import is cached');
  const fresh = await loadPlugins({ specs: [file], cwd: dir, log: () => {}, fresh: true });
  assert.equal(fresh.plugins[0].recognizers[0].name, 'n2');
});

test('CLI: a --plugin library applies to a plain .html input', () => {
  const dir = tmp('cli');
  const input = join(dir, 'page.html');
  writeFileSync(input, '<!DOCTYPE html><html><body style="margin:0"><button class="fancy-btn" style="width:120px;height:40px">Go</button></body></html>');
  const out = join(dir, 'out');
  execFileSync('node', [cli, input, '--plugin', examplePath, '-o', out, '--format', 'xml']);
  const xml = readFileSync(join(out, 'page.xml'), 'utf8');
  assert.match(xml, /fancy_button/);
  assert.ok(readdirSync(out).includes('page.xml'));
});

test('CLI: a broken recognizer plugin never fails the run', () => {
  const dir = tmp('clibad');
  const input = join(dir, 'page.html');
  writeFileSync(input, '<!DOCTYPE html><html><body><p>hi</p></body></html>');
  const plugin = join(dir, 'bad.mjs');
  writeFileSync(plugin, `export default { name: 'bad', pluginApi: ${PLUGIN_API}, recognizers: [{ name: 'Nope' }, { name: 'boom', match() { throw new Error('x'); }, build: () => null, props: {}, slots: [] }] };\n`);
  const out = join(dir, 'out');
  execFileSync('node', [cli, input, '--plugin', plugin, '-o', out, '--format', 'xml'], { stdio: 'pipe' });
  const diag = JSON.parse(readFileSync(join(out, 'diagnostics.json'), 'utf8'));
  const found = JSON.stringify(diag);
  assert.match(found, /PLUGIN_RECOGNIZER_REJECTED/);
  assert.match(found, /RECOGNIZER_ERROR/);
  assert.match(readFileSync(join(out, 'page.xml'), 'utf8'), /hi/);
});

test('watch mode applies plugin recognizers and reloads them when the plugin file changes', async () => {
  const dir = tmp('watch');
  const input = join(dir, 'page.html');
  writeFileSync(input, '<!DOCTYPE html><html><body style="margin:0"><button class="fancy-btn" style="width:120px;height:40px">Go</button></body></html>');
  const plugin = join(dir, 'p.mjs');
  const src = (name) => `export default { name: 'p', pluginApi: ${PLUGIN_API}, recognizers: [{
    name: 'w', match: (n) => n.classes?.includes('fancy-btn') ? 2 : 0, props: {}, slots: [],
    build: (n) => ({ ...n, lvName: ${JSON.stringify(name)} }) }] };\n`;
  writeFileSync(plugin, src('first_name'));
  const preview = await startPreview(input, {
    width: 320, height: 240, name: 'page', outputDir: join(dir, 'out'),
    port: 0, renderBin: '/nonexistent/render', plugins: [plugin],
  });
  try {
    const state = async () => (await fetch(`http://127.0.0.1:${preview.port}/state`)).json();
    const xmlOf = async () => readFileSync(join(dir, 'out', 'page.xml'), 'utf8');
    assert.match(await xmlOf(), /first_name/);
    writeFileSync(plugin, src('second_name'));
    let xml = '';
    for (let i = 0; i < 100 && !/second_name/.test(xml); i++) {
      await new Promise((r) => setTimeout(r, 100));
      xml = await xmlOf();
    }
    assert.match(xml, /second_name/, 'the edited plugin took effect without restarting');
    assert.deepEqual((await state()).pluginErrors, []);
  } finally {
    await preview.close();
  }
});
