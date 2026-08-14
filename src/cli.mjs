#!/usr/bin/env node
/**
 * html2lvgl — convert an HTML page into LVGL XML.
 *
 *   html2lvgl input.html [--size 320x240] [-o out/] [--name page]
 *             [--screenshot] [--debug]
 *
 * Renders the page in headless Chromium at the target resolution, extracts
 * layout + styles, and emits LVGL XML (v9.4 lv_xml runtime syntax) plus an
 * asset manifest. --screenshot saves the browser reference image;
 * --debug also writes the extracted UI tree JSON.
 */
import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { extractPage } from './extract.mjs';
import { extractReactPage } from './extract-react.mjs';
import { convert } from './convert.mjs';
import { componentize } from './componentize.mjs';
import { emitC } from './emit-c.mjs';
import { render } from './emit-xml.mjs';
import { planFonts, buildFonts, fontWarnings } from './fonts-build.mjs';
import { builtinFonts, customFonts } from './fonts.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', default: '320x240' },
    output: { type: 'string', short: 'o', default: '.' },
    name: { type: 'string' },
    format: { type: 'string', short: 'f', default: 'xml' },
    screenshot: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    'font-map': { type: 'string', multiple: true, default: [] },
    'lv-include': { type: 'string', default: 'lvgl.h' },
    watch: { type: 'boolean', short: 'w', default: false },
    port: { type: 'string', default: '8377' },
    'render-bin': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help || positionals.length === 0) {
  console.error(
    'usage: html2lvgl <input.html|input.jsx> [more-pages.html ...]\n' +
    '                 [--size WxH] [-o outdir] [--name component]\n' +
    '                 [--format xml|c|both] [--screenshot] [--debug]\n' +
    '                 [--font-map "Family=path.ttf"] ...\n' +
    '                 [--watch [--port 8377] [--render-bin path]]\n' +
    '\n' +
    'Passing several pages converts each into a <screen>, and links between\n' +
    'them (<a href="other.html">) become navigation buttons.\n' +
    '\n' +
    '--font-map points a CSS family at a font file, which is converted with\n' +
    'lv_font_conv at the exact sizes the page uses. @font-face sources are\n' +
    'picked up automatically. Unmapped families fall back to Montserrat.'
  );
  process.exit(opts.help ? 0 : 1);
}
if (!['xml', 'c', 'both'].includes(opts.format)) {
  console.error(`invalid --format "${opts.format}" (expected xml, c, or both)`);
  process.exit(1);
}

const m = opts.size.match(/^(\d+)x(\d+)$/);
if (!m) {
  console.error(`invalid --size "${opts.size}" (expected e.g. 320x240)`);
  process.exit(1);
}
const [width, height] = [Number(m[1]), Number(m[2])];

const screenName = (p) => basename(p).replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9_]/gi, '_').toLowerCase();

// Distinct files can still derive the same screen name (home-page.html and
// home_page.html both give home_page), which would silently overwrite output.
const screenNames = positionals.map(screenName);
const duplicates = screenNames.filter((n, i) => screenNames.indexOf(n) !== i);
if (duplicates.length) {
  console.error(`input pages must have unique names; "${duplicates[0]}" is derived from more than one file`);
  process.exit(1);
}

// Several inputs means a multi-screen UI: every page becomes a <screen> and
// links between them resolve to navigation events.
const screenMode = positionals.length > 1;
const screens = screenMode ? new Set(screenNames) : null;
if (screenMode && opts.name) {
  console.error('--name applies to a single page; drop it when converting several screens');
  process.exit(1);
}

const input = positionals[0];
const name = opts.name ?? screenName(input);

mkdirSync(opts.output, { recursive: true });

const reactMode = /\.(jsx|tsx)$/i.test(input);

// --font-map "Family=path.ttf", or "Family:700=path-bold.ttf" for one weight
const fontMap = {};
for (const spec of opts['font-map']) {
  const at = spec.indexOf('=');
  if (at < 1) {
    console.error(`invalid --font-map "${spec}" (expected "Family=path.ttf")`);
    process.exit(1);
  }
  fontMap[spec.slice(0, at).trim()] = spec.slice(at + 1).trim();
}

