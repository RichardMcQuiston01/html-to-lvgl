/**
 * Published-layout smoke tests. The repository checkout resolves the core by
 * relative path, which hides packaging mistakes: a file missing from "files",
 * an entry missing from "exports", a plugin reaching into the checkout. These
 * tests `npm pack` the core and each plugin, unpack the tarballs into a
 * scratch project's node_modules (exactly what `npm install <tarball>` lays
 * down) and run the real CLI from there.
 *
 * The tarballs are unpacked rather than `npm install`ed so the test needs no
 * network: the third-party dependencies (playwright, esbuild, vue, react,
 * @mui/...) are symlinked from this checkout's node_modules. Those are not
 * what is being tested.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, readdirSync, symlinkSync, copyFileSync, readFileSync,
  writeFileSync, existsSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const SCOPE = '@richardmcquiston01';
const CORE = `${SCOPE}/html-to-lvgl`;

/** @type {string} */ let scratch;
/** @type {string} */ let modules;

/** `npm pack` a directory into `dest`; returns the tarball path. */
function pack(dir, dest) {
  const out = execFileSync('npm', ['pack', resolve(repo, dir), '--pack-destination', dest, '--json', '--silent'], { cwd: repo, encoding: 'utf8' });
  return join(dest, JSON.parse(out)[0].filename);
}

/** Unpack a tarball into node_modules/<scope>/<name>. */
function install(tarball, name) {
  const target = join(modules, SCOPE, name);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);
  return target;
}

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'h2l-published-'));
  modules = join(scratch, 'node_modules');
  mkdirSync(modules, { recursive: true });
  // A project of its own: the plugins must not recognise it as the core checkout.
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'scratch-consumer', private: true, type: 'module' }));

  // Third-party dependencies come from this checkout; the packages under test do not.
  const real = realpathSync(join(repo, 'node_modules'));
  for (const entry of readdirSync(real)) {
    if (entry.startsWith('.') || entry === SCOPE) continue;
    symlinkSync(join(real, entry), join(modules, entry), 'dir');
  }

  const tarballs = join(scratch, 'tarballs');
  mkdirSync(tarballs);
  install(pack('.', tarballs), 'html-to-lvgl');
  install(pack('packages/vue', tarballs), 'html-to-lvgl-vue');
  install(pack('packages/mui', tarballs), 'html-to-lvgl-mui');
});

after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

const cli = () => join(modules, SCOPE, 'html-to-lvgl', 'src', 'cli.mjs');

/** Run a snippet as ESM from the scratch project. */
function inScratch(code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: scratch, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('the packed core contains only src/ and the render program sources, and the packed plugins only their src/', () => {
  const core = readdirSync(join(modules, SCOPE, 'html-to-lvgl'));
  assert.deepEqual(core.filter((f) => !['src', 'spike', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md'].includes(f)), []);
  // --build-render compiles these; nothing else of spike/ (samples, ESP32, MicroPython) ships.
  assert.deepEqual(readdirSync(join(modules, SCOPE, 'html-to-lvgl', 'spike')), ['render']);
  assert.deepEqual(readdirSync(join(modules, SCOPE, 'html-to-lvgl', 'spike', 'render')).sort(), ['CMakeLists.txt', 'lv_conf.h', 'main.c']);
  assert.ok(!existsSync(join(modules, SCOPE, 'html-to-lvgl', 'packages')), 'plugins are not inside the core tarball');
  for (const name of ['html-to-lvgl-vue', 'html-to-lvgl-mui']) {
    const files = readdirSync(join(modules, SCOPE, name));
    assert.deepEqual(files.filter((f) => !['src', 'package.json', 'README.md', 'LICENSE'].includes(f)), [], name);
  }
});

test('documented core entry points resolve from the published layout', () => {
  const out = inScratch(`
    const extract = await import('${CORE}/extract');
    const plugin = await import('${CORE}/plugin');
    const recognize = await import('${CORE}/recognize');
    const react = await import('${CORE}/src/plugins/react.mjs');
    console.log(JSON.stringify({
      buildTree: typeof extract.buildTree, launch: typeof extract.launch,
      api: plugin.PLUGIN_API, validatePlugin: typeof plugin.validatePlugin,
      createRegistry: typeof recognize.createRegistry, react: react.default.name,
    }));`);
  assert.deepEqual(JSON.parse(out), {
    buildTree: 'function', launch: 'function', api: 1, validatePlugin: 'function',
    createRegistry: 'function', react: 'react',
  });
});

test('paths outside the exports map are blocked in the published layout', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import('${CORE}/not-an-entry')`], { cwd: scratch, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
});

test('the CLI from the packed core runs and reports its version', () => {
  const r = spawnSync(process.execPath, [cli(), '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version);
});

test('vue: the example converts through the CLI using only the published entry points', { timeout: 120000 }, () => {
  const project = join(scratch, 'vue-app');
  mkdirSync(project);
  for (const f of ['App.vue', 'StatCard.vue']) copyFileSync(join(repo, 'packages/vue/examples', f), join(project, f));
  const out = join(scratch, 'vue-out');
  const r = spawnSync(process.execPath, [
    cli(), join(project, 'App.vue'), '--plugin', `${SCOPE}/html-to-lvgl-vue`,
    '--size', '320x240', '-o', out, '--name', 'dashboard',
  ], { cwd: scratch, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(out, 'dashboard.xml'), 'utf8'), /Dashboard/);
  assert.ok(existsSync(join(out, 'stat_card.xml')), 'StatCard became a reusable component file');
  assert.equal(
    readFileSync(join(out, 'stat_card.xml'), 'utf8'),
    readFileSync(join(repo, 'tests/golden-react/vue_dashboard/stat_card.xml'), 'utf8'),
    'the published-layout component equals the committed golden',
  );
});

test('mui: the example converts through the CLI and equals the committed golden', { timeout: 120000 }, () => {
  const project = join(scratch, 'mui-app');
  mkdirSync(project);
  copyFileSync(join(repo, 'packages/mui/examples/settings.jsx'), join(project, 'settings.jsx'));
  const out = join(scratch, 'mui-out');
  const r = spawnSync(process.execPath, [
    cli(), join(project, 'settings.jsx'), '--plugin', `${SCOPE}/html-to-lvgl-mui`,
    '--size', '320x240', '-o', out, '--name', 'settings',
  ], { cwd: scratch, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(join(out, 'settings.xml'), 'utf8'),
    readFileSync(join(repo, 'packages/mui/tests/golden/settings.xml'), 'utf8'),
    'the published-layout output is the committed golden',
  );
});
