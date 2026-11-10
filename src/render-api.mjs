/**
 * Render API: turn an editor IR into a PNG, behind a swappable interface.
 *
 * Two layers, both importable without side effects:
 *
 * 1. `Renderer` (documented below) and `createRenderProgramRenderer()`, the
 *    first implementation. It does what `--watch` does today: emit LVGL XML
 *    from the IR (src/ir.mjs, no browser), run the native LVGL render program
 *    on it, and encode the framebuffer it writes as PNG.
 * 2. `startPreviewApi()`, a small node:http server exposing any `Renderer`.
 *
 * ## Why an interface
 *
 * A future LVGL WebAssembly renderer must be a drop-in: the server and its
 * tests only know `Renderer`. See the `Renderer` typedef for the exact
 * contract an implementation owes.
 *
 * ## Security model of the server
 *
 * The server only ever accepts IR JSON in a request body. It never reads a
 * file named by a request: there is no path parameter, no "load this file"
 * field and no static file serving, so path traversal and arbitrary file
 * reads have nothing to attach to. The one place LVGL itself could be told to
 * open a file is an image/asset attribute inside the IR (the render program
 * mounts a POSIX filesystem), so `assertNoFileReferences()` rejects any
 * `src`/`path`/`file`/`url`-style attribute that looks like a filesystem
 * path before anything is rendered. Fonts are NOT accepted from requests:
 * they are configured by the process that creates the renderer.
 * The server binds to 127.0.0.1, checks the Host header (DNS rebinding),
 * only answers CORS for localhost origins plus an explicit allowlist, and
 * caps the request body.
 */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { importIr, emitFromIr, validateIr, IrError } from './ir.mjs';
import { defaultRegistry } from './recognize.mjs';
import { exportRegistry } from './registry-export.mjs';
import { cachedRenderBinary, BUILD_HINT } from './render-build.mjs';

/* ------------------------------------------------------------------ types */

/**
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ key: string, path: string }} FontFile  A converted LVGL binary font and the name the XML refers to it by (render program `--font=key=path`).
 * @typedef {{ level: 'info' | 'warning' | 'error', message: string }} RenderDiagnostic
 * @typedef {{ png: Buffer, width: number, height: number, diagnostics: RenderDiagnostic[] }} RenderResult
 *
 * @typedef {object} RenderRequest
 * @property {object | string} ir          IR document (parsed object or JSON text), validated with importIr().
 * @property {Size} [size]                 Wanted display size; defaults to the IR's root view width/height, else the renderer's display size.
 * @property {FontFile[]} [fonts]          Extra fonts, for trusted in-process callers only (never taken from HTTP requests).
 * @property {Record<string, string>} [components]  Extra component XML by component name, registered before the page.
 *
 * @typedef {object} Renderer
 * The contract every renderer (LVGL render program today, WebAssembly later)
 * implements. An implementation must:
 *  - be safe to call concurrently (queue or limit internally) and never throw
 *    synchronously;
 *  - resolve to an 8-bit RGB(A) PNG whose `width`/`height` equal the PNG's;
 *  - reject with a `RenderError` carrying one of the codes below, so the HTTP
 *    layer can map failures without parsing messages;
 *  - treat `ir` as untrusted data: it must not read files the IR names;
 *  - release every resource (temp files, processes, wasm instances) on
 *    success AND failure, and stop work after `timeoutMs`.
 * @property {(request: RenderRequest) => Promise<RenderResult>} render
 * @property {() => Promise<void>} [close]  Optional: stop queued work, free resources.
 * @property {{ cacheHits: number, cacheMisses: number, rendering: number, queued: number }} [stats]  Optional counters (read live).
 */

/**
 * Stable error codes (HTTP status in parentheses when served):
 *  invalid_ir (422), unsafe_file_reference (422), size_unsupported (422),
 *  render_binary_missing (503), render_queue_full (503),
 *  render_timeout (504), render_out_of_memory (500), render_assertion (500),
 *  render_failed (500), render_crashed (500), render_output_invalid (500).
 */
export class RenderError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ errors?: string[], cause?: unknown }} [extra]
   */
  constructor(code, message, { errors, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RenderError';
    this.code = code;
    if (errors) this.errors = errors;
  }
}

/* -------------------------------------------------------------- locating */

