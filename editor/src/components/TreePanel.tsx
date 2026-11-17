import { useEffect, useRef } from 'react';
import { nodeLabel, type TreeRow } from '../lib/irTree';

interface TreePanelProps {
  rows: readonly TreeRow[];
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  /** Rows the sidecar removes (a removed node and everything under it). */
  removedIds: ReadonlySet<string>;
  /** Names of widgets the sidecar changes. */
  editedNames: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

export function TreePanel({ rows, selectedId, collapsed, removedIds, editedNames, onSelect, onToggle }: TreePanelProps) {
  const selectedRef = useRef<HTMLLIElement>(null);
  // A pick on the canvas selects a row that may be off screen.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <nav aria-label="Widget tree" className="h-full overflow-auto p-2 text-sm">
      <ul role="tree">
        {rows.map((row) => {
          const selected = row.id === selectedId;
          const isCollapsed = collapsed.has(row.id);
          const isRemoved = removedIds.has(row.id);
          const isEdited = row.name !== null && editedNames.has(row.name);
          return (
            <li
              key={row.id}
              ref={selected ? selectedRef : undefined}
              role="treeitem"
              aria-selected={selected}
              aria-expanded={row.hasChildren ? !isCollapsed : undefined}
              style={{ paddingLeft: `${row.depth * 14}px` }}
            >
              <div className={`flex items-center rounded ${selected ? 'bg-sky-100 dark:bg-sky-900' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                {row.hasChildren ? (
                  <button
                    type="button"
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${nodeLabel(row.node)}`}
                    className="w-5 shrink-0 text-xs text-slate-500"
                    onClick={() => onToggle(row.id)}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                <button
                  type="button"
                  data-testid={`tree-row-${row.name ?? row.id}`}
                  data-removed={isRemoved}
                  className={`min-w-0 flex-1 truncate py-0.5 text-left ${row.name === null ? 'text-slate-400 dark:text-slate-500' : ''} ${isRemoved ? 'text-slate-400 line-through dark:text-slate-500' : ''}`}
                  title={row.name === null ? `${row.node.tag} (no name: it cannot be picked on the canvas)` : `${row.node.tag} ${row.name}`}
                  onClick={() => onSelect(row.id)}
                >
                  {nodeLabel(row.node)}
                  {row.name !== null && <span className="ml-2 text-xs text-slate-400">{row.node.tag}</span>}
                  {isEdited && <span className="ml-1 text-amber-600" title="Changed by the sidecar" data-testid={`edited-${row.name}`}>●</span>}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
