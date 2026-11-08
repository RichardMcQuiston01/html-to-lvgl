/**
 * IR export / import: the stable JSON an editor edits, and the way back to
 * the emitters. No browser, no Chromium: everything here is pure apart from
 * the small file helpers at the bottom.
 *
 * ## Which pipeline stage is "the IR"?
 *
 * The pipeline is extract (UiNode tree) -> recognize -> optimize -> convert
 * -> emit. The decision, checked against the code:
 *
 * - The extraction tree (src/extract.mjs) is coupled to Chromium: pixel
 *   boxes, computed styles, fonts measured in the browser. Re-running
 *   recognize/convert on it needs the font metrics, plugins and registry of
 *   the original run, and editing it means editing CSS-shaped data that
 *   every conversion rule still reinterprets. Not editable, not stable.
 * - The post-convert `view` (the `el(tag, attrs, children)` tree plus
 *   `meta`) is exactly what the XML, C, C++ and MicroPython emitters consume
 *   (emitC/emitCpp/emitPy take only `view` plus name/symbol/subjects;
 *   componentize() and applySidecar() also work on this tree). optimize and
 *   recognize have already run, so it is the final widget structure. Its
 *   attributes are plain LVGL attribute names/values, names (`attrs.name`)
 *   are unique per page and already what the sidecar targets. Verified: for
 *   every fixture the view survives JSON round-trips with byte-identical
 *   output in all four emitters (tests/ir.test.mjs).
 *
 * So the IR is the post-convert `view` plus the side data the emitters need
 * that does not live in the tree:
 *
 * - `name`        page/screen name (file and symbol names)
 * - `screenMode`  `<screen>` vs `<component>` wrapper and the
 *                 `ui_<name>_create` entry-point convention
 * - `subjects`    page subject declarations (initial values for C/C++ and
 *                 globals.xml; the emitters also discover declarations in
 *                 `meta.behavior.subjects`)
 * - `timelines`   animation timelines (`<animations>` in XML is rendered from
 *                 them; C/C++/Py read the copies in `meta.behavior.timelines`)
 * - `assets`      image files the page references (copy list for the CLI)
 *
 * Nothing the emitters read is missing: emitPy ignores subjects and C only
 * uses `subjects` as initial values. Fonts are referenced by name in
 * `style_text_font` attributes; the font files themselves are build
 * artifacts of the original run, not part of the IR.
 *
 * ## Schema (irVersion 1; machine-readable copy in tests/golden-editor/ir.schema.json)
 *
 *   {
 *     "format": "html2lvgl-ir", "irVersion": 1,
 *     "name": "dashboard", "screenMode": false,
 *     "view": Node,
 *     "subjects":  [{ "name", "type", "initial" }],
 *     "timelines": [{ "name", "animations": [{ "prop", "target", "start", "end", "duration", "delay"? }] }],
 *     "assets":    [{ "src", "name" }]
 *   }
 *   Node = { "tag": string, "attrs": { [k]: string|number|boolean|null },
 *            "meta"?: JSON object, "children": Node[] }
 *
 * Determinism: the key order of a node is fixed (tag, attrs, meta, children)
 * and attribute order is preserved exactly as the converter produced it,
 * because the emitters iterate attributes in order and byte-identical output
 * depends on it. No functions, Maps, Sets, undefined, absolute paths or
 * timestamps. Identity: `attrs.name` is unique per page. A few structural
 * nodes (tabview parts, behavior tags such as `subject_set_int_event`) have
 * no name; address them as a child of the nearest named ancestor.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pageXml } from './convert.mjs';
import { animationsElement, globalsXml } from './behavior.mjs';
import { componentize } from './componentize.mjs';
import { emitC, emitCpp } from './emit-c.mjs';
import { emitPy } from './emit-py.mjs';
import { applySidecar, sidecarFor } from './overrides.mjs';
import { createDiagnostics } from './diagnostics.mjs';

export const IR_VERSION = 1;
export const IR_FORMAT = 'html2lvgl-ir';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const describe = (v) => (v === undefined ? 'undefined' : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
const TAG = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ATTR = /^[A-Za-z_][A-Za-z0-9_]*(:[a-z_]+)*$/;

/** Thrown by importIr() for any invalid IR; `errors` lists every problem. */
export class IrError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`invalid IR: ${errors.length === 1 ? errors[0] : `${errors.length} problems:\n  - ${errors.join('\n  - ')}`}`);
    this.name = 'IrError';
    this.errors = errors;
  }
}

/* ------------------------------------------------------------------ export */

