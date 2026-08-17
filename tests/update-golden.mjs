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
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { render } from '../src/emit-xml.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const goldenDir = join(here, 'golden');
const goldenCDir = join(here, 'golden-c');
const goldenCppDir = join(here, 'golden-cpp');
const goldenReactDir = join(here, 'golden-react');
const goldenNavDir = join(here, 'golden-nav');
mkdirSync(goldenCDir, { recursive: true });
mkdirSync(goldenCppDir, { recursive: true });

const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
// *.nav.json fixtures form one multi-screen set that links to each other
const navScreens = new Set(fixtureFiles.filter((f) => f.endsWith('.nav.json')).map((f) => f.replace(/\.nav\.json$/, '')));

for (const file of fixtureFiles) {
  const react = file.endsWith('.react.json');
  const nav = file.endsWith('.nav.json');
  const name = file.replace(/(\.react|\.nav)?\.json$/, '');
  const tree = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const { xml, view } = convert(tree, {
    name,
    screenMode: nav,
    screens: nav ? navScreens : null,
  });

  if (nav) {
    mkdirSync(goldenNavDir, { recursive: true });
    writeFileSync(join(goldenNavDir, `${name}.xml`), xml);
    console.log(`updated golden-nav/${name}.xml`);
  } else if (react) {
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

  // C output stays flattened for all fixtures; screens get distinct entry
  // points so a multi-screen UI can link its units together. Nav fixtures are
  // prefixed here only to keep golden filenames unique alongside the
  // single-page fixture of the same name.
  const cName = nav ? `nav_${name}` : name;
  const symbol = nav ? `ui_${cName}_create` : 'ui_create';
  const { c, h, unit } = emitC(view, { name: cName, symbol });
  writeFileSync(join(goldenCDir, `${unit}.c`), c);
  writeFileSync(join(goldenCDir, `${unit}.h`), h);
  console.log(`updated golden-c/${unit}.c/.h`);

  const cpp = emitCpp(view, { name: cName, symbol });
  writeFileSync(join(goldenCppDir, `${cpp.unit}.cpp`), cpp.c);
  writeFileSync(join(goldenCppDir, `${cpp.unit}.hpp`), cpp.h);
  console.log(`updated golden-cpp/${cpp.unit}.cpp/.hpp`);
}
