/**
 * Extraction tests that need a real browser (font-family resolution can't be
 * verified any other way — see the comment in extract.mjs on why
 * document.fonts.check() doesn't work for this).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPage } from '../src/extract.mjs';

const LIBERATION_SANS = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';

function findByText(node, text) {
  if (node.text === text) return node;
  for (const child of node.children ?? []) {
    const found = findByText(child, text);
    if (found) return found;
  }
  return null;
}

async function extractHtml(html) {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-extract-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, html);
  return extractPage(file);
}

test('an unavailable named font falls through to the next stack entry, not the first', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <p style="font-family: 'TotallyFakeFontXYZ123', serif; font-size: 16px;">hi</p>
  </body></html>`);
  const node = findByText(tree, 'hi');
  // getComputedStyle keeps the whole stack ("TotallyFakeFontXYZ123, serif");
  // naively taking the first entry would report the fake name as if it
  // rendered. The generic fallback needs no installed font to verify.
  assert.equal(node.styles.fontFamily, 'serif');
});

test('an available named font in the stack is preferred over the generic fallback', { skip: existsSync(LIBERATION_SANS) ? false : 'Liberation Sans not installed' }, async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><body style="margin:0">
    <p style="font-family: 'Liberation Sans', sans-serif; font-size: 16px;">hi</p>
  </body></html>`);
  const node = findByText(tree, 'hi');
  assert.equal(node.styles.fontFamily, 'Liberation Sans');
});

test('a :hover/:active rule only applies pressed styles to the branch that carries the pseudo-class', async () => {
  const tree = await extractHtml(`<!DOCTYPE html><html><head><style>
    .btn:hover, .link { background-color: #ff0000; }
  </style></head><body style="margin:0">
    <button class="btn">Go</button>
    <a class="link" href="#">Learn more</a>
  </body></html>`);
  const btn = findByText(tree, 'Go');
  const link = findByText(tree, 'Learn more');
  // Only .btn carries :hover; .link must not inherit a pressed style just
  // because it shares a selector list with a rule that does.
  assert.ok(btn.styles.pressed);
  assert.equal(link.styles.pressed, null);
});
