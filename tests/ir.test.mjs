/**
 * IR contract (src/ir.mjs): convert -> exportIr -> JSON text -> importIr ->
 * emit must reproduce the committed goldens byte for byte, for every
 * fixture the repo converts, in all four formats. No browser needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { convert } from '../src/convert.mjs';
import { exportIr, importIr, validateIr, emitFromIr, stringifyIr, IrError, IR_VERSION } from '../src/ir.mjs';
import { registryFor } from '../src/plugin-loader.mjs';
import muiPlugin from '../packages/mui/src/index.mjs';
import { demoRegistry } from './helpers/disclosure-demo.mjs';
import { convertInstances } from './helpers/xml-instance-demo.mjs';
import { checkSchema } from './helpers/json-schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mui = join(here, '..', 'packages', 'mui', 'tests');
const read = (...p) => readFileSync(join(...p), 'utf8');
const schema = JSON.parse(read(here, 'golden-editor', 'ir.schema.json'));
const ALL = ['xml', 'c', 'cpp', 'py'];

/** Goldens one case must reproduce: emitted file name -> golden path. */
const units = (dirs, unit, exts) => Object.fromEntries(exts.map(([fmt, ext]) => [`ui_${unit}.${ext}`, join(dirs[fmt], `ui_${unit}.${ext}`)]));
const goldenDirs = (root) => ({ c: join(root, 'golden-c'), cpp: join(root, 'golden-cpp'), py: join(root, 'golden-py') });
const EXTS = [['c', 'c'], ['c', 'h'], ['cpp', 'cpp'], ['cpp', 'hpp'], ['py', 'py']];

/**
 * Every conversion the repo has goldens for.
 * @returns {{ id: string, result: object, screenMode: boolean, options: object, expected: Record<string, string>, formats: string[] }[]}
 */
function cases() {
  const out = [];
  const fixtureDir = join(here, 'fixtures');
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
  const navScreens = new Set(files.filter((f) => f.endsWith('.nav.json')).map((f) => f.replace(/\.nav\.json$/, '')));
  const dirs = goldenDirs(here);
  for (const file of files) {
    const react = file.endsWith('.react.json');
    const nav = file.endsWith('.nav.json');
    const name = file.replace(/(\.react|\.nav)?\.json$/, '');
    const tree = JSON.parse(read(fixtureDir, file));
    const result = convert(tree, { name, screenMode: nav, screens: nav ? navScreens : null });
    const cName = nav ? `nav_${name}` : name;
    const expected = units(dirs, cName, EXTS);
    let plainXml = null; // the page XML before componentize(), which is what convert() returns
    if (nav) expected[`${name}.xml`] = join(here, 'golden-nav', `${name}.xml`);
    else if (react) {
      for (const f of readdirSync(join(here, 'golden-react', name))) expected[f] = join(here, 'golden-react', name, f);
    } else plainXml = join(here, 'golden', `${name}.xml`);
    out.push({
      id: `fixture ${file}`, result, screenMode: nav, formats: ALL, expected, plainXml,
      options: nav ? { unitName: cName, symbol: `ui_${name}_create` } : { unitName: cName },
    });
  }
  // The nav case is exported under the page name, but its goldens use ui_nav_<name> units.

  const behaviorDir = join(here, 'fixtures-behavior');
  const bdirs = join(here, 'golden-behavior');
  for (const file of readdirSync(behaviorDir).filter((f) => f.endsWith('.json'))) {
    const name = file.replace(/\.json$/, '');
    const registry = name === 'disclosure' ? demoRegistry() : undefined;
    const result = convert(JSON.parse(read(behaviorDir, file)), { name, screenMode: true, registry });
    const unit = name.replace(/[^a-z0-9_]/gi, '_');
    const expected = {
      [`${name}.xml`]: join(bdirs, `${name}.xml`),
      'globals.xml': join(bdirs, `${name}.globals.xml`),
      ...Object.fromEntries(['c', 'h', 'cpp', 'hpp', 'py'].map((e) => [`ui_${unit}.${e}`, join(bdirs, `ui_${unit}.${e}`)])),
    };
    out.push({ id: `behavior ${name}`, result, screenMode: true, formats: ALL, expected, options: {} });
  }
  const inst = convertInstances();
  out.push({
    id: 'behavior acc_instances', result: inst, screenMode: true, formats: ['c', 'cpp'], options: {},
    expected: Object.fromEntries(['c', 'h', 'cpp', 'hpp'].map((e) => [`ui_acc_instances.${e}`, join(bdirs, `ui_acc_instances.${e}`)])),
  });

  const registry = registryFor([muiPlugin]);
  for (const file of readdirSync(join(mui, 'fixtures')).filter((f) => f.endsWith('.json'))) {
    const name = file.replace(/\.json$/, '');
    const result = convert(JSON.parse(read(mui, 'fixtures', file)), { name, registry });
    out.push({
      id: `mui ${name}`, result, screenMode: false, formats: ALL, options: {},
      expected: { [`${name}.xml`]: join(mui, 'golden', `${name}.xml`), ...units(goldenDirs(mui), name, EXTS) },
    });
  }
  return out;
}

