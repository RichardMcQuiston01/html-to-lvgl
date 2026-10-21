/**
 * Watch mode: rebuild on save and serve a live side-by-side preview.
 *
 * Re-runs the normal pipeline (extract -> convert -> componentize for React)
 * whenever a source file changes, invokes the LVGL render harness to produce
 * a framebuffer, and serves a page showing the Chromium reference next to the
 * LVGL render with a fidelity score, converter warnings, and the generated
 * XML. Browsers connect over SSE and refresh themselves after each build.
 *
 * Uses only node: builtins — no extra dependencies, no bundler.
 */
import { createServer } from 'node:http';
import { watch, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, dirname, basename, extname, sep } from 'node:path';
import { extractPage } from './extract.mjs';
import { extractReactPage } from './extract-react.mjs';
import { convert } from './convert.mjs';
import { componentize } from './componentize.mjs';
import { render as renderXml } from './emit-xml.mjs';
import { planFonts, buildFonts, fontDiagnostics } from './fonts-build.mjs';
import { builtinFonts, customFonts } from './fonts.mjs';

const execFileAsync = promisify(execFile);

/** Only source edits trigger rebuilds — generated .xml/.c/.bmp must not. */
const SOURCE_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.jsx', '.ts', '.tsx']);
const DEBOUNCE_MS = 150;
const DEFAULT_RENDER_BIN = 'spike/build/render';
/** A hung harness must not wedge the rebuild loop forever. */
const RENDER_TIMEOUT_MS = 30_000;

export async function startPreview(input, options) {
  const { width, height, name, reactMode, outputDir, port = 8377 } = options;
  const renderBin = resolveRenderBin(options.renderBin);
  const webPng = join(outputDir, `${name}_web.png`);
  const lvglBmp = join(outputDir, `${name}_lvgl.bmp`);

  mkdirSync(outputDir, { recursive: true });

  let state = { status: 'building', version: 0, xml: '', warnings: [], error: null, render: null };
  const clients = new Set();

  function publish(next) {
    state = { ...state, ...next, version: state.version + 1 };
    for (const res of clients) res.write(`data: ${state.version}\n\n`);
  }

  async function build() {
    const started = Date.now();
    try {
      const extractor = reactMode ? extractReactPage : extractPage;
      const tree = await extractor(input, { width, height, screenshotPath: webPng });
      if (!tree) throw new Error('extraction produced no visible content');

      // Rebuild fonts each pass: editing the CSS can change which sizes and
      // weights the page needs.
      const { built, unresolved } = await buildFonts(planFonts(tree), join(outputDir, 'fonts'), {
        fontMap: options.fontMap ?? {},
        faces: tree.fontFaces ?? [],
        baseDir: dirname(resolve(input)),
        lvInclude: options.lvInclude,
      });
      const fonts = built.length ? customFonts(built) : builtinFonts();

      const { xml, view, diagnostics } = convert(tree, { name, fonts });
      for (const d of fontDiagnostics(unresolved)) diagnostics.add(d);
      let pageXml = xml;
      const componentPaths = [];
      if (reactMode) {
        const { view: pageView, components } = componentize(view, { diagnostics });
        pageXml = `<component>\n${renderXml(pageView, 1)}\n</component>\n`;
        for (const [cname, cxml] of components) {
          const p = join(outputDir, `${cname}.xml`);
          writeFileSync(p, cxml);
          componentPaths.push(p);
        }
      }
      const xmlPath = join(outputDir, `${name}.xml`);
      writeFileSync(xmlPath, pageXml);
      const warnings = diagnostics.toWarningStrings();

      let render = null;
      if (renderBin) {
        try {
          const fontArgs = built.map((f) => `--font=${f.key}=${resolve(f.binFile)}`);
          await execFileAsync(renderBin, [xmlPath, lvglBmp, ...fontArgs, ...componentPaths], {
            timeout: RENDER_TIMEOUT_MS,
            killSignal: 'SIGKILL',
          });
          render = { ok: true };
        } catch (err) {
          render = { ok: false, message: (err.stderr || err.message).trim() };
        }
      }

      publish({
        status: 'ready',
        xml: pageXml,
        warnings,
        error: null,
        render,
        ms: Date.now() - started,
      });
      log(`rebuilt in ${Date.now() - started}ms${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}`);
    } catch (err) {
      publish({ status: 'error', error: err.message, render: null });
      log(`build failed: ${err.message}`);
    }
  }

  await build();

  /* ------------------------------------------------------------ watching */
  const watchDir = dirname(resolve(input));
  const outAbs = resolve(outputDir);
  let timer = null;
  let building = false;
  let pending = false;

  async function trigger() {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    await build();
    building = false;
    if (pending) {
      pending = false;
      trigger();
    }
  }

  const watcher = watch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const full = resolve(watchDir, filename);
    // Ignore our own output — matching on a path boundary so a sibling
    // directory like `outdated/` next to `out/` is not swallowed too.
    if (full === outAbs || full.startsWith(outAbs + sep)) return;
    if (!SOURCE_EXT.has(extname(filename))) return;  // ignore generated artifacts
    clearTimeout(timer);
    timer = setTimeout(trigger, DEBOUNCE_MS);
  });

  /* -------------------------------------------------------------- server */
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/') return send(res, 200, 'text/html; charset=utf-8', pageHtml({ name, input, width, height, renderBin }));

    if (url === '/state') {
      return send(res, 200, 'application/json', JSON.stringify({
        status: state.status,
        version: state.version,
        warnings: state.warnings,
        error: state.error,
        render: state.render,
        ms: state.ms ?? null,
        xml: state.xml,
        // Whether a harness exists at all is separate from whether *this*
        // build rendered: a stale bitmap must never be shown or scored.
        hasRenderBin: Boolean(renderBin),
        renderOk: Boolean(state.render && state.render.ok),
      }));
    }

    if (url === '/web.png') return sendFile(res, webPng, 'image/png');
    if (url === '/lvgl.bmp') return sendFile(res, lvglBmp, 'image/bmp');

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${state.version}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    send(res, 404, 'text/plain', 'not found');
  });

  await new Promise((ok, fail) => {
    server.once('error', fail);
    // Loopback only: this serves generated XML, warnings, and render-harness
    // stderr with no auth, so it must never be reachable from the network.
    server.listen(port, '127.0.0.1', () => ok());
  });
  const boundPort = server.address().port; // port 0 lets the OS pick

  log(`preview at http://localhost:${boundPort}  (watching ${watchDir})`);
  if (!renderBin) {
    log('no render harness found — showing the web reference and XML only.');
    log('build one with: cmake -S spike/render -B spike/build -DLVGL_DIR=<lvgl-9.4.0> && cmake --build spike/build -j');
  }

  return {
    port: boundPort,
    address: server.address().address,
    close: async () => {
      watcher.close();
      for (const res of clients) res.end();
      await new Promise((ok) => server.close(ok));
    },
  };
}

