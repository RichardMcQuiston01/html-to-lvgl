import { acceptsChildren, applyStructure, type StructureNode } from '../../../src/overrides-structure.mjs';
import { nodeName } from './irTree';
import { withStructure } from './sidecar';
import type { IrNode, SidecarOverrides, StructureOperation } from './types';

type AddOperation = Extract<StructureOperation, { op: 'add' }>;

/** The widgets the editor can add, with what each starts as. */
export interface WidgetKind {
  tag: string;
  /** Shown on the button, and the start of the new widget's name. */
  label: string;
  /** Names the parts when one widget needs more than one node (a button holds a label). */
  attrs: Record<string, string | number | boolean>;
  /** A child added inside it, such as the label of a button. */
  child?: { suffix: string; tag: string; attrs: Record<string, string | number | boolean> };
}

export const WIDGET_KINDS: readonly WidgetKind[] = [
  { tag: 'lv_obj', label: 'Box', attrs: { width: 80, height: 40, style_bg_color: '0xe2e8f0', style_border_width: 0, style_radius: 4, style_pad_all: 0, scrollable: false } },
  { tag: 'lv_label', label: 'Label', attrs: { text: 'Label' } },
  { tag: 'lv_button', label: 'Button', attrs: { width: 90, height: 36 }, child: { suffix: 'label', tag: 'lv_label', attrs: { text: 'Button', align: 'center' } } },
  { tag: 'lv_bar', label: 'Bar', attrs: { width: 120, height: 10, value: 50 } },
  { tag: 'lv_slider', label: 'Slider', attrs: { width: 120, value: 30 } },
  { tag: 'lv_switch', label: 'Switch', attrs: {} },
];

const asNode = (node: IrNode): StructureNode => node as unknown as StructureNode;
const asIr = (node: StructureNode): IrNode => node as unknown as IrNode;

/** The tree as it is after the sidecar's structure operations, and the problems found applying them. */
export interface EffectiveView {
  view: IrNode;
  /** One message per skipped operation (the converter reports the same ones). */
  problems: string[];
}

/**
 * Apply the sidecar's structure operations to the page's tree. This is the
 * converter's own function (it is imported, not copied), so the tree the
 * editor shows is the tree the converter will build.
 */
export function effectiveView(view: IrNode, sidecar: SidecarOverrides): EffectiveView {
  const operations = sidecar.structure ?? [];
  if (operations.length === 0) return { view, problems: [] };
  const problems: string[] = [];
  const result = applyStructure(asNode(view), operations, { diagnostics: { add: (entry) => problems.push(entry.message) } });
  return { view: asIr(result), problems };
}

/** Every widget name in the tree. */
export function allNames(view: IrNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: IrNode): void => {
    const name = nodeName(node);
    if (name !== null) names.add(name);
    node.children.forEach(visit);
  };
  visit(view);
  return names;
}

/** `base`, or `base_2`, `base_3`, ... the first one not in `taken`. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Names of the widgets this sidecar adds. */
export function addedNames(sidecar: SidecarOverrides): Set<string> {
  return new Set((sidecar.structure ?? []).filter((op): op is AddOperation => op.op === 'add').map((op) => op.name));
}

/** Names of the widgets this sidecar moves. */
export function movedNames(sidecar: SidecarOverrides): Set<string> {
  return new Set((sidecar.structure ?? []).filter((op) => op.op === 'move').map((op) => op.name));
}

/**
 * Add an operation. A move of the same widget straight after another move of it
 * replaces that one (dragging a widget around is one move, not a trail); an
 * operation is never removed from the middle of the list, because later ones
 * were worked out against the tree the earlier ones made.
 */
export function withOperation(sidecar: SidecarOverrides, operation: StructureOperation): SidecarOverrides {
  const list = [...(sidecar.structure ?? [])];
  const last = list[list.length - 1];
  if (operation.op === 'move' && last?.op === 'move' && last.name === operation.name) list[list.length - 1] = operation;
  else list.push(operation);
  return withStructure(sidecar, list);
}

