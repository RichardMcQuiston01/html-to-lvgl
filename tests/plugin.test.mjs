import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLUGIN_API, validatePlugin } from '../src/plugin.mjs';

const goodFramework = () => ({
  name: 'react',
  pluginApi: PLUGIN_API,
  extensions: ['.jsx', '.tsx'],
  load: async () => ({ tree: {} }),
});

test('a framework plugin with load and extensions is valid', () => {
  assert.deepEqual(validatePlugin(goodFramework()), { ok: true, errors: [] });
});

test('a library plugin with only recognizers is valid', () => {
  const result = validatePlugin({ name: 'mui', pluginApi: PLUGIN_API, recognizers: [] });
  assert.equal(result.ok, true);
});

test('a non-object is rejected without throwing', () => {
  assert.equal(validatePlugin(null).ok, false);
  assert.equal(validatePlugin('react').ok, false);
});

test('a version mismatch names both versions and says what to do', () => {
  const result = validatePlugin({ ...goodFramework(), pluginApi: 0 });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /built for plugin API 0.*uses plugin API 1.*update/);
});

test('every problem is reported at once', () => {
  const result = validatePlugin({ pluginApi: 99, extensions: ['jsx'], load: 'nope' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4, result.errors.join('\n'));
});

test('a plugin that provides nothing is rejected', () => {
  const result = validatePlugin({ name: 'empty', pluginApi: PLUGIN_API });
  assert.match(result.errors.join('\n'), /provides nothing/);
});

test('a load hook without extensions is rejected', () => {
  const { extensions, ...noExtensions } = goodFramework();
  const result = validatePlugin(noExtensions);
  assert.match(result.errors.join('\n'), /no `extensions`/);
});

test('hooks must be functions and extensions must start with a dot', () => {
  const result = validatePlugin({ ...goodFramework(), sourceOf: {}, extensions: ['jsx'] });
  const text = result.errors.join('\n');
  assert.match(text, /`sourceOf` must be a function/);
  assert.match(text, /`extensions` must be an array of strings like "\.jsx"/);
});
