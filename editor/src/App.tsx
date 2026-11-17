import { useCallback, useEffect, useMemo, useState } from 'react';
import { CanvasView } from './components/CanvasView';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar, type ApiState } from './components/Toolbar';
import { TreePanel } from './components/TreePanel';
import { EXAMPLE_FILE_NAME, EXAMPLE_IR } from './example';
import { checkHealth, renderIr } from './lib/api';
import { designSize, parseIrText } from './lib/irFile';
import { ancestorIds, flattenTree, idsByName, visibleRows } from './lib/irTree';
import type { ApiFailure, IrDocument, RenderResponse, Size } from './lib/types';

/** Used when an IR's root view has no pixel size. */
const DEFAULT_SIZE: Size = { width: 320, height: 240 };

type RenderState =
  | { status: 'idle' }
  | { status: 'loading'; previous: RenderResponse | null }
  | { status: 'ready'; response: RenderResponse }
  | { status: 'error'; failure: ApiFailure };

export function App() {
  const [ir, setIr] = useState<IrDocument>(EXAMPLE_IR);
  const [fileName, setFileName] = useState<string>(EXAMPLE_FILE_NAME);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [render, setRender] = useState<RenderState>({ status: 'idle' });
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState<number>(2);

  const rows = useMemo(() => flattenTree(ir.view), [ir]);
  const idForName = useMemo(() => idsByName(rows), [rows]);
  const shownRows = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;

  // Render whenever the IR changes. A newer IR cancels the request in flight.
  useEffect(() => {
    const controller = new AbortController();
    setRender((current) => ({
      status: 'loading',
      previous: current.status === 'ready' ? current.response : current.status === 'loading' ? current.previous : null,
    }));
    void (async () => {
      const result = await renderIr(ir, designSize(ir, DEFAULT_SIZE), { signal: controller.signal });
      if (controller.signal.aborted) return;
      setApiState(result.ok || result.failure.code !== 'preview_api_unreachable' ? 'online' : 'offline');
      setRender(result.ok ? { status: 'ready', response: result.value } : { status: 'error', failure: result.failure });
    })();
    return () => controller.abort();
  }, [ir]);

  // Is the preview API there at all? (A render failure above also updates this.)
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await checkHealth({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setApiState(result.ok ? 'online' : 'offline');
    })();
    return () => controller.abort();
  }, []);

  const openIr = useCallback((next: IrDocument, name: string) => {
    setIr(next);
    setFileName(name);
    setParseErrors([]);
    setSelectedId(null);
    setCollapsed(new Set());
  }, []);

  const onOpenFile = useCallback(
    async (file: File) => {
      const result = parseIrText(await file.text());
      if (result.ok) openIr(result.ir, file.name);
      else setParseErrors(result.errors.map((message) => `${file.name}: ${message}`));
    },
    [openIr],
  );

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) return;
    // Show the selection: open any collapsed ancestor.
    const ancestors = ancestorIds(id);
    setCollapsed((current) => (ancestors.some((a) => current.has(a)) ? new Set([...current].filter((c) => !ancestors.includes(c))) : current));
  }, []);

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const response = render.status === 'ready' ? render.response : render.status === 'loading' ? render.previous : null;
  const failure = render.status === 'error' ? render.failure : null;
  const selectedName = selectedRow?.name ?? null;
  const selectedBox = response?.boxes?.find((box) => box.name === selectedName) ?? null;

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Toolbar
        fileName={fileName}
        apiState={apiState}
        zoom={zoom}
        onOpenFile={(file) => void onOpenFile(file)}
        onLoadExample={() => openIr(EXAMPLE_IR, EXAMPLE_FILE_NAME)}
        onZoomChange={setZoom}
      />
      <main className="grid min-h-0 flex-1 grid-cols-[18rem_1fr_22rem]">
        <aside className="min-h-0 border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <TreePanel rows={shownRows} selectedId={selectedId} collapsed={collapsed} onSelect={select} onToggle={toggle} />
        </aside>
        <div className="min-h-0 min-w-0 bg-[repeating-conic-gradient(#e2e8f0_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#1e293b_0%_25%,transparent_0%_50%)]">
          <CanvasView
            response={response}
            loading={render.status === 'loading'}
            zoom={zoom}
            selectedName={selectedName}
            onPick={(name) => select(name === null ? null : (idForName.get(name) ?? null))}
          />
        </div>
        <aside className="min-h-0 divide-y divide-slate-200 overflow-auto border-l border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
          <PropertiesPanel node={selectedRow?.node ?? null} box={selectedBox} boxesAvailable={response?.boxes != null} />
          <DiagnosticsPanel diagnostics={response?.diagnostics ?? []} failure={failure} parseErrors={parseErrors} />
        </aside>
      </main>
    </div>
  );
}
