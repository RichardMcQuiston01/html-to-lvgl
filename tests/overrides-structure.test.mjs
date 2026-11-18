/**
 * Sidecar structure operations (src/overrides-structure.mjs, sidecar version 2):
 * adding widgets and moving them. Pure tree tests, then the whole path through
 * the CLI-facing functions and all four emitters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyStructure, validateStructure, acceptsChildren, CONTAINER_TAGS } from '../src/overrides-structure.mjs';
import { applyOverrides, validateOverrides, requiredVersion, loadOverrides } from '../src/overrides.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { readIrFile, emitFromIr } from '../src/ir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const scratch = mkdtempSync(join(tmpdir(), 'structure-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

const node = (tag, name, children = [], attrs = {}) => ({ tag, attrs: { ...(name ? { name } : {}), ...attrs }, children });
/** page > [a, panel > [b, c], label] */
const tree = () => node('view', null, [
  node('lv_obj', 'a'),
  node('lv_obj', 'panel', [node('lv_obj', 'b'), node('lv_obj', 'c')]),
  node('lv_label', 'label', [], { text: 'Hi' }),
]);
/** The names in tree order, indented by depth, for readable comparisons. */
const shape = (n, depth = 0) => (n.attrs.name ? [`${'-'.repeat(depth)}${n.attrs.name}`] : []).concat(n.children.flatMap((c) => shape(c, n.attrs.name ? depth + 1 : depth)));
const run = (structure, view = tree()) => {
  const diagnostics = createDiagnostics();
  const out = applyStructure(view, structure, { diagnostics });
  return { view: out, shape: shape(out), diagnostics: diagnostics.list() };
};

/* ------------------------------------------------------------- validation */

test('validateStructure accepts well-formed operations', () => {
  assert.deepEqual(validateStructure([]), []);
  assert.deepEqual(validateStructure([
    { op: 'add', name: 'note', tag: 'lv_label', parent: 'panel', index: 0, attrs: { text: 'x', width: 5, scrollable: false } },
    { op: 'move', name: 'a', parent: null, index: 3 },
  ]), []);
});

test('validateStructure lists every problem with where it is', () => {
  const errors = validateStructure([
    5,
    { op: 'rotate' },
    { op: 'move', name: '1bad', parent: 'x y', index: -1 },
    { op: 'move', name: 'a', parent: undefined, index: 1.5 },
    { op: 'add', name: 'n', tag: 'label', parent: null, index: 0 },
    { op: 'add', name: 'n', tag: 'lv_label', parent: null, index: 0, attrs: { name: 'z', width: null, extra: {} } },
    { op: 'move', name: 'a', parent: null, index: 0, tag: 'lv_obj', indx: 1 },
  ]);
  const text = errors.join('\n');
  assert.match(text, /structure\[0\] must be an object/);
  assert.match(text, /structure\[1\]\.op must be one of "add", "move"/);
  assert.match(text, /structure\[2\]\.name must be a widget name/);
  assert.match(text, /structure\[2\]\.parent must be the name of a widget, or null/);
  assert.match(text, /structure\[2\]\.index must be a whole number/);
  assert.match(text, /structure\[3\]\.parent/);
  assert.match(text, /structure\[3\]\.index/);
  assert.match(text, /structure\[4\]\.tag must be an LVGL widget tag/);
  assert.match(text, /structure\[5\]\.attrs\.name is not allowed/);
  assert.match(text, /structure\[5\]\.attrs\.width must be a string, number or boolean, got null/);
  assert.match(text, /structure\[5\]\.attrs\.extra must be a string, number or boolean, got object/);
  assert.match(text, /structure\[6\] has the unknown key "tag".*structure\[6\] has the unknown key "indx"/s);
  assert.deepEqual(validateStructure('x'), ['"structure" must be an array, got string']);
});

test('a sidecar with structure needs version 2; version 1 stays valid without it', () => {
  const op = { op: 'move', name: 'a', parent: null, index: 0 };
  assert.equal(validateOverrides({ version: 2, nodes: {}, structure: [op] }).ok, true);
  const v1 = validateOverrides({ version: 1, nodes: {}, structure: [op] });
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join(' '), /"structure" needs "version": 2/);
  assert.equal(validateOverrides({ version: 1, nodes: {}, structure: [] }).ok, true, 'an empty list changes nothing');
  assert.equal(validateOverrides({ version: 2, nodes: {} }).ok, true);
  assert.equal(validateOverrides({ version: 3, nodes: {} }).ok, false);
  assert.equal(requiredVersion({ nodes: {} }), 1);
  assert.equal(requiredVersion({ structure: [] }), 1);
  assert.equal(requiredVersion({ structure: [op] }), 2);
  assert.equal(requiredVersion(null), 1);
});

test('only widgets that can hold others accept children', () => {
  assert.deepEqual([...CONTAINER_TAGS].sort(), ['lv_button', 'lv_obj', 'view']);
  assert.equal(acceptsChildren('lv_label'), false);
  assert.equal(acceptsChildren('lv_obj'), true);
});

