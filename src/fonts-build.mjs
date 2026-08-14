/**
 * Custom font pipeline: convert the typefaces a page actually uses into LVGL
 * fonts with lv_font_conv.
 *
 * Three steps:
 *   planFonts()  walk the UI tree for every (family, weight, italic, size)
 *                combination in use, with the exact set of characters each
 *                one renders
 *   buildFonts() run lv_font_conv per combination, subsetted to those
 *                characters, emitting both a C file (to compile in) and a
 *                .bin (to load at runtime)
 *   readMetrics() parse the generated C for real advance widths, so text
 *                measurement matches what the device will draw
 *
 * A family with no resolvable font file is left to the built-in Montserrat
 * fallback rather than failing the conversion.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const execFileAsync = promisify(execFile);

const BPP = 4;                    // 4bpp antialiasing: good quality, modest size
const CONV_TIMEOUT_MS = 60_000;

/** Families the browser resolves internally; there is no file to convert. */
const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace']);

export const fontKey = (family, weight, italic, size) =>
  `${slug(family)}_${weight}${italic ? 'i' : ''}_${size}`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Collect every distinct typeface + size in the tree, along with the exact
 * characters rendered in it, so each generated font carries only the glyphs
 * the UI needs.
 */
export function planFonts(tree) {
  const plan = new Map();

  function visit(node) {
    const s = node.styles;
    if (node.text && s) {
      const key = fontKey(s.fontFamily, s.fontWeight, s.fontItalic, s.fontSize);
      let entry = plan.get(key);
      if (!entry) {
        entry = {
          key,
          family: s.fontFamily,
          weight: s.fontWeight,
          italic: Boolean(s.fontItalic),
          size: s.fontSize,
          chars: new Set(),
        };
        plan.set(key, entry);
      }
      for (const ch of node.text) entry.chars.add(ch);
      // Placeholders and values render in the same font as their widget
      for (const extra of [node.attrs?.placeholder, node.attrs?.value]) {
        if (typeof extra === 'string') for (const ch of extra) entry.chars.add(ch);
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return [...plan.values()];
}

/**
 * Resolve a planned font to a source file.
 * @param fontMap  explicit "Family" or "Family:weight" -> path, from --font-map
 * @param faces    @font-face declarations discovered in the page
 * @param baseDir  directory to resolve @font-face relative URLs against
 */
export function resolveFontFile(entry, { fontMap = {}, faces = {}, baseDir = '.' } = {}) {
  const exact = fontMap[`${entry.family}:${entry.weight}${entry.italic ? 'i' : ''}`] ?? fontMap[`${entry.family}:${entry.weight}`];
  if (exact) return resolve(exact);
  if (fontMap[entry.family]) return resolve(fontMap[entry.family]);

  const face = faces[`${entry.family}|${entry.weight}|${entry.italic ? 'i' : 'n'}`] ?? faces[`${entry.family}|400|n`];
  if (face && !/^(https?:)?\/\//.test(face) && !face.startsWith('data:')) {
    const path = resolve(baseDir, face);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Convert each resolvable planned font with lv_font_conv.
 * Returns the built fonts (with metrics) and the entries left unresolved.
 */
export async function buildFonts(plan, outDir, options = {}) {
  const built = [];
  const unresolved = [];
  // How the generated C reaches LVGL's header. "lvgl.h" suits the usual
  // -I path/to/lvgl setup; pass lvInclude: 'lvgl/lvgl.h' for projects that
  // put the parent directory on the include path instead.
  const lvInclude = options.lvInclude ?? 'lvgl.h';
  if (plan.length) mkdirSync(outDir, { recursive: true });

  for (const entry of plan) {
    // A generic family is the browser's own default; substituting Montserrat
    // is the documented behavior, not something to warn about.
    if (GENERIC_FAMILIES.has(entry.family.toLowerCase())) {
      unresolved.push({ ...entry, generic: true });
      continue;
    }
    const source = resolveFontFile(entry, options);
    if (!source) {
      unresolved.push({ ...entry, generic: false });
      continue;
    }

    // Space is always needed; sort for a deterministic, diffable command line
    const symbols = [...new Set([...entry.chars, ' '])]
      .filter((ch) => ch.codePointAt(0) >= 0x20)
      .sort()
      .join('');

    const cFile = join(outDir, `${entry.key}.c`);
    const binFile = join(outDir, `${entry.key}.bin`);
    const common = [
      '--font', source,
      '--size', String(entry.size),
      '--bpp', String(BPP),
      '--no-compress',        // avoids requiring LV_USE_FONT_COMPRESSED on device
      '--symbols', symbols,
    ];

    await run(['lv_font_conv', ...common, '--format', 'lvgl', '--lv-include', lvInclude, '--lv-font-name', entry.key, '-o', cFile]);
    await run(['lv_font_conv', ...common, '--format', 'bin', '-o', binFile]);

    built.push({ ...entry, source, cFile, binFile, ...readMetrics(cFile) });
  }

  return { built, unresolved };
}

/**
 * One warning per named family that could not be converted — not one per
 * size, and nothing for generic families that were never convertible.
 */
export function fontWarnings(unresolved) {
  const families = new Map();
  for (const entry of unresolved) {
    if (entry.generic) continue;
    if (!families.has(entry.family)) families.set(entry.family, new Set());
    families.get(entry.family).add(entry.size);
  }
  return [...families].map(([family, sizes]) =>
    `no font file for "${family}" (${[...sizes].sort((a, b) => a - b).join('px, ')}px); ` +
    `falling back to Montserrat — map it with --font-map "${family}=path.ttf"`
  );
}

function run(args) {
  return execFileAsync('npx', args, { timeout: CONV_TIMEOUT_MS, killSignal: 'SIGKILL' });
}

/**
 * Read advance widths out of a generated LVGL font.
 *
 * Glyph descriptors are listed by glyph id; the cmaps map codepoints onto
 * those ids. Subsetted fonts use a sparse cmap (an explicit list of
 * codepoint offsets), full ranges use the sequential "tiny" form — both are
 * handled here. adv_w is fixed point in 1/16 px.
 */
export function readMetrics(cFile) {
  const src = readFileSync(cFile, 'utf8');
  const advances = [...src.matchAll(/\.adv_w = (\d+)/g)].map((m) => Number(m[1]));
  const lineHeight = Number(src.match(/\.line_height = (\d+)/)?.[1] ?? 0);

  const lists = {};
  for (const m of src.matchAll(/static const uint16_t (unicode_list_\d+)\[\] = \{([^}]*)\}/g)) {
    lists[m[1]] = m[2].split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
  }

  const adv = {};
  for (const m of src.matchAll(/\.range_start = (\d+), \.range_length = (\d+), \.glyph_id_start = (\d+),\s*\.unicode_list = (\w+)[^}]*?\.type = (\w+)/g)) {
    const [rangeStart, rangeLength, glyphIdStart, listName, type] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]];
    if (type.endsWith('SPARSE_TINY') && lists[listName]) {
      lists[listName].forEach((offset, i) => {
        adv[rangeStart + offset] = advances[glyphIdStart + i] / 16;
      });
    } else if (type.endsWith('FORMAT0_TINY')) {
      for (let i = 0; i < rangeLength; i++) {
        const a = advances[glyphIdStart + i];
        if (a !== undefined) adv[rangeStart + i] = a / 16;
      }
    }
  }
  return { adv, lineHeight };
}
