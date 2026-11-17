import { useCallback, useEffect, useMemo, useState } from 'react';
import { CanvasView } from './components/CanvasView';
import { DiagnosticsPanel, type LabelledFailure } from './components/DiagnosticsPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar, type ApiState, type SaveState } from './components/Toolbar';
import { TreePanel } from './components/TreePanel';
import { EXAMPLE_FILE_NAME, EXAMPLE_IR } from './example';
import { checkHealth, fetchSidecar, renderIr, saveSidecar } from './lib/api';
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory, type History } from './lib/history';
import { designSize, parseIrText } from './lib/irFile';
import { ancestorIds, flattenTree, idsByName, visibleRows } from './lib/irTree';
import {
  countDifferences, countEdits, emptySidecar, isRemoved, knownAttrKeys, removedRowIds, sidecarsEqual, withAttr, withoutAttr, withRemoved,
  type AttrValue,
} from './lib/sidecar';
import type { ApiFailure, IrDocument, RenderResponse, SidecarOverrides, Size } from './lib/types';

/** Used when an IR's root view has no pixel size. */
const DEFAULT_SIZE: Size = { width: 320, height: 240 };

/** Wait this long after the last edit before rendering, so typing a value is one render. */
const RENDER_DELAY_MS = 120;

type RenderState =
  | { status: 'idle' }
  | { status: 'loading'; previous: RenderResponse | null }
  | { status: 'ready'; response: RenderResponse }
  | { status: 'error'; failure: ApiFailure };

/** Can edits be saved? `unknown` until the preview API has answered. */
type WorkspaceState = 'unknown' | 'on' | 'off';

