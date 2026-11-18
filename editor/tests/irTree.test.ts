import { describe, expect, it } from 'vitest';
import { ancestorIds, flattenTree, idsByName, nodeLabel, nodeName, ROOT_ID, visibleRows } from '../src/lib/irTree';
import type { IrNode } from '../src/lib/types';
import dashboard from '../../tests/golden-editor/ir_dashboard.json';

const node = (tag: string, attrs: IrNode['attrs'], children: IrNode[] = []): IrNode => ({ tag, attrs, children });

const small: IrNode = node('view', {}, [
  node('lv_obj', { name: 'topbar' }, [node('lv_label', { name: 'title' })]),
  node('lv_obj', {}, [node('lv_label', { name: 'note' })]),
]);

describe('irTree', () => {
  it('names a node by its name attribute, else its tag', () => {
    expect(nodeName(small.children[0]!)).toBe('topbar');
    expect(nodeName(small.children[1]!)).toBeNull();
    expect(nodeName(node('lv_obj', { name: '' }))).toBeNull();
    expect(nodeName(node('lv_obj', { name: 5 }))).toBeNull();
    expect(nodeLabel(small.children[1]!)).toBe('<lv_obj>');
  });

  it('flattens in tree order with stable ids and depths', () => {
    const rows = flattenTree(small);
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      [ROOT_ID, 0], ['root.0', 1], ['root.0.0', 2], ['root.1', 1], ['root.1.0', 2],
    ]);
    expect(rows[0]!.hasChildren).toBe(true);
    expect(rows[2]!.hasChildren).toBe(false);
  });

  it('maps names to ids, skipping unnamed nodes', () => {
    const ids = idsByName(flattenTree(small));
    expect([...ids.entries()]).toEqual([['topbar', 'root.0'], ['title', 'root.0.0'], ['note', 'root.1.0']]);
  });

  it('hides the descendants of collapsed rows only', () => {
    const rows = flattenTree(small);
    expect(visibleRows(rows, new Set()).length).toBe(5);
    expect(visibleRows(rows, new Set(['topbar'])).map((r) => r.id)).toEqual(['root', 'root.0', 'root.1', 'root.1.0']);
    expect(visibleRows(rows, new Set([ROOT_ID])).map((r) => r.id)).toEqual(['root']);
    // an unnamed row is collapsed by its id
    expect(visibleRows(rows, new Set(['root.1'])).map((r) => r.id)).toEqual(['root', 'root.0', 'root.0.0', 'root.1']);
  });

  it('lists the ancestors to expand for a selection', () => {
    expect(ancestorIds('root.1.0')).toEqual(['root', 'root.1']);
    expect(ancestorIds(ROOT_ID)).toEqual([]);
  });

  it('walks the committed dashboard example: every named widget is found once', () => {
    const rows = flattenTree((dashboard as unknown as { view: IrNode }).view);
    const names = rows.map((r) => r.name).filter((n): n is string => n !== null);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('topbar');
    expect(names).toContain('start');
    expect(idsByName(rows).size).toBe(names.length);
  });
});
