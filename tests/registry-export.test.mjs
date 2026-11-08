/**
 * Registry export (Phase 11 lane A): the JSON an editor palette and property
 * panel are built from. Schema validity, completeness, plugin attribution,
 * determinism, the committed golden, and consistency with what the
 * definitions' build() functions and the converter really do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportRegistry, stringifyRegistryExport, FORCED_WIDGETS, REGISTRY_SCHEMA_VERSION } from '../src/registry-export.mjs';
import { CORE_COMPONENT_META } from '../src/registry-meta.mjs';
import { defaultRegistry, createRegistry, recognize } from '../src/recognize.mjs';
import { registryFor } from '../src/plugin-loader.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import mui from '../packages/mui/src/index.mjs';
import { validateJsonSchema } from './helpers/json-schema.mjs';
import { node } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const schema = JSON.parse(readFileSync(join(root, 'src/schemas/registry-export.schema.json'), 'utf8'));
const goldenPath = join(here, 'golden-editor', 'registry.json');
const cli = join(root, 'src', 'cli.mjs');

const core = exportRegistry(defaultRegistry);
const withMui = () => exportRegistry(registryFor([mui]), { plugins: [mui] });
const byName = (data, name) => data.components.find((c) => c.name === name);

// ---------------------------------------------------------------- schema ---

test('the core export validates against the committed JSON Schema', () => {
  assert.equal(core.schemaVersion, REGISTRY_SCHEMA_VERSION);
  assert.deepEqual(validateJsonSchema(core, schema), []);
});

test('the export with the MUI plugin validates against the schema', () => {
  assert.deepEqual(validateJsonSchema(withMui(), schema), []);
});

test('the schema rejects a wrong version, an unknown key, a bad source and a non-unique slot list', () => {
  const bad = (mutate) => {
    const copy = structuredClone(core);
    mutate(copy);
    return validateJsonSchema(copy, schema);
  };
  assert.ok(bad((d) => { d.schemaVersion = 2; }).length > 0);
  assert.ok(bad((d) => { d.components[0].extra = 1; }).length > 0);
  assert.ok(bad((d) => { d.components[0].source = 'elsewhere'; }).length > 0);
  assert.ok(bad((d) => { d.components[0].props[0].type = 'float'; }).length > 0);
  assert.ok(bad((d) => { delete d.components[0].signals; }).length > 0);
  assert.ok(bad((d) => { byName(d, 'card').slots = ['body', 'body']; }).length > 0);
  assert.ok(bad((d) => { d.components[0].props[0].enum = []; }).length > 0);
});

// ------------------------------------------------------------ completeness ---

test('every registered core component is exported, in offer order, with its props and slots', () => {
  assert.deepEqual(core.components.map((c) => c.name), defaultRegistry.list().map((d) => d.name));
  assert.equal(new Set(core.components.map((c) => c.name)).size, core.components.length);
  for (const def of defaultRegistry.list()) {
    const out = byName(core, def.name);
    assert.deepEqual(out.props.map((p) => [p.name, p.type, p.default]), Object.entries(def.props).map(([n, p]) => [n, p.type, p.default]), def.name);
    assert.deepEqual(out.slots, def.slots, def.name);
    assert.equal(out.leaf, def.leaf === true, def.name);
    assert.equal(out.source, 'core');
    assert.equal(out.overrides, false);
  }
});

test('every core component has a description and every prop a type and a default', () => {
  for (const c of core.components) {
    assert.ok(c.description && c.description.length > 10, `${c.name} needs a description in src/registry-meta.mjs`);
    for (const p of c.props) {
      assert.ok(['string', 'bool', 'number', 'color'].includes(p.type), `${c.name}.${p.name}`);
      assert.notEqual(p.default, null, `${c.name}.${p.name} has no default`);
      assert.ok(p.description, `${c.name}.${p.name} needs a description in src/registry-meta.mjs`);
    }
  }
});

test('the metadata table names only real components, props and signals', () => {
  const names = new Set(builtinComponents.map((d) => d.name));
  for (const name of Object.keys(CORE_COMPONENT_META)) assert.ok(names.has(name), `registry-meta.mjs describes unknown component "${name}"`);
  for (const def of builtinComponents) {
    assert.ok(CORE_COMPONENT_META[def.name], `${def.name} has no entry in src/registry-meta.mjs`);
    for (const prop of Object.keys(CORE_COMPONENT_META[def.name].props ?? {})) {
      assert.ok(prop in def.props, `registry-meta.mjs describes unknown prop ${def.name}.${prop}`);
    }
  }
});

test('data-lv-widget names: forced widgets are listed and link to the components of the same name', () => {
  assert.deepEqual(core.widgets.map((w) => w.name), FORCED_WIDGETS.map((w) => w.name));
  assert.equal(core.widgets.find((w) => w.name === 'switch').component, 'switch');
  assert.equal(core.widgets.find((w) => w.name === 'slider').component, 'slider');
  assert.equal(core.widgets.find((w) => w.name === 'button').component, null);
});

test('FORCED_WIDGETS matches the converter: each name emits its LVGL tag, any other name is reported', () => {
  const run = (widget) => convert(node('body', { w: 320, h: 240 }, [node('div', { widget, text: 'Hi', x: 10, y: 10, w: 100, h: 30, attrs: { options: ['a'] } })]), { name: 't' });
  for (const w of FORCED_WIDGETS) {
    const r = run(w.name);
    assert.match(r.xml, new RegExp(`<${w.lvgl} `), `${w.name} should emit ${w.lvgl}`);
    assert.ok(!r.diagnostics.list().some((d) => d.code === 'WIDGET_UNSUPPORTED'), w.name);
  }
  assert.ok(run('not-a-widget').diagnostics.list().some((d) => d.code === 'WIDGET_UNSUPPORTED'));
});

// ---------------------------------------------------------------- plugins ---

test('plugin components are included with source attribution', () => {
  const data = withMui();
  const muiNames = mui.recognizers.map((d) => d.name);
  assert.deepEqual(data.components.slice(0, core.components.length), core.components, 'core entries and order are unchanged');
  assert.deepEqual(data.components.slice(core.components.length).map((c) => c.name), muiNames);
  for (const name of muiNames) assert.equal(byName(data, name).source, 'plugin:mui');
  const button = byName(data, 'mui-button');
  assert.deepEqual(button.slots, ['startIcon', 'endIcon']);
  assert.ok(button.description);
  assert.deepEqual(button.props.map((p) => p.name), ['label', 'variant', 'color', 'size', 'disabled']);
});

test('without the plugin list a non-core definition is "custom"; an override keeps the core position and is flagged', () => {
  const extra = { ...builtinComponents[1], name: 'my-card', props: {}, slots: [] };
  const custom = exportRegistry(createRegistry([...builtinComponents, extra]));
  assert.equal(byName(custom, 'my-card').source, 'custom');

  const replacement = { ...builtinComponents.find((d) => d.name === 'card'), override: true, description: 'Mine', props: { variant: { type: 'string', default: 'x', enum: ['x', 'y'], description: 'v' } } };
  const plugin = { name: 'acme', recognizers: [replacement] };
  const data = exportRegistry(registryFor([plugin]), { plugins: [plugin] });
  assert.deepEqual(data.components.map((c) => c.name), core.components.map((c) => c.name));
  const card = byName(data, 'card');
  assert.equal(card.source, 'plugin:acme');
  assert.equal(card.overrides, true);
  assert.equal(card.description, 'Mine', 'a plugin override does not inherit the core description');
  assert.deepEqual(card.props, [{ name: 'variant', type: 'string', default: 'x', enum: ['x', 'y'], description: 'v' }]);
  assert.deepEqual(validateJsonSchema(data, schema), []);
});

test('a plugin definition can carry its own description, prop enum and signals', () => {
  const def = {
    name: 'gauge', match: () => false, build: () => null, slots: [],
    description: 'A dial.', props: { unit: { type: 'string', default: 'C', enum: ['C', 'F'], description: 'Unit.' } },
    signals: [{ name: 'value', kind: 'subject', type: 'int', description: 'The reading.' }],
  };
  const out = byName(exportRegistry(createRegistry([def])), 'gauge');
  assert.equal(out.description, 'A dial.');
  assert.deepEqual(out.props[0].enum, ['C', 'F']);
  assert.deepEqual(out.signals, def.signals);
});

// ------------------------------------------------------------ determinism ---

test('the export is deterministic, plain JSON, with no functions, absolute paths or timestamps', () => {
  const a = stringifyRegistryExport(exportRegistry(defaultRegistry));
  const b = stringifyRegistryExport(exportRegistry(defaultRegistry));
  assert.equal(a, b);
  assert.deepEqual(JSON.parse(a), core);
  assert.ok(a.endsWith('}\n'));
  assert.doesNotMatch(a, /\/(home|tmp|Users|root|var)\/|[A-Za-z]:\\\\|\bfile:\/\/|node_modules/, 'no absolute path');
  assert.doesNotMatch(a, /\b(19|20)\d\d-\d\d-\d\dT|\bundefined\b|=>|function\s*\(/, 'no timestamp or code');
  assert.equal(stringifyRegistryExport(withMui()), stringifyRegistryExport(withMui()));
});

test('the export is the same from any working directory and matches the golden', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-reg-'));
  const run = (cwd) => execFileSync('node', [cli, '--export-registry', '-'], { cwd, encoding: 'utf8' });
  assert.equal(run(dir), run(root));
  assert.equal(run(dir), readFileSync(goldenPath, 'utf8'));
});

// ----------------------------------------------------------------- golden ---

test('tests/golden-editor/registry.json matches the definitions (run `npm run golden:update` after changing props or slots)', () => {
  assert.ok(existsSync(goldenPath), 'run `npm run golden:update` to create tests/golden-editor/registry.json');
  const expected = stringifyRegistryExport(exportRegistry(defaultRegistry));
  assert.equal(readFileSync(goldenPath, 'utf8'), expected, 'a component\'s props, slots, description or signals changed: review the diff, then run `npm run golden:update`');
});

// ------------------------------------------------------------ consistency ---

/** Props build() reports for bookkeeping, not for editing: which side of a multi-node component a node is. */
const INTERNAL_RECOGNIZED_KEYS = new Set(['role', 'part']);