/** Deep copy that keeps only JSON data; rejects what JSON would silently change. */
function cleanJson(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new IrError([`${path}: non-finite number ${value} cannot be stored in JSON`]);
    return value;
  }
  if (Array.isArray(value)) return value.map((v, i) => cleanJson(v === undefined ? null : v, `${path}[${i}]`));
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = cleanJson(v, `${path}.${k}`);
    return out;
  }
  throw new IrError([`${path}: ${describe(value)} (${Object.prototype.toString.call(value)}) cannot be stored in the IR`]);
}

function exportNode(node, path) {
  const out = { tag: node.tag, attrs: cleanJson(node.attrs ?? {}, `${path}.attrs`) };
  if (node.meta !== undefined) out.meta = cleanJson(node.meta, `${path}.meta`);
  out.children = (node.children ?? []).map((c, i) => exportNode(c, `${path}/${c.tag ?? i}`));
  return out;
}

/**
 * Serialize a convert() result as IR (a plain JSON-ready object).
 * Pass the result of convert(), optionally with a `view` already edited
 * (e.g. by applySidecar) to export that instead.
 *
 * @param {{ view: object, name: string, subjects?: object[], timelines?: object[], assets?: object[] }} result
 * @param {{ screenMode?: boolean }} [options]  convert() does not return its screenMode, so say it here.
 */
export function exportIr(result, { screenMode = false } = {}) {
  if (!result?.view) throw new IrError(['exportIr needs a convert() result with a "view"']);
  const ir = {
    format: IR_FORMAT,
    irVersion: IR_VERSION,
    name: result.name,
    screenMode: Boolean(screenMode),
    view: exportNode(result.view, 'view'),
    subjects: cleanJson(result.subjects ?? [], 'subjects'),
    timelines: cleanJson(result.timelines ?? [], 'timelines'),
    assets: cleanJson(result.assets ?? [], 'assets'),
  };
  const { ok, errors } = validateIr(ir);
  if (!ok) throw new IrError(errors);
  return ir;
}

/** Stable text form: 2-space JSON plus a trailing newline. */
export const stringifyIr = (ir) => `${JSON.stringify(ir, null, 2)}\n`;

/* -------------------------------------------------------------- validation */

function checkJson(value, path, errors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => checkJson(v, `${path}[${i}]`, errors));
  if (isPlainObject(value)) return Object.entries(value).forEach(([k, v]) => checkJson(v, `${path}.${k}`, errors));
  errors.push(`${path} must be plain JSON data, got ${describe(value)}`);
}

function checkNode(node, path, names, errors) {
  if (!isPlainObject(node)) return errors.push(`${path} must be an object, got ${describe(node)}`);
  for (const k of Object.keys(node)) {
    if (!['tag', 'attrs', 'meta', 'children'].includes(k)) errors.push(`${path} has unknown field "${k}" (allowed: tag, attrs, meta, children)`);
  }
  if (typeof node.tag !== 'string' || !TAG.test(node.tag)) errors.push(`${path}.tag must be an XML element name, got ${JSON.stringify(node.tag)}`);
  if (!isPlainObject(node.attrs)) {
    errors.push(`${path}.attrs must be an object, got ${describe(node.attrs)}`);
  } else {
    for (const [k, v] of Object.entries(node.attrs)) {
      if (!ATTR.test(k)) errors.push(`${path}.attrs has an invalid attribute name "${k}"`);
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
        errors.push(`${path}.attrs.${k} must be a string, number, boolean or null, got ${describe(v)}`);
      } else if (typeof v === 'number' && !Number.isFinite(v)) errors.push(`${path}.attrs.${k} must be a finite number`);
    }
    const nm = node.attrs.name;
    if (nm !== undefined && nm !== null) {
      if (typeof nm !== 'string' || nm === '') errors.push(`${path}.attrs.name must be a non-empty string, got ${JSON.stringify(nm)}`);
      else if (names.has(nm)) errors.push(`duplicate widget name "${nm}" at ${path} (first used at ${names.get(nm)}); names must be unique per page`);
      else names.set(nm, path);
    }
  }
  if (node.meta !== undefined) {
    if (!isPlainObject(node.meta)) errors.push(`${path}.meta must be an object, got ${describe(node.meta)}`);
    else checkJson(node.meta, `${path}.meta`, errors);
  }
  if (!Array.isArray(node.children)) {
    errors.push(`${path}.children must be an array, got ${describe(node.children)}`);
  } else {
    node.children.forEach((c, i) => checkNode(c, `${path}.children[${i}]`, names, errors));
  }
}

