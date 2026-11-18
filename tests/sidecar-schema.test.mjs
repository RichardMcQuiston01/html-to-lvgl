/**
 * The sidecar JSON Schema (src/schemas/sidecar.schema.json) must accept and
 * reject the same documents as validateOverrides() (src/overrides.mjs), which
 * stays the authority. The editor's TypeScript types are generated from the
 * schema, so a drift between the two would put wrong types in the editor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOverrides } from '../src/overrides.mjs';
import { validateJsonSchema } from './helpers/json-schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '..', 'src', 'schemas', 'sidecar.schema.json'), 'utf8'));

/** [label, document, expected ok] */
const cases = [
  ['minimal', { version: 1, nodes: {} }, true],
  ['attrs of every allowed value type', { version: 1, nodes: { card: { attrs: { width: 120, style_bg_color: '0xff0000', scrollable: false, text: null } } } }, true],
  ['remove', { version: 1, nodes: { card_2: { remove: true } } }, true],
  ['state suffix in a key', { version: 1, nodes: { start: { attrs: { 'style_bg_color:pressed': '0x000000' } } } }, true],
  ['unknown extra keys are tolerated', { version: 1, note: 'x', nodes: { a: { attrs: {}, comment: 'y' } } }, true],
  ['version 2', { version: 2, nodes: {} }, true],
  ['wrong version', { version: 3, nodes: {} }, false],
  ['add and move', { version: 2, nodes: {}, structure: [{ op: 'add', name: 'n', tag: 'lv_label', parent: null, index: 0, attrs: { text: 'x', width: 4, f: true } }, { op: 'move', name: 'a', parent: 'panel', index: 2 }] }, true],
  ['empty structure', { version: 2, nodes: {}, structure: [] }, true],
  ['structure is not an array', { version: 2, nodes: {}, structure: {} }, false],
  ['unknown op', { version: 2, nodes: {}, structure: [{ op: 'rotate' }] }, false],
  ['add without a tag', { version: 2, nodes: {}, structure: [{ op: 'add', name: 'n', parent: null, index: 0 }] }, false],
  ['add with a bad tag', { version: 2, nodes: {}, structure: [{ op: 'add', name: 'n', tag: 'label', parent: null, index: 0 }] }, false],
  ['bad name', { version: 2, nodes: {}, structure: [{ op: 'move', name: '1a', parent: null, index: 0 }] }, false],
  ['negative index', { version: 2, nodes: {}, structure: [{ op: 'move', name: 'a', parent: null, index: -1 }] }, false],
  ['fractional index', { version: 2, nodes: {}, structure: [{ op: 'move', name: 'a', parent: null, index: 0.5 }] }, false],
  ['a move with an unknown key', { version: 2, nodes: {}, structure: [{ op: 'move', name: 'a', parent: null, index: 0, tag: 'lv_obj' }] }, false],
  ['null attr in an add', { version: 2, nodes: {}, structure: [{ op: 'add', name: 'n', tag: 'lv_obj', parent: null, index: 0, attrs: { w: null } }] }, false],
  ['missing version', { nodes: {} }, false],
  ['missing nodes', { version: 1 }, false],
  ['nodes is an array', { version: 1, nodes: [] }, false],
  ['node is a string', { version: 1, nodes: { a: 'x' } }, false],
  ['remove is not a boolean', { version: 1, nodes: { a: { remove: 'yes' } } }, false],
  ['attrs is an array', { version: 1, nodes: { a: { attrs: [] } } }, false],
  ['attr value is an object', { version: 1, nodes: { a: { attrs: { width: { px: 1 } } } } }, false],
  ['a bad attr key is valid here (applying the sidecar skips it with a diagnostic)', { version: 1, nodes: { a: { attrs: { 'bad key': 1 } } } }, true],
  ['top level is an array', [], false],
  ['top level is null', null, false],
];

for (const [label, doc, expected] of cases) {
  test(`sidecar schema and validateOverrides agree: ${label}`, () => {
    const byFunction = validateOverrides(doc).ok;
    const bySchema = validateJsonSchema(doc, schema).length === 0;
    assert.equal(byFunction, expected, 'validateOverrides');
    assert.equal(bySchema, expected, `schema (${validateJsonSchema(doc, schema).join('; ')})`);
  });
}

test('the one rule the schema cannot express: structure needs version 2, which validateOverrides enforces', () => {
  const doc = { version: 1, nodes: {}, structure: [{ op: 'move', name: 'a', parent: null, index: 0 }] };
  assert.equal(validateJsonSchema(doc, schema).length, 0, 'the schema alone accepts it');
  assert.equal(validateOverrides(doc).ok, false);
  assert.match(validateOverrides(doc).errors.join(' '), /needs "version": 2/);
});