/** Every recognized.props observed across the shipped fixtures, per component, with core and MUI definitions. */
function observeFixtures() {
  /** @type {Map<string, Map<string, Set<string>>>} */
  const seen = new Map();
  const walk = (n) => {
    if (n.recognized) {
      const props = seen.get(n.recognized.component) ?? new Map();
      seen.set(n.recognized.component, props);
      for (const [k, v] of Object.entries(n.recognized.props)) props.set(k, (props.get(k) ?? new Set()).add(JSON.stringify(v)));
    }
    n.children?.forEach(walk);
  };
  for (const dir of ['fixtures', 'fixtures-behavior']) {
    for (const file of readdirSync(join(here, dir)).filter((f) => f.endsWith('.json'))) {
      const tree = JSON.parse(readFileSync(join(here, dir, file), 'utf8'));
      for (const registry of [defaultRegistry, registryFor([mui])]) walk(recognize(structuredClone(tree), { registry }).tree);
    }
  }
  return seen;
}

test('what build() reports on the shipped fixtures matches the exported props: names, types and enums', () => {
  const data = withMui();
  const seen = observeFixtures();
  assert.ok(seen.size >= 20, 'the fixtures should exercise most components');
  for (const [component, props] of seen) {
    const exported = byName(data, component);
    assert.ok(exported, `build() reports unknown component ${component}`);
    for (const [key, values] of props) {
      if (INTERNAL_RECOGNIZED_KEYS.has(key)) continue;
      const decl = exported.props.find((p) => p.name === key);
      assert.ok(decl, `${component} build() reports prop "${key}" that its definition does not declare`);
      for (const raw of values) {
        const v = JSON.parse(raw);
        const type = { bool: 'boolean', number: 'number', string: 'string', color: 'string' }[decl.type];
        assert.equal(typeof v, type, `${component}.${key} = ${raw} is not a ${decl.type}`);
        if (decl.enum) assert.ok(decl.enum.includes(v), `${component}.${key} = ${raw} is not in ${JSON.stringify(decl.enum)}`);
      }
    }
  }
});

