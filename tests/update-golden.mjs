#!/usr/bin/env node
/**
 * Regenerate tests/golden/<name>.xml from tests/fixtures/<name>.json.
 *
 * Fixtures are extraction snapshots (extract.mjs output) committed to the
 * repo so the conversion tests run without a browser. Refresh a fixture by
 * re-running the CLI with --debug and copying the JSON here.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { emitC } from '../src/emit-c.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const goldenDir = join(here, 'golden');
const goldenCDir = join(here, 'golden-c');
mkdirSync(goldenCDir, { recursive: true });

for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  const tree = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const { xml, view } = convert(tree, { name });
  writeFileSync(join(goldenDir, `${name}.xml`), xml);
  const { c, h, unit } = emitC(view, { name });
  writeFileSync(join(goldenCDir, `${unit}.c`), c);
  writeFileSync(join(goldenCDir, `${unit}.h`), h);
  console.log(`updated golden/${name}.xml + golden-c/${unit}.c/.h`);
}