function checkList(ir, field, required, errors, itemCheck) {
  const list = ir[field];
  if (!Array.isArray(list)) return errors.push(`"${field}" must be an array, got ${describe(list)}`);
  list.forEach((item, i) => {
    const p = `${field}[${i}]`;
    if (!isPlainObject(item)) return errors.push(`${p} must be an object, got ${describe(item)}`);
    for (const [key, type] of required) {
      if (typeof item[key] !== type) errors.push(`${p}.${key} must be a ${type}, got ${describe(item[key])}`);
    }
    checkJson(item, p, errors);
    itemCheck?.(item, p);
  });
}

/**
 * Check IR without throwing. Reports every problem found.
 * @param {unknown} ir
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateIr(ir) {
  const errors = [];
  if (!isPlainObject(ir)) return { ok: false, errors: [`top level must be an object, got ${describe(ir)}`] };
  if (ir.irVersion !== IR_VERSION) {
    errors.push(`unsupported irVersion ${JSON.stringify(ir.irVersion) ?? '(missing)'}; this build reads irVersion ${IR_VERSION}`);
    return { ok: false, errors };
  }
  if (ir.format !== IR_FORMAT) errors.push(`"format" must be "${IR_FORMAT}", got ${JSON.stringify(ir.format)}`);
  const allowed = new Set(['format', 'irVersion', 'name', 'screenMode', 'view', 'subjects', 'timelines', 'assets']);
  for (const k of Object.keys(ir)) if (!allowed.has(k)) errors.push(`unknown top-level field "${k}"`);
  if (typeof ir.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(ir.name)) {
    errors.push(`"name" must be a non-empty string of letters, digits, "_" or "-", got ${JSON.stringify(ir.name)}`);
  }
  if (typeof ir.screenMode !== 'boolean') errors.push(`"screenMode" must be a boolean, got ${describe(ir.screenMode)}`);
  checkNode(ir.view, 'view', new Map(), errors);
  checkList(ir, 'subjects', [['name', 'string'], ['type', 'string'], ['initial', 'number']], errors);
  checkList(ir, 'assets', [['src', 'string'], ['name', 'string']], errors);
  checkList(ir, 'timelines', [['name', 'string']], errors, (t, p) => {
    if (!Array.isArray(t.animations)) errors.push(`${p}.animations must be an array, got ${describe(t.animations)}`);
  });
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ import */

/**
 * Validate IR and turn it into what the emitters accept.
 * Accepts the parsed object or the JSON text. Throws IrError (a plain
 * Error with a readable message) for anything invalid.
 *
 * @param {object | string} json
 * @returns {{ name: string, screenMode: boolean, view: object, subjects: object[], timelines: object[], animations: object | null, assets: object[], xml: string, globalsXml: string | null }}
 */
export function importIr(json) {
  let ir = json;
  if (typeof json === 'string') {
    try {
      ir = JSON.parse(json);
    } catch (e) {
      throw new IrError([`not valid JSON: ${e.message}`]);
    }
  }
  const { ok, errors } = validateIr(ir);
  if (!ok) throw new IrError(errors);
  const copy = structuredClone(ir); // the caller keeps an unmodified IR; emitters never mutate ours
  const animations = animationsElement(copy.timelines);
  return {
    name: copy.name,
    screenMode: copy.screenMode,
    view: copy.view,
    subjects: copy.subjects,
    timelines: copy.timelines,
    animations,
    assets: copy.assets,
    xml: pageXml(copy.view, { screenMode: copy.screenMode, animations }),
    globalsXml: globalsXml(copy.subjects),
  };
}

/* ----------------------------------------------------------------- emitting */

const FORMATS = ['xml', 'c', 'cpp', 'py'];

/**
 * Run only the emitters on imported IR; the same calls the CLI makes after
 * conversion (see cli.mjs emitPage), minus anything that needs the browser.
 *
 * @param {ReturnType<typeof importIr>} ir
 * @param {{ formats?: Iterable<string>, lvInclude?: string, view?: object, symbol?: string, unitName?: string }} [options]
 *        `view` replaces the IR's view (a sidecar-edited one); `symbol` and
 *        `unitName` override the entry point and the ui_<unit> file stem for
 *        callers that follow another naming convention (the nav goldens).
 * @returns {{ files: Record<string, string>, components: string[] }} file name -> text
 */
