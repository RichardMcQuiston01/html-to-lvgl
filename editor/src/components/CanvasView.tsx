import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { availableHandles, DRAG_THRESHOLD_PX, handleCursor, type DragKind, type DragPlan, type Handle, type LayoutInfo, type Rect } from '../lib/geometry';
import { hitTest } from '../lib/hitTest';
import type { RenderResponse, WidgetBox } from '../lib/types';

/** What the canvas needs to let the selected widget be dragged. Null when it cannot be edited (no name, removed, not rendered). */
export interface CanvasEditing {
  layout: LayoutInfo;
  /** Work out a drag for the selected widget. */
  plan: (kind: DragKind, dx: number, dy: number) => DragPlan;
  /** Write the attributes a finished drag changes (one undo step). */
  onCommit: (changes: Record<string, number>) => void;
  /** Tell the person why something did not happen, or clear the message. */
  onHint: (message: string | null) => void;
}

interface CanvasViewProps {
  response: RenderResponse | null;
  loading: boolean;
  zoom: number;
  selectedName: string | null;
  editing: CanvasEditing | null;
  hint: string | null;
  onPick: (name: string | null) => void;
}

interface ActiveDrag {
  kind: DragKind;
  startX: number;
  startY: number;
  /** Whole pixels of the picture. */
  dx: number;
  dy: number;
  /** The pointer has gone further than a click. */
  moved: boolean;
}

const rectStyle = (rect: Rect, zoom: number) => ({
  left: rect.x * zoom,
  top: rect.y * zoom,
  width: rect.width * zoom,
  height: rect.height * zoom,
});

/** Where a handle sits on a rectangle, in picture pixels. */
function handlePosition(box: Rect, handle: Handle): { x: number; y: number } {
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2;
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2;
  return { x, y };
}

const toRect = (box: WidgetBox): Rect => ({ x: box.x, y: box.y, width: box.width, height: box.height });