if (opts.watch && screenMode) {
  console.error('--watch previews a single page at a time');
  process.exit(1);
}

if (opts.watch) {
  // Watch mode owns the build loop: it rebuilds on save and serves a live
  // side-by-side preview until interrupted.
  const { startPreview } = await import('./preview.mjs');
  const port = Number(opts.port);
  // 0 is valid: it asks the OS for a free port, which startPreview reports back
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`invalid --port "${opts.port}"`);
    process.exit(1);
  }
  await startPreview(input, {
    width,
    height,
    name,
    reactMode,
    outputDir: opts.output,
    port,
    renderBin: opts['render-bin'],
    fontMap,
    lvInclude: opts['lv-include'],
  });
  // Server and watcher keep the process alive.
} else {
  for (const page of positionals) {
    await buildOnce(page, screenMode ? screenName(page) : name);
  }
}

async function buildOnce(input, name) {
const reactMode = /\.(jsx|tsx)$/i.test(input);
const extractor = reactMode ? extractReactPage : extractPage;
const tree = await extractor(input, {
  width,
  height,
  screenshotPath: opts.screenshot ? join(opts.output, `${name}_web.png`) : undefined,
});
if (!tree) {
  console.error('extraction produced no visible content');
  process.exit(1);
}
if (opts.debug) writeFileSync(join(opts.output, `${name}.json`), JSON.stringify(tree, null, 2));

// Convert the page's own typefaces at the exact sizes it uses, subsetted to
// the characters it renders. Anything unresolvable stays on Montserrat.
const plan = planFonts(tree);
const { built, unresolved } = await buildFonts(plan, join(opts.output, 'fonts'), {
  fontMap,
  faces: tree.fontFaces ?? {},
  baseDir: dirname(input),
  lvInclude: opts['lv-include'],
});
const fonts = built.length ? customFonts(built) : builtinFonts();

const { xml, view, warnings, assets, collapsed } = convert(tree, { name, screens, screenMode, fonts });
warnings.push(...fontWarnings(unresolved));
const written = [];
if (opts.format !== 'c') {
  let pageXml = xml;
  if (reactMode) {
    // Split React component boundaries into reusable LVGL XML components.
    const { view: pageView, components } = componentize(view, { warnings });
    pageXml = `<component>\n${render(pageView, 1)}\n</component>\n`;
    for (const [cname, cxml] of components) {
      const cPath = join(opts.output, `${cname}.xml`);
      writeFileSync(cPath, cxml);
      written.push(cPath);
    }
  }
  const xmlPath = join(opts.output, `${name}.xml`);
  writeFileSync(xmlPath, pageXml);
  written.push(xmlPath);
}
if (opts.format !== 'xml') {
  // Each screen needs its own entry point; a single page keeps ui_create.
  const { c, h, unit } = emitC(view, { name, symbol: screenMode ? `ui_${name}_create` : 'ui_create' });
  writeFileSync(join(opts.output, `${unit}.c`), c);
  writeFileSync(join(opts.output, `${unit}.h`), h);
  written.push(join(opts.output, `${unit}.c`), join(opts.output, `${unit}.h`));
}

const assetDir = join(opts.output, 'assets');
for (const asset of assets) {
  const from = resolve(dirname(input), asset.src);
  if (existsSync(from)) {
    mkdirSync(assetDir, { recursive: true });
    copyFileSync(from, join(assetDir, basename(asset.src)));
  }
}

console.log(`wrote ${written.join(', ')}`);
if (collapsed > 0) console.log(`optimizer: collapsed ${collapsed} inert wrapper${collapsed === 1 ? '' : 's'}`);
if (assets.length) console.log(`assets: ${assets.map((a) => a.src).join(', ')} -> ${assetDir}/`);
for (const w of warnings) console.warn(`warning: ${w}`);
}