export function emitFromIr(ir, { formats = ['xml'], lvInclude = 'lvgl.h', view = ir.view, symbol: symbolOverride, unitName } = {}) {
  const wanted = new Set(formats);
  for (const f of wanted) if (!FORMATS.includes(f)) throw new Error(`unknown format "${f}" (expected ${FORMATS.join(', ')})`);
  const { name, screenMode, animations, subjects } = ir;
  const files = {};
  const components = [];
  if (wanted.has('xml')) {
    const { view: pageView, components: defs } = componentize(view, { diagnostics: createDiagnostics() });
    let pageText = pageXml(view, { screenMode, animations });
    if (defs.size) {
      pageText = pageXml(pageView, { screenMode, animations });
      for (const cname of defs.keys()) {
        if (cname === name) throw new Error(`component "${cname}" collides with the page name "${name}"`);
      }
      for (const [cname, cxml] of defs) {
        files[`${cname}.xml`] = cxml;
        components.push(cname);
      }
    }
    files[`${name}.xml`] = pageText;
    const globals = globalsXml(subjects);
    if (globals) files['globals.xml'] = globals;
  }
  const ident = unitName ?? name.replace(/[^a-z0-9_]/gi, '_');
  const symbol = symbolOverride ?? (screenMode ? `ui_${ident}_create` : 'ui_create');
  if (wanted.has('c')) {
    const { c, h, unit } = emitC(view, { name: ident, symbol, lvInclude, subjects });
    files[`${unit}.c`] = c;
    files[`${unit}.h`] = h;
  }
  if (wanted.has('cpp')) {
    const { c, h, unit } = emitCpp(view, { name: ident, symbol, lvInclude, subjects });
    files[`${unit}.cpp`] = c;
    files[`${unit}.hpp`] = h;
  }
  if (wanted.has('py')) {
    const { py, unit } = emitPy(view, { name: ident, symbol });
    files[`${unit}.py`] = py;
  }
  return { files, components };
}

/* -------------------------------------------------------------- file helpers */

/** Write IR text to `file` (creating directories). */
export function writeIrFile(ir, file) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringifyIr(ir));
}

/** Read and import an IR file; the error message names the file. */
export function readIrFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`cannot read IR file ${file}: ${e.message}`);
  }
  try {
    return importIr(text);
  } catch (e) {
    if (e instanceof IrError) throw new Error(`${file}: ${e.message}`);
    throw e;
  }
}

/** The sidecar paired with an IR file: page.ir.json and page.json both use page.lvgl.json. */
export const sidecarForIr = (irFile) => sidecarFor(irFile.replace(/\.ir\.json$/i, '.json'));

/**
 * `html2lvgl --from-ir`: emit files from IR files without a browser.
 * Applies the page's sidecar (explicit `overrides` for a single file, else the
 * one next to each IR file) before the emitters, like the normal flow.
 *
 * @param {{ files: string[], output: string, formats: Set<string>|string[], lvInclude?: string, overrides?: string, log?: (s: string) => void, warn?: (s: string) => void }} o
 */
export function runFromIr({ files, output, formats, lvInclude = 'lvgl.h', overrides, log = console.log, warn = console.warn }) {
  if (overrides && files.length > 1) throw new Error('--overrides applies to a single IR file; several screens each use their own <page>.lvgl.json');
  mkdirSync(output, { recursive: true });
  const imported = files.map((f) => ({ file: f, ir: readIrFile(f) }));
  const names = imported.map(({ ir }) => ir.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`IR files must describe distinct pages; "${dup}" appears more than once`);
  const allSubjects = [];
  for (const { file, ir } of imported) {
    const diagnostics = createDiagnostics();
    const applied = applySidecar(ir.view, { path: overrides ?? sidecarForIr(file), explicit: Boolean(overrides), diagnostics });
    const { files: out } = emitFromIr(ir, { formats, lvInclude, view: applied.view });
    for (const [fname, text] of Object.entries(out)) {
      if (fname === 'globals.xml') continue; // merged below: one file serves every screen
      writeFileSync(join(output, fname), text);
    }
    allSubjects.push(...ir.subjects);
    log(`wrote ${Object.keys(out).filter((n) => n !== 'globals.xml').map((n) => join(output, n)).join(', ')}`);
    for (const d of diagnostics.list()) warn(`${d.code}: ${d.message}`);
  }
  const wantsXml = [...formats].includes('xml');
  const globals = wantsXml ? globalsXml(allSubjects) : null;
  if (globals) {
    writeFileSync(join(output, 'globals.xml'), globals);
    log(`wrote ${join(output, 'globals.xml')} (register it as the "globals" component before creating screens)`);
  }
}