/** Typing in a text field must keep the browser's own undo, so the app's shortcuts leave those events alone. */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function App() {
  const [ir, setIr] = useState<IrDocument>(EXAMPLE_IR);
  const [fileName, setFileName] = useState<string>(EXAMPLE_FILE_NAME);
  /** Counts every open, so opening the same page again (the example) still reloads its saved sidecar. */
  const [openCount, setOpenCount] = useState<number>(0);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [render, setRender] = useState<RenderState>({ status: 'idle' });
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState<number>(2);

  const [history, setHistory] = useState<History<SidecarOverrides>>(() => createHistory(emptySidecar()));
  const [savedSidecar, setSavedSidecar] = useState<SidecarOverrides>(() => emptySidecar());
  const [workspace, setWorkspace] = useState<WorkspaceState>('unknown');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [saveFailure, setSaveFailure] = useState<ApiFailure | null>(null);

  const sidecar = history.present;
  const dirty = !sidecarsEqual(sidecar, savedSidecar);

  const rows = useMemo(() => flattenTree(ir.view), [ir]);
  const idForName = useMemo(() => idsByName(rows), [rows]);
  const shownRows = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const knownKeys = useMemo(() => knownAttrKeys(ir.view), [ir]);
  const removedIds = useMemo(() => removedRowIds(rows, sidecar), [rows, sidecar]);
  const editedNames = useMemo(() => new Set(Object.keys(sidecar.nodes)), [sidecar]);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;

  // Render whenever the IR or the edits change. A newer request cancels the one in flight.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRender((current) => ({
        status: 'loading',
        previous: current.status === 'ready' ? current.response : current.status === 'loading' ? current.previous : null,
      }));
      void (async () => {
        const result = await renderIr(ir, designSize(ir, DEFAULT_SIZE), { signal: controller.signal, sidecar });
        if (controller.signal.aborted) return;
        setApiState(result.ok || result.failure.code !== 'preview_api_unreachable' ? 'online' : 'offline');
        setRender(result.ok ? { status: 'ready', response: result.value } : { status: 'error', failure: result.failure });
      })();
    }, RENDER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ir, sidecar]);

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

  // Load the page's saved sidecar when a page is opened.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await fetchSidecar(ir.name, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.ok) {
        const loaded = result.value.sidecar ?? emptySidecar();
        setWorkspace('on');
        setLoadFailure(null);
        setHistory(createHistory(loaded));
        setSavedSidecar(loaded);
      } else if (result.failure.code === 'workspace_not_configured') {
        setWorkspace('off');
      } else if (result.failure.code !== 'aborted') {
        // Unreachable, or a saved file the API refuses (corrupt): say so, and start from no edits.
        setLoadFailure(result.failure);
      }
    })();
    return () => controller.abort();
  }, [ir, openCount]);

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const edit = useCallback((change: (current: SidecarOverrides) => SidecarOverrides) => {
    setHistory((current) => pushHistory(current, change(current.present), sidecarsEqual));
    setSaving('idle');
  }, []);

  const baseValue = useCallback(
    (nodeName: string, key: string): AttrValue | undefined => {
      const id = idForName.get(nodeName);
      return rows.find((row) => row.id === id)?.node.attrs[key];
    },
    [idForName, rows],
  );

  const onSetAttr = useCallback(
    (nodeName: string, key: string, value: AttrValue) => {
      // Setting an attribute back to the page's own value is no override at all.
      const same = value !== null && Object.is(baseValue(nodeName, key), value);
      edit((current) => (same ? withoutAttr(current, nodeName, key) : withAttr(current, nodeName, key, value)));
    },
    [baseValue, edit],
  );
  const onResetAttr = useCallback((nodeName: string, key: string) => edit((current) => withoutAttr(current, nodeName, key)), [edit]);
  const onRemoveNode = useCallback((nodeName: string) => edit((current) => withRemoved(current, nodeName, true)), [edit]);
  const onRestoreNode = useCallback((nodeName: string) => edit((current) => withRemoved(current, nodeName, false)), [edit]);

  const undo = useCallback(() => {
    setHistory((current) => undoHistory(current));
    setSaving('idle');
  }, []);
  const redo = useCallback(() => {
    setHistory((current) => redoHistory(current));
    setSaving('idle');
  }, []);
  const revert = useCallback(() => edit(() => savedSidecar), [edit, savedSidecar]);

  const save = useCallback(async () => {
    if (workspace === 'off' || !dirty) return;
    setSaving('saving');
    setSaveFailure(null);
    const toSave = sidecar;
    const result = await saveSidecar(ir.name, toSave);
    if (result.ok) {
      setSavedSidecar(toSave);
      setWorkspace('on');
      setSaving('saved');
      return;
    }
    setSaving('idle');
    if (result.failure.code === 'workspace_not_configured') setWorkspace('off');
    else setSaveFailure(result.failure);
  }, [workspace, dirty, sidecar, ir.name]);

  // Keyboard: undo, redo and save, except while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, undo, redo]);

  const openIr = useCallback(
    (next: IrDocument, name: string) => {
      const unsaved = countDifferences(sidecar, savedSidecar);
      if (dirty && !window.confirm(`Discard ${unsaved} unsaved edit${unsaved === 1 ? '' : 's'} to ${fileName}?`)) return;
      setIr(next);
      setOpenCount((count) => count + 1);
      setFileName(name);
      setParseErrors([]);
      setSelectedId(null);
      setCollapsed(new Set());
      setHistory(createHistory(emptySidecar()));
      setSavedSidecar(emptySidecar());
      setSaving('idle');
      setLoadFailure(null);
      setSaveFailure(null);
    },
    [dirty, sidecar, savedSidecar, fileName],
  );

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
  const failures: LabelledFailure[] = [
    ...(render.status === 'error' ? [{ kind: 'render' as const, failure: render.failure }] : []),
    ...(loadFailure !== null ? [{ kind: 'load' as const, failure: loadFailure }] : []),
    ...(saveFailure !== null ? [{ kind: 'save' as const, failure: saveFailure }] : []),
  ];
  const selectedName = selectedRow?.name ?? null;
  const selectedBox = response?.boxes?.find((box) => box.name === selectedName) ?? null;
  const saveState: SaveState = workspace === 'off' ? 'off' : saving === 'saving' ? 'saving' : saving === 'saved' ? 'saved' : 'idle';

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Toolbar
        fileName={fileName}
        apiState={apiState}
        zoom={zoom}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        editCount={countEdits(sidecar)}
        dirty={dirty}
        saveState={saveState}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void save()}
        onRevert={revert}
        onOpenFile={(file) => void onOpenFile(file)}
        onLoadExample={() => openIr(EXAMPLE_IR, EXAMPLE_FILE_NAME)}
        onZoomChange={setZoom}
      />
      <main className="grid min-h-0 flex-1 grid-cols-[18rem_1fr_22rem]">
        <aside className="min-h-0 border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <TreePanel rows={shownRows} selectedId={selectedId} collapsed={collapsed} removedIds={removedIds} editedNames={editedNames} onSelect={select} onToggle={toggle} />
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
          <PropertiesPanel
            node={selectedRow?.node ?? null}
            box={selectedBox}
            boxesAvailable={response?.boxes != null}
            sidecar={sidecar}
            removed={selectedRow !== null && removedIds.has(selectedRow.id)}
            removedHere={isRemoved(sidecar, selectedName)}
            knownKeys={knownKeys}
            onSetAttr={onSetAttr}
            onResetAttr={onResetAttr}
            onRemoveNode={onRemoveNode}
            onRestoreNode={onRestoreNode}
          />
          <DiagnosticsPanel diagnostics={response?.diagnostics ?? []} failures={failures} parseErrors={parseErrors} />
        </aside>
      </main>
    </div>
  );
}
