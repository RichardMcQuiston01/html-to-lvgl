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
import { emitC, emitCpp } from './emit-c.mjs';
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
    '                 [--format xml|c|cpp|both] [--screenshot] [--debug]\n' +
    '                 [--font-map "Family=path.ttf"] ...\n' +
    '                 [--watch [--port 8377] [--render-bin path]]\n' +
    '\n' +
    'Passing several pages converts each into a <screen>, and links between\n' +
    'them (<a href="other.html">) become navigation buttons.\n' +
    '\n' +
    '--format accepts a comma-separated list (e.g. "xml,cpp"); "both" is a\n' +
    'shorthand for "xml,c". "c" emits ui_<name>.c/.h; "cpp" emits the same\n' +
    'code as ui_<name>.cpp/.hpp for a project that only compiles C++.\n' +
    '\n' +
    '--font-map points a CSS family at a font file, which is converted with\n' +
    'lv_font_conv at the exact sizes the page uses. @font-face sources are\n' +
    'picked up automatically. Unmapped families fall back to Montserrat.'
  );
  process.exit(opts.help ? 0 : 1);
}
// "both" is a back-compat alias for "xml,c"; otherwise a comma-separated
// list of xml/c/cpp lets one run emit e.g. both C and C++ output at once.
const VALID_FORMATS = new Set(['xml', 'c', 'cpp']);
const formats = new Set(
  opts.format.split(',').map((f) => f.trim()).flatMap((f) => (f === 'both' ? ['xml', 'c'] : [f])),
);
for (const f of formats) {
  if (!VALID_FORMATS.has(f)) {
    console.error(`invalid --format "${opts.format}" (expected xml, c, cpp, or both, comma-separated)`);
    process.exit(1);
  }
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
  await buildAll();
}

async function buildAll() {
  // Extract every page before touching fonts: a font used differently by two
  // screens (e.g. a heading on one, body text on the other) needs the union
  // of both screens' glyphs in one shared file, not whichever screen's
  // buildFonts() call happened to run last silently overwriting the other's.
  const pages = [];
  for (const page of positionals) {
    const pageName = screenMode ? screenName(page) : name;
    const pageReactMode = /\.(jsx|tsx)$/i.test(page);
    const extractor = pageReactMode ? extractReactPage : extractPage;
    const tree = await extractor(page, {
      width,
      height,
      screenshotPath: opts.screenshot ? join(opts.output, `${pageName}_web.png`) : undefined,
    });
    if (!tree) {
      console.error(`extraction produced no visible content for ${page}`);
      process.exit(1);
    }
    if (opts.debug) writeFileSync(join(opts.output, `${pageName}.json`), JSON.stringify(tree, null, 2));
    pages.push({ input: page, name: pageName, reactMode: pageReactMode, tree });
  }

  // Merge font plans by lookupKey (exact family/weight/italic/size identity)
  // so a shared font's artifact carries every glyph any screen needs.
  const mergedPlan = new Map();
  for (const { tree } of pages) {
    for (const entry of planFonts(tree)) {
      const existing = mergedPlan.get(entry.lookupKey);
      if (existing) for (const ch of entry.chars) existing.chars.add(ch);
      else mergedPlan.set(entry.lookupKey, entry);
    }
  }
  // A multi-screen UI's pages conventionally live together; @font-face
  // sources and relative-URL resolution use the first page's, which is
  // exact for the common single-directory case and a documented limit
  // otherwise (screens in different directories should share --font-map).
  const { built, unresolved } = await buildFonts([...mergedPlan.values()], join(opts.output, 'fonts'), {
    fontMap,
    faces: pages[0]?.tree.fontFaces ?? [],
    baseDir: dirname(pages[0]?.input ?? '.'),
    lvInclude: opts['lv-include'],
  });
  const fonts = built.length ? customFonts(built) : builtinFonts();
  const sharedFontWarnings = fontWarnings(unresolved);

  for (const page of pages) await emitPage(page, fonts);

  for (const w of sharedFontWarnings) console.warn(`warning: ${w}`);
}

async function emitPage({ input, name, reactMode, tree }, fonts) {
  const { xml, view, warnings, assets, collapsed } = convert(tree, { name, screens, screenMode, fonts });
  const written = [];
  if (formats.has('xml')) {
    let pageXml = xml;
    if (reactMode) {
      // Split React component boundaries into reusable LVGL XML components.
      const { view: pageView, components } = componentize(view, { warnings });
      pageXml = `<component>\n${render(pageView, 1)}\n</component>\n`;
      for (const [cname, cxml] of components) {
        // Both write to <name>.xml; writing the page after its components
        // would silently overwrite a same-named component's definition.
        // Common in practice: name derives from the filename, cname from
        // the React function name (Panel in panel.jsx).
        if (cname === name) {
          console.error(`component "${cname}" collides with the page name; pass --name to rename the page`);
          process.exit(1);
        }
        const cPath = join(opts.output, `${cname}.xml`);
        writeFileSync(cPath, cxml);
        written.push(cPath);
      }
    }
    const xmlPath = join(opts.output, `${name}.xml`);
    writeFileSync(xmlPath, pageXml);
    written.push(xmlPath);
  }
  // Each screen needs its own entry point; a single page keeps ui_create.
  const symbol = screenMode ? `ui_${name}_create` : 'ui_create';
  if (formats.has('c')) {
    const { c, h, unit } = emitC(view, { name, symbol, lvInclude: opts['lv-include'] });
    writeFileSync(join(opts.output, `${unit}.c`), c);
    writeFileSync(join(opts.output, `${unit}.h`), h);
    written.push(join(opts.output, `${unit}.c`), join(opts.output, `${unit}.h`));
  }
  if (formats.has('cpp')) {
    const { c, h, unit } = emitCpp(view, { name, symbol, lvInclude: opts['lv-include'] });
    writeFileSync(join(opts.output, `${unit}.cpp`), c);
    writeFileSync(join(opts.output, `${unit}.hpp`), h);
    written.push(join(opts.output, `${unit}.cpp`), join(opts.output, `${unit}.hpp`));
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
