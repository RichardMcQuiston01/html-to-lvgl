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
import { emitPy } from '../src/emit-py.mjs';
import { render } from '../src/emit-xml.mjs';
import { demoRegistry } from './helpers/disclosure-demo.mjs';
import { convertInstances } from './helpers/xml-instance-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const goldenDir = join(here, 'golden');
const goldenCDir = join(here, 'golden-c');
const goldenCppDir = join(here, 'golden-cpp');
const goldenPyDir = join(here, 'golden-py');
const goldenReactDir = join(here, 'golden-react');
const goldenNavDir = join(here, 'golden-nav');
mkdirSync(goldenCDir, { recursive: true });
mkdirSync(goldenCppDir, { recursive: true });
mkdirSync(goldenPyDir, { recursive: true });

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
  // cName only disambiguates the golden *file* from a same-named non-nav
  // fixture (e.g. settings.json vs settings.nav.json); the exported symbol
  // must match cli.mjs's real multi-screen convention (ui_<screen>_create)
  // so a sibling screen's navigation callback can declare it extern and
  // actually link against it.
  const symbol = nav ? `ui_${name}_create` : 'ui_create';
  const { c, h, unit } = emitC(view, { name: cName, symbol });
  writeFileSync(join(goldenCDir, `${unit}.c`), c);
  writeFileSync(join(goldenCDir, `${unit}.h`), h);
  console.log(`updated golden-c/${unit}.c/.h`);

  const cpp = emitCpp(view, { name: cName, symbol });
  writeFileSync(join(goldenCppDir, `${cpp.unit}.cpp`), cpp.c);
  writeFileSync(join(goldenCppDir, `${cpp.unit}.hpp`), cpp.h);
  console.log(`updated golden-cpp/${cpp.unit}.cpp/.hpp`);

  const { py, unit: pyUnit } = emitPy(view, { name: cName, symbol });
  writeFileSync(join(goldenPyDir, `${pyUnit}.py`), py);
  console.log(`updated golden-py/${pyUnit}.py`);
}

// Behavior fixtures: converted as <screen>s (the disclosure one with the test-only
// components of tests/helpers/disclosure-demo.mjs, the rest with the real ones). Each writes <name>.xml and
// <name>.globals.xml; spike/subjects/run-generic.sh drives them in real LVGL.
const behaviorFixtureDir = join(here, 'fixtures-behavior');
const goldenBehaviorDir = join(here, 'golden-behavior');
mkdirSync(goldenBehaviorDir, { recursive: true });
for (const file of readdirSync(behaviorFixtureDir).filter((f) => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  const tree = JSON.parse(readFileSync(join(behaviorFixtureDir, file), 'utf8'));
  // `disclosure` uses the test-only demo components; every other behavior
  // fixture (accordion, ...) is converted by the shipped component definitions.
  const registry = name === 'disclosure' ? demoRegistry() : undefined;
  const { xml, globalsXml, view } = convert(tree, { name, screenMode: true, registry });
  writeFileSync(join(goldenBehaviorDir, `${name}.xml`), xml);
  writeFileSync(join(goldenBehaviorDir, `${name}.globals.xml`), globalsXml);
  console.log(`updated golden-behavior/${name}.xml and ${name}.globals.xml`);
  // MicroPython output; CI drives it with spike/micropython/run_py_behavior.py.
  const behaviorPy = emitPy(view, { name, symbol: `ui_${name}_create` });
  writeFileSync(join(goldenBehaviorDir, `${behaviorPy.unit}.py`), behaviorPy.py);
  console.log(`updated golden-behavior/${behaviorPy.unit}.py`);
}

// C and C++ for the behavior goldens (Phase 8 lane B): same trees as above,
// emitted with the screen entry point convention (ui_<screen>_create).
// spike/subjects/run-c.sh compiles and click-drives them in CI.
const behaviorUnits = [];
for (const file of readdirSync(behaviorFixtureDir).filter((f) => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');
  const tree = JSON.parse(readFileSync(join(behaviorFixtureDir, file), 'utf8'));
  behaviorUnits.push([name, convert(tree, { name, screenMode: true, registry: name === 'disclosure' ? demoRegistry() : undefined })]);
}
behaviorUnits.push(['acc_instances', convertInstances()]);
for (const [name, { view, subjects }] of behaviorUnits) {
  const opts = { name, symbol: `ui_${name}_create`, subjects };
  const c = emitC(view, opts);
  writeFileSync(join(goldenBehaviorDir, `${c.unit}.c`), c.c);
  writeFileSync(join(goldenBehaviorDir, `${c.unit}.h`), c.h);
  const cpp = emitCpp(view, opts);
  writeFileSync(join(goldenBehaviorDir, `${cpp.unit}.cpp`), cpp.c);
  writeFileSync(join(goldenBehaviorDir, `${cpp.unit}.hpp`), cpp.h);
  console.log(`updated golden-behavior/${c.unit}.c/.h and .cpp/.hpp`);
}
