/**
 * Preview server smoke test.
 *
 * Runs without a browser and without the LVGL render harness: if the initial
 * build cannot run (no Chromium in CI), the server must still come up and
 * report the failure through /state rather than crashing. That resilience is
 * the property being tested here — watch mode has to survive a broken save.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../src/preview.mjs';
import { PLUGIN_API } from '../src/plugin.mjs';

test('preview server serves the page, state, and SSE endpoint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-preview-'));
  const input = join(dir, 'page.html');
  writeFileSync(input, '<!DOCTYPE html><html><body><p>hi</p></body></html>');

  const preview = await startPreview(input, {
    width: 320,
    height: 240,
    name: 'page',
    reactMode: false,
    outputDir: join(dir, 'out'),
    port: 0,                       // OS-assigned port keeps the test hermetic
    renderBin: '/nonexistent/render',
  });

  try {
    const base = `http://127.0.0.1:${preview.port}`;

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /html2lvgl preview/);
    assert.match(html, /id="fidelity"/);

    const state = await (await fetch(`${base}/state`)).json();
    assert.ok(['ready', 'error'].includes(state.status));
    // Harness availability and this build's render result are tracked apart,
    // so a stale bitmap can never be shown or scored
    assert.equal(state.hasRenderBin, false); // render bin does not exist
    assert.equal(state.renderOk, false);
    assert.ok(Array.isArray(state.warnings));
    assert.ok(state.version >= 1);

    // SSE stream announces the current build version
    const events = await fetch(`${base}/events`);
    assert.equal(events.headers.get('content-type'), 'text/event-stream');
    const reader = events.body.getReader();
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /^data: \d+/);
    await reader.cancel(); // the reader holds the lock; cancel through it

    assert.equal((await fetch(`${base}/nope`)).status, 404);

    // No render harness, so lvgl.bmp was never built; sendFile takes its
    // missing-file path and must 404 cleanly rather than throw and crash
    // the server.
    assert.equal((await fetch(`${base}/lvgl.bmp`)).status, 404);
    // The server must still be alive after those requests.
    assert.equal((await fetch(`${base}/state`)).status, 200);

    // Unauthenticated dev server: must not be reachable from other hosts.
    assert.equal(preview.address, '127.0.0.1');
  } finally {
    await preview.close();
  }
});

/* ------------------------------------------------ plugin loader in watch */

function baseStyles() {
  return {
    bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null,
  };
}
function blockLayout() {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto',
  };
}
const treeNode = (tag, extra = {}) => ({
  tag, x: 0, y: 0, w: 100, h: 40, text: null, attrs: {}, styles: baseStyles(), layout: blockLayout(), children: [], ...extra,
});

async function stateOf(input, dir, extra = {}) {
  const preview = await startPreview(input, {
    width: 320, height: 240, name: 'page', outputDir: join(dir, 'out'),
    port: 0, renderBin: '/nonexistent/render', ...extra,
  });
  try {
    return await (await fetch(`http://127.0.0.1:${preview.port}/state`)).json();
  } finally {
    await preview.close();
  }
}

test('watch mode sends a path plugin through the loader and closes its handle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-preview-plugin-'));
  const input = join(dir, 'page.foo');
  writeFileSync(input, 'ignored');
  const pluginPath = join(dir, 'foo-plugin.mjs');
  const tree = JSON.stringify(treeNode('body', { w: 320, h: 240, children: [treeNode('div', { lvName: 'from_plugin' })] }));
  writeFileSync(pluginPath, `
    export default {
      name: 'foo', pluginApi: ${PLUGIN_API}, extensions: ['.foo'],
      async load() {
        return { tree: ${tree}, handle: { close: async () => { globalThis.__fooClosed = (globalThis.__fooClosed ?? 0) + 1; } } };
      },
    };`);
  globalThis.__fooClosed = 0;
  const state = await stateOf(input, dir, { plugins: [pluginPath] });
  assert.equal(state.status, 'ready', state.error);
  assert.match(state.xml, /from_plugin/);
  assert.deepEqual(state.pluginErrors, []);
  assert.equal(globalThis.__fooClosed, 1);
});

test('watch mode routes .jsx through the built-in react plugin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-preview-jsx-'));
  const input = fileURLToPath(new URL('./react-live-fixtures/css-import/app.jsx', import.meta.url));
  const state = await stateOf(input, dir);
  assert.equal(state.status, 'ready', state.error);
  assert.deepEqual(state.pluginErrors, []);
});

test('an invalid plugin shows its errors in the preview state without crashing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-preview-bad-'));
  const input = join(dir, 'page.html');
  writeFileSync(input, '<!DOCTYPE html><html><body><p>hi</p></body></html>');
  const bad = join(dir, 'bad-plugin.mjs');
  writeFileSync(bad, 'export default { name: "bad", pluginApi: 999 };');
  const state = await stateOf(input, dir, { plugins: [bad, join(dir, 'missing.mjs')] });
  assert.ok(['ready', 'error'].includes(state.status));
  assert.ok(state.pluginErrors.length >= 2, state.pluginErrors.join('\n'));
  assert.ok(state.pluginErrors.some((e) => /invalid plugin/.test(e)));
  assert.ok(state.pluginErrors.some((e) => /missing\.mjs/.test(e)));
});