/** Cheap hand-built nodes whose build() has nothing to read, so it reports the defaults. */
const DEFAULT_PROBES = {
  switch: () => node('div', { role: 'switch', aria: { checked: 'false' }, w: 40, h: 20 }),
  slider: () => node('div', { role: 'slider', w: 200, h: 6 }, [node('div'), node('div')]),
  progress: () => node('div', { role: 'progressbar', aria: { valuenow: '0' }, w: 200, h: 6 }),
  divider: () => node('hr', { w: 200, h: 1 }),
  card: () => node('div', { classes: ['MuiCard-root'], w: 200, h: 100 }),
  paper: () => node('div', { classes: ['MuiPaper-root'], w: 200, h: 100 }),
  alert: () => node('div', { role: 'alert', w: 200, h: 40, text: 'x' }),
  textfield: () => node('input', { attrs: { type: 'text' }, aria: { describedby: 'x' }, w: 200, h: 30 }),
  chip: () => node('div', { classes: ['MuiChip-root'], w: 80, h: 30 }),
  appbar: () => node('header', { role: 'banner', w: 320, h: 56 }),
  avatar: () => node('div', { classes: ['MuiAvatar-root'], w: 40, h: 40, styles: { radius: 20 } }),
};

test('declared defaults are what build() reports when the page says nothing (11 components exercised)', () => {
  for (const [name, probe] of Object.entries(DEFAULT_PROBES)) {
    const def = defaultRegistry.get(name);
    const n = probe();
    const built = def.build(n, { tree: n, parent: null, byId: new Map(), links: new Map(), diagnostics: { add() {} } });
    const reported = built?.recognized?.props;
    assert.ok(reported, `${name}: build() returned no recognized props`);
    let checked = 0;
    for (const [key, decl] of Object.entries(def.props)) {
      if (!(key in reported)) continue; // not reported by build() for this node (e.g. textfield helperText)
      assert.deepEqual(reported[key], decl.default, `${name}.${key}: build() reports ${JSON.stringify(reported[key])}, the definition declares ${JSON.stringify(decl.default)}`);
      checked += 1;
    }
    assert.ok(checked > 0, `${name}: nothing compared`);
  }
});

