/**
 * Structured diagnostics. Every problem the converter can report is one
 * entry: a stable code, a severity, a message, a "do this to fix it" line,
 * and optional pointers to the source file and to the generated output.
 *
 * Entries replace the bare warning strings. They feed three outputs:
 *   - a short console summary (formatSummary)
 *   - TODO.txt, grouped by output file, for the person finishing the port
 *   - diagnostics.json, for tooling and the future editor
 *
 * This module is pure: no browser, no file system. Writing the files is the
 * CLI's job.
 */

/** @typedef {'error' | 'warning' | 'info'} Severity */

/**
 * Where in the user's own source the problem comes from.
 * @typedef {object} SourceLocation
 * @property {string} [file]     Path of the HTML, JSX, or TSX file.
 * @property {string} [selector] CSS path or data-lv-name of the element.
 * @property {number} [line]     1-based line, when known (React dev builds).
 */

/**
 * Where in the generated output the problem shows up.
 * @typedef {object} OutputLocation
 * @property {string} [file]   Generated file name, such as "ui_home.xml".
 * @property {string} [widget] Widget name, as used by lv_obj_get_child_by_name().
 */

/**
 * @typedef {object} Diagnostic
 * @property {string} code           Stable identifier from CODES.
 * @property {Severity} severity
 * @property {string} message        What happened.
 * @property {string} fix            What the user should do about it.
 * @property {SourceLocation | null} source
 * @property {OutputLocation | null} output
 */

/**
 * The registry of known codes. A typo in a code fails loudly instead of
 * producing an entry nobody can look up. Each entry holds the default
 * severity; callers may override it per entry.
 *
 * Add a code here before using it.
 * @type {Readonly<Record<string, { severity: Severity }>>}
 */
export const CODES = Object.freeze({
  // Layout and mapping
  BASELINE_ALIGN_UNSUPPORTED: { severity: 'warning' },
  TAG_UNSUPPORTED: { severity: 'warning' },
  WIDGET_UNSUPPORTED: { severity: 'warning' },
  LINK_TARGET_UNKNOWN: { severity: 'warning' },
  // Assets and fonts
  IMAGE_REGISTER: { severity: 'info' },
  FONT_FALLBACK: { severity: 'warning' },
  // Recognition
  RECOGNIZER_ERROR: { severity: 'warning' },
  RECOGNIZER_AMBIGUOUS: { severity: 'warning' },
  ICON_PLACEHOLDER: { severity: 'warning' },
  ARIA_TARGET_MISSING: { severity: 'warning' },
  // Sidecar overrides
  OVERRIDE_FILE_INVALID: { severity: 'error' },
  OVERRIDE_TARGET_UNKNOWN: { severity: 'warning' },
  OVERRIDE_ATTR_INVALID: { severity: 'warning' },
  // Components
  COMPONENT_INLINE: { severity: 'warning' },
  COMPONENT_NESTED_DIFFERS: { severity: 'warning' },
  COMPONENT_ATTR_NOT_PROPPABLE: { severity: 'warning' },
});

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });

/**
 * A collector for one conversion run.
 *
 * add() validates its input and returns the stored entry, or throws on a
 * programming error (unknown code, empty message). A throw here means a
 * bug in the converter, not bad user input.
 */
