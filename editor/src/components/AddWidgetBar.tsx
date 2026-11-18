import { WIDGET_KINDS, type WidgetKind } from '../lib/structure';

interface AddWidgetBarProps {
  /** Where the next widget will go, in words (it follows the selection), or null when it cannot be added. */
  placement: string | null;
  onAdd: (kind: WidgetKind) => void;
}

/** Buttons that add a plain widget next to or inside the selected one. */
export function AddWidgetBar({ placement, onAdd }: AddWidgetBarProps) {
  return (
    <div className="border-b border-slate-200 p-2 dark:border-slate-700" role="group" aria-label="Add a widget">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Add</span>
        {WIDGET_KINDS.map((kind) => (
          <button
            key={kind.tag}
            type="button"
            disabled={placement === null}
            data-testid={`add-widget-${kind.tag}`}
            title={placement === null ? 'There is nowhere to add a widget here: its parent has no name' : `Add a ${kind.label.toLowerCase()} ${placement}`}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
            onClick={() => onAdd(kind)}
          >
            {kind.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" data-testid="add-placement">
        {placement ?? 'Select a widget with a name, or the page.'}
      </p>
    </div>
  );
}
