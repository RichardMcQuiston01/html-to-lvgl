#!/usr/bin/env node
/**
 * Regenerate tests/golden/<name>.xml from tests/fixtures/<name>.json.
 *
 * Fixtures are extraction snapshots (extract.mjs output) committed to the
 * repo so the conversion tests run without a browser. Refresh a fixture by
 * re-running the CLI with --debug and copying the JSON here.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const goldenDir = join(here, 'golden');

for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  const tree = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const { xml } = convert(tree, { name });
  writeFileSync(join(goldenDir, `${name}.xml`), xml);
  console.log(`updated golden/${name}.xml`);
}