export const DEFAULT_RENDER_BINARY = 'spike/build/render';
export const RENDER_BINARY_ENV = 'HTML2LVGL_RENDER_BIN';
/** The size the stock render program (spike/render/main.c HOR_RES x VER_RES) is compiled for. */
export const DEFAULT_DISPLAY_SIZE = Object.freeze({ width: 320, height: 240 });
const BUILD_COMMAND = BUILD_HINT;

/**
 * Find the render program: explicit path, then $HTML2LVGL_RENDER_BIN, then
 * `spike/build/render` under `cwd`, then the per-user cache that
 * `html2lvgl --build-render` fills. Returns null when none exists.
 *
 * @param {{ binary?: string, cwd?: string, env?: Record<string, string | undefined> }} [options]
 */
export function findRenderBinary({ binary, cwd = process.cwd(), env = process.env } = {}) {
  const candidates = [binary, env[RENDER_BINARY_ENV], join(cwd, DEFAULT_RENDER_BINARY), cachedRenderBinary({ env })].filter(Boolean);
  for (const c of candidates) {
    const p = resolve(cwd, c);
    if (existsSync(p)) return p;
    // An explicit path that does not exist is an error for the caller to see,
    // not something to paper over with a different binary.
    if (c === binary) return null;
  }
  return null;
}

/* ---------------------------------------------------------- IR hygiene */

/** Attribute names that can make LVGL open something: `src`, `style_bg_image_src`, `file`, `path`, `url`. */
const FILE_ATTR = /(^|_)(src|path|file|url)$/i;
/** LVGL filesystem prefix ("A:/x"), absolute and parent-relative paths, file: URLs, home dirs. */
const PATH_LIKE = /^(?:[A-Za-z]:|[\\/]|~|file:)|(?:^|[\\/])\.\.(?:[\\/]|$)/i;

/**
 * Reject IR that would make the render program read a file from the host.
 * Text content is untouched (a label may say "/month"); only file-bearing
 * attributes are inspected.
 *
 * @param {object} node
 * @param {string[]} [problems]
 * @param {string} [path]
 */
export function findFileReferences(node, problems = [], path = 'view') {
  for (const [key, value] of Object.entries(node?.attrs ?? {})) {
    if (typeof value === 'string' && FILE_ATTR.test(key) && PATH_LIKE.test(value.trim())) {
      problems.push(`${path}.attrs.${key}: "${value}" looks like a filesystem path`);
    }
  }
  (node?.children ?? []).forEach((c, i) => findFileReferences(c, problems, `${path}/${c?.tag ?? i}`));
  return problems;
}

function assertNoFileReferences(view) {
  const problems = findFileReferences(view);
  if (problems.length) {
    throw new RenderError(
      'unsafe_file_reference',
      `the IR references host files, which the preview never loads (${problems.join('; ')}); use asset names, not paths`,
      { errors: problems },
    );
  }
}

/* ------------------------------------------------------------- BMP -> PNG */

/**
 * Convert the render program's 24-bit bottom-up BMP to a PNG without a
 * browser. (spike/bmp2png.mjs drives Chromium, which a server must not
 * depend on; filter type 0 keeps pixels byte-identical to the BMP.)
 *
 * @param {Buffer} bmp
 * @returns {{ png: Buffer, width: number, height: number }}
 */
export function bmpToPng(bmp) {
  if (bmp.length < 54 || bmp.toString('latin1', 0, 2) !== 'BM') throw new RenderError('render_output_invalid', 'render program output is not a BMP file');
  const offset = bmp.readUInt32LE(10);
  const width = bmp.readInt32LE(18);
  const rawHeight = bmp.readInt32LE(22);
  const bpp = bmp.readUInt16LE(28);
  const height = Math.abs(rawHeight);
  if (bpp !== 24 || width <= 0 || height <= 0) throw new RenderError('render_output_invalid', `unsupported BMP (${width}x${rawHeight}, ${bpp} bpp); expected 24-bit`);
  const stride = Math.ceil((width * 3) / 4) * 4;
  if (bmp.length < offset + stride * height) throw new RenderError('render_output_invalid', 'render program output BMP is truncated');
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const srcRow = offset + stride * (rawHeight > 0 ? height - 1 - y : y); // positive height = bottom-up
    const dst = y * (width * 3 + 1);
    raw[dst] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[dst + 1 + x * 3] = bmp[srcRow + x * 3 + 2]; // R
      raw[dst + 2 + x * 3] = bmp[srcRow + x * 3 + 1]; // G
      raw[dst + 3 + x * 3] = bmp[srcRow + x * 3]; // B
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, width, height };
}