test('the date picker declares every prop its build() reports (today was missing)', () => {
  const def = defaultRegistry.get('date-picker');
  assert.deepEqual(Object.keys(def.props), ['shownYear', 'shownMonth', 'selectedDay', 'today', 'header']);
  assert.equal(def.props.today.default, 0);
});

test('declared signals are really emitted by the behavior fixtures, and nothing else is', () => {
  const declaredSubjects = new Set();
  const declaredTimelines = new Set();
  for (const c of core.components) {
    for (const s of c.signals) (s.kind === 'subject' ? declaredSubjects : declaredTimelines).add(s.name);
  }
  const dir = join(here, 'fixtures-behavior');
  const subjects = new Set();
  const timelines = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'disclosure.json')) {
    const tree = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const r = convert(tree, { name: file.replace('.json', ''), screenMode: true });
    for (const s of r.subjects) subjects.add(declaredSubjects.has(s.name.split('_').at(-1)) ? s.name.split('_').at(-1) : s.name);
    for (const t of r.timelines ?? []) timelines.add(/(slide_in|slide_out)$/.test(t.name) ? t.name.match(/(slide_in|slide_out)$/)[1] : t.name);
  }
  assert.deepEqual([...subjects].sort(), [...declaredSubjects].sort());
  assert.deepEqual([...timelines].sort(), [...declaredTimelines].sort());
  // Each component lists signals only when its build() uses behavior.
  const withSignals = core.components.filter((c) => c.signals.length).map((c) => c.name).sort();
  assert.deepEqual(withSignals, ['accordion', 'appbar-tabs', 'drawer', 'menu', 'modal', 'snackbar']);
});

// -------------------------------------------------------------------- CLI ---

test('html2lvgl --export-registry writes to stdout with "-" or with no value, needing no input page', () => {
  const golden = readFileSync(goldenPath, 'utf8');
  assert.equal(execFileSync('node', [cli, '--export-registry', '-'], { encoding: 'utf8' }), golden);
  assert.equal(execFileSync('node', [cli, '--export-registry'], { encoding: 'utf8' }), golden);
});

test('html2lvgl --export-registry <file> writes the file, and --plugin adds the plugin components', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-reg-'));
  const file = join(dir, 'registry.json');
  execFileSync('node', [cli, '--export-registry', file], { stdio: 'pipe' });
  assert.equal(readFileSync(file, 'utf8'), readFileSync(goldenPath, 'utf8'));

  const out = execFileSync('node', [cli, '--export-registry', '-', '--plugin', join(root, 'packages/mui/src/index.mjs')], { encoding: 'utf8' });
  const data = JSON.parse(out);
  assert.deepEqual(validateJsonSchema(data, schema), []);
  assert.equal(byName(data, 'mui-checkbox').source, 'plugin:mui');
  assert.equal(out, stringifyRegistryExport(withMui()));
});
