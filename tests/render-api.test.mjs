/**
 * Render API (src/render-api.mjs): the Renderer contract, the render-program
 * implementation (exercised with small fake programs so no LVGL is needed),
 * and the HTTP server. One real render runs when a render program exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  RenderError, createRenderProgramRenderer, startPreviewApi, bmpToPng, findRenderBinary, renderCacheKey, findFileReferences, RENDER_BINARY_ENV,
} from '../src/render-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = JSON.parse(readFileSync(join(here, 'golden-editor', 'ir_dashboard.json'), 'utf8'));
/** A distinct but valid IR per `n` (the cache key must differ). */
const irVariant = (n) => {
  const ir = structuredClone(dashboard);
  ir.view.attrs.style_bg_color = `0x${(0x100000 + n).toString(16)}`;
  return ir;
};

const scratch = mkdtempSync(join(tmpdir(), 'render-api-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
const freshDir = () => mkdtempSync(join(scratch, 't'));

/** A 4x2 red BMP as the fake program's output (24-bit, bottom-up, row padding). */
const BMP_JS = `
const w = 320, h = 240, stride = w * 3, buf = Buffer.alloc(54 + stride * h);
buf.write('BM'); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22); buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * stride + x * 3; buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 255; }
require('fs').writeFileSync(process.argv[3], buf);
`;

/** Write an executable fake render program; `body` runs before it writes the BMP. */
function fakeProgram(body = '', { writeBmp = true } = {}) {
  const dir = freshDir();
  const file = join(dir, 'fake-render.cjs');
  writeFileSync(file, `#!/usr/bin/env node\nconst fs = require('fs');\n${body}\n${writeBmp ? BMP_JS : ''}`);
  chmodSync(file, 0o755);
  return { file, dir, log: join(dir, 'calls.log') };
}
const logCall = (log) => `fs.appendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n');`;
const calls = (log) => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);

/** A renderer that never needs LVGL: fixed PNG, records requests. */
function fakeRenderer({ fail } = {}) {
  const { png } = bmpToPng(Buffer.from((() => { const b = Buffer.alloc(54 + 16); b.write('BM'); b.writeUInt32LE(54, 10); b.writeInt32LE(2, 18); b.writeInt32LE(2, 22); b.writeUInt16LE(24, 28); return b; })()));
  const seen = [];
  return {
    seen,
    png,
    stats: { cacheHits: 0, cacheMisses: 0, rendering: 0, queued: 0 },
    async render(request) {
      seen.push(request);
      if (fail) throw fail;
      return { png, width: 2, height: 2, diagnostics: [{ level: 'info', message: 'fake' }] };
    },
  };
}

async function withServer(options, fn) {
  const api = await startPreviewApi({ port: 0, ...options });
  try {
    return await fn(api);
  } finally {
    await api.close();
  }
}

/** Raw request so tests can set Host/Origin/headers freely. */
function request(api, { method = 'GET', path = '/', headers = {}, body, chunked = false }) {
  return new Promise((ok, bad) => {
    const req = http.request({ host: '127.0.0.1', port: api.port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? ok({ status: 'reset', headers: {}, body: Buffer.alloc(0) }) : bad(err)));
    if (body !== undefined) {
      if (chunked) { req.write(body.slice(0, body.length / 2)); req.write(body.slice(body.length / 2)); }
      else req.write(body);
    }
    req.end();
  });
}
const postJson = (api, path, value, headers = {}) =>
  request(api, { method: 'POST', path, headers: { 'Content-Type': 'application/json', ...headers }, body: typeof value === 'string' ? value : JSON.stringify(value) });
const json = (res) => JSON.parse(res.body.toString('utf8'));

/* ------------------------------------------------------------- png / bmp */

test('bmpToPng writes a valid truecolour PNG with the BMP pixels (bottom-up rows flipped, BGR swapped)', () => {
  // 2x2: bottom row (stored first) red, green; top row blue, white. Row stride 8 (6 + 2 pad).
  const bmp = Buffer.alloc(54 + 16);
  bmp.write('BM'); bmp.writeUInt32LE(54, 10); bmp.writeInt32LE(2, 18); bmp.writeInt32LE(2, 22); bmp.writeUInt16LE(24, 28);
  Buffer.from([0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0]).copy(bmp, 54);
  const { png, width, height } = bmpToPng(bmp);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(width, 2); assert.equal(height, 2);
  assert.equal(png.readUInt32BE(16), 2);
  const raw = inflateSync(png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8));
  // top row first: blue, white; then red, green
  assert.deepEqual([...raw], [0, 0, 0, 255, 255, 255, 255, 0, 255, 0, 0, 0, 255, 0]);
});

