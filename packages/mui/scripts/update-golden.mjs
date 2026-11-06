#!/usr/bin/env node
/**
 * Regenerate this package's goldens: tests/golden{,-c,-cpp,-py}/ from the
 * extraction snapshots in tests/fixtures/<name>.json, converted with the
 * Material UI plugin's recognizers.
 *
 *   node packages/mui/scripts/update-golden.mjs            goldens from the committed snapshots
 *   node packages/mui/scripts/update-golden.mjs --extract  first re-render examples/<name>.jsx
 *                                                          in Chromium and refresh the snapshots
 *
 * A snapshot is what the React plugin extracts WITH framework data, so the
 * fiber-name matching is part of what the goldens pin. Snapshots are kept so
 * the conversion tests run without a browser.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../../../src/convert.mjs';
import { emitC, emitCpp } from '../../../src/emit-c.mjs';
import { emitPy } from '../../../src/emit-py.mjs';
import reactPlugin from '../../../src/plugins/react.mjs';
import { registryFor } from '../../../src/plugin-loader.mjs';
import muiPlugin from '../src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixtureDir = join(root, 'tests', 'fixtures');

/** Examples that have a snapshot, with the size they are rendered at. */
const EXAMPLES = ['settings', 'branded'];

if (process.argv.includes('--extract')) {
  for (const name of EXAMPLES) {
    const loaded = await reactPlugin.load(join(root, 'examples', `${name}.jsx`), { width: 320, height: 240, frameworkData: true });
    await loaded.handle.close();
    writeFileSync(join(fixtureDir, `${name}.json`), `${JSON.stringify(loaded.tree, null, 2)}\n`);
    console.log(`extracted tests/fixtures/${name}.json`);
  }
}

const dirs = Object.fromEntries(['golden', 'golden-c', 'golden-cpp', 'golden-py'].map((d) => [d, join(root, 'tests', d)]));
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

const registry = registryFor([muiPlugin]);
for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  const tree = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const { xml, view } = convert(tree, { name, registry });
  writeFileSync(join(dirs.golden, `${name}.xml`), xml);
  const c = emitC(view, { name });
  writeFileSync(join(dirs['golden-c'], `${c.unit}.c`), c.c);
  writeFileSync(join(dirs['golden-c'], `${c.unit}.h`), c.h);
  const cpp = emitCpp(view, { name });
  writeFileSync(join(dirs['golden-cpp'], `${cpp.unit}.cpp`), cpp.c);
  writeFileSync(join(dirs['golden-cpp'], `${cpp.unit}.hpp`), cpp.h);
  const py = emitPy(view, { name });
  writeFileSync(join(dirs['golden-py'], `${py.unit}.py`), py.py);
  console.log(`updated ${name}: xml, c, cpp, py`);
}