export function createDiagnostics() {
  /** @type {Diagnostic[]} */
  const entries = [];

  return {
    /**
     * @param {{ code: string, message: string, fix?: string, severity?: Severity,
     *           source?: SourceLocation | null, output?: OutputLocation | null }} input
     * @returns {Diagnostic}
     */
    add(input) {
      const known = CODES[input.code];
      if (!known) throw new Error(`unknown diagnostic code "${input.code}"; add it to CODES in src/diagnostics.mjs`);
      if (!input.message) throw new Error(`diagnostic ${input.code} needs a message`);
      const severity = input.severity ?? known.severity;
      if (!(severity in SEVERITY_ORDER)) throw new Error(`diagnostic ${input.code} has unknown severity "${severity}"`);
      /** @type {Diagnostic} */
      const entry = {
        code: input.code,
        severity,
        message: input.message,
        fix: input.fix ?? '',
        source: input.source ?? null,
        output: input.output ?? null,
      };
      entries.push(entry);
      return entry;
    },

    /** @returns {Diagnostic[]} A copy, so callers cannot change the log. */
    list() {
      return entries.map((e) => ({ ...e }));
    },

    get length() {
      return entries.length;
    },

    /**
     * Append every entry from another collector.
     * @param {{ list(): Diagnostic[] }} other
     */
    merge(other) {
      for (const e of other.list()) entries.push(e);
    },

    /**
     * The messages as plain strings, for code that still expects the old
     * warnings array.
     * @returns {string[]}
     */
    toWarningStrings() {
      return entries.map((e) => e.message);
    },
  };
}

/** Remove entries that repeat the same code, message, and locations. */
function dedupe(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = JSON.stringify([e.code, e.message, e.source, e.output]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function bySeverityThenCode(a, b) {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code);
}

/** "src/App.tsx:42", "#menu", or "" when nothing is known. */
function describeSource(source) {
  if (!source) return '';
  const where = source.file ? (source.line ? `${source.file}:${source.line}` : source.file) : '';
  return [where, source.selector].filter(Boolean).join(' ');
}

const GENERAL_GROUP = 'General';

/**
 * The text of TODO.txt: one section per output file, one entry per problem,
 * errors first. Returns an empty string when there is nothing to do, so the
 * caller can skip writing the file.
 *
 * @param {Diagnostic[]} entries
 * @returns {string}
 */
export function formatTodo(entries) {
  const unique = dedupe(entries);
  if (!unique.length) return '';

  /** @type {Map<string, Diagnostic[]>} */
  const groups = new Map();
  for (const e of unique) {
    const group = e.output?.file || GENERAL_GROUP;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(e);
  }

  const names = [...groups.keys()].sort((a, b) => {
    if (a === GENERAL_GROUP) return 1;
    if (b === GENERAL_GROUP) return -1;
    return a.localeCompare(b);
  });

  const lines = [
    'TODO',
    '====',
    'Written by html2lvgl. This file is replaced on every run, so do not edit it.',
    '',
  ];
  for (const name of names) {
    lines.push(name);
    for (const e of groups.get(name).sort(bySeverityThenCode)) {
      const where = describeSource(e.source);
      const widget = e.output?.widget ? ` ${e.output.widget}` : '';
      lines.push(`  [${e.code}]${widget}${where ? ` (${where})` : ''}`);
      lines.push(`    ${e.message}`);
      if (e.fix) lines.push(`    Fix: ${e.fix}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The JSON written as diagnostics.json. The version field lets tools detect
 * a change in this shape.
 *
 * @param {Diagnostic[]} entries
 * @returns {string}
 */
export function formatJson(entries) {
  return `${JSON.stringify({ version: 1, diagnostics: dedupe(entries) }, null, 2)}\n`;
}

/**
 * Console lines for a finished run: one line per severity that has entries,
 * plus a pointer to TODO.txt. Empty when there is nothing to report.
 *
 * @param {Diagnostic[]} entries
 * @param {{ todoPath?: string }} [options]
 * @returns {string[]}
 */
export function formatSummary(entries, { todoPath = 'TODO.txt' } = {}) {
  const unique = dedupe(entries);
  if (!unique.length) return [];
  const counts = { error: 0, warning: 0, info: 0 };
  for (const e of unique) counts[e.severity] += 1;
  const parts = [];
  for (const severity of ['error', 'warning', 'info']) {
    const n = counts[severity];
    if (n) parts.push(`${n} ${severity}${n === 1 ? '' : 's'}`);
  }
  return [`${parts.join(', ')}. See ${todoPath} for what to do about them.`];
}