test('bmpToPng rejects non-BMP and unsupported bit depths with render_output_invalid', () => {
  assert.throws(() => bmpToPng(Buffer.from('nope')), (e) => e.code === 'render_output_invalid');
  const b = Buffer.alloc(60); b.write('BM'); b.writeInt32LE(1, 18); b.writeInt32LE(1, 22); b.writeUInt16LE(32, 28);
  assert.throws(() => bmpToPng(b), /expected 24-bit/);
});

/* ------------------------------------------------- Renderer via fake program */

/** Program that logs the page path it was given, then runs `extra`. */
function loggingProgram(extra = '') {
  const p = fakeProgram('');
  const body = `${logCall(p.log)}\n${extra}`;
  writeFileSync(p.file, readFileSync(p.file, 'utf8').replace("const fs = require('fs');\n", `const fs = require('fs');\n${body}\n`));
  return p;
}

test('render program renderer: IR -> png, and an unchanged IR is a cache hit (program runs once)', async () => {
  const p = loggingProgram();
  const renderer = createRenderProgramRenderer({ binary: p.file });
  const a = await renderer.render({ ir: dashboard });
  assert.equal(a.width, 320); assert.equal(a.height, 240);
  assert.equal(a.png.subarray(1, 4).toString(), 'PNG');
  assert.ok(Array.isArray(a.diagnostics));
  const b = await renderer.render({ ir: structuredClone(dashboard) });
  assert.equal(b.cached, true);
  assert.deepEqual(b.png, a.png);
  assert.equal(calls(p.log).length, 1);
  assert.deepEqual([renderer.stats.cacheHits, renderer.stats.cacheMisses], [1, 1]);
  // a different IR, and the same IR as JSON text with another key order, behave as expected
  await renderer.render({ ir: irVariant(1) });
  assert.equal(calls(p.log).length, 2);
  const reordered = JSON.stringify({ view: dashboard.view, name: dashboard.name, format: dashboard.format, irVersion: dashboard.irVersion, screenMode: dashboard.screenMode, subjects: dashboard.subjects, timelines: dashboard.timelines, assets: dashboard.assets });
  assert.equal((await renderer.render({ ir: reordered })).cached, true);
});

test('cache key covers ir, size and fonts', () => {
  const size = { width: 320, height: 240 };
  const base = renderCacheKey({ ir: dashboard, size });
  assert.equal(base, renderCacheKey({ ir: structuredClone(dashboard), size }));
  assert.notEqual(base, renderCacheKey({ ir: irVariant(2), size }));
  assert.notEqual(base, renderCacheKey({ ir: dashboard, size: { width: 100, height: 100 } }));
  assert.notEqual(base, renderCacheKey({ ir: dashboard, size, fonts: [{ key: 'f', path: 'f.bin' }] }));
});

test('cache evicts the oldest entry past cacheSize and never keeps a failure', async () => {
  const p = loggingProgram();
  const renderer = createRenderProgramRenderer({ binary: p.file, cacheSize: 1 });
  await renderer.render({ ir: irVariant(1) });
  await renderer.render({ ir: irVariant(2) });
  await renderer.render({ ir: irVariant(1) }); // evicted, renders again
  assert.equal(calls(p.log).length, 3);

  const bad = loggingProgram('process.exit(1);');
  const r2 = createRenderProgramRenderer({ binary: bad.file });
  await assert.rejects(r2.render({ ir: dashboard }));
  await assert.rejects(r2.render({ ir: dashboard }));
  assert.equal(calls(bad.log).length, 2, 'a failed render must not be cached');
});

