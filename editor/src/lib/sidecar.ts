import type { IrNode, SidecarOverrides } from './types';
import type { TreeRow } from './irTree';
import { nodeName } from './irTree';

/** A value an attribute can hold; `null` in a sidecar means "remove this attribute". */
export type AttrValue = string | number | boolean | null;

/** The attribute-name rule `validateOverrides()` applies at apply time (letters, digits, underscore, optional `:state`). */
export const ATTR_KEY = /^[A-Za-z_][A-Za-z0-9_]*(:[a-z_]+)?$/;

export function emptySidecar(): SidecarOverrides {
  return { version: 1, nodes: {} };
}

/** Does the sidecar change nothing? */
export function isEmptySidecar(sidecar: SidecarOverrides): boolean {
  return Object.keys(sidecar.nodes).length === 0;
}

/** JSON with object keys in sorted order, so two sidecars that mean the same compare equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sidecarsEqual(a: SidecarOverrides, b: SidecarOverrides): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Drop what changes nothing: empty `attrs`, `remove: false` and node entries left with neither. */
function normalized(sidecar: SidecarOverrides): SidecarOverrides {
  const nodes: SidecarOverrides['nodes'] = {};
  for (const [name, spec] of Object.entries(sidecar.nodes)) {
    const attrs = spec.attrs !== undefined && Object.keys(spec.attrs).length > 0 ? spec.attrs : undefined;
    const remove = spec.remove === true ? true : undefined;
    if (attrs === undefined && remove === undefined) continue;
    nodes[name] = { ...(attrs !== undefined ? { attrs } : {}), ...(remove !== undefined ? { remove } : {}) };
  }
  return { ...sidecar, nodes };
}

/** A copy of the sidecar with one node's entry replaced (or dropped when `entry` is empty). */
function withNode(sidecar: SidecarOverrides, name: string, entry: SidecarOverrides['nodes'][string]): SidecarOverrides {
  return normalized({ ...sidecar, nodes: { ...sidecar.nodes, [name]: entry } });
}

/** Set an attribute on a named node (a value replaces or adds it; `null` removes it). */
export function withAttr(sidecar: SidecarOverrides, nodeName: string, key: string, value: AttrValue): SidecarOverrides {
  const current = sidecar.nodes[nodeName] ?? {};
  return withNode(sidecar, nodeName, { ...current, attrs: { ...(current.attrs ?? {}), [key]: value } });
}

/** Forget the override of one attribute, so the page's own value shows again. */
export function withoutAttr(sidecar: SidecarOverrides, nodeName: string, key: string): SidecarOverrides {
  const current = sidecar.nodes[nodeName];
  if (current?.attrs === undefined || !(key in current.attrs)) return sidecar;
  const rest = Object.fromEntries(Object.entries(current.attrs).filter(([k]) => k !== key));
  return withNode(sidecar, nodeName, { ...current, attrs: rest });
}

/** Mark a node (and so its subtree) removed, or bring it back. */
export function withRemoved(sidecar: SidecarOverrides, nodeName: string, removed: boolean): SidecarOverrides {
  const current = sidecar.nodes[nodeName] ?? {};
  return withNode(sidecar, nodeName, { ...current, remove: removed });
}

export function isRemoved(sidecar: SidecarOverrides, nodeName: string | null): boolean {
  return nodeName !== null && sidecar.nodes[nodeName]?.remove === true;
}

/** How many separate changes the sidecar holds (each attribute override and each removal). */
export function countEdits(sidecar: SidecarOverrides): number {
  let count = 0;
  for (const spec of Object.values(sidecar.nodes)) {
    count += Object.keys(spec.attrs ?? {}).length + (spec.remove === true ? 1 : 0);
  }
  return count;
}

/** The single changes (an attribute override, a removal) in a sidecar, as `node:key` strings with their value. */
function flatEdits(sidecar: SidecarOverrides): Map<string, string> {
  const edits = new Map<string, string>();
  for (const [name, spec] of Object.entries(sidecar.nodes)) {
    for (const [key, value] of Object.entries(spec.attrs ?? {})) edits.set(`${name}\u0000attr\u0000${key}`, JSON.stringify(value));
    if (spec.remove === true) edits.set(`${name}\u0000remove`, 'true');
  }
  return edits;
}

/** How many single changes differ between two sidecars: added, removed or given another value. */
export function countDifferences(a: SidecarOverrides, b: SidecarOverrides): number {
  const left = flatEdits(a);
  const right = flatEdits(b);
  let count = 0;
  for (const [key, value] of left) if (right.get(key) !== value) count += 1;
  for (const key of right.keys()) if (!left.has(key)) count += 1;
  return count;
}

