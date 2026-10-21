import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODES, createDiagnostics, formatJson, formatSummary, formatTodo } from '../src/diagnostics.mjs';

test('add() fills the default severity from the code registry', () => {
  const diagnostics = createDiagnostics();
  const entry = diagnostics.add({ code: 'IMAGE_REGISTER', message: 'register logo' });
  assert.equal(entry.severity, CODES.IMAGE_REGISTER.severity);
  assert.equal(entry.fix, '');
  assert.equal(entry.source, null);
  assert.equal(entry.output, null);
});

test('add() rejects an unknown code with a pointer to the registry', () => {
  const diagnostics = createDiagnostics();
  assert.throws(
    () => diagnostics.add({ code: 'NOT_A_CODE', message: 'x' }),
    /unknown diagnostic code "NOT_A_CODE".*CODES/,
  );
});

test('add() rejects an empty message and an unknown severity', () => {
  const diagnostics = createDiagnostics();
  assert.throws(() => diagnostics.add({ code: 'FONT_FALLBACK', message: '' }), /needs a message/);
  assert.throws(
    () => diagnostics.add({ code: 'FONT_FALLBACK', message: 'x', severity: 'fatal' }),
    /unknown severity "fatal"/,
  );
});

test('list() returns copies, so callers cannot change the log', () => {
  const diagnostics = createDiagnostics();
  diagnostics.add({ code: 'FONT_FALLBACK', message: 'x' });
  diagnostics.list()[0].message = 'changed';
  assert.equal(diagnostics.list()[0].message, 'x');
});

test('merge() appends another collector and toWarningStrings() keeps the old shape', () => {
  const a = createDiagnostics();
  const b = createDiagnostics();
  a.add({ code: 'FONT_FALLBACK', message: 'first' });
  b.add({ code: 'TAG_UNSUPPORTED', message: 'second' });
  a.merge(b);
  assert.equal(a.length, 2);
  assert.deepEqual(a.toWarningStrings(), ['first', 'second']);
});

test('formatTodo() is empty when there is nothing to do', () => {
  assert.equal(formatTodo([]), '');
});

test('formatTodo() groups by output file and puts General last', () => {
  const diagnostics = createDiagnostics();
  diagnostics.add({ code: 'FONT_FALLBACK', message: 'no font map for "Roboto"', fix: 'pass --font-map' });
  diagnostics.add({
    code: 'TAG_UNSUPPORTED',
    message: '<canvas> is not supported; skipped',
    output: { file: 'ui_home.xml' },
    source: { file: 'src/App.tsx', line: 42 },
  });
  const text = formatTodo(diagnostics.list());
  assert.ok(text.indexOf('ui_home.xml') < text.indexOf('General'));
  assert.match(text, /\[TAG_UNSUPPORTED\] \(src\/App\.tsx:42\)/);
  assert.match(text, /Fix: pass --font-map/);
});

test('formatTodo() lists errors before warnings and names the widget', () => {
  const diagnostics = createDiagnostics();
  diagnostics.add({ code: 'TAG_UNSUPPORTED', message: 'warn', output: { file: 'a.xml' } });
  diagnostics.add({
    code: 'TAG_UNSUPPORTED',
    message: 'err',
    severity: 'error',
    output: { file: 'a.xml', widget: 'icon_menu' },
  });
  const text = formatTodo(diagnostics.list());
  assert.ok(text.indexOf('err') < text.indexOf('warn'));
  assert.match(text, /\[TAG_UNSUPPORTED\] icon_menu/);
});

test('duplicate entries are reported once', () => {
  const diagnostics = createDiagnostics();
  for (let i = 0; i < 3; i += 1) diagnostics.add({ code: 'FONT_FALLBACK', message: 'same' });
  assert.equal(formatTodo(diagnostics.list()).match(/\[FONT_FALLBACK\]/g).length, 1);
  assert.equal(JSON.parse(formatJson(diagnostics.list())).diagnostics.length, 1);
});

test('formatJson() carries a version for tools', () => {
  const parsed = JSON.parse(formatJson([]));
  assert.deepEqual(parsed, { version: 1, diagnostics: [] });
});

test('formatSummary() counts by severity and points at TODO.txt', () => {
  const diagnostics = createDiagnostics();
  diagnostics.add({ code: 'FONT_FALLBACK', message: 'a' });
  diagnostics.add({ code: 'TAG_UNSUPPORTED', message: 'b' });
  diagnostics.add({ code: 'IMAGE_REGISTER', message: 'c' });
  assert.deepEqual(formatSummary(diagnostics.list(), { todoPath: 'out/TODO.txt' }), [
    '2 warnings, 1 info. See out/TODO.txt for what to do about them.',
  ]);
  assert.deepEqual(formatSummary([]), []);
});
