/**
 * Sidecar overrides: load, validate, apply, and the CLI wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { el, render } from '../src/emit-xml.mjs';
import { createDiagnostics, CODES } from '../src/diagnostics.mjs';
import { loadOverrides, validateOverrides, applyOverrides } from '../src/overrides.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'html2lvgl-ovr-'));

const sample = () => el('view', { width: 320, height: 240 }, [
  el('lv_obj', { name: 'card', width: 100, style_bg_color: '0x000000' }, [
    el('lv_label', { name: 'title', text: 'Hello' }),
    el('lv_label', { name: 'subtitle', text: 'World' }),
  ]),
  el('lv_button', { name: 'save_button' }, []),
]);
const find = (n, name) => n.attrs.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean);
const ovr = (nodes) => ({ version: 1, nodes });

test('loadOverrides: a missing file is ok with no overrides', () => {
  const r = loadOverrides(join(tmp(), 'nope.lvgl.json'));
  assert.deepEqual(r, { ok: true, overrides: null, errors: [] });
});

test('loadOverrides: malformed JSON and wrong version are not ok, never throw', () => {
  const d = tmp();
  writeFileSync(join(d, 'bad.json'), '{ nope');
  const bad = loadOverrides(join(d, 'bad.json'));
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not valid JSON/);
  writeFileSync(join(d, 'v2.json'), JSON.stringify({ version: 2, nodes: {} }));
  const v2 = loadOverrides(join(d, 'v2.json'));
  assert.equal(v2.ok, false);
  assert.match(v2.errors[0], /version/);
  writeFileSync(join(d, 'good.json'), JSON.stringify(ovr({ a: { remove: true } })));
  assert.equal(loadOverrides(join(d, 'good.json')).ok, true);
  assert.equal(loadOverrides(d).ok, false, 'a directory is unreadable, not a crash');
});

test('validateOverrides reports every problem at once', () => {
  assert.equal(validateOverrides(null).ok, false);
  assert.equal(validateOverrides({ version: 1, nodes: {} }).ok, true);
  const r = validateOverrides({
    version: 3,
    nodes: {
      a: { attrs: { w: [1], x: { y: 1 }, ok: null, s: 'v', n: 1, b: true }, remove: 'yes' },
      b: 'nope',
      c: { attrs: 5 },
    },
  });
  assert.equal(r.ok, false);
  const text = r.errors.join('\n');
  for (const frag of ['"version"', 'nodes.a.remove', 'nodes.a.attrs.w', 'nodes.a.attrs.x', 'nodes.b', 'nodes.c.attrs']) {
    assert.ok(text.includes(frag), `${frag} reported in:\n${text}`);
  }
  assert.ok(!text.includes('attrs.ok') && !text.includes('attrs.s') && !text.includes('attrs.n'));
  assert.match(validateOverrides({ version: 1, nodes: [] }).errors[0], /"nodes"/);
});

test('applyOverrides sets, replaces and removes attributes', () => {
  const out = applyOverrides(sample(), ovr({
    card: { attrs: { width: 120, style_bg_color: '0xff0000', scrollable: false, extra: 'x' } },
    title: { attrs: { text: null } },
  }));
  const card = find(out, 'card');
  assert.equal(card.attrs.width, 120);
  assert.equal(card.attrs.style_bg_color, '0xff0000');
  assert.equal(card.attrs.scrollable, 'false');
  assert.equal(card.attrs.extra, 'x');
  assert.ok(!('text' in find(out, 'title').attrs));
});

test('applyOverrides removes a node with its subtree, nested nodes work', () => {
  const out = applyOverrides(sample(), ovr({ subtitle: { remove: true }, save_button: { remove: true } }));
  assert.equal(find(out, 'subtitle'), undefined);
  assert.equal(find(out, 'save_button'), undefined);
  assert.ok(find(out, 'title'), 'sibling kept');
  const gone = applyOverrides(sample(), ovr({ card: { remove: true } }));
  assert.equal(find(gone, 'title'), undefined, 'subtree removed with its parent');
  assert.equal(find(applyOverrides(sample(), ovr({ subtitle: { attrs: { text: 'Hi' } } })), 'subtitle').attrs.text, 'Hi');
});

test('applyOverrides does not mutate its input', () => {
  const v = sample();
  const before = JSON.stringify(v);
  applyOverrides(v, ovr({ card: { attrs: { width: 1, style_bg_color: null } }, title: { remove: true } }));
  assert.equal(JSON.stringify(v), before);
});

test('an unknown name reports OVERRIDE_TARGET_UNKNOWN with closest matches', () => {
  const diagnostics = createDiagnostics();
  const out = applyOverrides(sample(), ovr({ save_buton: { attrs: { width: 5 } }, zzzzzz: { remove: true } }), { diagnostics });
  const [typo, far] = diagnostics.list();
  assert.equal(typo.code, 'OVERRIDE_TARGET_UNKNOWN');
  assert.match(typo.message, /save_button/);
  assert.match(typo.fix, /data-lv-name/);
  assert.match(far.message, /No similar names/);
  assert.equal(render(out), render(sample()), 'unknown targets change nothing');
  for (const d of diagnostics.list()) assert.ok(CODES[d.code] && d.fix.length > 10);
});

test('invalid attribute keys and values report OVERRIDE_ATTR_INVALID and are skipped', () => {
  const diagnostics = createDiagnostics();
  const out = applyOverrides(sample(), ovr({
    card: { attrs: { name: 'other', 'bad key': 1, width: { a: 1 }, height: 9 } },
  }), { diagnostics });
  assert.deepEqual(diagnostics.list().map((d) => d.code), Array(3).fill('OVERRIDE_ATTR_INVALID'));
  const card = find(out, 'card');
  assert.equal(card.attrs.name, 'card');
  assert.equal(card.attrs.width, 100);
  assert.equal(card.attrs.height, 9);
});

/* ------------------------------------------------------------------ CLI */

