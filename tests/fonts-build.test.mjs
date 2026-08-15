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
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planFonts, buildFonts, resolveFontFile, readMetrics, fontKey, lookupKey } from '../src/fonts-build.mjs';
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

  const regular = plan.find((p) => p.lookupKey === lookupKey('Liberation Sans', 400, false, 16));
  assert.deepEqual([...regular.chars].sort().join(''), 'Hehirt');  // union of "Hi" + "there"
});

test('planFonts includes placeholder and value glyphs even with no node.text', () => {
  // A real <input> — e.g. a login field before anything is typed — has
  // text: null and only renders its placeholder; this used to be skipped
  // entirely because collection was gated on `node.text` being truthy.
  const input = {
    tag: 'input', text: null, attrs: { placeholder: 'Username', value: undefined }, children: [],
    styles: textNode('').styles,
  };
  const [plan] = planFonts(treeOf(input));
  for (const ch of 'Username') assert.ok(plan.chars.has(ch), `expected ${ch}`);
});

test('resolveFontFile prefers an explicit map, then a matching @font-face descriptor', () => {
  const entry = { family: 'Inter', weight: 700, italic: false };
  assert.equal(
    resolveFontFile(entry, { fontMap: { 'Inter:700': '/fonts/inter-bold.ttf' } }),
    '/fonts/inter-bold.ttf',
  );
  assert.equal(resolveFontFile(entry, { fontMap: { Inter: '/fonts/inter.ttf' } }), '/fonts/inter.ttf');
  // Remote @font-face sources cannot be converted offline
  assert.equal(
    resolveFontFile(entry, { faces: [{ family: 'Inter', weightMin: 700, weightMax: 700, italic: false, url: 'https://cdn/inter.woff2' }] }),
    null,
  );
  assert.equal(resolveFontFile(entry, {}), null);
});

test('resolveFontFile matches a variable-font @font-face weight range', () => {
  // font-weight: 100 900; in the source stylesheet — a single node requesting
  // any weight in that span must resolve, not only the literal first number.
  // resolveFontFile checks the source exists, so point it at a real (empty)
  // placeholder file rather than an arbitrary path.
  const dir = mkdtempSync(join(tmpdir(), 'f-faces-'));
  const src = join(dir, 'inter-variable.ttf');
  writeFileSync(src, '');
  const faces = [{ family: 'Inter', weightMin: 100, weightMax: 900, italic: false, url: src }];
  assert.equal(resolveFontFile({ family: 'Inter', weight: 400, italic: false }, { faces }), src);
  assert.equal(resolveFontFile({ family: 'Inter', weight: 900, italic: false }, { faces }), src);
  assert.equal(resolveFontFile({ family: 'Inter', weight: 950, italic: false }, { faces }), null);
});

test('resolveFontFile treats oblique the same as italic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'f-faces-'));
  const src = join(dir, 'inter-oblique.ttf');
  writeFileSync(src, '');
  const faces = [{ family: 'Inter', weightMin: 400, weightMax: 400, italic: true, url: src }];
  assert.equal(resolveFontFile({ family: 'Inter', weight: 400, italic: true }, { faces }), src);
  assert.equal(resolveFontFile({ family: 'Inter', weight: 400, italic: false }, { faces }), null);
});

test('generic families are never converted', async () => {
  const plan = planFonts(treeOf(textNode('Hi', { fontFamily: 'sans-serif' })));
  const { built, unresolved } = await buildFonts(plan, mkdtempSync(join(tmpdir(), 'f-')), {});
  assert.equal(built.length, 0);
  assert.equal(unresolved[0].generic, true);
});

test('two families that slug identically stay distinct', async () => {
  // "Acme UI" and "Acme-UI" both normalize to the slug "acme_ui" — without
  // collision handling, planning would merge their glyph sets and lookup
  // would resolve both to whichever font was built last.
  const tree = treeOf(
    textNode('AAA', { fontFamily: 'Acme UI' }),
    textNode('BBB', { fontFamily: 'Acme-UI' }),
  );
  const plan = planFonts(tree);
  assert.equal(plan.length, 2, 'distinct families must not merge during planning');

  const dir = mkdtempSync(join(tmpdir(), 'f-'));
  // Neither family resolves to a file, but buildFonts still assigns each
  // planned entry a key deterministically before checking resolvability —
  // exercise that path directly against the key-assignment logic instead by
  // asserting on the plan identity, which is the actual bug surface.
  const { unresolved } = await buildFonts(plan, dir, {});
  assert.equal(unresolved.length, 2);
  assert.notEqual(unresolved[0].lookupKey, unresolved[1].lookupKey);
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

test('two distinct families that collide on slug both resolve independently once built', { skip: systemTtf ? false : 'no system TTF available' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-fonts-collide-'));
  const tree = treeOf(
    textNode('AAA', { fontFamily: 'Acme UI' }),
    textNode('BBB', { fontFamily: 'Acme-UI' }),
  );
  const { built } = await buildFonts(planFonts(tree), dir, {
    fontMap: { 'Acme UI': systemTtf, 'Acme-UI': systemTtf },
  });
  assert.equal(built.length, 2);
  assert.notEqual(built[0].key, built[1].key, 'collision-disambiguated output keys must differ');

  const registry = customFonts(built);
  const a = registry.for(textNode('x', { fontFamily: 'Acme UI' }).styles);
  const b = registry.for(textNode('x', { fontFamily: 'Acme-UI' }).styles);
  assert.notEqual(a.name, b.name, 'each family must resolve to its own artifact, not merge');
});
