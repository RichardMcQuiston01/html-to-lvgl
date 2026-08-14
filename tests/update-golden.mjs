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
import { componentize } from '../src/componentize.mjs';
import { emitC } from '../src/emit-c.mjs';
import { render } from '../src/emit-xml.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const goldenDir = join(here, 'golden');
const goldenCDir = join(here, 'golden-c');
const goldenReactDir = join(here, 'golden-react');
mkdirSync(goldenCDir, { recursive: true });

for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) {
  const react = file.endsWith('.react.json');
  const name = file.replace(/(\.react)?\.json$/, '');
  const tree = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const { xml, view } = convert(tree, { name });

  if (react) {
    // React fixtures produce a componentized golden directory
    const dir = join(goldenReactDir, name);
    mkdirSync(dir, { recursive: true });
    const { view: pageView, components } = componentize(view);
    writeFileSync(join(dir, `${name}.xml`), `<component>\n${render(pageView, 1)}\n</component>\n`);
    for (const [cname, cxml] of components) writeFileSync(join(dir, `${cname}.xml`), cxml);
    console.log(`updated golden-react/${name}/ (${components.size + 1} files)`);
  } else {
    writeFileSync(join(goldenDir, `${name}.xml`), xml);
    console.log(`updated golden/${name}.xml`);
  }

  // C output stays flattened for all fixtures, React included
  const { c, h, unit } = emitC(view, { name });
  writeFileSync(join(goldenCDir, `${unit}.c`), c);
  writeFileSync(join(goldenCDir, `${unit}.h`), h);
  console.log(`updated golden-c/${unit}.c/.h`);
}
