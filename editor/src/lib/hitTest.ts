import type { WidgetBox } from './types';

/**
 * The widget under a point: the deepest visible box that contains it. Boxes
 * are in tree order, so a later box at the same depth is drawn on top and
 * wins. Same rule as `hitTest` in the converter's src/render-api.mjs.
 *
 * @returns The box, or null when the point hits no named widget.
 */
export function hitTest(boxes: readonly WidgetBox[] | null | undefined, x: number, y: number): WidgetBox | null {
  let best: WidgetBox | null = null;
  for (const box of boxes ?? []) {
    if (box.hidden) continue;
    if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) continue;
    if (best === null || box.depth >= best.depth) best = box;
  }
  return best;
}
