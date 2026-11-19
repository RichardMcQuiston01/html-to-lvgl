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
import { spawn, spawnSync } from 'node:child_process';
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
    const out = join(scratch, 'cli-out');
    const run = spawnSync(process.execPath, [join(repoRoot, 'src', 'cli.mjs'), '--from-ir', join(workspace, 'dashboard.ir.json'), '-o', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const xml = readFileSync(join(out, 'dashboard.xml'), 'utf8');
    assert.doesNotMatch(xml, /name="stop"/, 'the removed widget is gone from the generated XML');
    assert.match(xml, /name="card"[^>]*height="90"/);
    assert.match(xml, /name="topbar"[^>]*style_bg_color="0xff0000"/);
  });


  /* ------------------------------------------------- M3: drag and resize on the canvas */

  const fixtureHtml = join(editorRoot, 'e2e', 'fixtures', 'absolute.html');
  const absoluteIr = join(workspace, 'absolute.ir.json');
  const absoluteSidecar = join(workspace, 'absolute.lvgl.json');
  const cli = (args) => spawnSync(process.execPath, [join(repoRoot, 'src', 'cli.mjs'), ...args], { encoding: 'utf8', cwd: workspace });
  const waitProperties = (pattern) =>
    page.waitForFunction((source) => new RegExp(source).test(document.querySelector('[data-testid=properties-box]')?.textContent ?? ''), pattern, { timeout: 15000 });
  /** Press at an image point, move by a screen offset in steps, and leave the button down. */
  const dragFrom = async (imageX, imageY, screenDx, screenDy) => {
    const rect = await canvas.boundingBox();
    const startX = rect.x + imageX * 2;
    const startY = rect.y + imageY * 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + screenDx / 2, startY + screenDy / 2, { steps: 4 });
    await page.mouse.move(startX + screenDx, startY + screenDy, { steps: 4 });
  };
  const handleCenter = async (handle) => {
    const box = await page.getByTestId(`handle-${handle}`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const dragHandle = async (handle, screenDx, screenDy) => {
    const at = await handleCenter(handle);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + screenDx / 2, at.y + screenDy / 2, { steps: 4 });
    await page.mouse.move(at.x + screenDx, at.y + screenDy, { steps: 4 });
    await page.mouse.up();
  };
  /** Where each named widget is in the page as LVGL lays it out (no edits). */
  let absolute;

  await step('M3: a page of absolutely positioned elements, converted by the real CLI, opens in the editor', async () => {
    const run = cli([fixtureHtml, '--export-ir', workspace, '--size', '320x240']);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(absoluteIr), `the CLI did not write ${absoluteIr}`);
    const ir2 = JSON.parse(readFileSync(absoluteIr, 'utf8'));
    const answer = await (await fetch(`${apiUrl}/render?format=json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ir: ir2 }) })).json();
    assert.ok(answer.ok, JSON.stringify(answer));
    absolute = Object.fromEntries(answer.boxes.map((b) => [b.name, b]));
    await page.getByTestId('zoom').selectOption('2');
    await page.getByTestId('file-input').setInputFiles(absoluteIr);
    await page.getByTestId('tree-row-badge').waitFor({ timeout: 15000 });
    await canvas.locator('img').waitFor({ timeout: 15000 });
    await settled();
    assert.equal(await editCount(), 'no edits');
  });

  await step('the selected widget shows eight handles when its parent does not lay it out, and the page shows none', async () => {
    await page.getByTestId('tree-row-badge').click();
    for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) await page.getByTestId(`handle-${handle}`).waitFor({ timeout: 2000 });
  });

  await step('dragging a widget shows a ghost with its new position, then moves it: x and y change in one undo step, and the picture shows it', async () => {
    const badge = absolute.badge;
    assert.deepEqual([badge.x, badge.y], [170, 40]);
    await dragFrom(badge.x + 3, badge.y + 3, 60, 40); // 30 x 20 picture pixels at 2x
    assert.equal(await page.getByTestId('drag-readout').innerText(), '200, 60 · 60×30');
    await page.mouse.up();
    assert.equal(await editCount(), '2 edits · unsaved');
    await waitProperties('x 200, y 60, 60×30');
    assert.equal(await page.getByTestId('attr-x').inputValue(), '200');
    assert.equal(await page.getByTestId('attr-y').inputValue(), '60');
    // The blue badge is drawn at its new place and is gone from the old one.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const [r, g, b] = await pixel(205, 65);
      if (r < 60 && g < 120 && b > 200) break;
      assert.ok(attempt < 49, `the badge is not drawn at its new position (pixel ${r},${g},${b})`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const [or, og, ob] = await pixel(175, 45);
    assert.ok(!(or < 60 && og < 120 && ob > 200), 'the old position still shows the badge');
    await page.getByTestId('undo').click();
    assert.equal(await editCount(), 'no edits', 'one undo reverts both x and y');
    await waitProperties('x 170, y 40, 60×30');
  });

  await step('a press that barely moves is a click, and Escape abandons a drag', async () => {
    const badge = absolute.badge;
    await dragFrom(badge.x + 3, badge.y + 3, 1, 1);
    await page.mouse.up();
    assert.equal(await editCount(), 'no edits');
    assert.equal(await page.getByTestId('properties-title').innerText(), 'badge', 'still selected');
    await dragFrom(badge.x + 3, badge.y + 3, 80, 80);
    await page.getByTestId('drag-ghost').waitFor({ timeout: 2000 });
    await page.keyboard.press('Escape');
    await page.getByTestId('drag-ghost').waitFor({ state: 'detached', timeout: 2000 });
    await page.mouse.up();
    assert.equal(await editCount(), 'no edits', 'an abandoned drag changes nothing');
    assert.equal(await page.getByTestId('properties-title').innerText(), 'badge', 'and does not change the selection');
  });

  await step('the south-east handle resizes from the drawn size, and the west handle moves the left edge while the right stays put', async () => {
    await page.getByTestId('tree-row-panel').click();
    const panel = absolute.panel;
    assert.deepEqual([panel.x, panel.y, panel.width, panel.height], [20, 30, 122, 82]);
    await dragHandle('se', 40, 20); // +20 x +10 picture pixels
    await waitProperties('x 20, y 30, 142×92');
    assert.equal(await editCount(), '2 edits · unsaved');
    await page.getByTestId('tree-row-panel').click(); // selection overlay refreshed
    await dragHandle('w', 20, 0); // +10 picture pixels
    await waitProperties('x 30, y 30, 132×92');
    assert.equal(await page.getByTestId('attr-x').inputValue(), '30');
    assert.equal(await page.getByTestId('attr-width').inputValue(), '132');
  });

  await step('a child of a flex row can be resized but not moved, and the editor says why', async () => {
    await page.getByTestId('tree-row-chip_a').click();
    for (const handle of ['e', 's', 'se']) await page.getByTestId(`handle-${handle}`).waitFor({ timeout: 2000 });
    for (const handle of ['n', 'w', 'ne', 'nw', 'sw']) assert.equal(await page.getByTestId(`handle-${handle}`).count(), 0, `no ${handle} handle`);
    const chip = absolute.chip_a;
    const before = await editCount();
    await dragFrom(chip.x + 5, chip.y + 5, 40, 0);
    await page.mouse.up();
    assert.match(await page.getByTestId('canvas-hint').innerText(), /chip_a is placed by its parent's flex layout/);
    assert.equal(await editCount(), before, 'a refused move changes nothing');
    await dragHandle('e', 20, 0); // +10 picture pixels
    await waitProperties(`x ${chip.x}, y ${chip.y}, 50×30`);
    // the next chip in the row was pushed along by the layout
    await page.getByTestId('tree-row-chip_b').click();
    await waitProperties(`x ${absolute.chip_b.x + 10}, y ${absolute.chip_b.y}`);
  });

  await step('arrow keys nudge the selected widget (Shift for ten) and a flex child says it cannot move', async () => {
    await page.getByTestId('tree-row-corner').click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowUp');
    assert.equal(await page.getByTestId('attr-x').inputValue(), String(absolute.corner.x - 3));
    assert.equal(await page.getByTestId('attr-y').inputValue(), String(absolute.corner.y - 10));
    await waitProperties(`x ${absolute.corner.x - 3}, y ${absolute.corner.y - 10}`);
    await page.getByTestId('tree-row-chip_b').click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const before = await editCount();
    await page.keyboard.press('ArrowRight');
    assert.match(await page.getByTestId('canvas-hint').innerText(), /flex layout/);
    assert.equal(await editCount(), before);
  });

  await step('saving writes the geometry as plain attributes, and the converter turns the same sidecar into the same XML from the HTML and from the IR', async () => {
    await page.getByTestId('save').click();
    await page.getByTestId('save-status').waitFor({ timeout: 5000 });
    const saved = JSON.parse(readFileSync(absoluteSidecar, 'utf8'));
    assert.deepEqual(saved, {
      version: 1,
      nodes: {
        panel: { attrs: { width: 132, height: 92, x: 30 } },
        chip_a: { attrs: { width: 50 } },
        corner: { attrs: { x: absolute.corner.x - 3, y: absolute.corner.y - 10 } },
      },
    });
    // From the HTML page with the sidecar, and from the exported IR (which finds absolute.lvgl.json beside it).
    const fromHtml = cli([fixtureHtml, '--overrides', absoluteSidecar, '-o', join(scratch, 'from-html'), '--size', '320x240']);
    assert.equal(fromHtml.status, 0, fromHtml.stderr);
    const fromIr = cli(['--from-ir', absoluteIr, '-o', join(scratch, 'from-ir')]);
    assert.equal(fromIr.status, 0, fromIr.stderr);
    const xmlHtml = readFileSync(join(scratch, 'from-html', 'absolute.xml'), 'utf8');
    const xmlIr = readFileSync(join(scratch, 'from-ir', 'absolute.xml'), 'utf8');
    assert.equal(xmlHtml, xmlIr, 'the HTML and the IR give identical XML with the same sidecar');
    assert.match(xmlHtml, new RegExp(`name="corner"[^>]*x="${absolute.corner.x - 3}"`));
    assert.match(xmlHtml, /name="panel"[^>]*width="132"/);
  });


  /* ------------------------------------------------ M4: structure (add, move, remove) */

  const structureHtml = join(editorRoot, 'e2e', 'fixtures', 'structure.html');
  const structureIr = join(workspace, 'structure.ir.json');
  const structureSidecarFile = join(workspace, 'structure.lvgl.json');
  const RED = [239, 68, 68];
  const GREEN = [34, 197, 94];
  const BLUE = [59, 130, 246];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 14);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitPixel = async (x, y, expected, label) => {
    let last = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      last = await pixel(x, y);
      if (near(last, expected)) return;
      await sleep(200);
    }
    assert.fail(`${label}: expected about ${expected} at ${x},${y}, got ${last}`);
  };
  const treeOrder = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="tree-row-"]')].map((e) => e.getAttribute('data-testid').slice('tree-row-'.length)));
  const depthOf = async (name) => Number((await page.getByTestId(`row-${name}`).locator('xpath=ancestor::li').getAttribute('style')).match(/padding-left: (\d+)px/)[1]) / 14;
  /** Dispatch drag events by hand, to look at the tree mid-drag (a real drag cannot be paused). */
  const hoverDrag = async (sourceName, targetName, where = 'middle') => {
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.getByTestId(`row-${sourceName}`).dispatchEvent('dragstart', { dataTransfer });
    const target = page.getByTestId(`row-${targetName}`);
    const box = await target.boundingBox();
    const clientY = box.y + box.height * (where === 'before' ? 0.1 : where === 'after' ? 0.9 : 0.5);
    await target.dispatchEvent('dragover', { dataTransfer, clientX: box.x + 10, clientY });
    return { dataTransfer, end: () => page.getByTestId(`row-${sourceName}`).dispatchEvent('dragend', { dataTransfer }) };
  };

  // The hint is React state, so it follows the event by a render: wait for it instead of reading it at once.
  const waitHint = async (expected) => {
    const hint = page.getByTestId('drop-hint');
    await page.waitForFunction(
      ({ source, flags }) => new RegExp(source, flags).test(document.querySelector('[data-testid="drop-hint"]')?.innerText ?? ''),
      { source: expected.source, flags: expected.flags },
      { timeout: 2000 },
    ).catch(async () => { throw new Error(`the drop hint never matched ${expected}; it says: ${await hint.innerText()}`); });
  };

  await step('M4: a flex list page, converted by the real CLI, opens with its three coloured bars in order', async () => {
    const run = cli([structureHtml, '--export-ir', workspace, '--size', '320x240']);
    assert.equal(run.status, 0, run.stderr);
    await page.getByTestId('file-input').setInputFiles(structureIr);
    await page.getByTestId('tree-row-item_c').waitFor({ timeout: 15000 });
    await canvas.locator('img').waitFor({ timeout: 15000 });
    assert.deepEqual(await treeOrder(), ['root', 'list', 'item_a', 'item_b', 'item_c', 'tray']);
    await waitPixel(50, 25, RED, 'row 1');
    await waitPixel(50, 61, GREEN, 'row 2');
    await waitPixel(50, 97, BLUE, 'row 3');
    assert.equal(await editCount(), 'no edits');
  });

  await step('the move buttons reorder a flex child (which the canvas cannot), say why one is unavailable, and mark the widget moved', async () => {
    await page.getByTestId('tree-row-item_a').click();
    assert.equal(await page.getByTestId('step-up').isDisabled(), true);
    assert.equal(await page.getByTestId('step-up').getAttribute('title'), 'already first');
    await page.getByTestId('step-down').click();
    assert.deepEqual(await treeOrder(), ['root', 'list', 'item_b', 'item_a', 'item_c', 'tray']);
    await page.getByTestId('moved-item_a').waitFor({ timeout: 2000 });
    assert.equal(await editCount(), '1 edit · unsaved');
    await waitPixel(50, 25, GREEN, 'row 1 after the move');
    await waitPixel(50, 61, RED, 'row 2 after the move');
    await page.getByTestId('tree-row-list').click();
    assert.equal(await page.getByTestId('step-out').isDisabled(), true);
    assert.equal(await page.getByTestId('step-out').getAttribute('title'), 'already directly on the page');
  });

  await step('Alt+Up moves it back, and two moves in a row of one widget stay one edit', async () => {
    await page.getByTestId('tree-row-item_a').click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Alt+ArrowUp');
    assert.deepEqual(await treeOrder(), ['root', 'list', 'item_a', 'item_b', 'item_c', 'tray']);
    assert.equal(await editCount(), '1 edit · unsaved');
    await waitPixel(50, 25, RED, 'row 1 restored');
  });

  await step('dragging a row in the tree puts it before another, and the picture shows the new order', async () => {
    await page.getByTestId('tree-row-item_c').dragTo(page.getByTestId('tree-row-item_a'), { targetPosition: { x: 30, y: 2 } });
    assert.deepEqual(await treeOrder(), ['root', 'list', 'item_c', 'item_a', 'item_b', 'tray']);
    assert.equal(await editCount(), '2 edits · unsaved');
    await waitPixel(50, 25, BLUE, 'row 1 after the drag');
    await waitPixel(50, 61, RED, 'row 2 after the drag');
    await waitPixel(50, 97, GREEN, 'row 3 after the drag');
    assert.equal(await page.getByTestId('drop-hint').innerText(), 'Drag a widget to move it, or use the move buttons in the properties panel.');
  });

  await step('dropping on the middle of a widget moves it inside, and it lands where the converter puts it', async () => {
    await page.getByTestId('tree-row-item_b').dragTo(page.getByTestId('tree-row-tray'));
    assert.equal(await depthOf('item_b'), 2, 'item_b is now inside tray');
    assert.equal(await depthOf('tray'), 1);
    assert.equal(await editCount(), '3 edits · unsaved');
    await waitPixel(50, 185, GREEN, 'item_b drawn inside the tray');
  });

  await step('a drop that is not allowed shows the reason while hovering, and does nothing', async () => {
    const drag = await hoverDrag('tray', 'item_b');
    await waitHint(/item_b is inside tray, so tray cannot go there/);
    await drag.end();
    await waitHint(/^Drag a widget to move it, or use the move buttons in the properties panel\.$/);
    const self = await hoverDrag('item_a', 'item_a');
    await waitHint(/cannot be dropped on itself/);
    await self.end();
    assert.equal(await editCount(), '3 edits · unsaved');
  });

  await step('a dragover that arrives in the same task as the dragstart is still handled (React has not re-rendered in between)', async () => {
    // A fast pointer, or a test that fires both events back to back, would otherwise lose the first drop target.
    const accepted = await page.evaluate(() => {
      const dataTransfer = new DataTransfer();
      const source = document.querySelector('[data-testid="row-item_a"]');
      const target = document.querySelector('[data-testid="row-tray"]'); // a box: dropping inside is allowed
      const box = target.getBoundingClientRect();
      const fire = (element, type, extra = {}) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...extra }));
      fire(source, 'dragstart');
      const result = !fire(target, 'dragover', { clientX: box.x + 10, clientY: box.y + box.height / 2 }); // preventDefault called: the drop is accepted
      fire(source, 'dragend');
      return result;
    });
    assert.equal(accepted, true, 'the first dragover was ignored');
    assert.equal(await editCount(), '3 edits · unsaved', 'and nothing was moved by it');
  });

  await step('Move in and Move out change the parent, one step at a time', async () => {
    await page.getByTestId('tree-row-tray').click();
    await page.getByTestId('step-in').click();
    assert.equal(await depthOf('tray'), 2, 'tray is now inside list (the widget before it)');
    await page.getByTestId('step-out').click();
    assert.equal(await depthOf('tray'), 1, 'and out again, onto the page');
  });

  await step('adding a widget puts it where the selection says, selects it, and it can be edited like any other', async () => {
    await page.getByTestId('tree-row-list').click();
    assert.equal(await page.getByTestId('add-placement').innerText(), 'inside list');
    await page.getByTestId('add-widget-lv_label').click();
    await page.getByTestId('added-label').waitFor({ timeout: 2000 });
    assert.equal(await page.getByTestId('properties-title').innerText(), 'label');
    assert.equal(await page.getByTestId('attr-text').inputValue(), 'Label');
    assert.equal(await page.getByTestId('attr-x').count(), 0, 'list lays its children out with flex, so the new widget has no starting position');
    assert.equal(await depthOf('label'), 2, 'inside list');
    await waitProperties('x \\d+, y \\d+, \\d+×\\d+');
    await page.getByTestId('attr-text').fill('Hello');
    await page.getByTestId('attr-text').press('Enter');
    await page.getByTestId('attr-text-was').waitFor({ timeout: 2000 });
    assert.equal(await page.getByTestId('attr-text').inputValue(), 'Hello');
  });

  await step('a button is added with its label inside it, after the selected widget; taking it back removes both', async () => {
    assert.equal(await page.getByTestId('add-placement').innerText(), 'after label');
    await page.getByTestId('add-widget-lv_button').click();
    await page.getByTestId('added-button').waitFor({ timeout: 2000 });
    await page.getByTestId('added-button_label').waitFor({ timeout: 2000 });
    assert.equal(await depthOf('button'), 2);
    assert.equal(await depthOf('button_label'), 3, 'the label is inside the button');
    await waitProperties('x \\d+, y \\d+, 90×36');
    await page.getByTestId('remove-node').click();
    assert.equal(await page.getByTestId('tree-row-button').count(), 0);
    assert.equal(await page.getByTestId('tree-row-button_label').count(), 0, 'what was added inside goes too');
    assert.equal(await page.getByTestId('tree-row-label').count(), 1, 'the label stays');
  });

  await step('a refused drop onto a widget that cannot hold others says so', async () => {
    const drag = await hoverDrag('item_c', 'label');
    await waitHint(/label is a lv_label, which cannot hold other widgets/);
    await drag.end();
  });

  await step('Delete marks an original widget removed (undo brings it back); Ctrl+Z and Ctrl+Shift+Z step through every kind of edit', async () => {
    const before = await editCount();
    await page.getByTestId('tree-row-item_a').click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Delete');
    assert.equal(await page.getByTestId('tree-row-item_a').getAttribute('data-removed'), 'true');
    await page.keyboard.press('Control+z');
    assert.equal(await page.getByTestId('tree-row-item_a').getAttribute('data-removed'), 'false');
    assert.equal(await editCount(), before);
    // Undo walks back through every kind of edit, newest first: taking the button back, adding it, the label's text, adding the label.
    await page.keyboard.press('Control+z');
    await page.getByTestId('tree-row-button').waitFor({ timeout: 2000 });
    assert.equal(await depthOf('button_label'), 3, 'undoing the removal brings the button back with its label');
    await page.keyboard.press('Control+z');
    assert.equal(await page.getByTestId('tree-row-button').count(), 0, 'undoing the add takes the button away');
    await page.keyboard.press('Control+z');
    await page.getByTestId('tree-row-label').click();
    assert.equal(await page.getByTestId('attr-text').inputValue(), 'Label', 'undoing the edit restores the text');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    assert.equal(await page.getByTestId('tree-row-label').count(), 0, 'undoing the add takes the label away');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.getByTestId('tree-row-button').count(), 0, 'redoing all four ends where we were: no button');
    await page.getByTestId('tree-row-label').click();
    assert.equal(await page.getByTestId('attr-text').inputValue(), 'Hello');
  });

  await step('saving writes a version 2 sidecar the converter reads: the same XML from the HTML page and from the IR', async () => {
    await page.getByTestId('save').click();
    await page.getByTestId('save-status').waitFor({ timeout: 5000 });
    const saved = JSON.parse(readFileSync(structureSidecarFile, 'utf8'));
    assert.equal(saved.version, 2);
    assert.ok(Array.isArray(saved.structure) && saved.structure.length >= 3, 'the structure operations are saved');
    assert.ok(saved.structure.some((op) => op.op === 'add' && op.name === 'label' && op.tag === 'lv_label' && op.parent === 'list'));
    assert.ok(saved.structure.every((op) => op.op === 'add' || op.op === 'move'));
    assert.deepEqual(saved.nodes, { label: { attrs: { text: 'Hello' } } });
    const fromHtml = cli([structureHtml, '--overrides', structureSidecarFile, '-o', join(scratch, 'structure-from-html'), '--size', '320x240']);
    assert.equal(fromHtml.status, 0, fromHtml.stderr);
    const fromIr = cli(['--from-ir', structureIr, '-o', join(scratch, 'structure-from-ir')]);
    assert.equal(fromIr.status, 0, fromIr.stderr);
    const xmlHtml = readFileSync(join(scratch, 'structure-from-html', 'structure.xml'), 'utf8');
    const xmlIr = readFileSync(join(scratch, 'structure-from-ir', 'structure.xml'), 'utf8');
    assert.equal(xmlHtml, xmlIr, 'the HTML and the IR give identical XML with the same sidecar');
    assert.match(xmlHtml, /name="label"[^>]*text="Hello"/);
    assert.ok(xmlHtml.indexOf('name="item_c"') < xmlHtml.indexOf('name="item_a"'), 'item_c now comes before item_a');
    assert.ok(xmlHtml.indexOf('name="tray"') < xmlHtml.indexOf('name="item_b"'), 'item_b is inside tray');
    assert.doesNotMatch(readFileSync(structureSidecarFile, 'utf8'), /"remove"/, 'the undone Delete left no trace');
  });

  await step('reloading restores the whole structure: order, the added widget and its markers', async () => {
    await page.reload(); // the browser does not keep the chosen file, so the editor is back on the example: open the file again
    await canvas.locator('img').waitFor({ timeout: 15000 });
    await page.getByTestId('file-input').setInputFiles(structureIr);
    await page.getByTestId('tree-row-item_c').waitFor({ timeout: 15000 });
    await page.getByTestId('added-label').waitFor({ timeout: 5000 });
    const order = await treeOrder();
    assert.ok(order.indexOf('item_c') < order.indexOf('item_a'));
    assert.equal(await depthOf('item_b'), 2);
    await page.getByTestId('moved-item_c').waitFor({ timeout: 2000 });
    assert.match(await editCount(), /^\d+ edits$/);
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
