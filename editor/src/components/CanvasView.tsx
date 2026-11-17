import { useState, type MouseEvent } from 'react';
import { hitTest } from '../lib/hitTest';
import type { RenderResponse, WidgetBox } from '../lib/types';

interface CanvasViewProps {
  response: RenderResponse | null;
  loading: boolean;
  zoom: number;
  selectedName: string | null;
  onPick: (name: string | null) => void;
}

const boxStyle = (box: WidgetBox, zoom: number) => ({
  left: box.x * zoom,
  top: box.y * zoom,
  width: box.width * zoom,
  height: box.height * zoom,
});

export function CanvasView({ response, loading, zoom, selectedName, onPick }: CanvasViewProps) {
  const [hoverName, setHoverName] = useState<string | null>(null);
  if (response === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500" data-testid="canvas-empty">
        {loading ? 'Rendering…' : 'Nothing to show yet.'}
      </div>
    );
  }
  const boxes = response.boxes;
  const pointAt = (event: MouseEvent<HTMLDivElement>): WidgetBox | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    return hitTest(boxes, (event.clientX - rect.left) / zoom, (event.clientY - rect.top) / zoom);
  };
  const selectedBox = boxes?.find((b) => b.name === selectedName) ?? null;
  const hoverBox = hoverName !== null && hoverName !== selectedName ? (boxes?.find((b) => b.name === hoverName) ?? null) : null;

  return (
    // `m-auto` on the child (not `justify-center` on the parent) centres a small picture and still lets a large one scroll from its left edge.
    <div className="flex h-full overflow-auto p-6">
      <div className="m-auto flex flex-col items-center gap-2">
      <div
        data-testid="canvas"
        role="application"
        aria-label={`LVGL preview, ${response.width} by ${response.height} pixels. ${boxes === null ? 'Picking widgets here is unavailable.' : 'Click a widget to select it.'}`}
        className={`relative shrink-0 shadow-lg ring-1 ring-slate-300 dark:ring-slate-600 ${loading ? 'opacity-60' : ''} ${boxes === null ? '' : 'cursor-crosshair'}`}
        style={{ width: response.width * zoom, height: response.height * zoom }}
        onClick={(event) => onPick(pointAt(event)?.name ?? null)}
        onMouseMove={(event) => setHoverName(pointAt(event)?.name ?? null)}
        onMouseLeave={() => setHoverName(null)}
      >
        <img
          alt="Rendered LVGL screen"
          src={`data:image/png;base64,${response.png}`}
          width={response.width * zoom}
          height={response.height * zoom}
          draggable={false}
          className="block select-none"
          style={{ imageRendering: 'pixelated' }}
        />
        {hoverBox !== null && <div className="pointer-events-none absolute border border-dashed border-sky-500" style={boxStyle(hoverBox, zoom)} data-testid="hover-box" />}
        {selectedBox !== null && (
          <div className="pointer-events-none absolute border-2 border-sky-500 bg-sky-500/10" style={boxStyle(selectedBox, zoom)} data-testid="selected-box" />
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {response.width}×{response.height}
        {response.cached ? ' (cached)' : ''}
        {hoverName !== null ? ` · ${hoverName}` : ''}
      </p>
      </div>
    </div>
  );
}