/* ------------------------------------------------------- queue + cache */

/** Run at most `limit` tasks at once; the rest wait (up to `maxQueue`). */
class Limiter {
  constructor(limit, maxQueue) {
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.running = 0;
    /** @type {Array<() => void>} */
    this.waiting = [];
  }
  get queued() { return this.waiting.length; }
  async run(task) {
    if (this.running >= this.limit) {
      if (this.waiting.length >= this.maxQueue) {
        throw new RenderError('render_queue_full', `render queue is full (${this.maxQueue} waiting, ${this.limit} running); retry shortly`);
      }
      await new Promise((ok) => this.waiting.push(ok));
    } else {
      this.running++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // hand the slot over without releasing it
      else this.running--;
    }
  }
}

/** Order-independent JSON for hashing: object keys sorted, so equal IRs share a cache entry. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Hash of everything that decides the picture: IR, size, fonts, extra components.
 * @param {RenderRequest & { size: Size }} request
 */
export function renderCacheKey({ ir, size, fonts = [], components = {} }) {
  const parsed = typeof ir === 'string' ? safeParse(ir) : ir;
  return createHash('sha256').update(canonicalJson({ ir: parsed, size, fonts, components })).digest('hex');
}
const safeParse = (text) => { try { return JSON.parse(text); } catch { return text; } };

/* ------------------------------------------- render-program implementation */

/** Which failure the harness reported, from its exit code and the messages it prints (spike/render/main.c). */
function classifyFailure(err, binary, timeoutMs) {
  const stderr = String(err.stderr ?? '').trim();
  if (err.code === 'ENOENT') {
    return new RenderError('render_binary_missing', `render program not found at ${binary}; ${BUILD_COMMAND}`);
  }
  if (err.killed && (err.signal === 'SIGKILL' || err.signal === 'SIGTERM')) {
    return new RenderError('render_timeout', `render program did not finish within ${timeoutMs} ms and was killed`);
  }
  if (/ran out of memory|couldn't allocate memory/i.test(stderr)) {
    return new RenderError('render_out_of_memory', `LVGL ran out of memory rendering this IR: ${stderr}`);
  }
  if (/assertion failed/i.test(stderr)) {
    return new RenderError('render_assertion', `LVGL assertion failed while rendering this IR: ${stderr}`);
  }
  if (typeof err.signal === 'string' && err.signal) {
    return new RenderError('render_crashed', `render program crashed (${err.signal}); the IR probably exhausts the LVGL heap or hits an LVGL bug${stderr ? `: ${stderr}` : ''}`);
  }
  return new RenderError('render_failed', `render program exited with code ${err.code}${stderr ? `: ${stderr}` : ''}`);
}

/**
 * The first Renderer: IR -> XML -> native LVGL render program -> PNG.
 *
 * @param {object} [options]
 * @param {string} [options.binary]       Render program path (default: $HTML2LVGL_RENDER_BIN, then `<cwd>/spike/build/render`).
 * @param {string} [options.cwd]          Base for relative paths (default process.cwd()).
 * @param {number} [options.timeoutMs]    Per-render limit; the child is SIGKILLed (default 30000).
 * @param {number} [options.concurrency]  Parallel render programs (default 2; each holds an LVGL heap plus a framebuffer).
 * @param {number} [options.maxQueue]     Waiting renders before render_queue_full (default 32).
 * @param {number} [options.cacheSize]    Cached results kept in memory, 0 disables (default 64).
 * @param {FontFile[]} [options.fonts]    Fonts always passed to the render program.
 * @param {Size} [options.displaySize]    What the binary is compiled for (default 320x240).
 * @returns {Renderer}
 */
