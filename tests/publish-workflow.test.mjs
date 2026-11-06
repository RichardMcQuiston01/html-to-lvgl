/**
 * The publish workflows are checked structurally (no YAML dependency: the
 * repository has none, and these files use a small, regular subset). The
 * tests assert that every guard exists, that each tag pattern selects exactly
 * one workflow and package, and that nothing can publish without a tag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, '.github/workflows', f), 'utf8');
const core = read('publish.yml');
const plugins = read('publish-packages.yml');

/** The quoted patterns listed under `tags:` of the push trigger. */
function tagPatterns(text) {
  const m = /^on:\n {2}push:\n {4}tags:\n((?: {6}- .*\n)+)/m.exec(text);
  assert.ok(m, 'an `on.push.tags` list exists');
  return [...m[1].matchAll(/- '([^']+)'/g)].map((x) => x[1]);
}

/**
 * GitHub's filter-pattern glob as a RegExp: `*` any run without `/`, `+`
 * repeats the previous item, `[...]` is a class, everything else (including
 * `.`) is literal.
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '[') { const j = glob.indexOf(']', i); re += glob.slice(i, j + 1); i = j; }
    else if (c === '*') re += '[^/]*';
    else if (c === '+') re += '+';
    else re += c.replace(/[.\\^$|(){}?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matching = (text, tag) => tagPatterns(text).filter((p) => globToRegExp(p).test(tag));

test('publish.yml still triggers only on plain and v-prefixed version tags', () => {
  assert.deepEqual(tagPatterns(core), ['[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+']);
  assert.doesNotMatch(core, /workflow_dispatch/, 'the core workflow is unchanged: no manual trigger');
});

test('publish-packages.yml triggers on vue-v and mui-v tags and a manual run', () => {
  assert.deepEqual(tagPatterns(plugins), ['vue-v[0-9]+.[0-9]+.[0-9]+', 'mui-v[0-9]+.[0-9]+.[0-9]+']);
  assert.match(plugins, /^ {2}workflow_dispatch:\n {4}inputs:\n(?:.*\n)*? {6}dryRun:\n/m);
});

test('every tag selects exactly one workflow, and malformed tags select none', () => {
  const cases = {
    '0.7.1': [core, 1], 'v0.7.1': [core, 1], '12.0.30': [core, 1],
    'vue-v0.1.0': [plugins, 1], 'mui-v0.1.0': [plugins, 1], 'vue-v10.20.30': [plugins, 1],
  };
  for (const [tag, [owner, count]] of Object.entries(cases)) {
    const inCore = matching(core, tag).length, inPlugins = matching(plugins, tag).length;
    assert.equal(inCore + inPlugins, count, `${tag} matches ${inCore + inPlugins} patterns`);
    assert.equal(matching(owner, tag).length, count, `${tag} belongs to the expected workflow`);
  }
  for (const tag of ['vue-v0.1', 'vue-0.1.0', 'vuex-v0.1.0', 'mui-v0.1.0-rc1', 'v-vue-0.1.0', 'vue-v', 'x-vue-v0.1.0', '0.1.0-beta', 'ui-v0.1.0', '0.1.0.1', 'core-v0.8.0']) {
    assert.equal(matching(core, tag).length + matching(plugins, tag).length, 0, `${tag} publishes nothing`);
  }
});

const GUARDS = [
  ['checkout keeps full history', /fetch-depth: 0/],
  ['checkout does not persist credentials', /persist-credentials: false/],
  ['tag commit must be on main', /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/],
  ['tag must equal the package.json version', /package_version=.*package\.json'\)\.version/],
  ['refuses a mismatch', /does not match/],
  ['installs a test typeface', /apt-get install -y fonts-liberation/],
  ['npm ci', /^\s+- run: npm ci$/m],
  ['playwright install', /npx playwright install --with-deps chromium/],
  ['npm test', /^\s+- run: npm test$/m],
  ['publishes with the NPM_TOKEN secret', /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/],
  ['serialises publishes', /concurrency:\n {2}group: publish-npm\n {2}cancel-in-progress: false/],
  ['read-only token permissions', /permissions:\n {2}contents: read/],
  ['pins actions by commit', /actions\/checkout@[0-9a-f]{40}/],
  ['uses the npm registry', /registry-url: 'https:\/\/registry\.npmjs\.org'/],
];
for (const [name, workflow] of [['publish.yml', core], ['publish-packages.yml', plugins]]) {
  for (const [what, re] of GUARDS) test(`${name}: ${what}`, () => assert.match(workflow, re));

  test(`${name}: the guards run before npm test and publish, in order`, () => {
    const at = (re) => { const i = workflow.search(re); assert.ok(i >= 0, String(re)); return i; };
    const order = [/merge-base --is-ancestor/, /package_version=/, /apt-get install -y fonts-liberation/,
      /run: npm ci/, /playwright install/, /run: npm test/, /- name: Publish \(dry run\)|- run: npm publish/].map(at);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test(`${name}: npm publish only ever sees the token in the real publish step`, () => {
    assert.equal(workflow.match(/NPM_TOKEN/g).length, 1);
    const step = workflow.slice(workflow.lastIndexOf('- name: Publish\n') >= 0 ? workflow.lastIndexOf('- name: Publish\n') : workflow.lastIndexOf('- run: npm publish'));
    assert.match(step, /NODE_AUTH_TOKEN/);
  });
}

test('publish-packages.yml: package selection, plugin checks, dry run and scoped access', () => {
  assert.match(plugins, /vue-v\*\) key=vue/);
  assert.match(plugins, /mui-v\*\) key=mui/);
  assert.match(plugins, /vue\) dir=packages\/vue/);
  assert.match(plugins, /mui\) dir=packages\/mui/);
  assert.match(plugins, /tag_version="\$\{GITHUB_REF_NAME#"\$PKG_KEY"-v\}"/, 'the tag prefix is stripped before the version comparison');
  assert.match(plugins, /node scripts\/check-publish\.mjs/);
  assert.match(plugins, /npm publish -w "\$PKG_NAME" --dry-run/);
  assert.match(plugins, /npm publish -w "\$\{\{ steps\.pkg\.outputs\.name \}\}" --access public/);
  assert.doesNotMatch(plugins, /--provenance/, 'provenance is not used by the core job, so not here either');
});

test('publish-packages.yml: tag-only guards, and a manual run can never publish', () => {
  for (const name of ['Require the tag to point at a commit on main', 'Require the tag to match the package\'s package.json version']) {
    const i = plugins.indexOf(`- name: ${name}`);
    assert.ok(i >= 0, name);
    assert.match(plugins.slice(i, i + 120), /if: github\.event_name == 'push'/, name);
  }
  assert.match(plugins, /name: Refuse a real publish from a manual run\n\s+if: github\.event_name == 'workflow_dispatch' && !inputs\.dryRun/);
  // The only `npm publish` without --dry-run is gated on a push event.
  const real = plugins.slice(plugins.indexOf('- name: Publish\n'));
  assert.match(real, /if: github\.event_name == 'push'/);
  const dry = plugins.slice(plugins.indexOf('- name: Publish (dry run)'), plugins.indexOf('- name: Publish\n'));
  assert.match(dry, /if: github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(dry, /NODE_AUTH_TOKEN|secrets\./, 'a dry run never receives the token');
});

test('both workflows share a concurrency group so core and plugin publishes never overlap', () => {
  const group = (t) => /group: (\S+)/.exec(t)[1];
  assert.equal(group(core), group(plugins));
});
