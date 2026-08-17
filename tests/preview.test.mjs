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
import { startPreview } from '../src/preview.mjs';

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

    // Unauthenticated dev server: must not be reachable from other hosts.
    assert.equal(preview.address, '127.0.0.1');
  } finally {
    await preview.close();
  }
});
