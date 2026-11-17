/**
 * End-to-end smoke test: the built editor in headless Chromium, talking to a
 * real `html2lvgl --preview-api` and the real LVGL render program.
 *
 * Needs: `npm run build` first, a render program (html2lvgl --build-render, or
 * HTML2LVGL_RENDER_BIN), and Playwright with Chromium installed in the repo
 * root (`npx playwright install chromium`).
 *
 * Optional: E2E_SCREENSHOT=<file.png> saves a screenshot of the final state;
 * E2E_CHROMIUM=<path> uses that browser binary instead of Playwright's own;
 * E2E_API_PORT / E2E_WEB_PORT change the ports (18787 / 14173).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const editorRoot = resolve(here, '..');
const repoRoot = resolve(editorRoot, '..');
const { chromium } = createRequire(import.meta.url)(join(repoRoot, 'node_modules', 'playwright'));

const apiPort = Number(process.env.E2E_API_PORT ?? 18787);
const webPort = Number(process.env.E2E_WEB_PORT ?? 14173);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
const start = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.output = () => output;
  children.push(child);
  return child;
};

async function waitFor(url, what, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${what} exited early (code ${child.exitCode}):\n${child.output()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${what} did not answer at ${url} within 20 s:\n${child.output()}`);
}

let failed = false;
const step = async (label, fn) => {
  try {
    await fn();
    console.log(`ok   ${label}`);
  } catch (err) {
    failed = true;
    console.log(`FAIL ${label}\n     ${err instanceof Error ? err.message : String(err)}`);
  }
};

const scratch = mkdtempSync(join(tmpdir(), 'editor-e2e-'));
let browser;
try {
  const api = start(process.execPath, [join(repoRoot, 'src', 'cli.mjs'), '--preview-api', '--port', String(apiPort)], { cwd: repoRoot });
  const web = start(process.execPath, [join(editorRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'], {
    cwd: editorRoot,
    env: { ...process.env, HTML2LVGL_PREVIEW_URL: apiUrl },
  });
  await waitFor(`${apiUrl}/health`, 'the preview API', api);
  await waitFor(webUrl, 'the editor (did you run `npm run build`?)', web);

  // What the render program says about the example, to aim clicks without hard-coding geometry.
  const ir = JSON.parse(readFileSync(join(repoRoot, 'tests', 'golden-editor', 'ir_dashboard.json'), 'utf8'));
  const rendered = await (await fetch(`${apiUrl}/render?format=json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ir }) })).json();
  assert.ok(rendered.ok, `the preview API could not render the example: ${JSON.stringify(rendered)}`);
  assert.ok(Array.isArray(rendered.boxes), 'the render program reports no boxes: rebuild it with html2lvgl --build-render --rebuild');
  const box = (name) => {
    const found = rendered.boxes.find((b) => b.name === name);
    assert.ok(found, `no box for ${name}`);
    return found;
  };

  browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(webUrl);

  const canvas = page.getByTestId('canvas');
  const zoom = Number(await page.getByTestId('zoom').inputValue());
  const clickCanvas = async (x, y) => {
    const rect = await canvas.boundingBox();
    assert.ok(rect, 'the canvas has no box');
    await page.mouse.click(rect.x + x * zoom, rect.y + y * zoom);
  };

  await step('the example renders and the preview API shows as online', async () => {
    await canvas.locator('img').waitFor({ timeout: 15000 });
    await page.getByText('Preview API: online').waitFor({ timeout: 5000 });
    const size = await canvas.boundingBox();
    assert.equal(Math.round(size.width), rendered.width * zoom);
    assert.equal(Math.round(size.height), rendered.height * zoom);
    assert.ok(await canvas.locator('img').evaluate((img) => img.naturalWidth > 0), 'the picture did not load');
  });

  await step('the tree lists the named widgets', async () => {
    for (const name of ['topbar', 'cards', 'card', 'start', 'stop']) {
      await page.getByTestId(`tree-row-${name}`).waitFor({ timeout: 2000 });
    }
  });

  await step('clicking a card padding on the canvas selects the card, not a child', async () => {
    const card = box('card');
    await clickCanvas(card.x + 2, card.y + 2);
    await page.getByTestId('selected-box').waitFor({ timeout: 2000 });
    assert.equal(await page.getByTestId('properties-title').innerText(), 'card');
    assert.equal(await page.getByTestId('tree-row-card').locator('xpath=ancestor::li').getAttribute('aria-selected'), 'true');
    assert.match(await page.getByTestId('properties-box').innerText(), new RegExp(`x ${card.x}, y ${card.y}, ${card.width}×${card.height}`));
    const overlay = await page.getByTestId('selected-box').boundingBox();
    const canvasRect = await canvas.boundingBox();
    assert.equal(Math.round(overlay.x - canvasRect.x), card.x * zoom);
    assert.equal(Math.round(overlay.width), card.width * zoom);
  });

  await step('clicking a label inside a button selects the deepest named widget', async () => {
    const label = box('start_2');
    await clickCanvas(label.x + label.width / 2, label.y + label.height / 2);
    assert.equal(await page.getByTestId('properties-title').innerText(), 'start_2');
  });

  await step('clicking a tree row selects it and outlines it on the canvas', async () => {
    await page.getByTestId('tree-row-stop').click();
    assert.equal(await page.getByTestId('properties-title').innerText(), 'stop');
    const stop = box('stop');
    const overlay = await page.getByTestId('selected-box').boundingBox();
    const canvasRect = await canvas.boundingBox();
    assert.equal(Math.round(overlay.x - canvasRect.x), stop.x * zoom);
    assert.equal(Math.round(overlay.y - canvasRect.y), stop.y * zoom);
  });

  await step('clicking where no named widget is clears the selection', async () => {
    await clickCanvas(160, rendered.height - 4);
    await page.getByTestId('properties-empty').waitFor({ timeout: 2000 });
  });

  await step('the zoom control rescales the picture and the overlay', async () => {
    await page.getByTestId('zoom').selectOption('3');
    await page.getByTestId('tree-row-topbar').click();
    const size = await canvas.boundingBox();
    assert.equal(Math.round(size.width), rendered.width * 3);
    const overlay = await page.getByTestId('selected-box').boundingBox();
    assert.equal(Math.round(overlay.width), box('topbar').width * 3);
    // A picture wider than the pane scrolls from its left edge; it is not cut off on the left.
    await page.getByTestId('zoom').selectOption('4');
    const left = await canvas.boundingBox();
    const paneLeft = await page.getByTestId('canvas').evaluate((el) => el.parentElement.parentElement.getBoundingClientRect().left);
    assert.ok(left.x >= paneLeft - 1, `the picture starts ${paneLeft - left.x}px left of its pane`);
    await page.getByTestId('zoom').selectOption('3');
  });

  await step('opening a file that is not IR says what is wrong, and keeps the current page', async () => {
    const bad = join(scratch, 'not-ir.json');
    writeFileSync(bad, JSON.stringify({ format: 'something-else' }));
    await page.getByTestId('file-input').setInputFiles(bad);
    const message = await page.getByTestId('parse-error').innerText();
    assert.match(message, /not-ir\.json: not an html2lvgl IR file/);
    assert.match(await page.getByTestId('file-name').innerText(), /ir_dashboard/);
  });

  await step('opening a valid IR file replaces the page', async () => {
    const copy = join(scratch, 'my page.json');
    const edited = structuredClone(ir);
    edited.name = 'mypage';
    writeFileSync(copy, JSON.stringify(edited));
    await page.getByTestId('file-input').setInputFiles(copy);
    await page.getByText('my page.json').waitFor({ timeout: 2000 });
    await canvas.locator('img').waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId('parse-error').count(), 0, 'the earlier error is cleared');
  });

  await step('the preview API reports an invalid IR with every problem', async () => {
    const broken = join(scratch, 'broken.json');
    const dup = structuredClone(ir);
    dup.view.children[1].attrs.name = 'topbar'; // duplicate widget name: the quick check passes, the API's full check does not
    writeFileSync(broken, JSON.stringify(dup));
    await page.getByTestId('file-input').setInputFiles(broken);
    const failure = await page.getByTestId('render-failure').innerText({ timeout: 15000 });
    assert.match(failure, /invalid_ir/);
  });

  // The invalid-IR step provokes a 422 on purpose, and the browser logs every failed request.
  const unexpected = errors.filter((message) => !/status of 422/.test(message));
  assert.deepEqual(unexpected, [], `the page logged errors: ${unexpected.join(' | ')}`);
  if (process.env.E2E_SCREENSHOT) {
    await page.getByRole('button', { name: 'Load example' }).click();
    await canvas.locator('img').waitFor({ timeout: 15000 });
    await page.getByTestId('zoom').selectOption('2');
    await page.getByTestId('tree-row-card').click();
    await page.screenshot({ path: process.env.E2E_SCREENSHOT });
    console.log(`screenshot: ${process.env.E2E_SCREENSHOT}`);
  }
} catch (err) {
  failed = true;
  console.log(`FAIL setup\n     ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await browser?.close();
  for (const child of children) child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}
console.log(failed ? '\nFAILED' : '\nPASSED');
process.exit(failed ? 1 : 0);
