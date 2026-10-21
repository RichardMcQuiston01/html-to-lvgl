/**
 * Every warning the converter can raise is a coded diagnostic with a fix
 * line, and the CLI turns them into TODO.txt and diagnostics.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { componentize } from '../src/componentize.mjs';
import { fontDiagnostics, fontWarnings } from '../src/fonts-build.mjs';
import { CODES, createDiagnostics } from '../src/diagnostics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');
const dashboard = join(here, '..', 'examples', 'dashboard.html');

function base() {
  return {
    bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null,
  };
}
function block() {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto',
  };
}
const node = (tag, extra = {}) => ({
  tag, x: 0, y: 0, w: 100, h: 40, text: null, attrs: {}, styles: base(), layout: block(), children: [], ...extra,
});
const page = (...children) => node('body', { w: 320, h: 240, children });

function assertComplete(entries) {
  for (const d of entries) {
    assert.ok(CODES[d.code], `${d.code} is registered`);
    assert.ok(d.fix.length > 10, `${d.code} has a concrete fix line`);
  }
}

function runCli(file, out) {
  const r = spawnSync('node', [cli, file, '-o', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

test('convert() returns diagnostics and matching warning strings', () => {
  const { diagnostics, warnings } = convert(page(node('canvas', { id: 'chart' })));
  const [d] = diagnostics.list();
  assert.equal(d.code, 'TAG_UNSUPPORTED');
  assert.equal(d.source.selector, '#chart');
  assert.deepEqual(warnings, diagnostics.toWarningStrings());
  assertComplete(diagnostics.list());
});

test('diagnostic source selectors prefer the stable node key', () => {
  const sel = (n) => convert(page(n)).diagnostics.list()[0].source.selector;
  assert.equal(sel(node('canvas', { key: 'body/canvas[0]' })), 'body/canvas[0]');
  assert.equal(sel(node('canvas', { id: 'chart', key: '#chart' })), '#chart');
  assert.equal(sel(node('canvas', { lvName: 'c', key: 'name:c' })), 'name:c');
  // No key: the old fallbacks still apply
  assert.equal(sel(node('canvas')), '<canvas>');
  assert.equal(sel(node('canvas', { lvName: 'c' })), '[data-lv-name="c"]');
});

test('unknown data-lv-widget reports WIDGET_UNSUPPORTED', () => {
  const { diagnostics } = convert(page(node('div', { widget: 'hologram' })));
  assert.deepEqual(diagnostics.list().map((d) => d.code), ['WIDGET_UNSUPPORTED']);
  assertComplete(diagnostics.list());
});

test('unmatched data-lv-link reports LINK_TARGET_UNKNOWN', () => {
  const { diagnostics } = convert(page(node('button', { link: 'nowhere.html', text: 'Go' })), {
    screens: new Set(['settings']), screenMode: true,
  });
  assert.deepEqual(diagnostics.list().map((d) => d.code), ['LINK_TARGET_UNKNOWN']);
  assertComplete(diagnostics.list());
});

test('align-items: baseline reports BASELINE_ALIGN_UNSUPPORTED', () => {
  const flex = node('div', {
    layout: { ...block(), display: 'flex', alignItems: 'baseline' },
    children: [node('span', { text: 'a' }), node('span', { text: 'b' })],
  });
  const { diagnostics } = convert(page(flex));
  assert.ok(diagnostics.list().some((d) => d.code === 'BASELINE_ALIGN_UNSUPPORTED'));
  assertComplete(diagnostics.list());
});

test('an image reports IMAGE_REGISTER as info and names the widget', () => {
  const { diagnostics, xml } = convert(page(node('img', { attrs: { src: 'img/logo.png' } })));
  const [d] = diagnostics.list();
  assert.equal(d.code, 'IMAGE_REGISTER');
  assert.equal(d.severity, 'info');
  assert.ok(d.output.widget);
  assert.ok(xml.includes(`name="${d.output.widget}"`), 'widget name matches the emitted element');
  assertComplete([d]);
});

test('componentize() reports COMPONENT_* codes with the component as widget', () => {
  const label = (text) => ({ tag: 'lv_label', attrs: { text }, children: [] });
  const inst = (n, attrs, children) => ({ tag: 'lv_obj', attrs: { name: `c${n}`, ...attrs }, children, meta: { component: 'Card' } });
  const view = (...c) => ({ tag: 'view', attrs: {}, children: c });

  const structural = componentize(view(inst(1, {}, [label('x')]), inst(2, {}, [])));
  assert.equal(structural.diagnostics.list()[0].code, 'COMPONENT_INLINE');
  assert.equal(structural.diagnostics.list()[0].output.widget, 'card');

  const styled = componentize(view(inst(1, { style_radius: 1 }, []), inst(2, { style_radius: 9 }, [])));
  const [d] = styled.diagnostics.list();
  assert.equal(d.code, 'COMPONENT_ATTR_NOT_PROPPABLE');
  assert.match(d.message, /non-proppable attribute "style_radius"/);
  assert.deepEqual(styled.warnings, [d.message]);

  const shared = createDiagnostics();
  componentize(view(inst(1, {}, [label('x')]), inst(2, {}, [])), { diagnostics: shared });
  assert.equal(shared.length, 1);
  assertComplete([...structural.diagnostics.list(), d, ...shared.list()]);
});

test('fontDiagnostics() gives one FONT_FALLBACK per named family and matches fontWarnings()', () => {
  const unresolved = [
    { family: 'Inter', size: 12, generic: false },
    { family: 'Inter', size: 16, generic: false },
    { family: 'sans-serif', size: 12, generic: true },
  ];
  const list = fontDiagnostics(unresolved);
  assert.equal(list.length, 1);
  assert.equal(list[0].code, 'FONT_FALLBACK');
  assert.match(list[0].fix, /--font-map "Inter=/);
  assert.deepEqual(fontWarnings(unresolved), [list[0].message]);
  const c = createDiagnostics();
  for (const d of list) c.add(d);
  assertComplete(c.list());
});

test('the CLI writes TODO.txt and diagnostics.json, prints a summary, and clears them on a clean run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'html2lvgl-diag-'));
  const input = join(dir, 'problem.html');
  writeFileSync(input, '<!doctype html><body style="margin:0"><canvas id="chart" width="100" height="50"></canvas><video width="10" height="10"></video><p>hi</p></body>');
  const out = join(dir, 'out');

  const first = runCli(input, out);
  const todo = readFileSync(join(out, 'TODO.txt'), 'utf8');
  assert.match(todo, /problem\.xml/);
  assert.match(todo, /\[TAG_UNSUPPORTED\]/);
  assert.match(todo, /Fix: /);
  const json = JSON.parse(readFileSync(join(out, 'diagnostics.json'), 'utf8'));
  assert.equal(json.version, 1);
  const entry = json.diagnostics.find((d) => d.code === 'TAG_UNSUPPORTED');
  assert.equal(entry.output.file, 'problem.xml');
  assert.equal(entry.source.file, input);
  // One summary line instead of one console line per warning.
  assert.match(first.stderr, /warnings?\. See .*TODO\.txt/);
  assert.doesNotMatch(first.stderr, /^warning: /m);

  // Same output directory, now a page with nothing to report: stale files go.
  const second = runCli(dashboard, out);
  assert.ok(!existsSync(join(out, 'TODO.txt')));
  assert.ok(!existsSync(join(out, 'diagnostics.json')));
  assert.doesNotMatch(second.stderr, /TODO\.txt/);
});

test('a clean example writes no TODO.txt', () => {
  const out = mkdtempSync(join(tmpdir(), 'html2lvgl-diag-'));
  runCli(dashboard, out);
  assert.ok(!existsSync(join(out, 'TODO.txt')));
});