export function CanvasView({ response, loading, zoom, selectedName, editing, hint, onPick }: CanvasViewProps) {
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [drag, setDragState] = useState<ActiveDrag | null>(null);
  /**
   * The drag as the event handlers see it. State alone is not enough: a fast
   * pointer can deliver pointerup before React has re-rendered with the last
   * pointermove, and the handler would see an older drag and treat it as a click.
   */
  const dragRef = useRef<ActiveDrag | null>(null);
  const setDrag = (next: ActiveDrag | null): void => {
    dragRef.current = next;
    setDragState(next);
  };
  /** Where a dropped widget is going, shown until the render with the new position arrives. */
  const [pending, setPending] = useState<Rect | null>(null);
  /** A finished drag ends with a click event; it must not also select. */
  const suppressClick = useRef<boolean>(false);

  // The new render has arrived: the picture itself shows the result now.
  const responseKey = response;
  useEffect(() => {
    setPending(null);
  }, [responseKey]);

  // Escape abandons a drag in progress.
  useEffect(() => {
    if (drag === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      suppressClick.current = true;
      dragRef.current = null;
      setDragState(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drag]);

  if (response === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500" data-testid="canvas-empty">
        {loading ? 'Rendering…' : 'Nothing to show yet.'}
      </div>
    );
  }
  const boxes = response.boxes;
  const pointAt = (event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>): WidgetBox | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    return hitTest(boxes, (event.clientX - rect.left) / zoom, (event.clientY - rect.top) / zoom);
  };
  const selectedBox = boxes?.find((b) => b.name === selectedName) ?? null;
  const hoverBox = hoverName !== null && hoverName !== selectedName ? (boxes?.find((b) => b.name === hoverName) ?? null) : null;
  const canEdit = editing !== null && selectedBox !== null;
  const handles = canEdit && drag?.moved !== true ? availableHandles(editing.layout) : [];

  const ghostPlan = drag?.moved === true && editing !== null ? editing.plan(drag.kind, drag.dx, drag.dy) : null;
  const ghost: Rect | null = ghostPlan?.ok === true ? ghostPlan.preview : null;
  const shownBox: Rect | null = pending ?? (selectedBox !== null ? toRect(selectedBox) : null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !canEdit) return;
    const handle = (event.target as HTMLElement).dataset['handle'] as Handle | undefined;
    let kind: DragKind | null = null;
    if (handle !== undefined) kind = { type: 'resize', handle };
    else if (pointAt(event)?.name === selectedName) kind = { type: 'move' };
    if (kind === null) return;
    if (loading) {
      editing.onHint('Wait for the preview to update, then drag again.');
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ kind, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0, moved: false });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current;
    if (current === null) {
      setHoverName(pointAt(event)?.name ?? null);
      return;
    }
    const screenDx = event.clientX - current.startX;
    const screenDy = event.clientY - current.startY;
    const moved = current.moved || Math.hypot(screenDx, screenDy) > DRAG_THRESHOLD_PX;
    setDrag({ ...current, moved, dx: Math.round(screenDx / zoom), dy: Math.round(screenDy / zoom) });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const finished = dragRef.current;
    if (finished === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
    if (!finished.moved || editing === null) return; // a click: the click handler selects
    suppressClick.current = true;
    const plan = editing.plan(finished.kind, finished.dx, finished.dy);
    if (!plan.ok) {
      editing.onHint(plan.reason);
      return;
    }
    if (Object.keys(plan.changes).length === 0) return;
    editing.onHint(null);
    setPending(plan.preview);
    editing.onCommit(plan.changes);
  };

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onPick(pointAt(event)?.name ?? null);
  };

  const overSelected = hoverName !== null && hoverName === selectedName;
  const cursor = drag?.moved === true ? 'grabbing' : boxes === null ? 'default' : overSelected && editing?.layout.canMove === true ? 'move' : 'crosshair';

  return (
    // `m-auto` on the child (not `justify-center` on the parent) centres a small picture and still lets a large one scroll from its left edge.
    <div className="flex h-full overflow-auto p-6">
      <div className="m-auto flex flex-col items-center gap-2">
        <div
          data-testid="canvas"
          role="application"
          aria-label={`LVGL preview, ${response.width} by ${response.height} pixels. ${boxes === null ? 'Picking widgets here is unavailable.' : 'Click a widget to select it; drag the selected widget to move it, or its handles to resize it.'}`}
          className={`relative shrink-0 shadow-lg ring-1 ring-slate-300 dark:ring-slate-600 ${loading ? 'opacity-60' : ''}`}
          style={{ width: response.width * zoom, height: response.height * zoom, cursor, touchAction: 'none' }}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          // The browser's own image drag would take the gesture over (and cancel the pointer) a moment into a slow drag.
          onDragStart={(event) => event.preventDefault()}
          onMouseLeave={() => setHoverName(null)}
        >
          <img
            alt="Rendered LVGL screen"
            src={`data:image/png;base64,${response.png}`}
            width={response.width * zoom}
            height={response.height * zoom}
            draggable={false}
            className="block select-none"
            style={{ imageRendering: 'pixelated', WebkitUserDrag: 'none', userSelect: 'none' } as React.CSSProperties}
          />
          {hoverBox !== null && drag === null && <div className="pointer-events-none absolute border border-dashed border-sky-500" style={rectStyle(toRect(hoverBox), zoom)} data-testid="hover-box" />}
          {shownBox !== null && selectedName !== null && selectedBox !== null && (
            <div className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/10" style={rectStyle(shownBox, zoom)} data-testid="selected-box" />
          )}
          {ghost !== null && (
            <div className="pointer-events-none absolute border-2 border-dashed border-amber-500 bg-amber-400/20" style={rectStyle(ghost, zoom)} data-testid="drag-ghost">
              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-amber-500 px-1 text-[10px] font-medium text-white" data-testid="drag-readout">
                {ghost.x}, {ghost.y} · {ghost.width}×{ghost.height}
              </span>
            </div>
          )}
          {shownBox !== null &&
            handles.map((handle) => {
              const at = handlePosition(shownBox, handle);
              return (
                <div
                  key={handle}
                  data-handle={handle}
                  data-testid={`handle-${handle}`}
                  className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 border border-sky-600 bg-white"
                  style={{ left: at.x * zoom, top: at.y * zoom, cursor: handleCursor(handle) }}
                />
              );
            })}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {response.width}×{response.height}
          {response.cached ? ' (cached)' : ''}
          {hoverName !== null ? ` · ${hoverName}` : ''}
        </p>
        {hint !== null && (
          <p role="status" className="max-w-md rounded bg-amber-50 px-2 py-1 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="canvas-hint">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
