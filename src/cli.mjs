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
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { extractPage } from './extract.mjs';
import { loadPlugins, selectPlugin, extractWithPlugin } from './plugin-loader.mjs';
import { convert } from './convert.mjs';
import { componentize } from './componentize.mjs';
import { loadOverrides, applyOverrides } from './overrides.mjs';
import { emitC, emitCpp } from './emit-c.mjs';
import { emitPy } from './emit-py.mjs';
import { render } from './emit-xml.mjs';
import { planFonts, buildFonts, fontDiagnostics } from './fonts-build.mjs';
import { createDiagnostics, formatTodo, formatJson, formatSummary } from './diagnostics.mjs';
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
    plugin: { type: 'string', multiple: true, default: [] },
    overrides: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help || positionals.length === 0) {
  console.error(
    'usage: html2lvgl <input.html|input.jsx> [more-pages.html ...]\n' +
    '                 [--size WxH] [-o outdir] [--name component]\n' +
    '                 [--format xml|c|cpp|py|both] [--screenshot] [--debug]\n' +
    '                 [--font-map "Family=path.ttf"] ...\n' +
    '                 [--plugin <package-or-path>] ...\n' +
    '                 [--overrides <file.lvgl.json>]\n' +
    '                 [--watch [--port 8377] [--render-bin path]]\n' +
    '\n' +
    'Passing several pages converts each into a <screen>, and links between\n' +
    'them (<a href="other.html">) become navigation buttons.\n' +
    '\n' +
    '--format accepts a comma-separated list (e.g. "xml,cpp"); "both" is a\n' +
    'shorthand for "xml,c". "c" emits ui_<name>.c/.h; "cpp" emits the same\n' +
    'code as ui_<name>.cpp/.hpp for a project that only compiles C++. "py"\n' +
    'emits ui_<name>.py — idiomatic MicroPython (lv.* calls), taking\n' +
    'converted fonts/images at runtime as ui_create()\'s "fonts"/"images"\n' +
    'dict arguments since Python has no compile-time linkage (see README).\n' +
    '\n' +
    '--plugin loads an input plugin (repeatable), chosen by file extension.\n' +
    'html2lvgl.config.mjs next to the input or in the working directory\n' +
    'can list plugins too: export default { plugins: [...] }. React (.jsx,\n' +
    '.tsx) is built in.\n' +
    '\n' +
    '--overrides applies a sidecar of per-widget changes (attribute values,\n' +
    'removed nodes) without editing the HTML. <input>.lvgl.json next to a\n' +
    'page is picked up automatically; --overrides names one explicitly (single\n' +
    'page only). Target widgets by name, ideally via data-lv-name.\n' +
    '\n' +
    '--font-map points a CSS family at a font file, which is converted with\n' +
    'lv_font_conv at the exact sizes the page uses. @font-face sources are\n' +
    'picked up automatically. Unmapped families fall back to Montserrat.'
  );
  process.exit(opts.help ? 0 : 1);
}
// "both" is a back-compat alias for "xml,c"; otherwise a comma-separated
// list of xml/c/cpp lets one run emit e.g. both C and C++ output at once.
const VALID_FORMATS = new Set(['xml', 'c', 'cpp', 'py']);
const formats = new Set(
  opts.format.split(',').map((f) => f.trim()).flatMap((f) => (f === 'both' ? ['xml', 'c'] : [f])),
);
for (const f of formats) {
  if (!VALID_FORMATS.has(f)) {
    console.error(`invalid --format "${opts.format}" (expected xml, c, cpp, py, or both, comma-separated)`);
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
// screenName() already sanitizes derived filenames into valid identifiers;
// an explicit --name bypassed that entirely, so e.g. --name my-page produced
// invalid C/C++ identifiers (ui_my-page, UI_MY-PAGE_H). Route both through
// the same sanitizer so the XML output name and the C/C++ unit/guard/symbol
// all agree on one valid slug.
const name = screenName(opts.name ?? input);

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

if (opts.overrides && screenMode) {
  console.error('--overrides applies to a single page; several screens each use their own <page>.lvgl.json');
  process.exit(1);
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
    plugins: opts.plugin,
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
  // Invalid plugins print every error line and are skipped, never fatal.
  const { plugins } = await loadPlugins({ specs: opts.plugin, inputs: positionals });
  // Extract every page before touching fonts: a font used differently by two
  // screens (e.g. a heading on one, body text on the other) needs the union
  // of both screens' glyphs in one shared file, not whichever screen's
  // buildFonts() call happened to run last silently overwriting the other's.
  const pages = [];
  for (const page of positionals) {
    const pageName = screenMode ? screenName(page) : name;
    const pageReactMode = /\.(jsx|tsx)$/i.test(page);
    const extractOptions = {
      width,
      height,
      screenshotPath: opts.screenshot ? join(opts.output, `${pageName}_web.png`) : undefined,
    };
    // Plain .html (or anything no plugin claims) keeps the extractPage path.
    const plugin = selectPlugin(plugins, page);
    let tree;
    if (plugin) {
      const r = await extractWithPlugin(plugin, page, extractOptions);
      if (!r.ok) {
        console.error(r.error);
        process.exit(1);
      }
      tree = r.tree;
    } else {
      tree = await extractPage(page, extractOptions);
    }
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
  const diagnostics = createDiagnostics();
  for (const d of fontDiagnostics(unresolved)) diagnostics.add(d);

  for (const page of pages) diagnostics.merge(await emitPage(page, fonts));

  writeDiagnostics(diagnostics.list());
}

/**
 * Write TODO.txt and diagnostics.json next to the generated files, or remove
 * the ones a previous run left behind when this run found nothing to report.
 * Then print the short console summary.
 */
function writeDiagnostics(entries) {
  const todoPath = join(opts.output, 'TODO.txt');
  const jsonPath = join(opts.output, 'diagnostics.json');
  const todo = formatTodo(entries);
  if (todo) {
    writeFileSync(todoPath, todo);
    writeFileSync(jsonPath, formatJson(entries));
  } else {
    rmSync(todoPath, { force: true });
    rmSync(jsonPath, { force: true });
  }
  for (const line of formatSummary(entries, { todoPath })) console.warn(line);
}

async function emitPage({ input, name, tree }, fonts) {
  const converted = convert(tree, { name, screens, screenMode, fonts });
  const { diagnostics, assets, collapsed } = converted;
  let { xml, view } = converted;
  const written = [];

  // Sidecar overrides edit the shared view tree before any emitter runs (and
  // before componentize, so component definitions see them too). Without a
  // sidecar the view and the pre-rendered xml are used untouched.
  const sidecar = opts.overrides ?? input.replace(/\.[^./\\]+$/, '') + '.lvgl.json';
  const loaded = loadOverrides(sidecar);
  if (!loaded.ok) {
    diagnostics.add({
      code: 'OVERRIDE_FILE_INVALID',
      message: `Sidecar ${sidecar} was ignored: ${loaded.errors.join('; ')}`,
      fix: `Fix ${sidecar} (expected {"version": 1, "nodes": {"<name>": {"attrs": {...}, "remove": false}}}) and convert again.`,
      source: { file: sidecar },
    });
  } else if (opts.overrides && loaded.overrides === null) {
    diagnostics.add({
      code: 'OVERRIDE_FILE_INVALID',
      message: `Sidecar ${sidecar} does not exist.`,
      fix: 'Check the --overrides path, or create the file.',
      source: { file: sidecar },
    });
  } else if (loaded.overrides) {
    view = applyOverrides(view, loaded.overrides, { diagnostics, file: sidecar });
    const wrapper = screenMode ? 'screen' : 'component';
    xml = `<${wrapper}>\n${render(view, 1)}\n</${wrapper}>\n`;
  }

  if (formats.has('xml')) {
    let pageXml = xml;
    // Split component boundaries (React fiber-walk stamps, or manual
    // data-lv-component on plain HTML) into reusable LVGL XML components.
    // componentize() is a no-op when the view carries no boundaries, so this
    // runs unconditionally rather than only for reactMode input.
    const { view: pageView, components } = componentize(view, { diagnostics });
    if (components.size) {
      const wrapper = screenMode ? 'screen' : 'component';
      pageXml = `<${wrapper}>\n${render(pageView, 1)}\n</${wrapper}>\n`;
      // Both write to <name>.xml; writing the page after its components
      // would silently overwrite a same-named component's definition.
      // Common in practice: name derives from the filename, cname from the
      // React function name (Panel in panel.jsx). Checked as a preflight
      // pass, before any component is written, so a collision on a later
      // component can't leave earlier ones written to disk.
      for (const cname of components.keys()) {
        if (cname === name) {
          console.error(`component "${cname}" collides with the page name; pass --name to rename the page`);
          process.exit(1);
        }
      }
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
  if (formats.has('py')) {
    const { py, unit } = emitPy(view, { name, symbol });
    writeFileSync(join(opts.output, `${unit}.py`), py);
    written.push(join(opts.output, `${unit}.py`));
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

  // Point each entry at the file it concerns. Component problems belong to
  // the component's own file; everything else to the page's main output.
  const pageFile = formats.has('xml') ? `${name}.xml` : basename(written[0] ?? `${name}.xml`);
  return {
    list: () => diagnostics.list().map((d) => ({
      ...d,
      source: { file: input, ...d.source },
      output: {
        file: d.code.startsWith('COMPONENT_') && d.output?.widget ? `${d.output.widget}.xml` : pageFile,
        ...d.output,
      },
    })),
  };
}
