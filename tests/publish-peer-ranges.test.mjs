/**
 * Peer ranges and the pre-publish check (scripts/check-publish.mjs): a plugin
 * must not claim to run on a core that lacks the features it uses, and must
 * not be published before the core it needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  CORE_NAME, CORE_FLOOR, LAST_CORE_WITHOUT_FEATURES,
  satisfies, lowestVersion, compareVersions, checkPackage,
} from '../scripts/check-publish.mjs';
import { PLUGIN_API } from '../src/plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readPkg = (dir) => JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
const PLUGINS = { vue: 'packages/vue', mui: 'packages/mui' };

test('the core floor is newer than the last core without the plugin features', () => {
  // Recognizers wiring, frameworkData, data-lv-source stamping and URL mode are
  // absent from 0.7.0 (see CHANGELOG.md, [Unreleased] when this was written).
  for (const [key, floor] of Object.entries(CORE_FLOOR)) {
    assert.ok(compareVersions(floor, LAST_CORE_WITHOUT_FEATURES) > 0, `${key} floor ${floor}`);
  }
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  assert.ok(released.includes(LAST_CORE_WITHOUT_FEATURES), 'CHANGELOG lists the last core without the features');
});

for (const [key, dir] of Object.entries(PLUGINS)) {
  test(`${key}: the core peer range does not admit a core below the floor`, () => {
    const range = readPkg(dir).peerDependencies[CORE_NAME];
    assert.ok(range, 'declares a peer dependency on the core');
    assert.ok(compareVersions(lowestVersion(range), CORE_FLOOR[key]) >= 0, `${range} vs floor ${CORE_FLOOR[key]}`);
    assert.equal(satisfies(LAST_CORE_WITHOUT_FEATURES, range), false, `${range} must exclude ${LAST_CORE_WITHOUT_FEATURES}`);
  });

  test(`${key}: pluginApi matches the core's PLUGIN_API and publishConfig is public`, () => {
    const pkg = readPkg(dir);
    assert.equal(pkg.publishConfig?.access, 'public');
    assert.equal(pkg.private, undefined);
    const src = readFileSync(join(root, dir, 'src/index.mjs'), 'utf8');
    assert.match(src, new RegExp(`(PLUGIN_API|PLUGIN_API_BUILT_FOR) = ${PLUGIN_API};`));
  });

  test(`${key}: checkPackage passes with a new enough core and refuses an older one`, () => {
    assert.deepEqual(checkPackage(join(root, dir), { coreLatest: '0.8.0' }), []);
    assert.deepEqual(checkPackage(join(root, dir), { coreLatest: '1.4.2' }), []);
    const old = checkPackage(join(root, dir), { coreLatest: '0.7.0' });
    assert.equal(old.length, 1);
    assert.match(old[0], /newest published core is 0\.7\.0.*Publish the core first/);
  });
}

test('range arithmetic: >=, ^, ~, exact and combined ranges; unsupported syntax throws', () => {
  assert.equal(satisfies('0.8.0', '>=0.8.0'), true);
  assert.equal(satisfies('0.7.9', '>=0.8.0'), false);
  assert.equal(satisfies('0.8.5', '^0.8.0'), true);
  assert.equal(satisfies('0.9.0', '^0.8.0'), false, '^0.y is limited to the minor');
  assert.equal(satisfies('1.9.0', '^1.2.0'), true);
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  assert.equal(satisfies('0.8.9', '~0.8.1'), true);
  assert.equal(satisfies('0.9.0', '~0.8.1'), false);
  assert.equal(satisfies('0.8.0', '0.8.0'), true);
  assert.equal(satisfies('0.8.1', '0.8.0'), false);
  assert.equal(satisfies('0.8.2', '>=0.8.0 <0.9.0'.replace('<0.9.0', '~0.8.1')), true);
  assert.equal(lowestVersion('>=0.8.0'), '0.8.0');
  assert.equal(lowestVersion('^0.9.1'), '0.9.1');
  assert.throws(() => satisfies('1.0.0', '*'), /unsupported version range/);
  assert.throws(() => satisfies('1.0.0', '>=1.0'), /unsupported version range/);
  assert.throws(() => satisfies('1.0.0', '1.x || 2.x'), /unsupported/);
});

test('checkPackage: scoped without public access, low range, unknown plugin and bad range are reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'h2l-check-'));
  const write = (pkg) => writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  try {
    write({ name: '@x/html-to-lvgl-vue', version: '1.0.0', peerDependencies: { [CORE_NAME]: '>=0.7.0' } });
    const problems = checkPackage(dir, { coreLatest: '0.8.0' });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /publishConfig\.access/);
    assert.match(problems[1], /allows core 0\.7\.0.*needs core >=0\.8\.0/);

    write({ name: '@x/html-to-lvgl-other', version: '1.0.0', publishConfig: { access: 'public' }, peerDependencies: { [CORE_NAME]: '>=0.8.0' } });
    assert.match(checkPackage(dir, { coreLatest: '0.8.0' })[0], /no entry in CORE_FLOOR/);

    write({ name: '@x/html-to-lvgl-vue', version: '1.0.0', publishConfig: { access: 'public' }, peerDependencies: { [CORE_NAME]: '*' } });
    assert.match(checkPackage(dir, { coreLatest: '0.8.0' })[0], /unsupported version range/);

    // The core itself has no core peer dependency, only the access rule.
    write({ name: CORE_NAME, version: '0.8.0', publishConfig: { access: 'public' } });
    assert.deepEqual(checkPackage(dir, { coreLatest: '0.0.0' }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI form exits 1 with an ::error:: line when the core is too old, 0 when it is current', () => {
  const run = (latest) => spawnSync(process.execPath, [join(root, 'scripts/check-publish.mjs'), join(root, PLUGINS.vue), `--core-latest=${latest}`], { encoding: 'utf8' });
  const bad = run('0.7.0');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^::error::/);
  const good = run('0.8.0');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /publish checks passed/);
});
