import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script with JSDoc types
import { generateAll } from '../scripts/generate-types.mjs';

const editorRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('generated types', () => {
  it('match the JSON schemas: run `npm run generate:types` when this fails', async () => {
    const files = (await generateAll()) as Record<string, string>;
    expect(Object.keys(files).length).toBe(3);
    for (const [output, expected] of Object.entries(files)) {
      expect(readFileSync(join(editorRoot, output), 'utf8'), `${output} is stale`).toBe(expected);
    }
  });
});
