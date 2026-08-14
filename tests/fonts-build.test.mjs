/**
 * Font pipeline tests.
 *
 * Planning, naming and resolution are pure and always run. The conversion
 * test needs a real TTF: it uses a system font when one is present and skips
 * otherwise, so a bare machine still passes. CI installs fonts-liberation so
 * the conversion path is genuinely exercised there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planFonts, buildFonts, resolveFontFile, readMetrics, fontKey } from '../src/fonts-build.mjs';
import { customFonts } from '../src/fonts.mjs';

const CANDIDATE_TTFS = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];
const systemTtf = CANDIDATE_TTFS.find((p) => existsSync(p));

const textNode = (text, styles = {}) => ({
  tag: 'span', text, attrs: {}, children: [],
  styles: { fontFamily: 'Liberation Sans', fontWeight: 400, fontItalic: false, fontSize: 16, ...styles },
});

const treeOf = (...children) => ({ tag: 'body', text: null, attrs: {}, styles: textNode('').styles, children });

test('fontKey encodes family, weight, italic and size', () => {
  assert.equal(fontKey('Liberation Sans', 400, false, 16), 'liberation_sans_400_16');
  assert.equal(fontKey('Liberation Sans', 700, true, 28), 'liberation_sans_700i_28');
});

test('planFonts groups by typeface and collects the characters used', () => {
  const plan = planFonts(treeOf(
    textNode('Hi'),
    textNode('there'),
    textNode('Bold', { fontWeight: 700 }),
    textNode('Big', { fontSize: 28 }),
  ));
  assert.equal(plan.length, 3); // 400/16, 700/16, 400/28

  const regular = plan.find((p) => p.key === 'liberation_sans_400_16');
  assert.deepEqual([...regular.chars].sort().join(''), 'Hehirt');  // union of "Hi" + "there"
});

test('planFonts includes placeholder and value text', () => {
  const input = {
    tag: 'input', text: 'x', attrs: { placeholder: 'Name', value: '42' }, children: [],
    styles: textNode('').styles,
  };
  const [plan] = planFonts(treeOf(input));
  for (const ch of 'Name42') assert.ok(plan.chars.has(ch), `expected ${ch}`);
});

test('resolveFontFile prefers an explicit map, then @font-face', () => {
  const entry = { family: 'Inter', weight: 700, italic: false };
  assert.equal(
    resolveFontFile(entry, { fontMap: { 'Inter:700': '/fonts/inter-bold.ttf' } }),
    '/fonts/inter-bold.ttf',
  );
  assert.equal(resolveFontFile(entry, { fontMap: { Inter: '/fonts/inter.ttf' } }), '/fonts/inter.ttf');
  // Remote @font-face sources cannot be converted offline
  assert.equal(resolveFontFile(entry, { faces: { 'Inter|700|n': 'https://cdn/inter.woff2' } }), null);
  assert.equal(resolveFontFile(entry, {}), null);
});

test('generic families are never converted', async () => {
  const plan = planFonts(treeOf(textNode('Hi', { fontFamily: 'sans-serif' })));
  const { built, unresolved } = await buildFonts(plan, mkdtempSync(join(tmpdir(), 'f-')), {});
  assert.equal(built.length, 0);
  assert.equal(unresolved[0].generic, true);
});

test('conversion produces a usable font with real metrics', { skip: systemTtf ? false : 'no system TTF available' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-fonts-'));
  const plan = planFonts(treeOf(textNode('Hello World')));
  const { built, unresolved } = await buildFonts(plan, dir, { fontMap: { 'Liberation Sans': systemTtf } });

  assert.equal(unresolved.length, 0);
  assert.equal(built.length, 1);
  const font = built[0];
  assert.equal(font.key, 'liberation_sans_400_16');
  assert.ok(existsSync(font.cFile) && existsSync(font.binFile), 'emits both C and bin');

  // Metrics come from the generated font, covering exactly the glyphs used
  const { adv } = readMetrics(font.cFile);
  assert.ok(adv['H'.codePointAt(0)] > 0);
  assert.equal(adv['Z'.codePointAt(0)], undefined, 'unused glyphs are subset out');

  // ...and the registry measures with them
  const registry = customFonts(built);
  const resolved = registry.for(textNode('Hello World').styles);
  assert.equal(resolved.name, 'liberation_sans_400_16');
  assert.ok(resolved.measure('Hello World') > 50);
  assert.equal(resolved.stepDown(), null, 'a converted font is already the exact size');

  // An unconverted typeface still falls back to Montserrat
  const fallback = registry.for({ ...textNode('x').styles, fontFamily: 'Nonexistent' });
  assert.match(fallback.name, /^montserrat_/);
});
