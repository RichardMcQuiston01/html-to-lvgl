import type { IrNode } from './types';

/** One visible row of the tree panel. */
export interface TreeRow {
  /** Position in the tree: `root`, then `root.0`, `root.0.2`, ... Stable for an unchanged IR. */
  id: string;
  depth: number;
  node: IrNode;
  /** The node's `name` attribute, or null when it has none (it cannot be picked on the canvas). */
  name: string | null;
  hasChildren: boolean;
}

export const ROOT_ID = 'root';

/** The node's `name` attribute when it is a non-empty string. */
export function nodeName(node: IrNode): string | null {
  const name = node.attrs['name'];
  return typeof name === 'string' && name !== '' ? name : null;
}

/** What to show for a node: its name, else its tag in angle brackets. */
export function nodeLabel(node: IrNode): string {
  return nodeName(node) ?? `<${node.tag}>`;
}

/** Every node in tree order (parents before children), with its depth and id. */
export function flattenTree(root: IrNode): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: IrNode, id: string, depth: number): void => {
    rows.push({ id, depth, node, name: nodeName(node), hasChildren: node.children.length > 0 });
    node.children.forEach((child, index) => visit(child, `${id}.${index}`, depth + 1));
  };
  visit(root, ROOT_ID, 0);
  return rows;
}

/** Map from a node's `name` to its row id. Names are unique per page (the IR validator enforces it). */
export function idsByName(rows: readonly TreeRow[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const row of rows) {
    if (row.name !== null && !ids.has(row.name)) ids.set(row.name, row.id);
  }
  return ids;
}

/** The rows whose ancestors are all expanded. `collapsed` holds the ids of collapsed rows. */
export function visibleRows(rows: readonly TreeRow[], collapsed: ReadonlySet<string>): TreeRow[] {
  const visible: TreeRow[] = [];
  let hiddenBelowDepth: number | null = null;
  for (const row of rows) {
    if (hiddenBelowDepth !== null) {
      if (row.depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = null;
    }
    visible.push(row);
    if (collapsed.has(row.id)) hiddenBelowDepth = row.depth;
  }
  return visible;
}

/** The ids of every ancestor of a row, nearest last. Used to expand the tree to a selection. */
export function ancestorIds(id: string): string[] {
  const parts = id.split('.');
  const ids: string[] = [];
  for (let end = 1; end < parts.length; end += 1) ids.push(parts.slice(0, end).join('.'));
  return ids;
}
