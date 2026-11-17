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
  ['wrong version', { version: 2, nodes: {} }, false],
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
