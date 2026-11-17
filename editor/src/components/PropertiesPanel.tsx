import { nodeLabel, nodeName } from '../lib/irTree';
import { effectiveAttrs, type AttrValue } from '../lib/sidecar';
import type { IrNode, SidecarOverrides, WidgetBox } from '../lib/types';
import { AddAttrForm } from './AddAttrForm';
import { AttrRow } from './AttrRow';

interface PropertiesPanelProps {
  node: IrNode | null;
  box: WidgetBox | null;
  boxesAvailable: boolean;
  sidecar: SidecarOverrides;
  /** The widget is removed by the sidecar (or sits under one that is). */
  removed: boolean;
  /** The sidecar removes this very node (so it can be brought back here). */
  removedHere: boolean;
  knownKeys: readonly string[];
  onSetAttr: (nodeName: string, key: string, value: AttrValue) => void;
  onResetAttr: (nodeName: string, key: string) => void;
  onRemoveNode: (nodeName: string) => void;
  onRestoreNode: (nodeName: string) => void;
}

const smallButton = 'rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800';

export function PropertiesPanel({ node, box, boxesAvailable, sidecar, removed, removedHere, knownKeys, onSetAttr, onResetAttr, onRemoveNode, onRestoreNode }: PropertiesPanelProps) {
  if (node === null) {
    return <p className="p-3 text-sm text-slate-500" data-testid="properties-empty">Select a widget in the tree or on the canvas.</p>;
  }
  const name = nodeName(node);
  const attrs = effectiveAttrs(node, sidecar);
  const editable = name !== null && !removed;
  const currentValue = (key: string): AttrValue | undefined => attrs.find((a) => a.key === key)?.value ?? node.attrs[key];

  return (
    <section aria-label="Properties" className="p-3 text-sm" data-testid="properties" key={name ?? 'unnamed'}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-semibold" data-testid="properties-title">{nodeLabel(node)}</h2>
        {name !== null && !removed && (
          <button type="button" className={smallButton} onClick={() => onRemoveNode(name)} data-testid="remove-node" title="Remove this widget and everything inside it from the generated UI">
            Remove widget
          </button>
        )}
        {name !== null && removedHere && (
          <button type="button" className={smallButton} onClick={() => onRestoreNode(name)} data-testid="restore-node">
            Restore widget
          </button>
        )}
      </div>
      {removed && (
        <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200" data-testid="removed-note">
          {removedHere ? 'This widget is removed from the generated UI.' : 'A widget above this one is removed, so this one is gone too.'}
        </p>
      )}
      {name === null && (
        <p className="mt-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300" data-testid="unnamed-note">
          This widget has no name, so it cannot be edited. Give the element a data-lv-name (or an id) in the page.
        </p>
      )}
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-slate-500">tag</dt>
        <dd>{node.tag}</dd>
        <dt className="text-slate-500">children</dt>
        <dd>{node.children.length}</dd>
        <dt className="text-slate-500">on screen</dt>
        <dd data-testid="properties-box">
          {box !== null
            ? `x ${box.x}, y ${box.y}, ${box.width}×${box.height}${box.hidden ? ' (hidden)' : ''}`
            : removed
              ? 'not shown: removed'
              : name === null
                ? 'not reported: this node has no name'
                : boxesAvailable
                  ? 'not reported for this node'
                  : 'unavailable: rebuild the render program (html2lvgl --build-render --rebuild)'}
        </dd>
      </dl>
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Attributes</h3>
      {attrs.length === 0 ? (
        <p className="text-xs text-slate-500">None.</p>
      ) : (
        <table className="mt-1 w-full table-fixed text-xs">
          <colgroup>
            <col className="w-[36%]" />
            <col />
            <col className="w-12" />
          </colgroup>
          <tbody>
            {attrs.map((attr) => (
              <AttrRow
                key={`${name ?? ''}:${attr.key}:${String(attr.value)}:${attr.overridden}`}
                attr={attr}
                editable={editable}
                onCommit={(value) => name !== null && onSetAttr(name, attr.key, value)}
                onReset={() => name !== null && onResetAttr(name, attr.key)}
                onRemove={() => name !== null && onSetAttr(name, attr.key, null)}
              />
            ))}
          </tbody>
        </table>
      )}
      {editable && name !== null && <AddAttrForm suggestions={knownKeys} currentValue={currentValue} onAdd={(key, value) => onSetAttr(name, key, value)} />}
    </section>
  );
}
