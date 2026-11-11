/**
 * Render program build (src/render-build.mjs). The build logic runs against
 * fake `git` and `cmake` so no toolchain or network is needed; the package
 * contents and the CLI error path are checked for real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildRenderProgram, cacheDir, cachedRenderBinary, renderBinaryName, renderSourceDir, renderSourceHash, lvglCloneDir, packageFiles,
  RenderBuildError, LVGL_VERSION, CACHE_DIR_ENV,
} from '../src/render-build.mjs';
import { findRenderBinary } from '../src/render-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const scratch = mkdtempSync(join(tmpdir(), 'render-build-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
const freshDir = () => mkdtempSync(join(scratch, 't'));

/** A fake toolchain that records commands and creates the files the real one would. */
function fakeDeps({ missing = [], failAt = null, writeBinary = true, outDir }) {
  const commands = [];
  const present = new Set();
  const deps = {
    packageRoot: root,
    platform: 'linux',
    env: {},
    probe: (tool) => ({ status: missing.includes(tool) ? null : 0, error: missing.includes(tool) ? new Error('ENOENT') : undefined }),
    exists: (p) => present.has(p) || (!p.startsWith(outDir) && existsOnDisk(p)),
    run: (command, args) => {
      commands.push([command, ...args]);
      const step = command === 'git' ? 'git' : args[0] === '--build' ? 'build' : 'configure';
      if (failAt === step) return { status: 1 };
      if (step === 'git') present.add(join(args[args.length - 1], 'CMakeLists.txt'));
      if (step === 'build' && writeBinary) present.add(join(args[1], 'render'));
      return { status: 0 };
    },
  };
  return { deps, commands, present };
}
const existsOnDisk = (p) => {
  try { readFileSync(p); return true; } catch { return false; }
};

test('the npm package ships the render program sources', () => {
  const files = packageFiles(root);
  for (const f of ['spike/render/CMakeLists.txt', 'spike/render/lv_conf.h', 'spike/render/main.c']) {
    assert.ok(files.includes(f), `package.json "files" must list ${f}`);
  }
  assert.ok(existsOnDisk(join(renderSourceDir(root), 'main.c')));
});

test('cacheDir honours $HTML2LVGL_CACHE_DIR, then XDG, then the home directory', () => {
  assert.equal(cacheDir({ env: { [CACHE_DIR_ENV]: '/x/c' } }), '/x/c');
  assert.equal(cacheDir({ env: { XDG_CACHE_HOME: '/x/xdg' } }), join('/x/xdg', 'html2lvgl'));
  assert.equal(cacheDir({ env: {}, home: '/home/u', platform: 'linux' }), join('/home/u', '.cache', 'html2lvgl'));
  assert.equal(cacheDir({ env: { LOCALAPPDATA: 'C:\\L' }, platform: 'win32' }), join('C:\\L', 'html2lvgl'));
});

test('the installed binary path carries the LVGL version and a hash of the render sources', () => {
  const path = cachedRenderBinary({ env: { [CACHE_DIR_ENV]: '/x/c' }, platform: 'linux' });
  assert.equal(path, join('/x/c', `render-lvgl-${LVGL_VERSION}-${renderSourceHash(root)}`, 'build', 'render'));
  assert.match(renderSourceHash(root), /^[0-9a-f]{10}$/);
  assert.equal(renderBinaryName('win32'), 'render.exe');
  assert.equal(lvglCloneDir({ env: { [CACHE_DIR_ENV]: '/x/c' } }), join('/x/c', `lvgl-${LVGL_VERSION}`));
});

test('a changed render source gives a different install directory, so an old binary is not reused', () => {
  const copy = (mutate) => {
    const dir = freshDir();
    mkdirSync(join(dir, 'spike', 'render'), { recursive: true });
    for (const f of ['CMakeLists.txt', 'lv_conf.h', 'main.c']) {
      const text = readFileSync(join(renderSourceDir(root), f), 'utf8');
      writeFileSync(join(dir, 'spike', 'render', f), f === 'main.c' ? mutate(text) : text);
    }
    return dir;
  };
  const same = renderSourceHash(copy((t) => t));
  const changed = renderSourceHash(copy((t) => `${t}\n/* edit */\n`));
  assert.equal(same, renderSourceHash(root));
  assert.notEqual(changed, same);
  assert.equal(renderSourceHash(freshDir()), 'unknown');
});

test('builds by cloning LVGL v9.4.0, configuring and compiling', () => {
  const outDir = freshDir();
  const { deps, commands } = fakeDeps({ outDir });
  const result = buildRenderProgram({ outDir, deps });
  assert.equal(result.built, true);
  assert.equal(result.binary, join(outDir, `render-lvgl-${LVGL_VERSION}-${renderSourceHash(root)}`, 'build', 'render'));
  const [clone, configure, build] = commands;
  assert.deepEqual(clone.slice(0, 5), ['git', 'clone', '--depth', '1', '--branch']);
  assert.equal(clone[5], `v${LVGL_VERSION}`);
  assert.equal(configure[0], 'cmake');
  assert.ok(configure.includes('-S') && configure.includes(renderSourceDir(root)), 'configures from the shipped sources');
  assert.ok(configure.some((a) => a.startsWith('-DLVGL_DIR=')));
  assert.deepEqual(build.slice(0, 2), ['cmake', '--build']);
});

