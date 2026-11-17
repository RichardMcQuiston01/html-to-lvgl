/**
 * Reading and writing sidecar files (`<name>.lvgl.json`) in one directory, for
 * the editor's save and load. This is the only place the preview API writes to
 * disk, so it is deliberately narrow:
 *
 *  - the file name is built from a name that matches `[A-Za-z0-9_-]{1,100}`, so
 *    no path separator, dot or NUL can reach the file system;
 *  - only the configured directory is used (no sub-directories);
 *  - a document is validated with validateOverrides() before anything is written;
 *  - a path that is a symbolic link, or not a regular file, is never read or
 *    overwritten;
 *  - a write goes to a temporary file in the same directory and is renamed into
 *    place, so a crash cannot leave half a sidecar.
 *
 * Every function returns a value (`{ ok: true, ... }` or `{ ok: false, code,
 * message, errors }`) and never throws for an expected failure.
 */
import { lstatSync, readFileSync, renameSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateOverrides, OVERRIDES_VERSION } from './overrides.mjs';

/** What a sidecar name may be: the IR's `name` (letters, digits, `_` and `-`). */
export const SIDECAR_NAME = /^[A-Za-z0-9_-]{1,100}$/;

/** The largest sidecar file that is read (the write side is bounded by the request body cap). */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/** @typedef {{ ok: true, exists: boolean, sidecar: object | null }} ReadOk */
/** @typedef {{ ok: false, code: string, message: string, errors?: string[] }} StoreFailure */

/** @param {string} code @param {string} message @param {string[]} [errors] @returns {StoreFailure} */
const failure = (code, message, errors) => (errors ? { ok: false, code, message, errors } : { ok: false, code, message });

/**
 * Check a directory is usable as the workspace.
 *
 * @param {string} directory
 * @returns {{ ok: true, path: string } | StoreFailure}
 */
export function checkWorkspace(directory) {
  const path = resolve(directory);
  try {
    if (!statSync(path).isDirectory()) return failure('workspace_invalid', `${path} is not a directory`);
  } catch (err) {
    return failure('workspace_invalid', `cannot use ${path} as the workspace: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: true, path };
}

/**
 * The path of a sidecar inside the workspace, or a failure for a bad name.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {{ ok: true, path: string } | StoreFailure}
 */
export function sidecarPath(directory, name) {
  if (typeof name !== 'string' || !SIDECAR_NAME.test(name)) {
    return failure('invalid_sidecar_name', `"${String(name).slice(0, 60)}" is not a valid sidecar name: use the IR's name (letters, digits, underscore and hyphen, at most 100 characters)`);
  }
  return { ok: true, path: join(resolve(directory), `${name}.lvgl.json`) };
}

/**
 * Read `<name>.lvgl.json`. A missing file is fine: `{ ok: true, exists: false }`.
 *
 * @param {string} directory
 * @param {string} name
 * @returns {ReadOk | StoreFailure}
 */
export function readSidecar(directory, name) {
  const located = sidecarPath(directory, name);
  if (!located.ok) return located;
  let info;
  try {
    info = lstatSync(located.path);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, exists: false, sidecar: null };
    return failure('sidecar_read_failed', `cannot read ${name}.lvgl.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!info.isFile()) return failure('sidecar_unsafe_path', `${name}.lvgl.json is not a regular file (a link or a directory), so it is not read`);
  if (info.size > MAX_READ_BYTES) return failure('sidecar_read_failed', `${name}.lvgl.json is ${info.size} bytes, over the ${MAX_READ_BYTES}-byte limit`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(located.path, 'utf8'));
  } catch (err) {
    return failure('sidecar_invalid', `${name}.lvgl.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, [`not valid JSON: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const { ok, errors } = validateOverrides(parsed);
  if (!ok) return failure('sidecar_invalid', `${name}.lvgl.json is not a valid sidecar: ${errors.join('; ')}`, errors);
  return { ok: true, exists: true, sidecar: parsed };
}

/**
 * Validate and write `<name>.lvgl.json` atomically.
 *
 * @param {string} directory
 * @param {string} name
 * @param {unknown} sidecar
 * @returns {{ ok: true, file: string, bytes: number } | StoreFailure}
 */
export function writeSidecar(directory, name, sidecar) {
  const located = sidecarPath(directory, name);
  if (!located.ok) return located;
  const { ok, errors } = validateOverrides(sidecar);
  if (!ok) return failure('sidecar_invalid', `not a valid sidecar: ${errors.join('; ')}`, errors);

  // Refuse to replace anything that is not a plain file we could have written.
  try {
    const existing = lstatSync(located.path);
    if (!existing.isFile()) return failure('sidecar_unsafe_path', `${name}.lvgl.json exists and is not a regular file (a link or a directory), so it is not overwritten`);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return failure('sidecar_write_failed', `cannot check ${name}.lvgl.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = `${JSON.stringify({ version: OVERRIDES_VERSION, ...sidecarWithoutVersion(sidecar) }, null, 2)}\n`;
  const temporary = join(resolve(directory), `.${name}.lvgl.json.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o644 });
    renameSync(temporary, located.path);
  } catch (err) {
    try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
    return failure('sidecar_write_failed', `cannot write ${name}.lvgl.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: true, file: `${name}.lvgl.json`, bytes: Buffer.byteLength(text) };
}

/** The sidecar's own keys without `version`, which is written first. */
function sidecarWithoutVersion(sidecar) {
  const { version: _version, ...rest } = /** @type {Record<string, unknown>} */ (sidecar);
  return rest;
}
