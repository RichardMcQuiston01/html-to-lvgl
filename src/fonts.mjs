/**
 * Text measurement using real LVGL Montserrat font metrics.
 *
 * Metrics come from src/font-metrics.json, generated from LVGL v9.4.0 font
 * sources by scripts/gen-font-metrics.mjs (advance widths per ASCII glyph in
 * px, plus line height, per font size).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const metrics = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'font-metrics.json'), 'utf8')
);

export const FONT_SIZES = Object.keys(metrics).map(Number).sort((a, b) => a - b);

/** Font name as registered in the render harness / user firmware. */
export const fontName = (size) => `montserrat_${size}`;

/**
 * Largest available size that does not exceed the CSS px size. Montserrat
 * runs wider than default browser fonts, so rounding down beats clipping.
 */
export function nearestSize(cssPx) {
  return FONT_SIZES.filter((s) => s <= cssPx).pop() ?? FONT_SIZES[0];
}

/** Measured width in px of `text` rendered in montserrat_<size>. */
export function measure(size, text) {
  const { adv } = metrics[size];
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    // Non-ASCII falls back to the average advance width
    w += code >= 32 && code <= 126 ? adv[code - 32] : avg(size);
  }
  return Math.ceil(w);
}

export const lineHeight = (size) => metrics[size].lineHeight;

const avgCache = {};
function avg(size) {
  if (!(size in avgCache)) {
    const { adv } = metrics[size];
    avgCache[size] = adv.reduce((a, b) => a + b, 0) / adv.length;
  }
  return avgCache[size];
}