/* ------------------------------------------------------------------ util */

function resolveRenderBin(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  return existsSync(DEFAULT_RENDER_BIN) ? DEFAULT_RENDER_BIN : null;
}

const log = (msg) => console.log(`[preview] ${msg}`);

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, path, type) {
  // existsSync + readFileSync would race a concurrent rebuild that replaces
  // or removes the file between the two calls, throwing inside the request
  // handler and crashing watch mode.
  let body;
  try {
    body = readFileSync(path);
  } catch {
    return send(res, 404, 'text/plain', 'not built');
  }
  send(res, 200, type, body);
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pageHtml({ name, input, width, height, renderBin }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>html2lvgl — ${escapeHtml(name)}</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#262b36; --fg:#e6edf3; --dim:#8b95a5; --ok:#3fb950; --warn:#d29922; --err:#f85149; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header { display:flex; align-items:baseline; gap:12px; padding:12px 16px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  h1 { font-size:15px; margin:0; font-weight:600; }
  .src { color:var(--dim); font-size:12px; font-family:ui-monospace, monospace; }
  #status { margin-left:auto; font-size:12px; }
  main { padding:16px; display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(340px, 1fr)); }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; min-width:0; }
  .panel h2 { font-size:12px; margin:0 0 10px; color:var(--dim); font-weight:600; letter-spacing:.04em; text-transform:uppercase; }
  .shot { display:block; image-rendering:pixelated; border:1px solid var(--line); border-radius:4px; background:#000; max-width:100%; }
  .row { display:flex; gap:16px; flex-wrap:wrap; }
  pre { margin:0; overflow:auto; max-height:340px; font-size:12px; font-family:ui-monospace, monospace; color:var(--dim); }
  ul { margin:0; padding-left:18px; }
  li { color:var(--warn); font-size:12px; }
  .empty { color:var(--dim); font-size:12px; }
  .err { color:var(--err); white-space:pre-wrap; font-family:ui-monospace, monospace; font-size:12px; }
  .score { font-size:22px; font-weight:600; }
  .hint { color:var(--dim); font-size:12px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
</style>
</head>
<body>
<header>
  <h1>html2lvgl preview</h1>
  <span class="src">${escapeHtml(input)} · ${width}×${height}</span>
  <span id="status"></span>
</header>
<main>
  <section class="panel">
    <h2>Render comparison</h2>
    <div class="row">
      <figure style="margin:0">
        <img id="web" class="shot" alt="Chromium reference">
        <figcaption class="hint">Chromium reference</figcaption>
      </figure>
      <figure style="margin:0">
        <img id="lvgl" class="shot" alt="LVGL render">
        <figcaption class="hint">LVGL v9.4</figcaption>
      </figure>
    </div>
    <p id="fidelity" class="hint" style="margin:12px 0 0"></p>
  </section>

  <section class="panel">
    <h2>Warnings</h2>
    <div id="warnings"></div>
  </section>

  <section class="panel" style="grid-column:1/-1">
    <h2>Generated XML</h2>
    <pre id="xml"></pre>
  </section>
</main>
<script>
const TOLERANCE = 32;

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}

function score() {
  const a = document.getElementById('web'), b = document.getElementById('lvgl');
  const out = document.getElementById('fidelity');
  if (!a.naturalWidth || !b.naturalWidth) { out.textContent = ''; return; }
  if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) {
    out.textContent = 'size mismatch — cannot score'; return;
  }
  const [x, y] = [pixels(a), pixels(b)];
  let match = 0;
  const total = a.naturalWidth * a.naturalHeight;
  for (let i = 0; i < total * 4; i += 4) {
    const d = Math.max(Math.abs(x[i]-y[i]), Math.abs(x[i+1]-y[i+1]), Math.abs(x[i+2]-y[i+2]));
    if (d <= TOLERANCE) match++;
  }
  const pct = (match / total * 100).toFixed(1);
  out.innerHTML = '<span class="score">' + pct + '%</span> <span class="hint">of pixels within tolerance ' + TOLERANCE + '</span>';
}

