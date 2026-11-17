/**
 * The editor's save and load: src/sidecar-store.mjs (the only disk access of the
 * preview API) and the /sidecar/<name> endpoints, plus rendering with a sidecar.
 * No LVGL needed: renders go through small fake render programs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readSidecar, writeSidecar, sidecarPath, checkWorkspace, SIDECAR_NAME } from '../src/sidecar-store.mjs';
import { createRenderProgramRenderer, startPreviewApi, renderCacheKey, RenderError } from '../src/render-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dashboardText = readFileSync(join(here, 'golden-editor', 'ir_dashboard.json'), 'utf8');
const dashboard = JSON.parse(dashboardText);

const scratch = mkdtempSync(join(tmpdir(), 'sidecar-api-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
const freshDir = () => mkdtempSync(join(scratch, 't'));

const sidecar = (nodes) => ({ version: 1, nodes });

/* ------------------------------------------------------------------ store */

test('SIDECAR_NAME accepts IR names and nothing that could leave the directory', () => {
  for (const ok of ['dashboard', 'my_page-2', 'A', 'x'.repeat(100)]) assert.ok(SIDECAR_NAME.test(ok), ok);
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a.b', 'a b', 'x'.repeat(101), 'a\0b', '~', '%2e%2e']) {
    assert.ok(!SIDECAR_NAME.test(bad), JSON.stringify(bad));
  }
  assert.equal(sidecarPath('/w', '../etc/passwd').code, 'invalid_sidecar_name');
  assert.equal(sidecarPath('/w', 'page').path, join('/w', 'page.lvgl.json'));
});

test('checkWorkspace accepts a directory and explains anything else', () => {
  const dir = freshDir();
  assert.equal(checkWorkspace(dir).ok, true);
  const file = join(dir, 'f');
  writeFileSync(file, '');
  assert.match(checkWorkspace(file).message, /not a directory/);
  assert.match(checkWorkspace(join(dir, 'missing')).message, /cannot use/);
});

test('read of a missing sidecar is fine; write then read round-trips with version first', () => {
  const dir = freshDir();
  assert.deepEqual(readSidecar(dir, 'page'), { ok: true, exists: false, sidecar: null });
  const doc = sidecar({ card: { attrs: { width: 120, text: null } }, stop: { remove: true } });
  const written = writeSidecar(dir, 'page', doc);
  assert.equal(written.ok, true);
  assert.equal(written.file, 'page.lvgl.json');
  const text = readFileSync(join(dir, 'page.lvgl.json'), 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.ok(text.startsWith('{\n  "version": 1,'), 'version comes first, 2-space indent');
  assert.deepEqual(readSidecar(dir, 'page'), { ok: true, exists: true, sidecar: doc });
});

test('an invalid sidecar is rejected with every problem and nothing is written', () => {
  const dir = freshDir();
  const result = writeSidecar(dir, 'page', { version: 2, nodes: { a: { remove: 'yes' } } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'sidecar_invalid');
  assert.equal(result.errors.length, 2);
  assert.deepEqual(readdirSync(dir), []);
});

test('an invalid name never reaches the file system', () => {
  const dir = freshDir();
  for (const name of ['../escape', 'a/b', '.hidden', '']) {
    assert.equal(writeSidecar(dir, name, sidecar({})).code, 'invalid_sidecar_name', name);
    assert.equal(readSidecar(dir, name).code, 'invalid_sidecar_name', name);
  }
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(existsSync(join(dir, '..', 'escape.lvgl.json')), false);
});

test('a symbolic link or directory in place of the sidecar is never read or overwritten', () => {
  const dir = freshDir();
  const outside = join(freshDir(), 'secret.json');
  writeFileSync(outside, JSON.stringify(sidecar({})));
  symlinkSync(outside, join(dir, 'link.lvgl.json'));
  assert.equal(readSidecar(dir, 'link').code, 'sidecar_unsafe_path');
  const before = readFileSync(outside, 'utf8');
  assert.equal(writeSidecar(dir, 'link', sidecar({ a: { remove: true } })).code, 'sidecar_unsafe_path');
  assert.equal(readFileSync(outside, 'utf8'), before, 'the link target is untouched');
  mkdirSync(join(dir, 'dir.lvgl.json'));
  assert.equal(readSidecar(dir, 'dir').code, 'sidecar_unsafe_path');
  assert.equal(writeSidecar(dir, 'dir', sidecar({})).code, 'sidecar_unsafe_path');
});

test('a corrupt file on disk is reported as sidecar_invalid, not a crash', () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'a.lvgl.json'), '{nope');
  assert.equal(readSidecar(dir, 'a').code, 'sidecar_invalid');
  writeFileSync(join(dir, 'b.lvgl.json'), JSON.stringify({ version: 9, nodes: {} }));
  const wrong = readSidecar(dir, 'b');
  assert.equal(wrong.code, 'sidecar_invalid');
  assert.match(wrong.message, /version/);
});

