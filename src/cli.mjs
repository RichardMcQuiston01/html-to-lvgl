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

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', default: '320x240' },
    output: { type: 'string', short: 'o', default: '.' },
    name: { type: 'string' },
    format: { type: 'string', short: 'f', default: 'xml' },
    screenshot: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
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
    '                 [--watch [--port 8377] [--render-bin path]]\n' +
    '\n' +
    'Passing several pages converts each into a <screen>, and links between\n' +
    'them (<a href="other.html">) become navigation buttons.'
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

// Several inputs means a multi-screen UI: every page becomes a <screen> and
// links between them resolve to navigation events.
const screenMode = positionals.length > 1;
const screens = screenMode ? new Set(positionals.map(screenName)) : null;
if (screenMode && opts.name) {
  console.error('--name applies to a single page; drop it when converting several screens');
  process.exit(1);
}

const input = positionals[0];
const name = opts.name ?? screenName(input);

mkdirSync(opts.output, { recursive: true });

const reactMode = /\.(jsx|tsx)$/i.test(input);

if (opts.watch && screenMode) {
  console.error('--watch previews a single page at a time');
  process.exit(1);
}

if (opts.watch) {
  // Watch mode owns the build loop: it rebuilds on save and serves a live
  // side-by-side preview until interrupted.
  const { startPreview } = await import('./preview.mjs');
  const port = Number(opts.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
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

const { xml, view, warnings, assets, collapsed } = convert(tree, { name, screens, screenMode });
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