test('--lvgl-dir skips the clone and needs only cmake', () => {
  const outDir = freshDir();
  const lvgl = freshDir();
  writeFileSync(join(lvgl, 'CMakeLists.txt'), '');
  const { deps, commands } = fakeDeps({ outDir, missing: ['git'] });
  buildRenderProgram({ outDir, lvglDir: lvgl, deps });
  assert.ok(commands.every(([c]) => c !== 'git'));
  assert.ok(commands[0].includes(`-DLVGL_DIR=${lvgl}`));
});

test('an existing build is reused unless force is set', () => {
  const outDir = freshDir();
  const first = fakeDeps({ outDir });
  const built = buildRenderProgram({ outDir, deps: first.deps });
  const again = buildRenderProgram({ outDir, deps: first.deps });
  assert.equal(again.built, false);
  assert.equal(again.binary, built.binary);
  const commandsBefore = first.commands.length;
  buildRenderProgram({ outDir, force: true, deps: first.deps });
  assert.ok(first.commands.length > commandsBefore, 'force runs the build again');
});

test('failures carry a code and say what to do', () => {
  const cases = [
    [{ missing: ['cmake'] }, 'toolchain_missing', /cmake not found.*C compiler/],
    [{ missing: ['git', 'cmake'] }, 'toolchain_missing', /git and cmake/],
    [{ failAt: 'git' }, 'lvgl_fetch_failed', /--lvgl-dir/],
    [{ failAt: 'configure' }, 'configure_failed', /C compiler/],
    [{ failAt: 'build' }, 'build_failed', /compiler output/],
    [{ writeBinary: false }, 'binary_missing', /does not exist/],
  ];
  for (const [options, code, message] of cases) {
    const outDir = freshDir();
    const { deps } = fakeDeps({ outDir, ...options });
    assert.throws(() => buildRenderProgram({ outDir, deps }), (err) => {
      assert.ok(err instanceof RenderBuildError);
      assert.equal(err.code, code);
      assert.match(err.message, message);
      return true;
    }, code);
  }
});

test('missing sources are reported, not a cryptic CMake error', () => {
  const outDir = freshDir();
  const { deps } = fakeDeps({ outDir });
  assert.throws(() => buildRenderProgram({ outDir, deps: { ...deps, packageRoot: freshDir() } }),
    (err) => err.code === 'sources_missing' && /Reinstall/.test(err.message));
});

test('findRenderBinary finds a binary installed in the cache', () => {
  const cache = freshDir();
  const binary = cachedRenderBinary({ env: { [CACHE_DIR_ENV]: cache } });
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, '');
  const cwd = freshDir(); // no spike/build/render here
  assert.equal(findRenderBinary({ cwd, env: { [CACHE_DIR_ENV]: cache } }), binary);
  assert.equal(findRenderBinary({ cwd, env: { [CACHE_DIR_ENV]: freshDir() } }), null);
});

test('CLI: --build-render with a bad --lvgl-dir exits 1 with a clear message', () => {
  const result = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), '--build-render', '--lvgl-dir', join(scratch, 'nope')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--build-render failed \(lvgl_fetch_failed\).*CMakeLists\.txt/);
});

/* ------------------------------------------------- real build (opt-in) */

const REAL_BUILD_ENV = 'HTML2LVGL_TEST_BUILD_RENDER';

test('real build from the shipped sources renders the dashboard IR (needs git, cmake, a compiler and network)', {
  skip: process.env[REAL_BUILD_ENV] === '1' ? false : `set ${REAL_BUILD_ENV}=1 to run the real build`,
  timeout: 600_000,
}, async () => {
  const outDir = freshDir();
  const result = buildRenderProgram({ outDir });
  assert.equal(result.built, true);
  const { createRenderProgramRenderer } = await import('../src/render-api.mjs');
  const ir = JSON.parse(readFileSync(join(here, 'golden-editor', 'ir_dashboard.json'), 'utf8'));
  const renderer = createRenderProgramRenderer({ binary: result.binary });
  const out = await renderer.render({ ir, size: { width: 320, height: 240 } });
  assert.equal(Buffer.from(out.png).subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(out.width, 320);
  assert.equal(out.height, 240);
  // The editor's canvas selection depends on these two options of the shipped main.c.
  assert.ok(Array.isArray(out.boxes) && out.boxes.length > 10, 'the render program reports widget boxes');
  const big = await renderer.render({ ir, size: { width: 480, height: 320 } });
  assert.deepEqual([big.width, big.height], [480, 320]);
});
