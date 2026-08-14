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
import { convert } from './convert.mjs';
import { emitC } from './emit-c.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    size: { type: 'string', default: '320x240' },
    output: { type: 'string', short: 'o', default: '.' },
    name: { type: 'string' },
    format: { type: 'string', short: 'f', default: 'xml' },
    screenshot: { type: 'boolean', default: false },
    debug: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help || positionals.length !== 1) {
  console.error('usage: html2lvgl <input.html> [--size WxH] [-o outdir] [--name component] [--format xml|c|both] [--screenshot] [--debug]');
  process.exit(opts.help ? 0 : 1);
}
if (!['xml', 'c', 'both'].includes(opts.format)) {
  console.error(`invalid --format "${opts.format}" (expected xml, c, or both)`);
  process.exit(1);
}

const input = positionals[0];
const m = opts.size.match(/^(\d+)x(\d+)$/);
if (!m) {
  console.error(`invalid --size "${opts.size}" (expected e.g. 320x240)`);
  process.exit(1);
}
const [width, height] = [Number(m[1]), Number(m[2])];
const name = opts.name ?? basename(input).replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9_]/gi, '_').toLowerCase();

mkdirSync(opts.output, { recursive: true });

const tree = await extractPage(input, {
  width,
  height,
  screenshotPath: opts.screenshot ? join(opts.output, `${name}_web.png`) : undefined,
});
if (!tree) {
  console.error('extraction produced no visible content');
  process.exit(1);
}
if (opts.debug) writeFileSync(join(opts.output, `${name}.json`), JSON.stringify(tree, null, 2));

const { xml, view, warnings, assets, collapsed } = convert(tree, { name });
const written = [];
if (opts.format !== 'c') {
  const xmlPath = join(opts.output, `${name}.xml`);
  writeFileSync(xmlPath, xml);
  written.push(xmlPath);
}
if (opts.format !== 'xml') {
  const { c, h, unit } = emitC(view, { name });
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
