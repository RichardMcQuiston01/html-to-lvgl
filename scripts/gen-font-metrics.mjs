#!/usr/bin/env node
/**
 * Generate src/font-metrics.json from LVGL's built-in Montserrat font sources.
 *
 * LVGL's lv_font_montserrat_<N>.c files store per-glyph advance widths as
 * `adv_w` in 1/16 px fixed point, with ASCII glyphs (codepoints 32..126)
 * mapped sequentially from glyph id 1 (FORMAT0_TINY cmap, range_start=32,
 * range_length=95). This script extracts those widths plus each font's
 * line_height so the converter can measure text with real LVGL metrics.
 *
 * Usage: node scripts/gen-font-metrics.mjs /path/to/lvgl-9.4 [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZES = [10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48];
const ASCII_GLYPHS = 95; // codepoints 32..126

const [, , lvglDir, outArg] = process.argv;
if (!lvglDir) {
  console.error('usage: node scripts/gen-font-metrics.mjs <lvgl-dir> [out.json]');
  process.exit(1);
}
const outPath = outArg ?? join(dirname(fileURLToPath(import.meta.url)), '../src/font-metrics.json');

const metrics = {};
for (const size of SIZES) {
  const src = readFileSync(join(lvglDir, 'src/font', `lv_font_montserrat_${size}.c`), 'utf8');

  const advances = [...src.matchAll(/\.adv_w = (\d+)/g)].map((m) => Number(m[1]));
  // advances[0] is the reserved glyph id 0; ids 1..95 are ASCII 32..126
  if (advances.length < ASCII_GLYPHS + 1) {
    throw new Error(`lv_font_montserrat_${size}.c: expected >= ${ASCII_GLYPHS + 1} glyphs, got ${advances.length}`);
  }
  const lineHeight = Number(src.match(/\.line_height = (\d+)/)[1]);

  metrics[size] = {
    lineHeight,
    // Advance width per ASCII char (32..126) in px, from 1/16 px fixed point
    adv: advances.slice(1, ASCII_GLYPHS + 1).map((w) => w / 16),
  };
}

writeFileSync(outPath, JSON.stringify(metrics));
console.log(`wrote ${outPath} (${SIZES.length} fonts)`);