test('concurrency limit: renders never overlap beyond the limit, extra requests queue, a full queue is render_queue_full', async () => {
  // Track overlap with marker files: each running program registers itself in a lock directory.
  const p = fakeProgram();
  const lock = freshDir();
  writeFileSync(p.file, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const lock = ${JSON.stringify(lock)};
const me = path.join(lock, String(process.pid));
fs.writeFileSync(me, '');
const running = fs.readdirSync(lock).length;
fs.appendFileSync(${JSON.stringify(p.log)}, running + '\\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
fs.unlinkSync(me);
${BMP_JS}`);
  const renderer = createRenderProgramRenderer({ binary: p.file, concurrency: 1, maxQueue: 2 });
  const results = await Promise.allSettled([1, 2, 3, 4].map((n) => renderer.render({ ir: irVariant(n) })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'render_queue_full');
  assert.ok(calls(p.log).every((n) => n === '1'), `programs overlapped: ${calls(p.log)}`);
});

test('timeout kills the render program and reports render_timeout', async () => {
  const pidFile = join(freshDir(), 'pid');
  const p = fakeProgram(`fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`, { writeBmp: false });
  const renderer = createRenderProgramRenderer({ binary: p.file, timeoutMs: 400 });
  const started = Date.now();
  await assert.rejects(renderer.render({ ir: dashboard }), (e) => e.code === 'render_timeout' && /400 ms/.test(e.message));
  assert.ok(Date.now() - started < 5000);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise((ok) => setTimeout(ok, 100));
  assert.throws(() => process.kill(pid, 0), (e) => e.code === 'ESRCH', 'the child must be dead');
});

test('the per-call temp directory is removed after success and after failure', async () => {
  const before = () => readdirSync(tmpdir()).filter((n) => n.startsWith('html2lvgl-render-')).length;
  const base = before();
  const ok = loggingProgram();
  await createRenderProgramRenderer({ binary: ok.file }).render({ ir: dashboard });
  const pageDir = dirname(calls(ok.log)[0]);
  assert.equal(existsSync(pageDir), false);
  const bad = loggingProgram('process.exit(3);');
  await assert.rejects(createRenderProgramRenderer({ binary: bad.file }).render({ ir: dashboard }));
  assert.equal(existsSync(dirname(calls(bad.log)[0])), false);
  assert.equal(before(), base);
});

test('render program failures map to stable codes with the harness message', async () => {
  const cases = [
    ['process.stderr.write("error: LVGL ran out of memory (LV_MEM_SIZE is 65536 bytes)\\n"); process.exit(2);', 'render_out_of_memory', /LV_MEM_SIZE/],
    ['process.stderr.write("error: LVGL assertion failed (most often the heap is full)\\n"); process.exit(2);', 'render_assertion', /assertion failed/],
    ['process.kill(process.pid, "SIGSEGV");', 'render_crashed', /SIGSEGV/],
    ['process.stderr.write("failed to instantiate XML component\\n"); process.exit(1);', 'render_failed', /instantiate XML component/],
    ['', 'render_output_invalid', /wrote no image/],
  ];
  for (const [body, code, message] of cases) {
    const p = fakeProgram(body, { writeBmp: false });
    await assert.rejects(createRenderProgramRenderer({ binary: p.file }).render({ ir: dashboard }), (e) => e instanceof RenderError && e.code === code && message.test(e.message), code);
  }
});

test('a missing render program is render_binary_missing with the build command', async () => {
  const renderer = createRenderProgramRenderer({ binary: join(freshDir(), 'nope') });
  await assert.rejects(renderer.render({ ir: dashboard }), (e) => e.code === 'render_binary_missing' && /cmake -S spike\/render -B spike\/build/.test(e.message));
});

test('bad IR is invalid_ir with every problem listed; the program is not started', async () => {
  const p = loggingProgram();
  const renderer = createRenderProgramRenderer({ binary: p.file });
  const bad = structuredClone(dashboard); bad.name = 'has space'; bad.screenMode = 'yes';
  await assert.rejects(renderer.render({ ir: bad }), (e) => e.code === 'invalid_ir' && e.errors.length === 2);
  await assert.rejects(renderer.render({ ir: '{nope' }), (e) => e.code === 'invalid_ir' && /not valid JSON/.test(e.message));
  assert.equal(calls(p.log).length, 0);
});

test('a size the program is not compiled for is size_unsupported', async () => {
  const renderer = createRenderProgramRenderer({ binary: loggingProgram().file });
  await assert.rejects(renderer.render({ ir: dashboard, size: { width: 640, height: 480 } }), (e) => e.code === 'size_unsupported' && /320x240/.test(e.message));
});

test('findRenderBinary: explicit path, then env var, then spike/build/render; a wrong explicit path is not replaced', () => {
  const p = fakeProgram();
  const other = fakeProgram();
  assert.equal(findRenderBinary({ binary: p.file, env: {} }), p.file);
  assert.equal(findRenderBinary({ env: { [RENDER_BINARY_ENV]: other.file }, cwd: p.dir }), other.file);
  assert.equal(findRenderBinary({ binary: join(p.dir, 'missing'), env: { [RENDER_BINARY_ENV]: other.file } }), null);
  assert.equal(findRenderBinary({ env: {}, cwd: freshDir() }), null);
});

/* ------------------------------------------------------- file references */

test('file-bearing attributes with path-like values are rejected; text content is not', () => {
  const node = (attrs) => ({ tag: 'view', attrs, children: [] });
  for (const v of ['A:/etc/passwd', '/etc/passwd', '../../secret.png', 'C:\\x.png', '~/x.png', 'file:///etc/passwd', 'a/../../b']) {
    assert.equal(findFileReferences(node({ src: v })).length, 1, v);
  }
  assert.equal(findFileReferences(node({ style_bg_image_src: '/x.png' })).length, 1);
  assert.equal(findFileReferences(node({ text: '/month', src: 'logo' })).length, 0);
});

test('a path-like value in the IR never reaches the render program or a file read', async () => {
  const p = loggingProgram();
  const secret = join(freshDir(), 'secret.png');
  writeFileSync(secret, 'secret');
  const evil = structuredClone(dashboard);
  evil.view.children.push({ tag: 'image', attrs: { name: 'evil', src: `A:${secret}` }, children: [] });
  const renderer = createRenderProgramRenderer({ binary: p.file });
  await assert.rejects(renderer.render({ ir: evil }), (e) => e.code === 'unsafe_file_reference' && e.errors[0].includes(secret));
  assert.equal(calls(p.log).length, 0);
  await withServer({ renderer }, async (api) => {
    const res = await postJson(api, '/render', { ir: evil });
    assert.equal(res.status, 422);
    assert.equal(json(res).code, 'unsafe_file_reference');
    assert.ok(!res.body.toString().includes('secret</') && !res.body.includes(Buffer.from('secret\u0000')));
    // validate reports it too
    const v = json(await postJson(api, '/ir/validate', { ir: evil }));
    assert.equal(v.ok, false);
    assert.match(v.errors[0], /filesystem path/);
  });
});

test('the server ignores request fields that would name files (fonts, components, path)', async () => {
  const renderer = fakeRenderer();
  await withServer({ renderer }, async (api) => {
    const res = await postJson(api, '/render', { ir: dashboard, fonts: [{ key: 'x', path: '/etc/passwd' }], components: { a: '<x/>' }, path: '/etc/passwd' });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(renderer.seen[0]).sort(), ['ir', 'size']);
  });
});

/* ------------------------------------------------------------------ server */

test('POST /render returns image/png with size headers; ?format=json returns base64 plus diagnostics', async () => {
  const renderer = fakeRenderer();
  await withServer({ renderer }, async (api) => {
    const res = await postJson(api, '/render', { ir: dashboard, size: { width: 320, height: 240 } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['x-render-width'], '2');
    assert.deepEqual(res.body, renderer.png);
    assert.deepEqual(renderer.seen[0].size, { width: 320, height: 240 });
    const j = json(await postJson(api, '/render?format=json', { ir: dashboard }));
    assert.equal(j.ok, true);
    assert.equal(Buffer.from(j.png, 'base64').compare(renderer.png), 0);
    assert.deepEqual(j.diagnostics, [{ level: 'info', message: 'fake' }]);
    assert.equal(renderer.seen[1].size, undefined);
  });
});

test('error codes and bodies: 400, 413, 415, 422, 503, 504, 500, 404, 405', async () => {
  const renderer = fakeRenderer();
  await withServer({ renderer, maxBodyBytes: 65536 }, async (api) => {
    const cases = [
      [await postJson(api, '/render', '{nope'), 400, 'invalid_json'],
      [await postJson(api, '/render', '[1]'), 400, 'invalid_json'],
      [await postJson(api, '/render', {}), 400, 'missing_ir'],
      [await postJson(api, '/render', { ir: dashboard, size: { width: 0, height: 5 } }), 400, 'invalid_size'],
      [await postJson(api, '/render', { ir: dashboard, size: { width: 1.5, height: 5 } }), 400, 'invalid_size'],
      [await request(api, { method: 'POST', path: '/render', headers: { 'Content-Type': 'text/plain' }, body: 'x' }), 415, 'unsupported_media_type'],
      [await postJson(api, '/render', { ir: 'x'.repeat(70000) }), 413, 'body_too_large'],
      [await request(api, { method: 'GET', path: '/nope' }), 404, 'not_found'],
      [await request(api, { method: 'GET', path: '/render' }), 405, 'method_not_allowed'],
    ];
    for (const [res, status, code] of cases) {
      assert.equal(res.status, status, code);
      const body = json(res);
      assert.equal(body.ok, false);
      assert.equal(body.code, code);
      assert.ok(body.message.length > 10, 'descriptive message');
    }
  });
  const failures = [
    [new RenderError('invalid_ir', 'invalid IR: x', { errors: ['x'] }), 422],
    [new RenderError('size_unsupported', 'nope'), 422],
    [new RenderError('render_binary_missing', 'no binary; build it'), 503],
    [new RenderError('render_queue_full', 'busy'), 503],
    [new RenderError('render_timeout', 'too slow'), 504],
    [new RenderError('render_out_of_memory', 'oom'), 500],
    [new Error('boom'), 500],
  ];
  for (const [err, status] of failures) {
    await withServer({ renderer: fakeRenderer({ fail: err }) }, async (api) => {
      const res = await postJson(api, '/render', { ir: dashboard });
      assert.equal(res.status, status, err.message);
      const body = json(res);
      assert.equal(body.code, err.code ?? 'render_failed');
      assert.equal(body.message, err.message);
      if (err.errors) assert.deepEqual(body.errors, err.errors);
    });
  }
});

test('the body cap holds without a Content-Length too (chunked upload)', async () => {
  await withServer({ renderer: fakeRenderer(), maxBodyBytes: 1000 }, async (api) => {
    const res = await request(api, { method: 'POST', path: '/render', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }, body: JSON.stringify({ ir: 'y'.repeat(3000) }), chunked: true });
    assert.ok(res.status === 413 || res.status === 'reset', String(res.status));
    if (res.status === 413) assert.equal(json(res).code, 'body_too_large');
  });
});

test('real invalid IR through the real renderer is a 422 invalid_ir with errors[]', async () => {
  const renderer = createRenderProgramRenderer({ binary: fakeProgram().file });
  await withServer({ renderer }, async (api) => {
    const res = await postJson(api, '/render', { ir: { format: 'html2lvgl-ir', irVersion: 1 } });
    assert.equal(res.status, 422);
    const body = json(res);
    assert.equal(body.code, 'invalid_ir');
    assert.ok(body.errors.length >= 1);
  });
});

test('timeout through the server is a 504 render_timeout', async () => {
  const p = fakeProgram('setInterval(() => {}, 1000);', { writeBmp: false });
  const renderer = createRenderProgramRenderer({ binary: p.file, timeoutMs: 300 });
  await withServer({ renderer }, async (api) => {
    const res = await postJson(api, '/render', { ir: dashboard });
    assert.equal(res.status, 504);
    assert.equal(json(res).code, 'render_timeout');
  });
});

test('CORS: localhost origins allowed, others denied, allowlist extends, preflight answered', async () => {
  await withServer({ renderer: fakeRenderer(), allowedOrigins: ['https://editor.example.com'] }, async (api) => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:5173', 'https://editor.example.com']) {
      const res = await request(api, { method: 'GET', path: '/health', headers: { Origin: origin } });
      assert.equal(res.status, 200, origin);
      assert.equal(res.headers['access-control-allow-origin'], origin);
    }
    for (const origin of ['https://evil.example.com', 'http://localhost.evil.com', 'http://localhost:5173.evil.com', 'null']) {
      const res = await request(api, { method: 'GET', path: '/health', headers: { Origin: origin } });
      assert.equal(res.status, 403, origin);
      assert.equal(json(res).code, 'origin_not_allowed');
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    }
    const post = await postJson(api, '/render', { ir: dashboard }, { Origin: 'https://evil.example.com' });
    assert.equal(post.status, 403);
    const pre = await request(api, { method: 'OPTIONS', path: '/render', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers['access-control-allow-methods'], /POST/);
    assert.match(pre.headers['access-control-allow-headers'], /Content-Type/i);
    const noOrigin = await request(api, { method: 'GET', path: '/health' });
    assert.equal(noOrigin.headers['access-control-allow-origin'], undefined);
  });
});

test('a non-loopback Host header (DNS rebinding) is refused on a loopback server', async () => {
  await withServer({ renderer: fakeRenderer() }, async (api) => {
    const res = await request(api, { method: 'GET', path: '/health', headers: { Host: 'evil.example.com' } });
    assert.equal(res.status, 403);
    assert.equal(json(res).code, 'host_not_allowed');
  });
});

test('binds to 127.0.0.1 by default', async () => {
  await withServer({ renderer: fakeRenderer() }, async (api) => {
    assert.equal(api.host, '127.0.0.1');
    assert.match(api.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

test('GET /health, GET /registry, POST /ir/validate', async () => {
  const renderer = fakeRenderer();
  await withServer({ renderer }, async (api) => {
    const health = json(await request(api, { path: '/health' }));
    assert.equal(health.ok, true);
    assert.deepEqual(Object.keys(health.renderer).sort(), ['cacheHits', 'cacheMisses', 'queued', 'rendering']);

    const reg = json(await request(api, { path: '/registry' }));
    const golden = JSON.parse(readFileSync(join(here, 'golden-editor', 'registry.json'), 'utf8'));
    assert.deepEqual(reg, golden, 'same export as --export-registry');

    const good = json(await postJson(api, '/ir/validate', { ir: dashboard }));
    assert.deepEqual(good, { ok: true, errors: [] });
    const bad = json(await postJson(api, '/ir/validate', { ir: { ...dashboard, irVersion: 99 } }));
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /irVersion/);
    const missing = await postJson(api, '/ir/validate', {});
    assert.equal(missing.status, 400);
    assert.equal(renderer.seen.length, 0, 'validation never renders');
  });
});

test('startPreviewApi requires a renderer with render()', async () => {
  await assert.rejects(startPreviewApi({ port: 0 }), /renderer/);
});

/* ---------------------------------------------------------- real render */

const realBinary = findRenderBinary();
test('real render of the exported dashboard IR (needs the LVGL render program)', {
  skip: realBinary ? false : `no render program: set ${RENDER_BINARY_ENV} or build one (cmake -S spike/render -B spike/build -DLVGL_DIR=<lvgl-9.4.0> && cmake --build spike/build -j)`,
}, async () => {
  const renderer = createRenderProgramRenderer({ binary: realBinary });
  await withServer({ renderer }, async (api) => {
    const res = await postJson(api, '/render', { ir: dashboard });
    assert.equal(res.status, 200, res.body.toString().slice(0, 300));
    assert.equal(res.body.subarray(1, 4).toString(), 'PNG');
    assert.equal(res.body.readUInt32BE(16), 320);
    assert.equal(res.body.readUInt32BE(20), 240);
    const raw = inflateSync(res.body.subarray(res.body.indexOf('IDAT') + 4, res.body.indexOf('IEND') - 8));
    const colours = new Set();
    for (let i = 0; i < raw.length; i += 997) colours.add(raw.readUIntBE(i, 3));
    assert.ok(colours.size > 5, `image looks blank (${colours.size} sampled values)`);
    const again = await postJson(api, '/render', { ir: dashboard });
    assert.equal(again.headers['x-render-cached'], 'hit');
    assert.deepEqual(again.body, res.body);
  });
});