const roundTrip = (result, screenMode) => importIr(JSON.parse(JSON.stringify(exportIr(result, { screenMode }))));
const ALL_CASES = cases();

test('the case list covers fixtures, behavior, nav, react, and the mui package', () => {
  const ids = ALL_CASES.map((c) => c.id);
  for (const needle of ['fixture dashboard.json', 'fixture home.nav.json', 'fixture panel.react.json', 'fixture vue_dashboard.react.json', 'behavior drawer', 'behavior acc_instances', 'mui settings']) {
    assert.ok(ids.includes(needle), `missing case ${needle}`);
  }
  assert.ok(ALL_CASES.length >= 45, `expected 45+ cases, got ${ALL_CASES.length}`);
});

for (const c of ALL_CASES) {
  test(`round trip reproduces the goldens: ${c.id}`, () => {
    const ir = roundTrip(c.result, c.screenMode);
    assert.equal(ir.xml, c.result.xml, 'the imported IR renders the same page XML as convert()');
    if (c.plainXml) assert.equal(ir.xml, read(c.plainXml), 'page XML differs from the golden');
    const { files } = emitFromIr(ir, { formats: c.formats, ...c.options });
    for (const [file, golden] of Object.entries(c.expected)) {
      assert.ok(file in files, `${file} was not emitted (got ${Object.keys(files).join(', ')})`);
      assert.equal(files[file], read(golden), `${file} differs from ${golden}`);
    }
  });

  test(`the exported IR matches the schema and validates: ${c.id}`, () => {
    const exported = exportIr(c.result, { screenMode: c.screenMode });
    assert.deepEqual(checkSchema(exported, schema), []);
    assert.deepEqual(validateIr(exported), { ok: true, errors: [] });
  });
}

test('exporting twice is byte-identical, and export -> import -> export is a fixed point', () => {
  for (const c of ALL_CASES) {
    const a = stringifyIr(exportIr(c.result, { screenMode: c.screenMode }));
    const b = stringifyIr(exportIr(c.result, { screenMode: c.screenMode }));
    assert.equal(a, b, c.id);
    const again = importIr(a);
    const re = stringifyIr(exportIr({ ...again }, { screenMode: again.screenMode }));
    assert.equal(re, a, `${c.id}: re-export of an imported IR changed`);
  }
});

test('IR holds only JSON data: no functions, undefined, absolute paths or timestamps', () => {
  for (const c of ALL_CASES) {
    const ir = exportIr(c.result, { screenMode: c.screenMode });
    const text = JSON.stringify(ir);
    assert.deepEqual(JSON.parse(text), ir, `${c.id}: not JSON-stable`);
    assert.doesNotMatch(text, /"\/(home|tmp|root|Users)\//, c.id);
    assert.doesNotMatch(text, /\b\d{4}-\d{2}-\d{2}T\d{2}:/, c.id);
    assert.equal(ir.irVersion, IR_VERSION);
    assert.deepEqual(Object.keys(ir), ['format', 'irVersion', 'name', 'screenMode', 'view', 'subjects', 'timelines', 'assets']);
  }
});

test('widget names are unique per page and every named node keeps its name', () => {
  for (const c of ALL_CASES) {
    const names = [];
    (function walk(n) { if (n.attrs.name != null) names.push(n.attrs.name); n.children.forEach(walk); })(exportIr(c.result, { screenMode: c.screenMode }).view);
    assert.equal(new Set(names).size, names.length, `${c.id}: duplicate names`);
    assert.ok(names.length > 0, c.id);
  }
});

/* ------------------------------------------------------------------ editing */

const dashboard = () => ALL_CASES.find((c) => c.id === 'fixture dashboard.json');
const findNode = (node, pred) => (pred(node) ? node : node.children.map((c) => findNode(c, pred)).find(Boolean));
const changedLines = (a, b) => {
  const x = a.split('\n'), y = b.split('\n');
  assert.equal(x.length, y.length, 'line count must not change');
  return x.map((l, i) => [l, y[i]]).filter(([l, r]) => l !== r);
};

test('editing one attribute in the JSON changes only that attribute in every output', () => {
  const c = dashboard();
  const base = exportIr(c.result);
  const edited = structuredClone(base);
  const target = findNode(edited.view, (n) => n.attrs.name && typeof n.attrs.width === 'number');
  const before = target.attrs.width;
  target.attrs.width = before + 7;
  const a = emitFromIr(importIr(base), { formats: ALL, ...c.options }).files;
  const b = emitFromIr(importIr(edited), { formats: ALL, ...c.options }).files;
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const file of Object.keys(a)) {
    const diff = changedLines(a[file], b[file]);
    assert.ok(diff.length <= 2, `${file}: ${diff.length} lines changed`);
    if (/\.(xml|c|cpp|py)$/.test(file)) assert.ok(diff.length >= 1, `${file}: edit did not reach the output`);
    for (const [l, r] of diff) assert.ok(l.includes(String(before)) && r.includes(String(before + 7)), `${file}: unexpected change\n${l}\n${r}`);
  }
});