/* ------------------------------------------------------------------- apply */

test('add puts a new widget at an index inside a parent, or at the end for a large index', () => {
  assert.deepEqual(run([{ op: 'add', name: 'n', tag: 'lv_obj', parent: 'panel', index: 1 }]).shape, ['a', 'panel', '-b', '-n', '-c', 'label']);
  assert.deepEqual(run([{ op: 'add', name: 'n', tag: 'lv_obj', parent: 'panel', index: 99 }]).shape, ['a', 'panel', '-b', '-c', '-n', 'label']);
  assert.deepEqual(run([{ op: 'add', name: 'n', tag: 'lv_obj', parent: null, index: 0 }]).shape, ['n', 'a', 'panel', '-b', '-c', 'label']);
});

test('an added widget has its tag, its name, the given attributes (booleans as text), and no children', () => {
  const { view } = run([{ op: 'add', name: 'note', tag: 'lv_label', parent: null, index: 0, attrs: { text: 'Hello', width: 40, scrollable: false } }]);
  assert.deepEqual(view.children[0], { tag: 'lv_label', attrs: { name: 'note', text: 'Hello', width: 40, scrollable: 'false' }, children: [] });
});

test('move reorders within a parent, moves between parents, and moves to the page', () => {
  assert.deepEqual(run([{ op: 'move', name: 'label', parent: null, index: 0 }]).shape, ['label', 'a', 'panel', '-b', '-c']);
  assert.deepEqual(run([{ op: 'move', name: 'b', parent: 'panel', index: 1 }]).shape, ['a', 'panel', '-c', '-b', 'label']);
  assert.deepEqual(run([{ op: 'move', name: 'a', parent: 'panel', index: 1 }]).shape, ['panel', '-b', '-a', '-c', 'label']);
  assert.deepEqual(run([{ op: 'move', name: 'c', parent: null, index: 99 }]).shape, ['a', 'panel', '-b', 'label', 'c']);
});

test('a move\'s index counts the parent\'s children with the widget already taken out', () => {
  // a is first; "index 1" in the list without a is after panel.
  assert.deepEqual(run([{ op: 'move', name: 'a', parent: null, index: 1 }]).shape, ['panel', '-b', '-c', 'a', 'label']);
  // moving down within the same list: b to index 1 of [b, c] without b = [c] -> after c
  assert.deepEqual(run([{ op: 'move', name: 'b', parent: 'panel', index: 1 }]).shape, ['a', 'panel', '-c', '-b', 'label']);
});

test('operations apply in order, each to the result of the ones before it', () => {
  const result = run([
    { op: 'add', name: 'box', tag: 'lv_obj', parent: null, index: 0 },
    { op: 'add', name: 'inner', tag: 'lv_label', parent: 'box', index: 0 },
    { op: 'move', name: 'a', parent: 'box', index: 0 },
    { op: 'move', name: 'inner', parent: 'box', index: 1 },
  ]);
  assert.deepEqual(result.shape, ['box', '-a', '-inner', 'panel', '-b', '-c', 'label']);
  assert.deepEqual(result.diagnostics, []);
});

test('the input tree is not changed', () => {
  const original = tree();
  const before = JSON.stringify(original);
  run([{ op: 'move', name: 'a', parent: 'panel', index: 0 }, { op: 'add', name: 'n', tag: 'lv_obj', parent: null, index: 0 }], original);
  assert.equal(JSON.stringify(original), before);
});

