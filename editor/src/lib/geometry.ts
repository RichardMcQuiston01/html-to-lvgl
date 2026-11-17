import type { AttrValue } from './sidecar';
import type { IrNode } from './types';

/** A rectangle in screen (image) pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight resize handles, named by the side or corner they sit on. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type DragKind = { type: 'move' } | { type: 'resize'; handle: Handle };

/** What the layout allows for one widget, with the reason for each thing it does not. */
export interface LayoutInfo {
  canMove: boolean;
  /** Why it cannot be moved, or null. */
  moveReason: string | null;
  canResizeWidth: boolean;
  widthReason: string | null;
  canResizeHeight: boolean;
  heightReason: string | null;
}

export type DragPlan =
  | {
      ok: true;
      /** Where the widget will be (for the ghost outline while dragging). */
      preview: Rect;
      /** The attributes to write. Only what changes. */
      changes: Record<string, number>;
    }
  | { ok: false; reason: string };

const asNumber = (value: AttrValue | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The parent lays its children out with flex (so x and y mean nothing to them). */
export function isFlex(parent: IrNode | null): boolean {
  const flow = parent?.attrs['flex_flow'];
  return typeof flow === 'string' && flow !== '' && flow !== 'none';
}

const isGrid = (parent: IrNode | null): boolean => parent !== null && Object.keys(parent.attrs).some((key) => key.startsWith('grid_'));

/** Which way a positive pixel move changes the x and y offsets, for an `align` value. Null when the alignment is not one a drag can follow. */
export function alignSigns(align: AttrValue | undefined): { sx: 1 | -1; sy: 1 | -1 } | null {
  if (align === undefined || align === null || align === '') return { sx: 1, sy: 1 };
  if (typeof align !== 'string') return null;
  if (align.startsWith('out_')) return null; // outside the parent: the offset is measured from another widget's edge
  return { sx: align.includes('right') ? -1 : 1, sy: align.includes('bottom') ? -1 : 1 };
}

/**
 * What a widget can do on the canvas, from its parent's layout and its own
 * attributes (both with the sidecar already applied).
 *
 *  - Moving writes x and y, which LVGL honours only for children that the
 *    parent does not lay out itself, so a flex or grid parent forbids it.
 *  - Resizing writes width and height, which a flex parent honours except
 *    along the axis it stretches with `flex_grow`.
 */
export function layoutInfo(parent: IrNode | null, node: IrNode): LayoutInfo {
  const name = String(node.attrs['name'] ?? node.tag);
  let canMove = true;
  let moveReason: string | null = null;
  if (parent === null) {
    canMove = false;
    moveReason = `${name} is the page itself`;
  } else if (isFlex(parent)) {
    canMove = false;
    moveReason = `${name} is placed by its parent's flex layout, so x and y have no effect on it`;
  } else if (isGrid(parent)) {
    canMove = false;
    moveReason = `${name} is placed by its parent's grid layout, so x and y have no effect on it`;
  } else if (alignSigns(node.attrs['align']) === null) {
    canMove = false;
    moveReason = `${name} uses align="${String(node.attrs['align'])}", which a drag cannot follow; edit x and y in the panel`;
  } else {
    const x = node.attrs['x'];
    const y = node.attrs['y'];
    for (const [key, value] of [['x', x], ['y', y]] as const) {
      if (value !== undefined && asNumber(value) === null) {
        canMove = false;
        moveReason = `${name} has ${key}="${String(value)}", which is not a pixel value, so a drag cannot change it; edit it in the panel`;
      }
    }
  }

  let canResizeWidth = parent !== null;
  let widthReason: string | null = parent === null ? `${name} is the page itself` : null;
  let canResizeHeight = parent !== null;
  let heightReason: string | null = parent === null ? `${name} is the page itself` : null;
  const grow = asNumber(node.attrs['flex_grow']);
  if (parent !== null && isFlex(parent) && grow !== null && grow > 0) {
    const flow = String(parent.attrs['flex_flow']);
    const mainIsWidth = flow.startsWith('row');
    if (mainIsWidth) {
      canResizeWidth = false;
      widthReason = `${name} fills the row with flex_grow, so its width comes from the layout; remove flex_grow to size it`;
    } else {
      canResizeHeight = false;
      heightReason = `${name} fills the column with flex_grow, so its height comes from the layout; remove flex_grow to size it`;
    }
  }
  return { canMove, moveReason, canResizeWidth, widthReason, canResizeHeight, heightReason };
}

/** Which handles to show: the sides that can change, and the west and north ones only when the widget can also move (they shift the position). */
export function availableHandles(layout: LayoutInfo): Handle[] {
  const handles: Handle[] = [];
  const { canMove, canResizeWidth: w, canResizeHeight: h } = layout;
  if (w) handles.push('e');
  if (h) handles.push('s');
  if (w || h) handles.push('se');
  if (canMove && w) handles.push('w');
  if (canMove && h) handles.push('n');
  if (canMove && w && h) handles.push('ne', 'nw', 'sw');
  return handles;
}

/** The size a drag may not go below. */
export const MIN_SIZE = 1;

/**
 * Work out a drag: where the widget ends up and which attributes to write.
 *
 * `box` is where LVGL drew the widget (screen pixels). A move adds the pixel
 * distance to the widget's own x and y (so it works whatever the parent's
 * padding or the widget's alignment is); a resize starts from the drawn size,
 * so the widget follows the pointer even when the attribute and the drawn size
 * differ. `dx` and `dy` are whole pixels.
 */
export function planDrag(node: IrNode, parent: IrNode | null, box: Rect, kind: DragKind, dx: number, dy: number): DragPlan {
  const layout = layoutInfo(parent, node);
  const preview: Rect = { ...box };
  const changes: Record<string, number> = {};

  if (kind.type === 'move') {
    if (!layout.canMove) return { ok: false, reason: layout.moveReason ?? 'this widget cannot be moved' };
    const signs = alignSigns(node.attrs['align']);
    if (signs === null) return { ok: false, reason: layout.moveReason ?? 'this widget cannot be moved' };
    const baseX = asNumber(node.attrs['x']) ?? 0;
    const baseY = asNumber(node.attrs['y']) ?? 0;
    preview.x = box.x + dx;
    preview.y = box.y + dy;
    if (dx !== 0) changes['x'] = baseX + signs.sx * dx;
    if (dy !== 0) changes['y'] = baseY + signs.sy * dy;
    return { ok: true, preview, changes };
  }

  const { handle } = kind;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const resizeW = (west || east) && layout.canResizeWidth;
  const resizeH = (north || south) && layout.canResizeHeight;
  // Every axis the handle touches is locked: say why, rather than do nothing.
  if (!resizeW && !resizeH) {
    const widthLocked = (west || east) && !layout.canResizeWidth;
    return { ok: false, reason: (widthLocked ? layout.widthReason : layout.heightReason) ?? 'this widget cannot be resized' };
  }
  if ((west || north) && !layout.canMove) return { ok: false, reason: layout.moveReason ?? 'this widget cannot be moved' };

  if (resizeW) {
    const requested = east ? box.width + dx : box.width - dx;
    const width = Math.max(MIN_SIZE, requested);
    preview.width = width;
    if (width !== box.width) changes['width'] = width;
    if (west) {
      // The right edge stays put, so the left edge moves by the size change.
      const shift = box.width - width;
      preview.x = box.x + shift;
      const signs = alignSigns(node.attrs['align']);
      if (signs === null) return { ok: false, reason: layout.moveReason ?? 'this widget cannot be moved' };
      if (shift !== 0) changes['x'] = (asNumber(node.attrs['x']) ?? 0) + signs.sx * shift;
    }
  }
  if (resizeH) {
    const requested = south ? box.height + dy : box.height - dy;
    const height = Math.max(MIN_SIZE, requested);
    preview.height = height;
    if (height !== box.height) changes['height'] = height;
    if (north) {
      const shift = box.height - height;
      preview.y = box.y + shift;
      const signs = alignSigns(node.attrs['align']);
      if (signs === null) return { ok: false, reason: layout.moveReason ?? 'this widget cannot be moved' };
      if (shift !== 0) changes['y'] = (asNumber(node.attrs['y']) ?? 0) + signs.sy * shift;
    }
  }
  return { ok: true, preview, changes };
}

/** A drag shorter than this many screen pixels is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The CSS cursor for a handle. */
export function handleCursor(handle: Handle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    default:
      return 'nwse-resize';
  }
}
