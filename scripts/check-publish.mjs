#!/usr/bin/env node
/**
 * Pre-publish checks for one package of this repository, run by
 * .github/workflows/publish-packages.yml before `npm publish`.
 *
 *   node scripts/check-publish.mjs <package-dir> [--core-latest=<version>]
 *
 * Checks (each failure is one line on stderr, exit code 1):
 *   1. A scoped package must set publishConfig.access to "public"; npm
 *      publishes scoped packages as private (and fails) otherwise.
 *   2. A plugin package (one with a peerDependency on the core) must declare a
 *      core range that
 *        a. does not allow core versions older than the lowest one containing
 *           the features the plugin uses (CORE_FLOOR below), and
 *        b. is satisfied by the CURRENT published core (npm `latest`), because
 *           a plugin whose required core is not on npm yet would install into
 *           an unsupported combination. Publish the core first.
 *
 * Only the range syntax the packages here use is understood (`>=x.y.z`,
 * `^x.y.z`, `~x.y.z`, an exact version, and space-separated AND of those).
 * Anything else is rejected instead of guessed at, so the check fails closed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const CORE_NAME = '@richardmcquiston01/html-to-lvgl';

/**
 * The lowest core version each plugin package can run on, and why. The plugins
 * use core features that are NOT in the published 0.7.0: library-plugin
 * recognizers wired into the registry, `frameworkData` (node.framework),
 * `data-lv-source` stamping (node.source), and URL mode. They first ship in
 * core 0.8.0. Raise the number here whenever a plugin starts to rely on a
 * newer core feature; tests/publish-peer-ranges.test.mjs fails if a package's
 * peer range drops below it.
 */
export const CORE_FLOOR = { vue: '0.8.0', mui: '0.8.0' };

/** The newest published core release WITHOUT those features. */
export const LAST_CORE_WITHOUT_FEATURES = '0.7.0';

/** @param {string} v @returns {[number, number, number]} */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  if (!m) throw new Error(`"${v}" is not a version like 1.2.3`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** @returns {number} negative, 0 or positive like a - b */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Comparators for one range part as [op, version] pairs, all of which must hold.
 * @param {string} part
 */
function comparatorsOf(part) {
  const m = /^(>=|\^|~|=)?\s*(\d+\.\d+\.\d+)$/.exec(part);
  if (!m) throw new Error(`unsupported version range "${part}" (use >=x.y.z, ^x.y.z, ~x.y.z or x.y.z)`);
  const [major, minor, patch] = parseVersion(m[2]);
  const base = `${major}.${minor}.${patch}`;
  switch (m[1]) {
    case '>=': return [['>=', base]];
    case '^':
      // ^0.y.z only allows patch bumps of 0.y, ^0.0.z only z itself.
      if (major > 0) return [['>=', base], ['<', `${major + 1}.0.0`]];
      if (minor > 0) return [['>=', base], ['<', `0.${minor + 1}.0`]];
      return [['>=', base], ['<', `0.0.${patch + 1}`]];
    case '~': return [['>=', base], ['<', `${major}.${minor + 1}.0`]];
    default: return [['>=', base], ['<=', base]];
  }
}

/** Does `version` satisfy the range (space-separated comparators, ANDed)? */
export function satisfies(version, range) {
  return range.trim().split(/\s+/).flatMap(comparatorsOf).every(([op, v]) => {
    const c = compareVersions(version, v);
    return op === '>=' ? c >= 0 : op === '<' ? c < 0 : c <= 0;
  });
}

/**
 * The lowest version the range admits (the version after `>=`, `^`, `~`).
 * @param {string} range
 */
export function lowestVersion(range) {
  return range.trim().split(/\s+/).flatMap(comparatorsOf)
    .filter(([op]) => op === '>=').map(([, v]) => v)
    .reduce((lo, v) => (compareVersions(v, lo) > 0 ? v : lo));
}

/**
 * @param {string} dir          package directory ('.' for the root)
 * @param {{ coreLatest: string }} options  current published core version
 * @returns {string[]} one line per problem; empty when publishable
 */
export function checkPackage(dir, { coreLatest }) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const problems = [];
  if (pkg.name.startsWith('@') && pkg.publishConfig?.access !== 'public') {
    problems.push(`${pkg.name} is scoped, so package.json needs publishConfig.access = "public" (npm would otherwise publish it as restricted).`);
  }
  const range = pkg.peerDependencies?.[CORE_NAME];
  if (range === undefined) return problems;

  const key = Object.keys(CORE_FLOOR).find((k) => pkg.name.endsWith(`-${k}`));
  if (!key) {
    problems.push(`${pkg.name} has a core peer dependency but no entry in CORE_FLOOR (scripts/check-publish.mjs); add the lowest core version it needs.`);
    return problems;
  }
  try {
    const lowest = lowestVersion(range);
    if (compareVersions(lowest, CORE_FLOOR[key]) < 0) {
      problems.push(`${pkg.name} allows core ${lowest}, but it needs core >=${CORE_FLOOR[key]} (features missing from older cores). Raise the peerDependencies range.`);
    }
    if (!satisfies(coreLatest, range)) {
      problems.push(`${pkg.name} requires core "${range}" but the newest published core is ${coreLatest}. Publish the core first, then this plugin.`);
    }
  } catch (err) {
    problems.push(`${pkg.name}: ${err.message}`);
  }
  return problems;
}

/** The `latest` version of the core on the registry; throws when unreachable. */
function publishedCoreVersion() {
  const r = spawnSync('npm', ['view', CORE_NAME, 'version'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not read the published core version: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node scripts/check-publish.mjs <package-dir> [--core-latest=<version>]');
    process.exit(2);
  }
  const override = args.find((a) => a.startsWith('--core-latest='))?.slice('--core-latest='.length);
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const needsCore = pkg.peerDependencies?.[CORE_NAME] !== undefined;
    const coreLatest = override ?? (needsCore ? publishedCoreVersion() : '0.0.0');
    const problems = checkPackage(dir, { coreLatest });
    for (const p of problems) console.error(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log(`${pkg.name}@${pkg.version}: publish checks passed${needsCore ? ` (published core is ${coreLatest})` : ''}.`);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