test('editing demo: renaming a label changes the text in XML, C, C++ and MicroPython', () => {
  const c = dashboard();
  const ir = exportIr(c.result);
  const label = findNode(ir.view, (n) => n.tag === 'lv_label' && typeof n.attrs.text === 'string' && n.attrs.text.length > 2);
  const oldText = label.attrs.text;
  label.attrs.text = 'Renamed in the editor';
  const out = emitFromIr(importIr(JSON.stringify(ir)), { formats: ALL, ...c.options }).files;
  const base = emitFromIr(importIr(exportIr(c.result)), { formats: ALL, ...c.options }).files;
  for (const file of ['dashboard.xml', 'ui_dashboard.c', 'ui_dashboard.cpp', 'ui_dashboard.py']) {
    assert.ok(out[file].includes('Renamed in the editor'), file);
    assert.ok(!out[file].includes(`"${oldText}"`) || base[file].split(`"${oldText}"`).length > out[file].split(`"${oldText}"`).length, file);
    for (const [l, r] of changedLines(base[file], out[file])) assert.ok(l.includes(oldText) && r.includes('Renamed in the editor'), file);
  }
});

test('removing a node in the JSON removes its subtree from the output', () => {
  const c = dashboard();
  const ir = exportIr(c.result);
  const parent = findNode(ir.view, (n) => n.children.length > 1 && n.children.some((k) => k.attrs.name));
  const removed = parent.children.find((k) => k.attrs.name).attrs.name;
  parent.children = parent.children.filter((k) => k.attrs.name !== removed);
  const xml = emitFromIr(importIr(ir)).files['dashboard.xml'];
  assert.ok(!xml.includes(`name="${removed}"`));
});

/* --------------------------------------------------------------- validation */

const good = () => exportIr(ALL_CASES[0].result);
const rejects = (mutate, pattern) => {
  const ir = good();
  const returned = mutate(ir);
  const value = returned === undefined ? ir : returned;
  assert.throws(() => importIr(value), (e) => e instanceof Error && e instanceof IrError && pattern.test(e.message) && !/\n\s+at /.test(e.message));
};

test('importIr rejects bad input with a clear message', () => {
  rejects((ir) => { ir.irVersion = 2; }, /unsupported irVersion 2/);
  rejects((ir) => { delete ir.irVersion; }, /unsupported irVersion \(missing\)/);
  rejects((ir) => { delete ir.view; }, /view must be an object/);
  rejects((ir) => { delete ir.name; }, /"name" must be/);
  rejects((ir) => { ir.screenMode = 'yes'; }, /"screenMode" must be a boolean/);
  rejects((ir) => { ir.view.children = {}; }, /view\.children must be an array/);
  rejects((ir) => { ir.view.tag = 5; }, /view\.tag must be an XML element name/);
  rejects((ir) => { ir.view.attrs.width = { px: 1 }; }, /view\.attrs\.width must be a string, number, boolean or null, got object/);
  rejects((ir) => { ir.view.attrs['bad key'] = 1; }, /invalid attribute name "bad key"/);
  rejects((ir) => { ir.view.extra = 1; }, /unknown field "extra"/);
  rejects((ir) => { ir.extra = 1; }, /unknown top-level field "extra"/);
  rejects((ir) => { ir.subjects = [{ name: 'a' }]; }, /subjects\[0\]\.type must be a string/);
  rejects((ir) => { ir.view.meta = []; }, /view\.meta must be an object/);
  rejects(() => 'not json {', /not valid JSON/);
  rejects(() => null, /top level must be an object/);
  rejects(() => 42, /top level must be an object/);
});