test('a write leaves no temporary file behind, and replaces an existing sidecar', () => {
  const dir = freshDir();
  writeSidecar(dir, 'page', sidecar({ a: { remove: true } }));
  writeSidecar(dir, 'page', sidecar({ b: { attrs: { width: 1 } } }));
  assert.deepEqual(readdirSync(dir), ['page.lvgl.json']);
  assert.deepEqual(readSidecar(dir, 'page').sidecar, sidecar({ b: { attrs: { width: 1 } } }));
});

test('a failed write (unwritable directory) is sidecar_write_failed and leaves no temporary file', { skip: process.getuid?.() === 0 ? 'root can write anywhere' : false }, () => {
  const dir = freshDir();
  chmodSync(dir, 0o500);
  try {
    const result = writeSidecar(dir, 'page', sidecar({}));
    assert.equal(result.code, 'sidecar_write_failed');
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.deepEqual(readdirSync(dir), []);
});

/* --------------------------------------------------------------- endpoints */

function request(api, { method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((ok, bad) => {
    const req = http.request({ host: '127.0.0.1', port: api.port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', bad);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const json = (res) => JSON.parse(res.body.toString('utf8'));
const put = (api, name, value, headers = {}) =>
  request(api, { method: 'PUT', path: `/sidecar/${name}`, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
const idle = { render: async () => { throw new Error('not used'); } };

async function withApi(options, fn) {
  const api = await startPreviewApi({ port: 0, renderer: idle, ...options });
  try {
    return await fn(api);
  } finally {
    await api.close();
  }
}

test('without a workspace /sidecar answers 501 and says how to turn it on', async () => {
  await withApi({}, async (api) => {
    const res = await request(api, { path: '/sidecar/page' });
    assert.equal(res.status, 501);
    assert.equal(json(res).code, 'workspace_not_configured');
    assert.match(json(res).message, /--workspace/);
  });
});

test('GET and PUT /sidecar/<name> load and save in the workspace', async () => {
  const dir = freshDir();
  await withApi({ workspace: dir }, async (api) => {
    assert.deepEqual(json(await request(api, { path: '/sidecar/page' })), { ok: true, exists: false, sidecar: null });
    const doc = sidecar({ card: { attrs: { width: 120 } } });
    const saved = await put(api, 'page', { sidecar: doc });
    assert.equal(saved.status, 200);
    assert.deepEqual(json(saved), { ok: true, file: 'page.lvgl.json', bytes: json(saved).bytes });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'page.lvgl.json'), 'utf8')), doc);
    assert.deepEqual(json(await request(api, { path: '/sidecar/page' })), { ok: true, exists: true, sidecar: doc });
  });
});

test('PUT /sidecar rejects bad input with a stable code and writes nothing', async () => {
  const dir = freshDir();
  await withApi({ workspace: dir }, async (api) => {
    const invalid = await put(api, 'page', { sidecar: { version: 3, nodes: [] } });
    assert.equal(invalid.status, 422);
    assert.equal(json(invalid).code, 'sidecar_invalid');
    assert.ok(json(invalid).errors.length >= 2);
    assert.equal((await put(api, 'page', {})).status, 400);
    assert.equal(json(await put(api, 'page', {})).code, 'missing_sidecar');
    for (const bad of ['a%2Fb', 'a%5Cb', 'a.b', '%', 'x%00y', '.hidden']) {
      const res = await put(api, bad, { sidecar: sidecar({}) });
      assert.equal(res.status, 400, bad);
      assert.equal(json(res).code, 'invalid_sidecar_name', bad);
    }
    // Dot segments are collapsed by URL parsing before routing: not a sidecar route at all.
    for (const dots of ['..', '%2e%2e', '.']) {
      const res = await put(api, dots, { sidecar: sidecar({}) });
      assert.notEqual(res.status, 200, dots);
    }
    const text = await request(api, { method: 'PUT', path: '/sidecar/page', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(text.status, 415, 'a simple cross-site form post cannot write');
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('PUT /sidecar from a foreign origin or a rebinding host is refused', async () => {
  const dir = freshDir();
  await withApi({ workspace: dir }, async (api) => {
    const foreign = await put(api, 'page', { sidecar: sidecar({}) }, { Origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal(json(foreign).code, 'origin_not_allowed');
    const rebinding = await put(api, 'page', { sidecar: sidecar({}) }, { Host: 'evil.example' });
    assert.equal(rebinding.status, 403);
    assert.equal(json(rebinding).code, 'host_not_allowed');
    const local = await put(api, 'page', { sidecar: sidecar({}) }, { Origin: 'http://localhost:5173' });
    assert.equal(local.status, 200, 'the editor dev server origin is allowed');
    assert.equal(local.headers['access-control-allow-origin'], 'http://localhost:5173');
  });
  assert.deepEqual(readdirSync(dir), ['page.lvgl.json'], 'only the allowed write happened');
});

test('/sidecar accepts only GET and PUT, and the preflight allows PUT', async () => {
  await withApi({ workspace: freshDir() }, async (api) => {
    assert.equal((await request(api, { method: 'POST', path: '/sidecar/page', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
    assert.equal((await request(api, { method: 'DELETE', path: '/sidecar/page' })).status, 405);
    const preflight = await request(api, { method: 'OPTIONS', path: '/sidecar/page', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers['access-control-allow-methods'], /PUT/);
  });
});

test('a stored sidecar that is corrupt comes back as sidecar_invalid with the problems', async () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'page.lvgl.json'), JSON.stringify({ version: 1, nodes: { a: { remove: 'x' } } }));
  await withApi({ workspace: dir }, async (api) => {
    const res = await request(api, { path: '/sidecar/page' });
    assert.equal(res.status, 422);
    assert.equal(json(res).code, 'sidecar_invalid');
    assert.match(json(res).errors[0], /remove/);
  });
});

/* ------------------------------------------------------ render with sidecar */

/** A render program that keeps a copy of every page XML it is given, so a test can read what was rendered. */
function recordingProgram() {
  const dir = freshDir();
  const file = join(dir, 'fake-render.cjs');
  writeFileSync(file, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.copyFileSync(process.argv[2], path.join(${JSON.stringify(dir)}, 'last-page.xml'));
const w = 320, h = 240, stride = w * 3, buf = Buffer.alloc(54 + stride * h);
buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
fs.writeFileSync(process.argv[3], buf);
const boxes = process.argv.find((a) => a.startsWith('--boxes='));
if (boxes) fs.writeFileSync(boxes.slice(8), JSON.stringify({ boxes: [
  { name: 'card', x: 0, y: 0, width: 5, height: 5, depth: 1, hidden: false },
  { name: 'stop', x: 0, y: 0, width: 5, height: 5, depth: 1, hidden: false },
] }));
`);
  chmodSync(file, 0o755);
  return { file, lastXml: () => readFileSync(join(dir, 'last-page.xml'), 'utf8') };
}

test('a sidecar is applied to the IR before rendering: attributes change, removed nodes disappear', async () => {
  const program = recordingProgram();
  const renderer = createRenderProgramRenderer({ binary: program.file });
  const plain = await renderer.render({ ir: dashboard });
  const xmlPlain = program.lastXml();
  assert.match(xmlPlain, /name="stop"/);
  assert.match(xmlPlain, /name="card"[^>]*width="114"/);

  const edited = await renderer.render({ ir: dashboard, sidecar: sidecar({ card: { attrs: { width: 200 } }, stop: { remove: true } }) });
  const xml = program.lastXml();
  assert.match(xml, /name="card"[^>]*width="200"/);
  assert.doesNotMatch(xml, /name="stop"/, 'the removed widget and its subtree are gone');
  assert.doesNotMatch(xml, /name="stop_2"/);
  assert.notEqual(edited.cached, true, 'a different sidecar is a different render, not a cache hit');
  // boxes are limited to widgets that still exist
  assert.deepEqual(edited.boxes.map((b) => b.name), ['card']);
  assert.deepEqual(plain.boxes.map((b) => b.name), ['card', 'stop']);
});

test('the sidecar is part of the cache key; an empty or null one is the same as none', async () => {
  const size = { width: 320, height: 240 };
  const none = renderCacheKey({ ir: dashboard, size });
  assert.equal(none, renderCacheKey({ ir: dashboard, size, sidecar: null }));
  assert.notEqual(none, renderCacheKey({ ir: dashboard, size, sidecar: sidecar({ card: { remove: true } }) }));
  assert.notEqual(
    renderCacheKey({ ir: dashboard, size, sidecar: sidecar({ card: { attrs: { width: 1 } } }) }),
    renderCacheKey({ ir: dashboard, size, sidecar: sidecar({ card: { attrs: { width: 2 } } }) }),
  );
});

test('an override that targets a missing widget renders anyway and reports a warning', async () => {
  const program = recordingProgram();
  const renderer = createRenderProgramRenderer({ binary: program.file });
  const result = await renderer.render({ ir: dashboard, sidecar: sidecar({ nope: { attrs: { width: 1 } } }) });
  assert.ok(result.diagnostics.some((d) => d.level === 'warning' && /no generated widget has that name/.test(d.message)));
});

test('an invalid sidecar is invalid_sidecar with every problem, before any render starts', async () => {
  const program = recordingProgram();
  const renderer = createRenderProgramRenderer({ binary: program.file });
  await assert.rejects(renderer.render({ ir: dashboard, sidecar: { version: 2, nodes: [] } }), (e) => e instanceof RenderError && e.code === 'invalid_sidecar' && e.errors.length === 2);
  assert.equal(existsSync(program.file.replace('fake-render.cjs', 'last-page.xml')), false, 'the program never ran');
});

test('a sidecar cannot smuggle a file reference past the IR safety check', async () => {
  const program = recordingProgram();
  const renderer = createRenderProgramRenderer({ binary: program.file });
  for (const attrs of [{ style_bg_image_src: 'A:/etc/passwd' }, { src: '/etc/passwd' }, { file: '../../secret' }]) {
    await assert.rejects(
      renderer.render({ ir: dashboard, sidecar: sidecar({ card: { attrs } }) }),
      (e) => e.code === 'unsafe_file_reference',
      JSON.stringify(attrs),
    );
  }
});

test('POST /render takes the sidecar; a bad one is a 422 invalid_sidecar', async () => {
  const program = recordingProgram();
  await withApi({ renderer: createRenderProgramRenderer({ binary: program.file }) }, async (api) => {
    const ok = await request(api, {
      method: 'POST', path: '/render?format=json', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ir: dashboard, sidecar: sidecar({ card: { attrs: { width: 77 } } }) }),
    });
    assert.equal(ok.status, 200);
    assert.match(program.lastXml(), /name="card"[^>]*width="77"/);
    const bad = await request(api, {
      method: 'POST', path: '/render?format=json', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ir: dashboard, sidecar: { version: 1, nodes: { card: { remove: 1 } } } }),
    });
    assert.equal(bad.status, 422);
    assert.equal(json(bad).code, 'invalid_sidecar');
  });
});

test('what the editor saves is what --from-ir applies: the same sidecar gives the same XML as the render path', async () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'dashboard.ir.json'), dashboardText);
  const doc = sidecar({ card: { attrs: { width: 200 } }, stop: { remove: true } });
  await withApi({ workspace: dir }, async (api) => {
    assert.equal((await put(api, 'dashboard', { sidecar: doc })).status, 200);
  });
  // The CLI finds dashboard.lvgl.json next to dashboard.ir.json by itself.
  const out = join(dir, 'out');
  const run = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), '--from-ir', join(dir, 'dashboard.ir.json'), '-o', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const cliXml = readFileSync(join(out, 'dashboard.xml'), 'utf8');

  const program = recordingProgram();
  await createRenderProgramRenderer({ binary: program.file }).render({ ir: dashboard, sidecar: doc });
  assert.equal(program.lastXml(), cliXml, 'the editor preview renders exactly the XML the CLI generates from the saved sidecar');
});

test('CLI: --preview-api --workspace rejects a directory that does not exist', () => {
  const run = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), '--preview-api', '--port', '0', '--workspace', join(scratch, 'no-such-dir')], { encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--workspace: cannot use .*no-such-dir/);
});