test('each problem skips only that operation and says why', () => {
  const cases = [
    [{ op: 'move', name: 'gone', parent: null, index: 0 }, /no widget named "gone"/],
    [{ op: 'move', name: 'a', parent: 'gone', index: 0 }, /no widget named "gone" to move it into/],
    [{ op: 'add', name: 'n', tag: 'lv_obj', parent: 'gone', index: 0 }, /no widget named "gone" to add it to/],
    [{ op: 'add', name: 'a', tag: 'lv_obj', parent: null, index: 0 }, /a widget named "a" already exists/],
    [{ op: 'move', name: 'panel', parent: 'b', index: 0 }, /"b" is inside "panel", so it cannot move there/],
    [{ op: 'move', name: 'panel', parent: 'panel', index: 0 }, /is inside "panel"/],
    [{ op: 'move', name: 'a', parent: 'label', index: 0 }, /label is a lv_label, which cannot hold other widgets/],
    [{ op: 'add', name: 'n', tag: 'lv_obj', parent: 'label', index: 0 }, /label is a lv_label/],
  ];
  for (const [op, message] of cases) {
    const { shape: after, diagnostics } = run([op, { op: 'add', name: 'ok', tag: 'lv_obj', parent: null, index: 0 }]);
    assert.equal(diagnostics.length, 1, JSON.stringify(op));
    assert.equal(diagnostics[0].code, 'OVERRIDE_STRUCTURE_INVALID');
    assert.equal(diagnostics[0].severity, 'warning');
    assert.match(diagnostics[0].message, message, JSON.stringify(op));
    assert.match(diagnostics[0].message, /^structure\[0\] \((move|add) "/);
    assert.ok(diagnostics[0].fix.length > 10);
    assert.equal(after[0], 'ok', 'the later, valid operation still applied');
  }
});

/* --------------------------------------------- with the per-widget overrides */

test('per-widget overrides apply after structure, so they can restyle or remove an added widget', () => {
  const sidecar = {
    version: 2,
    structure: [{ op: 'add', name: 'note', tag: 'lv_label', parent: null, index: 0, attrs: { text: 'one' } }],
    nodes: { note: { attrs: { text: 'two', width: 50 } }, a: { remove: true } },
  };
  const diagnostics = createDiagnostics();
  const view = applyOverrides(tree(), sidecar, { diagnostics });
  assert.deepEqual(diagnostics.list(), []);
  assert.deepEqual(shape(view), ['note', 'panel', '-b', '-c', 'label']);
  assert.deepEqual(view.children[0].attrs, { name: 'note', text: 'two', width: 50 });
  const removedNote = applyOverrides(tree(), { ...sidecar, nodes: { note: { remove: true } } });
  assert.deepEqual(shape(removedNote), ['a', 'panel', '-b', '-c', 'label']);
});

test('a sidecar with only structure (no nodes) still applies', () => {
  const view = applyOverrides(tree(), { version: 2, nodes: {}, structure: [{ op: 'move', name: 'label', parent: null, index: 0 }] });
  assert.deepEqual(shape(view), ['label', 'a', 'panel', '-b', '-c']);
});

/* -------------------------------------------------------- through the CLI */

test('the whole path: a v2 sidecar next to an IR reaches XML, C, C++ and MicroPython', () => {
  const dir = mkdtempSync(join(scratch, 'cli-'));
  writeFileSync(join(dir, 'dashboard.ir.json'), readFileSync(join(here, 'golden-editor', 'ir_dashboard.json')));
  writeFileSync(join(dir, 'dashboard.lvgl.json'), JSON.stringify({
    version: 2,
    structure: [
      { op: 'add', name: 'footer', tag: 'lv_label', parent: null, index: 99, attrs: { text: 'Footer note' } },
      { op: 'move', name: 'actions', parent: null, index: 1 },
    ],
    nodes: { footer: { attrs: { width: 120 } } },
  }));
  const out = join(dir, 'out');
  const result = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), '--from-ir', join(dir, 'dashboard.ir.json'), '-o', out, '--format', 'xml,c,cpp,py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const xml = readFileSync(join(out, 'dashboard.xml'), 'utf8');
  assert.match(xml, /name="footer"/);
  assert.match(xml, /text="Footer note"/);
  assert.ok(xml.indexOf('name="actions"') < xml.indexOf('name="cards"'), 'actions now comes before cards');
  for (const file of ['ui_dashboard.c', 'ui_dashboard.cpp', 'ui_dashboard.py']) {
    const text = readFileSync(join(out, file), 'utf8');
    assert.match(text, /Footer note/, `${file} has the added widget's text`);
    assert.match(text, /footer/, `${file} names the added widget`);
  }
  assert.equal(loadOverrides(join(dir, 'dashboard.lvgl.json')).ok, true);
});

test('a structure problem in the file is a warning in TODO.txt, not a failure', () => {
  const dir = mkdtempSync(join(scratch, 'warn-'));
  writeFileSync(join(dir, 'dashboard.ir.json'), readFileSync(join(here, 'golden-editor', 'ir_dashboard.json')));
  writeFileSync(join(dir, 'dashboard.lvgl.json'), JSON.stringify({
    version: 2, nodes: {}, structure: [{ op: 'move', name: 'does_not_exist', parent: null, index: 0 }],
  }));
  const result = spawnSync(process.execPath, [join(root, 'src', 'cli.mjs'), '--from-ir', join(dir, 'dashboard.ir.json'), '-o', join(dir, 'out')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(`${result.stdout}${result.stderr}`, /OVERRIDE_STRUCTURE_INVALID|no widget named "does_not_exist"/);
});

test('every tag the editor can add is emitted by all four emitters', () => {
  const ir = readIrFile(join(here, 'golden-editor', 'ir_dashboard.json'));
  for (const tag of ['lv_obj', 'lv_label', 'lv_button', 'lv_bar', 'lv_slider', 'lv_switch']) {
    const view = applyOverrides(ir.view, { version: 2, nodes: {}, structure: [{ op: 'add', name: 'added_widget', tag, parent: null, index: 0, attrs: { width: 40, height: 20 } }] });
    const { files } = emitFromIr(ir, { formats: ['xml', 'c', 'cpp', 'py'], view });
    const joined = Object.values(files).join('\n');
    assert.match(files['dashboard.xml'], new RegExp(`name="added_widget"`), `${tag} in XML`);
    assert.match(joined, /added_widget/, `${tag} reaches the generated code`);
    assert.ok(Object.keys(files).some((f) => f.endsWith('.c')) && Object.keys(files).some((f) => f.endsWith('.cpp')) && Object.keys(files).some((f) => f.endsWith('.py')), `${tag}: all formats produced`);
  }
});