// Build messages carry source-derived text (page content, harness stderr),
// so they are only ever inserted as text nodes — never parsed as markup.
function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function showMessages(s) {
  const warn = document.getElementById('warnings');
  warn.replaceChildren();
  if (s.error) return warn.appendChild(textEl('div', 'err', s.error));
  if (s.render && !s.render.ok) {
    return warn.appendChild(textEl('div', 'err', 'render harness: ' + s.render.message));
  }
  if (!s.warnings.length) return warn.appendChild(textEl('p', 'empty', 'None.'));
  const list = document.createElement('ul');
  for (const w of s.warnings) list.appendChild(textEl('li', null, w));
  warn.appendChild(list);
}

async function refresh() {
  const s = await (await fetch('/state')).json();

  const status = document.getElementById('status');
  status.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = s.status === 'error' ? 'var(--err)' : 'var(--ok)';
  status.appendChild(dot);
  status.appendChild(document.createTextNode(
    s.status === 'error' ? 'build failed' : 'built' + (s.ms ? ' in ' + s.ms + 'ms' : '')
  ));

  showMessages(s);
  document.getElementById('xml').textContent = s.xml;

  const web = document.getElementById('web'), lvgl = document.getElementById('lvgl');
  const fidelity = document.getElementById('fidelity');

  // Only the current build's render may be shown or scored
  let pendingImages = s.renderOk ? 2 : 1;
  const done = () => { if (--pendingImages === 0) score(); };
  web.onload = done; web.onerror = done;
  web.src = '/web.png?v=' + s.version;

  if (s.renderOk) {
    lvgl.onload = done; lvgl.onerror = done;
    lvgl.src = '/lvgl.bmp?v=' + s.version;
  } else {
    lvgl.removeAttribute('src');
    fidelity.textContent = s.hasRenderBin
      ? 'No render for this build — see the message above.'
      : 'No render harness — build spike/build/render to enable the LVGL pane.';
  }
}

new EventSource('/events').onmessage = refresh;
refresh();
</script>
</body>
</html>
`;
}
