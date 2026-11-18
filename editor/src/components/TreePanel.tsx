import { useEffect, useRef, useState, type DragEvent } from 'react';
import { nodeLabel, ROOT_ID, type TreeRow } from '../lib/irTree';
import type { DropZone, MovePlan } from '../lib/structure';

interface TreePanelProps {
  rows: readonly TreeRow[];
  selectedId: string | null;
  /** Keys (see TreeRow.key) of collapsed rows. */
  collapsed: ReadonlySet<string>;
  /** Rows the sidecar removes (a removed node and everything under it). */
  removedIds: ReadonlySet<string>;
  /** Names of widgets the sidecar changes. */
  editedNames: ReadonlySet<string>;
  /** Names of widgets the sidecar adds. */
  addedNames: ReadonlySet<string>;
  /** Names of widgets the sidecar moves. */
  movedNames: ReadonlySet<string>;
  /** What dropping the dragged widget on a row, in a zone, would do. */
  planDrop: (dragName: string, target: TreeRow, zone: DropZone) => MovePlan;
  onSelect: (id: string) => void;
  onToggle: (key: string) => void;
  /** A drop that is allowed. */
  onDrop: (dragName: string, plan: Extract<MovePlan, { ok: true }>) => void;
}

interface DropState {
  rowId: string;
  zone: DropZone;
  plan: MovePlan;
}

/** The top fifth of a row means "before", the bottom fifth "after", the middle "into". */
function zoneAt(event: DragEvent<HTMLElement>, isRoot: boolean): DropZone {
  if (isRoot) return 'into';
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
  return ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'into';
}

export function TreePanel({ rows, selectedId, collapsed, removedIds, editedNames, addedNames, movedNames, planDrop, onSelect, onToggle, onDrop }: TreePanelProps) {
  const selectedRef = useRef<HTMLLIElement>(null);
  const [dragName, setDragName] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  // A pick on the canvas selects a row that may be off screen.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const endDrag = (): void => {
    setDragName(null);
    setDrop(null);
  };

  return (
    <nav aria-label="Widget tree" className="flex h-full flex-col text-sm">
      <ul role="tree" className="min-h-0 flex-1 overflow-auto p-2">
        {rows.map((row) => {
          const selected = row.id === selectedId;
          const isCollapsed = collapsed.has(row.key);
          const isRemoved = removedIds.has(row.id);
          const isEdited = row.name !== null && editedNames.has(row.name);
          const isAdded = row.name !== null && addedNames.has(row.name);
          const isMoved = row.name !== null && movedNames.has(row.name);
          const isRoot = row.id === ROOT_ID;
          const canDrag = row.name !== null && !isRoot && !isRemoved;
          const target = drop !== null && drop.rowId === row.id ? drop : null;
          const indicator =
            target === null
              ? 'border-transparent'
              : !target.plan.ok
                ? 'border-transparent ring-2 ring-rose-400/70'
                : target.zone === 'before'
                  ? 'border-t-sky-500 border-b-transparent'
                  : target.zone === 'after'
                    ? 'border-b-sky-500 border-t-transparent'
                    : 'border-transparent ring-2 ring-sky-500';
          return (
            <li
              key={row.id}
              ref={selected ? selectedRef : undefined}
              role="treeitem"
              aria-selected={selected}
              aria-expanded={row.hasChildren ? !isCollapsed : undefined}
              style={{ paddingLeft: `${row.depth * 14}px` }}
            >
              <div
                data-testid={`row-${row.name ?? row.id}`}
                draggable={canDrag}
                onDragStart={(event) => {
                  if (row.name === null) return;
                  event.dataTransfer.setData('text/plain', row.name);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragName(row.name);
                }}
                onDragEnd={endDrag}
                onDragOver={(event) => {
                  if (dragName === null) return;
                  const zone = zoneAt(event, isRoot);
                  const plan = planDrop(dragName, row, zone);
                  if (plan.ok) {
                    event.preventDefault(); // this row accepts the drop
                    event.dataTransfer.dropEffect = 'move';
                  } else {
                    event.dataTransfer.dropEffect = 'none';
                  }
                  setDrop((current) => (current !== null && current.rowId === row.id && current.zone === zone && current.plan.ok === plan.ok ? current : { rowId: row.id, zone, plan }));
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop((current) => (current?.rowId === row.id ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragName !== null) {
                    const plan = planDrop(dragName, row, zoneAt(event, isRoot));
                    if (plan.ok) onDrop(dragName, plan);
                  }
                  endDrag();
                }}
                className={`flex items-center rounded border-y-2 ${indicator} ${selected ? 'bg-sky-100 dark:bg-sky-900' : 'hover:bg-slate-100 dark:hover:bg-slate-800'} ${dragName !== null && row.name === dragName ? 'opacity-40' : ''}`}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${nodeLabel(row.node)}`}
                    className="w-5 shrink-0 text-xs text-slate-500"
                    onClick={() => onToggle(row.key)}
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
                  title={row.name === null ? `${row.node.tag} (no name: it cannot be picked on the canvas or moved)` : `${row.node.tag} ${row.name}${canDrag ? ' (drag to move)' : ''}`}
                  onClick={() => onSelect(row.id)}
                >
                  {nodeLabel(row.node)}
                  {row.name !== null && <span className="ml-2 text-xs text-slate-400">{row.node.tag}</span>}
                  {isAdded && (
                    <span className="ml-1 text-xs font-semibold text-emerald-600" title="Added in the editor" data-testid={`added-${row.name}`}>
                      +
                    </span>
                  )}
                  {isMoved && (
                    <span className="ml-1 text-xs text-violet-600" title="Moved in the editor" data-testid={`moved-${row.name}`}>
                      ⇅
                    </span>
                  )}
                  {isEdited && <span className="ml-1 text-amber-600" title="Changed by the sidecar" data-testid={`edited-${row.name}`}>●</span>}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p
        role="status"
        data-testid="drop-hint"
        className={`min-h-[2.5rem] border-t border-slate-200 px-2 py-1 text-xs dark:border-slate-700 ${drop !== null && !drop.plan.ok ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}`}
      >
        {drop !== null && !drop.plan.ok ? drop.plan.reason : dragName !== null ? `Moving ${dragName}: drop above or below a widget, or on one to put it inside.` : 'Drag a widget to move it, or use the move buttons in the properties panel.'}
      </p>
    </nav>
  );
}
