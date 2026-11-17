import { describe, expect, it } from 'vitest';
import { hitTest } from '../src/lib/hitTest';
import type { WidgetBox } from '../src/lib/types';

const box = (name: string, x: number, y: number, width: number, height: number, depth: number, hidden = false): WidgetBox => ({
  name, x, y, width, height, depth, hidden,
});

describe('hitTest', () => {
  const boxes: WidgetBox[] = [
    box('screen', 0, 0, 100, 100, 1),
    box('card', 10, 10, 50, 50, 2),
    box('label', 20, 20, 10, 10, 3),
    box('overlay', 20, 20, 10, 10, 3, true),
    box('badge', 20, 20, 10, 10, 3),
  ];

  it('picks the deepest visible box under the point', () => {
    expect(hitTest(boxes, 5, 5)?.name).toBe('screen');
    expect(hitTest(boxes, 15, 15)?.name).toBe('card');
  });

  it('prefers the later box at the same depth and never a hidden one', () => {
    expect(hitTest(boxes, 25, 25)?.name).toBe('badge');
  });

  it('treats the far edge as outside', () => {
    expect(hitTest(boxes, 60, 60)?.name).toBe('screen');
    expect(hitTest(boxes, 100, 100)).toBeNull();
    expect(hitTest(boxes, -1, 5)).toBeNull();
  });

  it('is null for no boxes', () => {
    expect(hitTest(null, 1, 1)).toBeNull();
    expect(hitTest(undefined, 1, 1)).toBeNull();
    expect(hitTest([], 1, 1)).toBeNull();
  });
});