/** Add widgets (a button is two operations: the button and its label) in one step. */
export function withAddedWidgets(sidecar: SidecarOverrides, operations: readonly AddOperation[]): SidecarOverrides {
  return withStructure(sidecar, [...(sidecar.structure ?? []), ...operations]);
}

/**
 * Take back an added widget: its add, everything added inside it, every move
 * of any of them, and every attribute override on them. Moves of other widgets
 * into it are dropped too (that widget is gone, so it would only be skipped).
 */
export function withoutAddedWidget(sidecar: SidecarOverrides, name: string): SidecarOverrides {
  const gone = new Set<string>([name]);
  const operations = sidecar.structure ?? [];
  // Widgets added inside a removed one go with it; repeat until nothing new joins.
  for (let changed = true; changed; ) {
    changed = false;
    for (const op of operations) {
      if (op.op === 'add' && op.parent !== null && gone.has(op.parent) && !gone.has(op.name)) {
        gone.add(op.name);
        changed = true;
      }
    }
  }
  const kept = operations.filter((op) => !gone.has(op.name) && !(op.parent !== null && gone.has(op.parent)));
  const nodes = Object.fromEntries(Object.entries(sidecar.nodes).filter(([key]) => !gone.has(key)));
  return withStructure({ ...sidecar, nodes }, kept);
}

/** Where a widget sits now, in the tree after the sidecar's structure. */
export interface Position {
  /** The holder's name, null for the page, or undefined when the holder has no name (so nothing can be moved into or out of it by name). */
  parentName: string | null | undefined;
  parent: IrNode;
  index: number;
}

/** Find a widget by name: where it is, or null (also for the page, which has no name). */
export function positionOf(view: IrNode, name: string): Position | null {
  const visit = (node: IrNode, isRoot: boolean): Position | null => {
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]!;
      if (nodeName(child) === name) return { parentName: isRoot ? null : (nodeName(node) ?? undefined), parent: node, index };
      const deeper = visit(child, false);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  return visit(view, true);
}

/** Does `node` contain a widget named `name` anywhere inside it? */
function containsName(node: IrNode, name: string): boolean {
  return node.children.some((child) => nodeName(child) === name || containsName(child, name));
}

/** A move to carry out, or why it cannot be. `unchanged` means the widget would end up where it is. */
export type MovePlan = { ok: true; parent: string | null; index: number; unchanged: boolean } | { ok: false; reason: string };

/** What a move into `parentNode` at `index` needs to be allowed. `index` counts the parent's children with the moved widget taken out. */
function checkTarget(view: IrNode, name: string, parentNode: IrNode, parentName: string | null | undefined, index: number): MovePlan {
  const current = positionOf(view, name);
  if (current === null) return { ok: false, reason: `${name} is not in the tree` };
  const moving = current.parent.children[current.index]!;
  if (parentName === undefined) return { ok: false, reason: 'that widget has no name, so a move into it cannot be saved (give it a data-lv-name)' };
  if (parentNode === moving || containsName(moving, parentName ?? '\u0000')) return { ok: false, reason: `${parentName ?? 'the page'} is inside ${name}, so ${name} cannot go there` };
  if (!acceptsChildren(parentNode.tag)) return { ok: false, reason: `${parentName ?? 'the page'} is a ${parentNode.tag}, which cannot hold other widgets` };
  return { ok: true, parent: parentName, index, unchanged: current.parent === parentNode && current.index === index };
}

/** Where a drop on a tree row puts the dragged widget. */
export type DropZone = 'before' | 'after' | 'into';

/** Work out dropping widget `name` on widget `targetName` (null: the page) in a zone. */
export function planDrop(view: IrNode, name: string, targetName: string | null, zone: DropZone): MovePlan {
  const current = positionOf(view, name);
  if (current === null) return { ok: false, reason: `${name} is not in the tree` };
  const moving = current.parent.children[current.index]!;
  if (targetName === name) return { ok: false, reason: 'a widget cannot be dropped on itself' };

  if (zone === 'into' || targetName === null) {
    const holder = targetName === null ? view : findByName(view, targetName);
    if (holder === null) return { ok: false, reason: `${targetName} is not in the tree` };
    const children = holder.children.filter((child) => child !== moving);
    return checkTarget(view, name, holder, targetName, children.length);
  }
  const target = positionOf(view, targetName);
  if (target === null) return { ok: false, reason: `${targetName} is not in the tree` };
  const siblings = target.parent.children.filter((child) => child !== moving);
  const at = siblings.findIndex((child) => nodeName(child) === targetName);
  return checkTarget(view, name, target.parent, target.parentName, at + (zone === 'after' ? 1 : 0));
}

