// Regression: `--export-ir <dir>` for a single page used to treat the directory
// as the output FILE and crash with EISDIR (found while testing the preview API).
// A directory, existing or written with a trailing separator, gets
// <name>.ir.json inside it; a plain file path still names the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importIr } from '../src/ir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');
const page = join(here, '..', 'examples', 'dashboard.html');

/** Run the CLI on one page with the given --export-ir target; returns the temp root. */
function exportTo(targetFor) {
  const root = mkdtempSync(join(tmpdir(), 'ir-export-dir-'));
  const target = targetFor(root);
  execFileSync(process.execPath, [cli, page, '-o', join(root, 'out'), '-f', 'xml', '--export-ir', target], { encoding: 'utf8', stdio: 'pipe' });
  return root;
}

test('single page: an existing directory gets <name>.ir.json inside it', () => {
  const root = exportTo((r) => { mkdirSync(join(r, 'ir')); return join(r, 'ir'); });
  try {
    assert.deepEqual(readdirSync(join(root, 'ir')), ['dashboard.ir.json']);
    assert.equal(importIr(JSON.parse(readFileSync(join(root, 'ir', 'dashboard.ir.json'), 'utf8'))).name, 'dashboard');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('single page: a path ending in a separator is a directory, created if missing', () => {
  const root = exportTo((r) => `${join(r, 'made', 'later')}/`);
  try {
    assert.ok(existsSync(join(root, 'made', 'later', 'dashboard.ir.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('single page: a plain file path still names the file', () => {
  const root = exportTo((r) => join(r, 'custom-name.json'));
  try {
    assert.ok(existsSync(join(root, 'custom-name.json')));
    assert.ok(!existsSync(join(root, 'dashboard.ir.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
