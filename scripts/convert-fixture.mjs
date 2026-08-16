#!/usr/bin/env node
/**
 * Convert a committed extraction fixture straight to LVGL XML, converting
 * fonts along the way — no browser needed.
 *
 * Fixtures are faithful snapshots of extract.mjs output, so this exercises
 * the whole conversion path (including lv_font_conv) in environments without
 * Chromium, which is how CI validates custom fonts.
 *
 * Usage:
 *   node scripts/convert-fixture.mjs tests/fixtures/typography.json out/ \
 *     --font-map "Liberation Sans=/path/Regular.ttf"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { convert } from '../src/convert.mjs';
import { planFonts, buildFonts, fontWarnings } from '../src/fonts-build.mjs';
import { builtinFonts, customFonts } from '../src/fonts.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'font-map': { type: 'string', multiple: true, default: [] },
    format: { type: 'string', default: 'xml' },
  },
});

if (positionals.length !== 2 || !['xml', 'c', 'cpp'].includes(values.format)) {
  console.error('usage: convert-fixture.mjs <fixture.json> <outdir> [--font-map "Family=path.ttf"] [--format xml|c|cpp]');
  process.exit(1);
}

const [fixture, outDir] = positionals;
const name = basename(fixture).replace(/(\.\w+)?\.json$/, '');
const tree = JSON.parse(readFileSync(fixture, 'utf8'));

const fontMap = {};
for (const spec of values['font-map']) {
  const at = spec.indexOf('=');
  fontMap[spec.slice(0, at).trim()] = spec.slice(at + 1).trim();
}

mkdirSync(outDir, { recursive: true });
const { built, unresolved } = await buildFonts(planFonts(tree), join(outDir, 'fonts'), {
  fontMap,
  faces: tree.fontFaces ?? [],
});

const { xml, view } = convert(tree, { name, fonts: built.length ? customFonts(built) : builtinFonts() });

if (values.format === 'xml') {
  writeFileSync(join(outDir, `${name}.xml`), xml);
  console.log(`wrote ${join(outDir, `${name}.xml`)} with ${built.length} converted font(s)`);
} else {
  const emit = values.format === 'cpp' ? emitCpp : emitC;
  const { c, h, unit } = emit(view, { name });
  const ext = values.format === 'cpp' ? { c: 'cpp', h: 'hpp' } : { c: 'c', h: 'h' };
  writeFileSync(join(outDir, `${unit}.${ext.c}`), c);
  writeFileSync(join(outDir, `${unit}.${ext.h}`), h);
  console.log(`wrote ${join(outDir, `${unit}.${ext.c}`)}, ${join(outDir, `${unit}.${ext.h}`)} with ${built.length} converted font(s)`);
}
for (const f of built) console.log(`  ${f.key}  <- ${f.source}`);
for (const w of fontWarnings(unresolved)) console.log(`  (fallback) ${w}`);
