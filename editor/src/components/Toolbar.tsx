import { useRef } from 'react';

export type ApiState = 'checking' | 'online' | 'offline';

export const ZOOM_LEVELS: readonly number[] = [1, 2, 3, 4];

interface ToolbarProps {
  fileName: string;
  apiState: ApiState;
  zoom: number;
  onOpenFile: (file: File) => void;
  onLoadExample: () => void;
  onZoomChange: (zoom: number) => void;
}

const API_BADGE: Record<ApiState, { label: string; className: string }> = {
  checking: { label: 'Preview API: checking', className: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  online: { label: 'Preview API: online', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  offline: { label: 'Preview API: offline', className: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' },
};

export function Toolbar({ fileName, apiState, zoom, onOpenFile, onLoadExample, onZoomChange }: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const badge = API_BADGE[apiState];
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
      <h1 className="text-sm font-semibold tracking-tight">html2lvgl editor</h1>
      <span className="text-xs text-slate-500 dark:text-slate-400" data-testid="file-name">
        {fileName}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          data-testid="file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) onOpenFile(file);
            event.target.value = ''; // choosing the same file again must still fire
          }}
        />
        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={() => fileInput.current?.click()}>
          Open IR file…
        </button>
        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800" onClick={onLoadExample}>
          Load example
        </button>
        <label className="flex items-center gap-1 text-xs">
          Zoom
          <select
            className="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-600 dark:bg-slate-800"
            value={zoom}
            onChange={(event) => onZoomChange(Number(event.target.value))}
            data-testid="zoom"
          >
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>{`${level}x`}</option>
            ))}
          </select>
        </label>
        <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`} data-testid="api-state">
          {badge.label}
        </span>
      </div>
    </header>
  );
}