function findByName(view: IrNode, name: string): IrNode | null {
  for (const child of view.children) {
    if (nodeName(child) === name) return child;
    const deeper = findByName(child, name);
    if (deeper !== null) return deeper;
  }
  return null;
}

/** The four one-step moves the buttons offer. */
export type Step = 'up' | 'down' | 'out' | 'in';

/** The move for a button, or why the button does nothing (shown as its tooltip). */
export function planStep(view: IrNode, name: string, step: Step): MovePlan {
  const position = positionOf(view, name);
  if (position === null) return { ok: false, reason: `${name} is not in the tree` };
  const { parent, parentName, index } = position;
  if (parentName === undefined) return { ok: false, reason: 'its parent has no name, so a move cannot be saved (give the parent a data-lv-name)' };
  switch (step) {
    case 'up':
      return index === 0 ? { ok: false, reason: 'already first' } : { ok: true, parent: parentName, index: index - 1, unchanged: false };
    case 'down':
      return index === parent.children.length - 1 ? { ok: false, reason: 'already last' } : { ok: true, parent: parentName, index: index + 1, unchanged: false };
    case 'out': {
      if (parentName === null) return { ok: false, reason: 'already directly on the page' };
      const holder = positionOf(view, parentName);
      if (holder === null) return { ok: false, reason: 'its parent is not in the tree' };
      return checkTarget(view, name, holder.parent, holder.parentName, holder.index + 1);
    }
    case 'in': {
      const previous = parent.children[index - 1];
      if (previous === undefined) return { ok: false, reason: 'there is no widget before it to move into' };
      const previousName = nodeName(previous);
      if (previousName === null) return { ok: false, reason: 'the widget before it has no name, so a move cannot be saved' };
      return checkTarget(view, name, previous, previousName, previous.children.length);
    }
  }
}

/**
 * The operations that add a widget of a kind inside `parent` at `index`.
 * `parentIsFlex` decides whether it gets a starting position (a flex parent
 * places it itself).
 */
export function addOperations(kind: WidgetKind, parent: string | null, index: number, taken: ReadonlySet<string>, parentIsFlex: boolean): AddOperation[] {
  const name = uniqueName(kind.tag === 'lv_obj' ? 'box' : kind.label.toLowerCase(), taken);
  const attrs: Record<string, string | number | boolean> = { ...kind.attrs };
  if (!parentIsFlex) {
    attrs['x'] = 10;
    attrs['y'] = 10;
  }
  const operations: AddOperation[] = [{ op: 'add', name, tag: kind.tag, parent, index, attrs }];
  if (kind.child !== undefined) {
    const childName = uniqueName(`${name}_${kind.child.suffix}`, new Set([...taken, name]));
    operations.push({ op: 'add', name: childName, tag: kind.child.tag, parent: name, index: 0, attrs: { ...kind.child.attrs } });
  }
  return operations;
}

/** Where a new widget goes when `selected` is selected: inside it if it can hold widgets, else right after it. */
export function insertionPoint(view: IrNode, selectedName: string | null): { parent: string | null; parentNode: IrNode; index: number } | null {
  if (selectedName !== null) {
    const holder = findByName(view, selectedName);
    if (holder !== null && acceptsChildren(holder.tag)) return { parent: selectedName, parentNode: holder, index: holder.children.length };
    const position = positionOf(view, selectedName);
    if (position !== null && position.parentName !== undefined) return { parent: position.parentName, parentNode: position.parent, index: position.index + 1 };
    if (position !== null) return null; // the parent has no name: nothing can be added next to it
  }
  return { parent: null, parentNode: view, index: view.children.length };
}
