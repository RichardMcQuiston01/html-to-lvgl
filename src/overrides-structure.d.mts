/** Types for overrides-structure.mjs, which the editor imports. */
export interface StructureNode {
  tag: string;
  attrs: Record<string, string | number | boolean | null>;
  children: StructureNode[];
  meta?: Record<string, unknown>;
}

export type StructureAttrValue = string | number | boolean;

export interface AddOp {
  op: 'add';
  name: string;
  tag: string;
  parent: string | null;
  index: number;
  attrs?: Record<string, StructureAttrValue>;
}

export interface MoveOp {
  op: 'move';
  name: string;
  parent: string | null;
  index: number;
}

export type StructureOp = AddOp | MoveOp;

export interface DiagnosticsSink {
  add(entry: { code: string; message: string; fix?: string; source?: { file: string } | null; output?: { widget: string } | null }): unknown;
}

export const STRUCTURE_OPS: readonly string[];
export const NAME_PATTERN: RegExp;
export const TAG_PATTERN: RegExp;
export const CONTAINER_TAGS: readonly string[];
export function acceptsChildren(tag: string): boolean;
export function validateStructure(structure: unknown): string[];
export function applyStructure(view: StructureNode, structure: readonly StructureOp[], options?: { diagnostics?: DiagnosticsSink | null; file?: string }): StructureNode;
