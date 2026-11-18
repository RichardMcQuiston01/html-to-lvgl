import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddWidgetBar } from './components/AddWidgetBar';
import { CanvasView, type CanvasEditing } from './components/CanvasView';
import { DiagnosticsPanel, type LabelledFailure } from './components/DiagnosticsPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toolbar, type ApiState, type SaveState } from './components/Toolbar';
import { TreePanel } from './components/TreePanel';
import { EXAMPLE_FILE_NAME, EXAMPLE_IR } from './example';
import { checkHealth, fetchSidecar, renderIr, saveSidecar } from './lib/api';
import { isFlex, layoutInfo, planDrag } from './lib/geometry';
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, undoHistory, type History } from './lib/history';
import { designSize, parseIrText } from './lib/irFile';
import { ancestorIds, flattenTree, idsByName, ROOT_ID, visibleRows, type TreeRow } from './lib/irTree';
import {
  addedNames, addOperations, allNames, effectiveView, insertionPoint, movedNames, planDrop, planStep, positionOf, withAddedWidgets, withOperation, withoutAddedWidget,
  type DropZone, type MovePlan, type Step, type WidgetKind,
} from './lib/structure';
import {
  countDifferences, countEdits, emptySidecar, isRemoved, knownAttrKeys, nodeWithSidecar, removedRowIds, sidecarsEqual, withAttr, withoutAttr, withRemoved,
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
  /** The selected widget. A named widget is followed by name, so it stays selected when a move changes its place in the tree. */
  const [selection, setSelection] = useState<{ id: string; name: string | null } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState<number>(2);

  const [history, setHistory] = useState<History<SidecarOverrides>>(() => createHistory(emptySidecar()));
  const [savedSidecar, setSavedSidecar] = useState<SidecarOverrides>(() => emptySidecar());
  const [workspace, setWorkspace] = useState<WorkspaceState>('unknown');
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loadFailure, setLoadFailure] = useState<ApiFailure | null>(null);
  const [saveFailure, setSaveFailure] = useState<ApiFailure | null>(null);
  /** Why a drag or a nudge did nothing; cleared when the selection changes or something works. */
  const [hint, setHint] = useState<string | null>(null);

  const sidecar = history.present;
  const dirty = !sidecarsEqual(sidecar, savedSidecar);

  // The tree as the converter will build it: the page with the sidecar's adds and moves applied.
  const structure = useMemo(() => effectiveView(ir.view, sidecar), [ir, sidecar]);
  const viewTree = structure.view;
  const rows = useMemo(() => flattenTree(viewTree), [viewTree]);
  const idForName = useMemo(() => idsByName(rows), [rows]);
  const shownRows = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const knownKeys = useMemo(() => knownAttrKeys(viewTree), [viewTree]);
  const removedIds = useMemo(() => removedRowIds(rows, sidecar), [rows, sidecar]);
  const editedNames = useMemo(() => new Set(Object.keys(sidecar.nodes)), [sidecar]);
  const addedSet = useMemo(() => addedNames(sidecar), [sidecar]);
  const movedSet = useMemo(() => movedNames(sidecar), [sidecar]);
  const selectedRow = useMemo(() => {
    if (selection === null) return null;
    return (selection.name !== null ? rows.find((row) => row.name === selection.name) : rows.find((row) => row.id === selection.id)) ?? null;
  }, [selection, rows]);
  const selectedId = selectedRow?.id ?? null;
  const selectedName = selectedRow?.name ?? null;

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
  /** Several attributes of one widget as a single undo step (a drag changes x and y together). */
  const onSetAttrs = useCallback(
    (nodeName: string, changes: Record<string, number>) => {
      edit((current) =>
        Object.entries(changes).reduce(
          (next, [key, value]) => (Object.is(baseValue(nodeName, key), value) ? withoutAttr(next, nodeName, key) : withAttr(next, nodeName, key, value)),
          current,
        ),
      );
    },
    [baseValue, edit],
  );
  /** Carry out an allowed move (a drag in the tree or a move button). */
  const moveTo = useCallback(
    (name: string, plan: Extract<MovePlan, { ok: true }>) => {
      if (plan.unchanged) return;
      setHint(null);
      edit((current) => withOperation(current, { op: 'move', name, parent: plan.parent, index: plan.index }));
    },
    [edit],
  );

  /** The four move buttons for the selected widget: what each would do, or why it cannot. */
  const steps = useMemo<Record<Step, MovePlan> | null>(() => {
    if (selectedRow === null || selectedName === null || removedIds.has(selectedRow.id)) return null;
    if (selectedRow.id === ROOT_ID) return null;
    return { up: planStep(viewTree, selectedName, 'up'), down: planStep(viewTree, selectedName, 'down'), out: planStep(viewTree, selectedName, 'out'), in: planStep(viewTree, selectedName, 'in') };
  }, [selectedRow, selectedName, removedIds, viewTree]);

  const onStep = useCallback(
    (step: Step) => {
      const plan = steps?.[step];
      if (selectedName === null || plan === undefined) return;
      if (plan.ok) moveTo(selectedName, plan);
      else setHint(plan.reason);
    },
    [steps, selectedName, moveTo],
  );

  /** What dropping a dragged widget on a tree row would do. A row without a name cannot be addressed by a saved move. */
  const planDropOnRow = useCallback(
    (dragName: string, target: TreeRow, zone: DropZone): MovePlan => {
      if (target.id === ROOT_ID) return planDrop(viewTree, dragName, null, 'into');
      if (target.name === null) return { ok: false, reason: 'that widget has no name, so a move next to or into it cannot be saved (give it a data-lv-name)' };
      return planDrop(viewTree, dragName, target.name, zone);
    },
    [viewTree],
  );

  /** Where a new widget would go, in words: it follows the selection. Null when nowhere is possible. */
  const placement = useMemo<string | null>(() => {
    const point = insertionPoint(viewTree, selectedName);
    if (point === null) return null;
    if (selectedName !== null && point.parent === selectedName) return `inside ${selectedName}`;
    if (selectedName !== null) return `after ${selectedName}`;
    return 'at the end of the page';
  }, [viewTree, selectedName]);

  const addWidget = useCallback(
    (kind: WidgetKind) => {
      const point = insertionPoint(viewTree, selectedName);
      if (point === null) {
        setHint('There is nowhere to add a widget here: its parent has no name.');
        return;
      }
      const operations = addOperations(kind, point.parent, point.index, allNames(viewTree), isFlex(point.parentNode));
      setHint(null);
      edit((current) => withAddedWidgets(current, operations));
      setSelection({ id: '', name: operations[0]!.name }); // follow the new widget by name once the tree has it
    },
    [viewTree, selectedName, edit],
  );

  const onResetAttr = useCallback((nodeName: string, key: string) => edit((current) => withoutAttr(current, nodeName, key)), [edit]);
  /** Remove a widget: one added in the editor is taken back; an original one is marked removed in the sidecar. */
  const onRemoveNode = useCallback(
    (nodeName: string) => {
      if (addedSet.has(nodeName)) {
        const holder = positionOf(viewTree, nodeName)?.parentName;
        edit((current) => withoutAddedWidget(current, nodeName));
        setSelection(typeof holder === 'string' ? { id: '', name: holder } : null);
        return;
      }
      edit((current) => withRemoved(current, nodeName, true));
    },
    [addedSet, viewTree, edit],
  );
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

  const response = render.status === 'ready' ? render.response : render.status === 'loading' ? render.previous : null;
  const selectedBox = response?.boxes?.find((box) => box.name === selectedName) ?? null;

  // What the canvas may do with the selected widget: its layout (from its own and its parent's attributes, with the sidecar applied) decides.
  const editing = useMemo<CanvasEditing | null>(() => {
    if (selectedRow === null || selectedName === null || selectedBox === null || removedIds.has(selectedRow.id)) return null;
    const parentId = selectedRow.id.includes('.') ? selectedRow.id.slice(0, selectedRow.id.lastIndexOf('.')) : null;
    const parentRow = parentId === null ? null : (rows.find((row) => row.id === parentId) ?? null);
    const node = nodeWithSidecar(selectedRow.node, sidecar);
    const parent = parentRow === null ? null : nodeWithSidecar(parentRow.node, sidecar);
    const box = { x: selectedBox.x, y: selectedBox.y, width: selectedBox.width, height: selectedBox.height };
    return {
      layout: layoutInfo(parent, node),
      plan: (kind, dx, dy) => planDrag(node, parent, box, kind, dx, dy),
      onCommit: (changes) => {
        setHint(null);
        onSetAttrs(selectedName, changes);
      },
      onHint: setHint,
    };
  }, [selectedRow, selectedName, selectedBox, removedIds, rows, sidecar, onSetAttrs]);

  // Keyboard: undo, redo and save, except while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey && !isTypingTarget(event.target)) {
        // Delete takes the selected widget out (undo brings it back); Alt+Up and Alt+Down move it in the tree.
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedName !== null && selectedRow !== null && selectedRow.id !== ROOT_ID && !removedIds.has(selectedRow.id)) {
          event.preventDefault();
          onRemoveNode(selectedName);
          return;
        }
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          onStep(event.key === 'ArrowUp' ? 'up' : 'down');
          return;
        }
      }
      // Arrow keys nudge the selected widget by 1 pixel, 10 with Shift. A drag has no keyboard equivalent without this.
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (arrow !== undefined && !event.ctrlKey && !event.metaKey && !event.altKey && editing !== null && !isTypingTarget(event.target)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const plan = editing.plan({ type: 'move' }, arrow[0]! * step, arrow[1]! * step);
        if (plan.ok) editing.onCommit(plan.changes);
        else setHint(plan.reason);
        return;
      }
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
  }, [save, undo, redo, editing, selectedName, selectedRow, removedIds, onRemoveNode, onStep]);

  const openIr = useCallback(
    (next: IrDocument, name: string) => {
      const unsaved = countDifferences(sidecar, savedSidecar);
      if (dirty && !window.confirm(`Discard ${unsaved} unsaved edit${unsaved === 1 ? '' : 's'} to ${fileName}?`)) return;
      setIr(next);
      setOpenCount((count) => count + 1);
      setFileName(name);
      setParseErrors([]);
      setSelection(null);
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

  const select = useCallback(
    (id: string | null) => {
      setHint(null);
      if (id === null) {
        setSelection(null);
        return;
      }
      const row = rows.find((candidate) => candidate.id === id) ?? null;
      setSelection({ id, name: row?.name ?? null });
      // Show the selection: open any collapsed ancestor.
      const ancestorKeys = ancestorIds(id).flatMap((ancestor) => rows.find((candidate) => candidate.id === ancestor)?.key ?? []);
      setCollapsed((current) => (ancestorKeys.some((key) => current.has(key)) ? new Set([...current].filter((key) => !ancestorKeys.includes(key))) : current));
    },
    [rows],
  );

  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  // Skipped structure operations, found here as soon as the sidecar changes and again by the converter in the render: shown once.
  const diagnostics = [...structure.problems.map((message) => ({ level: 'warning' as const, message })), ...(response?.diagnostics ?? [])].filter(
    (item, position, all) => all.findIndex((other) => other.level === item.level && other.message === item.message) === position,
  );
  const failures: LabelledFailure[] = [
    ...(render.status === 'error' ? [{ kind: 'render' as const, failure: render.failure }] : []),
    ...(loadFailure !== null ? [{ kind: 'load' as const, failure: loadFailure }] : []),
    ...(saveFailure !== null ? [{ kind: 'save' as const, failure: saveFailure }] : []),
  ];
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
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <AddWidgetBar placement={placement} onAdd={addWidget} />
          <div className="min-h-0 flex-1">
            <TreePanel
              rows={shownRows}
              selectedId={selectedId}
              collapsed={collapsed}
              removedIds={removedIds}
              editedNames={editedNames}
              addedNames={addedSet}
              movedNames={movedSet}
              planDrop={planDropOnRow}
              onSelect={select}
              onToggle={toggle}
              onDrop={moveTo}
            />
          </div>
        </aside>
        <div className="min-h-0 min-w-0 bg-[repeating-conic-gradient(#e2e8f0_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#1e293b_0%_25%,transparent_0%_50%)]">
          <CanvasView
            response={response}
            loading={render.status === 'loading'}
            zoom={zoom}
            selectedName={selectedName}
            editing={editing}
            hint={hint}
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
            added={selectedName !== null && addedSet.has(selectedName)}
            steps={steps}
            onStep={onStep}
            onSetAttr={onSetAttr}
            onResetAttr={onResetAttr}
            onRemoveNode={onRemoveNode}
            onRestoreNode={onRestoreNode}
          />
          <DiagnosticsPanel diagnostics={diagnostics} failures={failures} parseErrors={parseErrors} />
        </aside>
      </main>
    </div>
  );
}
