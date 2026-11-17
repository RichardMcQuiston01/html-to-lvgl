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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
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
const workspace = join(scratch, 'workspace');
mkdirSync(workspace);
let browser;
try {
  const api = start(process.execPath, [join(repoRoot, 'src', 'cli.mjs'), '--preview-api', '--port', String(apiPort), '--workspace', workspace], { cwd: repoRoot });
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


  /* ---------------------------------------------------------------- M2: editing */

  /** Wait until the picture is not being re-rendered. */
  const settled = async () => {
    await page.waitForFunction(() => !document.querySelector('[data-testid=canvas]')?.className.includes('opacity-60'), null, { timeout: 15000 });
  };
  /** A pixel of the rendered picture (image coordinates), as [r, g, b]. */
  const pixel = (x, y) => canvas.locator('img').evaluate((img, [px, py]) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(px, py, 1, 1).data.slice(0, 3)];
  }, [x, y]);
  const editCount = () => page.getByTestId('edit-count').innerText();
  const sidecarFile = join(workspace, 'dashboard.lvgl.json');

  await step('M2: back to the example for editing, with saving on and no edits', async () => {
    await page.getByRole('button', { name: 'Load example' }).click();
    await canvas.locator('img').waitFor({ timeout: 15000 });
    await settled();
    assert.equal(await editCount(), 'no edits');
    assert.equal(await page.getByTestId('save').isDisabled(), true, 'nothing to save yet');
    assert.equal(await page.getByTestId('undo').isDisabled(), true);
  });

  await step('editing an attribute re-renders: the card gets taller, and the edit is counted and marked', async () => {
    await page.getByTestId('tree-row-card').click();
    const input = page.getByTestId('attr-height');
    assert.equal(await input.inputValue(), '64');
    await input.fill('90');
    await input.press('Enter');
    await page.getByTestId('edited-card').waitFor({ timeout: 2000 });
    assert.equal(await editCount(), '1 edit · unsaved');
    await page.waitForFunction(() => /×90$/.test(document.querySelector('[data-testid=properties-box]')?.textContent ?? ''), null, { timeout: 15000 });
    assert.equal(await page.getByTestId('attr-height-was').innerText(), 'page: 64');
    assert.equal(await page.getByTestId('attr-height-row').getAttribute('data-overridden'), 'true');
  });

  await step('undo and redo step through the edit, from the buttons and from the keyboard', async () => {
    await page.getByTestId('undo').click();
    assert.equal(await editCount(), 'no edits');
    await page.waitForFunction(() => /×64$/.test(document.querySelector('[data-testid=properties-box]')?.textContent ?? ''), null, { timeout: 15000 });
    await page.getByTestId('redo').click();
    assert.equal(await editCount(), '1 edit · unsaved');
    await page.locator('body').click({ position: { x: 5, y: 5 } }); // focus out of any field
    await page.keyboard.press('Control+z');
    assert.equal(await editCount(), 'no edits');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await editCount(), '1 edit · unsaved');
  });

  await step('a value that is not valid for the attribute is refused where it is typed, and changes nothing', async () => {
    const input = page.getByTestId('attr-width');
    await input.fill('wide');
    await input.press('Enter');
    assert.match(await page.getByTestId('attr-width-problem').innerText(), /"wide" is not a number/);
    assert.equal(await editCount(), '1 edit · unsaved');
    await input.press('Escape');
    assert.equal(await page.getByTestId('attr-width-problem').count(), 0);
    assert.equal(await input.inputValue(), '114');
  });

  await step('the colour picker changes the colour, and the rendered picture shows it', async () => {
    await page.getByTestId('tree-row-topbar').click();
    assert.deepEqual(await pixel(2, 2), [15, 23, 42], 'the topbar starts as 0x0f172a');
    await page.getByTestId('attr-style_bg_color-picker').fill('#ff0000');
    await page.getByTestId('attr-style_bg_color-picker').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('[data-testid=attr-style_bg_color]')?.value === '0xff0000', null, { timeout: 2000 });
    await page.waitForFunction(() => document.querySelector('[data-testid=canvas] img') !== null);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const [r, g, b] = await pixel(2, 2);
      if (r > 200 && g < 40 && b < 40) break;
      assert.ok(attempt < 49, `the topbar never turned red (pixel ${r},${g},${b})`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(await editCount(), '2 edits · unsaved');
  });

  await step('adding an attribute works, a bad name is refused, and an invalid add changes nothing', async () => {
    await page.getByTestId('tree-row-card').click();
    await page.getByTestId('add-attr-key').fill('bad key');
    await page.getByTestId('add-attr-value').fill('1');
    await page.getByTestId('add-attr-submit').click();
    assert.match(await page.getByTestId('add-attr-problem').innerText(), /letters, digits and underscores/);
    await page.getByTestId('add-attr-key').fill('name');
    await page.getByTestId('add-attr-submit').click();
    assert.match(await page.getByTestId('add-attr-problem').innerText(), /cannot be changed/);
    assert.equal(await editCount(), '2 edits · unsaved');
    await page.getByTestId('add-attr-key').fill('style_radius');
    await page.getByTestId('add-attr-value').fill('20');
    await page.getByTestId('add-attr-submit').click();
    assert.equal(await page.getByTestId('attr-style_radius').inputValue(), '20');
    assert.equal(await editCount(), '3 edits · unsaved');
  });

  await step('removing a widget takes it and its children out of the picture and marks the tree', async () => {
    await page.getByTestId('tree-row-stop').click();
    await page.getByTestId('remove-node').click();
    assert.equal(await page.getByTestId('tree-row-stop').getAttribute('data-removed'), 'true');
    assert.equal(await page.getByTestId('tree-row-stop_2').getAttribute('data-removed'), 'true', 'the child goes with it');
    assert.equal(await page.getByTestId('tree-row-start').getAttribute('data-removed'), 'false');
    await page.getByTestId('removed-note').waitFor({ timeout: 2000 });
    await page.waitForFunction(() => /not shown: removed/.test(document.querySelector('[data-testid=properties-box]')?.textContent ?? ''), null, { timeout: 15000 });
    assert.equal(await editCount(), '4 edits · unsaved');
    await settled();
    // Where the Stop button was is the page background now (it was red).
    const stop = box('stop');
    const [r, g, b] = await pixel(stop.x + stop.width / 2, stop.y + 3);
    assert.ok(!(r > 200 && g < 60 && b < 60), `the stop button is still drawn (pixel ${r},${g},${b})`);
  });

  await step('a widget with no name says why it cannot be edited', async () => {
    await page.getByTestId('tree-row-root').click();
    await page.getByTestId('unnamed-note').waitFor({ timeout: 2000 });
    assert.equal(await page.getByTestId('add-attr').count(), 0, 'no add-attribute form for an unnamed widget');
    assert.equal(await page.getByTestId('remove-node').count(), 0);
  });

  await step('saving writes the sidecar file, in the form the CLI reads, and nothing else', async () => {
    assert.equal(existsSync(sidecarFile), false, 'nothing is written before Save');
    await page.getByTestId('save').click();
    await page.getByTestId('save-status').waitFor({ timeout: 5000 });
    assert.equal(await editCount(), '4 edits');
    assert.deepEqual(JSON.parse(readFileSync(sidecarFile, 'utf8')), {
      version: 1,
      nodes: {
        card: { attrs: { height: 90, style_radius: 20 } },
        topbar: { attrs: { style_bg_color: '0xff0000' } },
        stop: { remove: true },
      },
    });
    assert.deepEqual(readdirSync(workspace), ['dashboard.lvgl.json'], 'no temporary files left behind');
    assert.equal(await page.getByTestId('save').isDisabled(), true, 'nothing left to save');
  });

  await step('reloading the page loads the saved edits', async () => {
    await page.reload();
    await canvas.locator('img').waitFor({ timeout: 15000 });
    await page.getByTestId('edited-card').waitFor({ timeout: 5000 });
    assert.equal(await editCount(), '4 edits');
    assert.equal(await page.getByTestId('tree-row-stop').getAttribute('data-removed'), 'true');
    await page.getByTestId('tree-row-card').click();
    assert.equal(await page.getByTestId('attr-height').inputValue(), '90');
  });

  await step('reset brings the page value back; restore brings a removed widget back; revert discards unsaved edits', async () => {
    await page.getByTestId('attr-height-reset').click();
    assert.equal(await page.getByTestId('attr-height').inputValue(), '64');
    assert.equal(await editCount(), '3 edits · unsaved');
    await page.getByTestId('tree-row-stop').click();
    await page.getByTestId('restore-node').click();
    assert.equal(await page.getByTestId('tree-row-stop').getAttribute('data-removed'), 'false');
    assert.equal(await editCount(), '2 edits · unsaved');
    await page.getByTestId('revert').click();
    assert.equal(await editCount(), '4 edits');
    assert.equal(await page.getByTestId('tree-row-stop').getAttribute('data-removed'), 'true');
    assert.equal(await page.getByTestId('save').isDisabled(), true);
  });

  await step('leaving the page with unsaved edits asks first, and keeps them when you decline', async () => {
    await page.getByTestId('tree-row-card').click();
    const input = page.getByTestId('attr-height');
    await input.fill('70');
    await input.press('Enter');
    assert.equal(await editCount(), '4 edits · unsaved');
    const messages = [];
    page.once('dialog', (dialog) => { messages.push(dialog.message()); void dialog.dismiss(); });
    await page.getByRole('button', { name: 'Load example' }).click();
    assert.equal(messages.length, 1, 'a confirmation was shown');
    assert.match(messages[0], /Discard 1 unsaved edit/);
    assert.equal(await editCount(), '4 edits · unsaved', 'declining keeps the edits');
    await page.getByTestId('revert').click();
  });

  await step('the saved sidecar means the same to the converter: --from-ir on the IR gives the edited XML', async () => {
    writeFileSync(join(workspace, 'dashboard.ir.json'), readFileSync(join(repoRoot, 'tests', 'golden-editor', 'ir_dashboard.json')));
    const { spawnSync } = await import('node:child_process');
    const out = join(scratch, 'cli-out');
    const run = spawnSync(process.execPath, [join(repoRoot, 'src', 'cli.mjs'), '--from-ir', join(workspace, 'dashboard.ir.json'), '-o', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const xml = readFileSync(join(out, 'dashboard.xml'), 'utf8');
    assert.doesNotMatch(xml, /name="stop"/, 'the removed widget is gone from the generated XML');
    assert.match(xml, /name="card"[^>]*height="90"/);
    assert.match(xml, /name="topbar"[^>]*style_bg_color="0xff0000"/);
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