/** One attribute as the editor shows it: the page's value, the value after the sidecar, and what changed. */
export interface EffectiveAttr {
  key: string;
  /** The value in the page's IR, or undefined when the page does not have this attribute. */
  base: AttrValue | undefined;
  /** The value after the sidecar, or undefined when the sidecar removes it (or it never existed). */
  value: AttrValue | undefined;
  /** The sidecar has an entry for this key. */
  overridden: boolean;
}

/** The node's attributes with the sidecar applied: the page's own keys first, then keys the sidecar adds. */
export function effectiveAttrs(node: IrNode, sidecar: SidecarOverrides): EffectiveAttr[] {
  const name = nodeName(node);
  const overrides = name === null ? {} : (sidecar.nodes[name]?.attrs ?? {});
  const rows: EffectiveAttr[] = [];
  for (const [key, base] of Object.entries(node.attrs)) {
    const overridden = key in overrides;
    const override = overrides[key];
    rows.push({ key, base, value: overridden ? (override === null ? undefined : override) : base, overridden });
  }
  for (const [key, override] of Object.entries(overrides)) {
    if (key in node.attrs) continue;
    rows.push({ key, base: undefined, value: override === null ? undefined : override, overridden: true });
  }
  return rows;
}

/** Why an attribute name is not allowed, or null when it is. */
export function attrKeyProblem(key: string): string | null {
  if (key === '') return 'type an attribute name';
  if (key === 'name') return 'the name identifies the widget and cannot be changed';
  if (!ATTR_KEY.test(key)) return 'use letters, digits and underscores, with an optional :state suffix such as :pressed';
  return null;
}

export type ParsedAttr = { ok: true; value: AttrValue } | { ok: false; message: string };

/**
 * Turn what a person typed into a value of the right type. An attribute that
 * already has a type keeps it (a number stays a number, a boolean a boolean);
 * a new attribute is a number when it looks like one, a boolean for `true` or
 * `false`, otherwise text, so `0xff0000` stays text.
 */
export function parseAttrInput(text: string, existing: AttrValue | undefined): ParsedAttr {
  const trimmed = text.trim();
  const kind = existing === undefined || existing === null ? guessKind(trimmed) : typeof existing;
  if (kind === 'number') {
    if (trimmed === '' || !Number.isFinite(Number(trimmed))) return { ok: false, message: `"${text}" is not a number` };
    return { ok: true, value: Number(trimmed) };
  }
  if (kind === 'boolean') {
    if (trimmed !== 'true' && trimmed !== 'false') return { ok: false, message: 'use true or false' };
    return { ok: true, value: trimmed === 'true' };
  }
  return { ok: true, value: text };
}

function guessKind(text: string): 'number' | 'boolean' | 'string' {
  if (/^-?\d+(\.\d+)?$/.test(text)) return 'number';
  if (text === 'true' || text === 'false') return 'boolean';
  return 'string';
}

/** Is this attribute a colour (`style_bg_color`, `style_text_color:pressed`, ...)? */
export function isColorKey(key: string): boolean {
  return /color(:[a-z_]+)?$/.test(key);
}

/** `0xRRGGBB` text to `#rrggbb` for a colour input, or null when it is not that form. */
export function hexToCss(value: AttrValue | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^0x([0-9a-fA-F]{6})$/.exec(value.trim());
  return match === null ? null : `#${match[1]!.toLowerCase()}`;
}

/** `#rrggbb` from a colour input to the IR's `0xrrggbb` form. */
export function cssToHex(css: string): string {
  return `0x${css.replace(/^#/, '').toLowerCase()}`;
}

/**
 * The ids of rows that the sidecar removes: nodes it marks removed and
 * everything beneath them. `rows` is in tree order, parents first.
 */
export function removedRowIds(rows: readonly TreeRow[], sidecar: SidecarOverrides): Set<string> {
  const removed = new Set<string>();
  for (const row of rows) {
    const parentId = row.id.includes('.') ? row.id.slice(0, row.id.lastIndexOf('.')) : null;
    if ((parentId !== null && removed.has(parentId)) || isRemoved(sidecar, row.name)) removed.add(row.id);
  }
  return removed;
}

/** Every attribute name used anywhere in the tree, sorted: suggestions for "add attribute". */
export function knownAttrKeys(root: IrNode): string[] {
  const keys = new Set<string>();
  const visit = (node: IrNode): void => {
    for (const key of Object.keys(node.attrs)) if (key !== 'name') keys.add(key);
    node.children.forEach(visit);
  };
  visit(root);
  return [...keys].sort();
}
