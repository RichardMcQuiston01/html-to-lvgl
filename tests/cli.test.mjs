/**
 * CLI argument-handling tests. cli.mjs is a top-level script (parseArgs and
 * process.exit run at import time), so it isn't importable as a module —
 * these spawn it as a real subprocess instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');
const dashboard = join(here, '..', 'examples', 'dashboard.html');
const annotations = join(here, '..', 'examples', 'annotations.html');

test('an explicit --name is sanitized into a valid C/C++ identifier', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'html2lvgl-cli-'));
  execFileSync('node', [cli, dashboard, '--name', 'my-page', '--format', 'c', '-o', outDir]);

  const files = readdirSync(outDir);
  // The unsanitized "--name my-page" would previously produce ui_my-page.c/.h
  // (an invalid C identifier); the sanitized slug is ui_my_page.
  assert.ok(files.includes('ui_my_page.c'), `expected ui_my_page.c, got: ${files.join(', ')}`);
  assert.ok(files.includes('ui_my_page.h'), `expected ui_my_page.h, got: ${files.join(', ')}`);

  const header = readFileSync(join(outDir, 'ui_my_page.h'), 'utf8');
  assert.match(header, /#ifndef UI_MY_PAGE_H/);
  assert.match(header, /lv_obj_t \* ui_create\(lv_obj_t \* parent\);/);
});

test('data-lv-component on plain HTML is componentized, not just for .jsx/.tsx input', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'html2lvgl-cli-'));
  execFileSync('node', [cli, annotations, '-o', outDir]);

  // componentize() was previously only invoked when the input was .jsx/.tsx,
  // so a manual data-lv-component annotation on plain HTML (examples/annotations.html
  // marks its "Pump enable" row as PumpRow) was silently dropped: extract.mjs and
  // convert.mjs carried the boundary through, but the CLI never split it out.
  const files = readdirSync(outDir);
  assert.ok(files.includes('pump_row.xml'), `expected pump_row.xml, got: ${files.join(', ')}`);

  const component = readFileSync(join(outDir, 'pump_row.xml'), 'utf8');
  assert.match(component, /<lv_switch name="pump_enable"/);

  const page = readFileSync(join(outDir, 'annotations.xml'), 'utf8');
  assert.match(page, /<pump_row /);
});