test('importIr rejects duplicate widget names and reports every problem', () => {
  const ir = good();
  const named = [];
  (function walk(n) { if (n.attrs.name) named.push(n); n.children.forEach(walk); })(ir.view);
  named[1].attrs.name = named[0].attrs.name;
  ir.screenMode = 1;
  try {
    importIr(ir);
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof IrError);
    assert.match(e.message, /duplicate widget name/);
    assert.match(e.message, /screenMode/);
    assert.equal(e.errors.length, 2);
  }
});

test('exportIr refuses data JSON would silently change', () => {
  const result = { name: 'x', view: { tag: 'view', attrs: { width: NaN }, children: [] } };
  assert.throws(() => exportIr(result), /non-finite/);
  assert.throws(() => exportIr({ name: 'x', view: { tag: 'view', attrs: { f: () => 1 }, children: [] } }), /cannot be stored/);
  assert.throws(() => exportIr({ name: 'x' }), /needs a convert\(\) result/);
});

test('importIr does not alias the caller IR and exportIr drops undefined keys', () => {
  const ir = good();
  const snap = JSON.stringify(ir);
  const imported = importIr(ir);
  imported.view.attrs.width = 99999;
  assert.equal(JSON.stringify(ir), snap);
  const out = exportIr({ name: 'x', view: { tag: 'view', attrs: { a: 1, b: undefined }, children: [] } });
  assert.deepEqual(Object.keys(out.view.attrs), ['a']);
});

/* ---------------------------------------------------------------------- CLI */

test('cli --from-ir emits from an IR file without a browser, with sidecar, and matches emitFromIr', () => {
  const c = ALL_CASES.find((x) => x.id === 'behavior drawer');
  const dir = mkdtempSync(join(tmpdir(), 'ir-cli-'));
  const irFile = join(dir, 'drawer.ir.json');
  writeFileSync(irFile, stringifyIr(exportIr(c.result, { screenMode: true })));
  const run = (...extra) => execFileSync(process.execPath, [join(here, '..', 'src', 'cli.mjs'), '--from-ir', irFile, '-o', join(dir, 'out'), '-f', 'xml,c,cpp,py', ...extra], { encoding: 'utf8' });
  run();
  const expected = emitFromIr(importIr(read(irFile)), { formats: ALL }).files;
  for (const [file, text] of Object.entries(expected)) assert.equal(read(dir, 'out', file), text, file);

  // A sidecar next to the IR (drawer.lvgl.json) is applied.
  const named = findNode(c.result.view, (n) => n.attrs.name && n.attrs.width !== undefined).attrs.name;
  writeFileSync(join(dir, 'drawer.lvgl.json'), JSON.stringify({ version: 1, nodes: { [named]: { attrs: { width: 4321 } } } }));
  run();
  assert.match(read(dir, 'out', 'drawer.xml'), /width="4321"/);
  assert.match(read(dir, 'out', 'ui_drawer.c'), /4321/);
  assert.equal(existsSync(join(dir, 'out', 'globals.xml')), true);
});

test('cli --from-ir reports a bad IR file with a one-line error, not a stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ir-cli-'));
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ irVersion: 99 }));
  assert.throws(
    () => execFileSync(process.execPath, [join(here, '..', 'src', 'cli.mjs'), '--from-ir', bad, '-o', dir], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => /unsupported irVersion 99/.test(e.stderr) && !/\n\s+at /.test(e.stderr) && e.status === 1,
  );
});

test('the committed example IR (tests/golden-editor/ir_dashboard.json) is current and imports', () => {
  const text = read(here, 'golden-editor', 'ir_dashboard.json');
  assert.equal(text, stringifyIr(exportIr(dashboard().result)));
  assert.deepEqual(checkSchema(JSON.parse(text), schema), []);
  assert.equal(importIr(text).xml, dashboard().result.xml);
});

test('cli --export-ir - with several pages is rejected before any browser starts', () => {
  assert.throws(
    () => execFileSync(process.execPath, [join(here, '..', 'src', 'cli.mjs'), 'a.html', 'b.html', '--export-ir', '-'], { encoding: 'utf8', stdio: 'pipe' }),
    (e) => /use a directory for several pages/.test(e.stderr) && e.status === 1,
  );
});