const html = `<!doctype html><html><body style="margin:0;background:#fff">
<div data-lv-name="panel" style="width:200px;height:100px;background:#00ff00">
  <p data-lv-name="heading" style="margin:0">Title</p>
  <p data-lv-name="note" style="margin:0">Remove me</p>
</div></body></html>`;

function run(args) {
  return spawnSync('node', [cli, ...args], { encoding: 'utf8' });
}

test('CLI: a sidecar next to the page changes XML and C; diagnostics are written', () => {
  const dir = tmp();
  const page = join(dir, 'screen.html');
  const outPlain = join(dir, 'plain');
  const out = join(dir, 'out');
  writeFileSync(page, html);

  const plain = run([page, '--format', 'xml,c', '-o', outPlain]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(readFileSync(join(outPlain, 'screen.xml'), 'utf8'), /name="note"/);
  const plainTodo = join(outPlain, 'TODO.txt');
  assert.ok(!existsSync(plainTodo) || !/OVERRIDE_/.test(readFileSync(plainTodo, 'utf8')), 'no sidecar, no override diagnostics');

  writeFileSync(join(dir, 'screen.lvgl.json'), JSON.stringify(ovr({
    panel: { attrs: { style_bg_color: '0xff0000', width: 150 } },
    note: { remove: true },
    headng: { attrs: { text: 'x' } },
  })));
  const r = run([page, '--format', 'xml,c', '-o', out]);
  assert.equal(r.status, 0, r.stderr);
  const xml = readFileSync(join(out, 'screen.xml'), 'utf8');
  assert.match(xml, /style_bg_color="0xff0000"/);
  assert.match(xml, /width="150"/);
  assert.ok(!xml.includes('name="note"'));
  const c = readFileSync(join(out, 'ui_screen.c'), 'utf8');
  assert.match(c, /ff0000/i, 'C output reflects the override');
  assert.ok(!/Remove me/.test(c), 'removed widget absent from C');

  const diags = JSON.parse(readFileSync(join(out, 'diagnostics.json'), 'utf8'));
  const list = Array.isArray(diags) ? diags : diags.diagnostics;
  const d = list.find((e) => e.code === 'OVERRIDE_TARGET_UNKNOWN');
  assert.ok(d, 'typo reported');
  assert.match(d.message, /heading/);
});

test('CLI: --overrides names an explicit file; an invalid sidecar is reported, output still written', () => {
  const dir = tmp();
  const page = join(dir, 'screen.html');
  writeFileSync(page, html);
  writeFileSync(join(dir, 'custom.json'), JSON.stringify(ovr({ note: { remove: true } })));
  const out = join(dir, 'out');
  assert.equal(run([page, '--overrides', join(dir, 'custom.json'), '-o', out]).status, 0);
  assert.ok(!readFileSync(join(out, 'screen.xml'), 'utf8').includes('name="note"'));

  writeFileSync(join(dir, 'screen.lvgl.json'), '{ broken');
  const out2 = join(dir, 'out2');
  const r = run([page, '-o', out2]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(out2, 'screen.xml'), 'utf8'), /name="note"/);
  assert.match(readFileSync(join(out2, 'TODO.txt'), 'utf8'), /OVERRIDE_FILE_INVALID/);

  run([page, '--overrides', join(dir, 'missing.json'), '-o', join(dir, 'out3')]);
  assert.match(readFileSync(join(dir, 'out3', 'TODO.txt'), 'utf8'), /does not exist/);
  assert.match(run(['--help']).stderr, /--overrides/);
});