export function createRenderProgramRenderer({
  binary,
  cwd = process.cwd(),
  timeoutMs = 30_000,
  concurrency = 2,
  maxQueue = 32,
  cacheSize = 64,
  fonts: defaultFonts = [],
  displaySize = DEFAULT_DISPLAY_SIZE,
} = {}) {
  const limiter = new Limiter(concurrency, maxQueue);
  /** @type {Map<string, Promise<RenderResult>>} insertion-ordered: oldest first */
  const cache = new Map();
  const stats = { cacheHits: 0, cacheMisses: 0, get rendering() { return limiter.running; }, get queued() { return limiter.queued; } };

  async function renderUncached(request, size) {
    const path = findRenderBinary({ binary, cwd });
    if (!path) {
      throw new RenderError('render_binary_missing',
        `render program not found${binary ? ` at ${resolve(cwd, binary)}` : ` (looked at $${RENDER_BINARY_ENV}, ${join(cwd, DEFAULT_RENDER_BINARY)} and ${cachedRenderBinary()})`}; ${BUILD_COMMAND}`);
    }
    let ir;
    try {
      ir = importIr(request.ir);
    } catch (err) {
      if (err instanceof IrError) throw new RenderError('invalid_ir', err.message, { errors: err.errors, cause: err });
      throw err;
    }
    assertNoFileReferences(ir.view);
    const { files, components } = emitFromIr(ir, { formats: ['xml'] });
    const extra = request.components ?? {};
    const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-render-'));
    try {
      const componentPaths = [];
      for (const [fileName, text] of [...Object.entries(files), ...Object.entries(extra).map(([n, t]) => [`${n}.xml`, t])]) {
        if (fileName === 'globals.xml') continue; // subjects only matter for C/Py; the render program does not load it
        // Names come from the IR validator / component registry, but a path
        // separator here would escape the temp dir, so check at the write.
        if (!/^[A-Za-z0-9_-]+\.xml$/.test(fileName)) throw new RenderError('invalid_ir', `component file name "${fileName}" is not a plain identifier`);
        const p = join(dir, fileName);
        writeFileSync(p, text);
        if (fileName !== `${ir.name}.xml`) componentPaths.push(p);
      }
      const bmpPath = join(dir, 'out.bmp');
      const fontArgs = [...defaultFonts, ...(request.fonts ?? [])].map((f) => `--font=${f.key}=${resolve(cwd, f.path)}`);
      const stdout = await new Promise((ok, fail) => {
        execFile(path, [join(dir, `${ir.name}.xml`), bmpPath, ...fontArgs, ...componentPaths],
          { timeout: timeoutMs, killSignal: 'SIGKILL', cwd: dir, maxBuffer: 1 << 20 },
          (err, out, errOut) => (err ? fail(classifyFailure(Object.assign(err, { stderr: errOut }), path, timeoutMs)) : ok({ out, errOut })));
      });
      let bmp;
      try {
        bmp = readFileSync(bmpPath);
      } catch (err) {
        throw new RenderError('render_output_invalid', 'render program exited successfully but wrote no image', { cause: err });
      }
      const { png, width, height } = bmpToPng(bmp);
      /** @type {RenderDiagnostic[]} */
      const diagnostics = String(stdout.errOut ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((message) => ({ level: 'warning', message }));
      return { png, width, height, diagnostics };
    } finally {
      rmSync(dir, { recursive: true, force: true }); // success and failure alike
    }
  }

  return {
    stats,
    async render(request) {
      // Everything cheap and deterministic is checked before the queue, so a
      // bad request never waits behind real renders.
      let parsed;
      try {
        parsed = typeof request.ir === 'string' ? JSON.parse(request.ir) : request.ir;
      } catch (err) {
        throw new RenderError('invalid_ir', `not valid JSON: ${err.message}`, { errors: [`not valid JSON: ${err.message}`] });
      }
      const { ok, errors } = validateIr(parsed);
      if (!ok) throw new RenderError('invalid_ir', `invalid IR: ${errors.join('; ')}`, { errors });
      const rootW = Number(parsed.view.attrs?.width);
      const rootH = Number(parsed.view.attrs?.height);
      const size = request.size ?? (Number.isInteger(rootW) && Number.isInteger(rootH) && rootW > 0 && rootH > 0 ? { width: rootW, height: rootH } : { ...displaySize });
      if (size.width !== displaySize.width || size.height !== displaySize.height) {
        throw new RenderError('size_unsupported',
          `this render program is compiled for ${displaySize.width}x${displaySize.height}; ${size.width}x${size.height} was requested (change HOR_RES/VER_RES in spike/render/main.c and rebuild, or use a renderer that supports the size)`);
      }
      const key = renderCacheKey({ ir: parsed, size, fonts: [...defaultFonts, ...(request.fonts ?? [])], components: request.components });
      const hit = cache.get(key);
      if (hit) {
        stats.cacheHits++;
        return hit.then((r) => ({ ...r, cached: true }));
      }
      stats.cacheMisses++;
      // Cache the promise, so identical requests arriving together share one render.
      const pending = limiter.run(() => renderUncached({ ...request, ir: parsed }, size));
      if (cacheSize > 0) {
        cache.set(key, pending);
        while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
        pending.catch(() => cache.delete(key)); // never cache a failure
      }
      return pending;
    },
    async close() { cache.clear(); },
  };
}

/* ------------------------------------------------------------------ server */

const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

/** @type {Record<string, number>} */
const STATUS_FOR_CODE = {
  invalid_ir: 422,
  unsafe_file_reference: 422,
  size_unsupported: 422,
  render_binary_missing: 503,
  render_queue_full: 503,
  render_timeout: 504,
};

/**
 * Start the preview HTTP API.
 *
 *   POST /render         {ir, size?}  -> image/png ; ?format=json -> {png: base64, width, height, diagnostics, cached}
 *   POST /ir/validate    {ir}         -> {ok, errors[]}
 *   GET  /registry                    -> the component registry export (src/registry-export.mjs)
 *   GET  /health                      -> {ok, renderer stats}
 *
 * Errors are `{ ok: false, code, message, errors? }` with a stable `code`.
 *
 * @param {object} options
 * @param {number} [options.port]            0 picks a free port (default 8787).
 * @param {string} [options.host]            Bind address (default 127.0.0.1; do not expose without a proxy that adds auth).
 * @param {Renderer} options.renderer
 * @param {string[]} [options.allowedOrigins]  Extra CORS origins besides localhost, e.g. ['https://editor.example.com'].
 * @param {number} [options.maxBodyBytes]    Request body cap (default 2 MiB).
 * @param {object} [options.registry]        Registry export served at /registry (default: core registry).
 * @returns {Promise<{ port: number, host: string, url: string, close: () => Promise<void> }>}
 */
export async function startPreviewApi({ port = 8787, host = '127.0.0.1', renderer, allowedOrigins = [], maxBodyBytes = DEFAULT_MAX_BODY_BYTES, registry } = {}) {
  if (!renderer || typeof renderer.render !== 'function') throw new TypeError('startPreviewApi needs a renderer with a render() method');
  const allowed = new Set(allowedOrigins);
  const loopbackOnly = /^(127\.|::1$|localhost$)/.test(host);
  let registryJson = null; // built on first use: the export walks every recognizer

  const originAllowed = (origin) => LOCAL_ORIGIN.test(origin) || allowed.has(origin);

  function sendJson(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(text);
  }
  const fail = (res, status, code, message, extra = {}, headers = {}) => sendJson(res, status, { ok: false, code, message, ...extra }, headers);

  /** Read the body up to the cap; rejects with {tooLarge:true} past it. */
  function readBody(req) {
    return new Promise((ok, bad) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBodyBytes) return bad({ tooLarge: true });
      const chunks = [];
      let size = 0;
      let overflowed = false;
      req.on('data', (c) => {
        if (overflowed) return; // keep draining so the 413 reaches the client before the socket closes
        size += c.length;
        if (size > maxBodyBytes) {
          overflowed = true;
          chunks.length = 0;
          bad({ tooLarge: true });
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => !overflowed && ok(Buffer.concat(chunks).toString('utf8')));
      req.on('error', bad);
    });
  }

  async function readJson(req, res, corsHeaders) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      fail(res, 415, 'unsupported_media_type', 'send the body as application/json', {}, corsHeaders);
      return undefined;
    }
    let text;
    try {
      text = await readBody(req);
    } catch (err) {
      if (err?.tooLarge) fail(res, 413, 'body_too_large', `request body exceeds the ${maxBodyBytes}-byte limit`, {}, { ...corsHeaders, Connection: 'close' });
      else fail(res, 400, 'bad_request', 'could not read the request body', {}, corsHeaders);
      return undefined;
    }
    try {
      const body = JSON.parse(text);
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('top level must be a JSON object');
      return body;
    } catch (err) {
      fail(res, 400, 'invalid_json', `request body is not valid JSON: ${err.message}`, {}, corsHeaders);
      return undefined;
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const origin = req.headers.origin;
      const cors = {};

      // DNS rebinding: a hostile page can point its own name at 127.0.0.1;
      // the Host header then names that site, which we refuse.
      if (loopbackOnly && !LOCAL_HOST.test(req.headers.host ?? '')) {
        return fail(res, 403, 'host_not_allowed', `Host "${req.headers.host}" is not a loopback name`);
      }
      if (origin !== undefined) {
        if (!originAllowed(origin)) {
          return fail(res, 403, 'origin_not_allowed', `origin "${origin}" is not allowed; start the server with allowedOrigins (--allow-origin) to add it`);
        }
        cors['Access-Control-Allow-Origin'] = origin;
        cors.Vary = 'Origin';
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        return res.end();
      }

      const route = url.pathname;
      const allowedMethod = { '/render': 'POST', '/ir/validate': 'POST', '/registry': 'GET', '/health': 'GET' }[route];
      if (!allowedMethod) return fail(res, 404, 'not_found', `no such endpoint: ${route}`, {}, cors);
      if (req.method !== allowedMethod) return fail(res, 405, 'method_not_allowed', `${route} accepts ${allowedMethod}`, {}, { ...cors, Allow: allowedMethod });

      if (route === '/health') {
        return sendJson(res, 200, { ok: true, renderer: renderer.stats ? { ...renderer.stats } : null }, cors);
      }

      if (route === '/registry') {
        registryJson ??= JSON.stringify(registry ?? exportRegistry(defaultRegistry));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
        return res.end(registryJson);
      }

      const body = await readJson(req, res, cors);
      if (body === undefined) return;

      if (route === '/ir/validate') {
        if (!('ir' in body)) return fail(res, 400, 'missing_ir', 'body must be {"ir": <IR document>}', {}, cors);
        const { ok, errors } = validateIr(body.ir);
        let all = errors;
        if (ok) {
          try {
            importIr(body.ir);
          } catch (err) {
            all = err instanceof IrError ? err.errors : [err.message];
          }
          all = [...all, ...findFileReferences(body.ir.view)];
        }
        return sendJson(res, 200, { ok: all.length === 0, errors: all }, cors);
      }

      // POST /render
      if (!('ir' in body)) return fail(res, 400, 'missing_ir', 'body must be {"ir": <IR document>, "size"?: {"width", "height"}}', {}, cors);
      let size;
      if (body.size !== undefined) {
        const s = body.size;
        const dim = (v) => Number.isInteger(v) && v >= 1 && v <= 4096;
        if (s === null || typeof s !== 'object' || !dim(s.width) || !dim(s.height)) {
          return fail(res, 400, 'invalid_size', 'size must be {"width": int, "height": int} with each between 1 and 4096', {}, cors);
        }
        size = { width: s.width, height: s.height };
      }
      let result;
      try {
        // Only `ir` and `size` are forwarded. Fonts and components are not
        // request fields: they would let a client name host files.
        result = await renderer.render({ ir: body.ir, size });
      } catch (err) {
        const code = err instanceof RenderError ? err.code : 'render_failed';
        const status = STATUS_FOR_CODE[code] ?? 500;
        return fail(res, status, code, err.message, err.errors ? { errors: err.errors } : {}, cors);
      }
      if (url.searchParams.get('format') === 'json') {
        return sendJson(res, 200, {
          ok: true,
          width: result.width,
          height: result.height,
          cached: Boolean(result.cached),
          diagnostics: result.diagnostics,
          png: result.png.toString('base64'),
        }, cors);
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': result.png.length,
        'Cache-Control': 'no-store',
        'X-Render-Width': String(result.width),
        'X-Render-Height': String(result.height),
        'X-Render-Cached': result.cached ? 'hit' : 'miss',
        ...cors,
      });
      res.end(result.png);
    } catch (err) {
      // Last resort: a bug here must be a JSON 500, never a crashed server.
      if (!res.headersSent) fail(res, 500, 'internal_error', err instanceof Error ? err.message : String(err));
      else res.destroy();
    }
  });

  await new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, host, ok);
  });
  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: boundPort,
    host,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${boundPort}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((ok) => server.close(ok));
      await renderer.close?.();
    },
  };
}
