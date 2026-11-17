import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, HISTORY_LIMIT, pushHistory, redoHistory, undoHistory } from '../src/lib/history';

const same = (a: number, b: number): boolean => a === b;

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = createHistory(0);
    h = pushHistory(h, 1, same);
    h = pushHistory(h, 2, same);
    expect(h.present).toBe(2);
    h = undoHistory(h);
    expect(h.present).toBe(1);
    h = undoHistory(h);
    expect(h.present).toBe(0);
    expect(canUndo(h)).toBe(false);
    h = redoHistory(h);
    h = redoHistory(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
  });

  it('ignores a push that changes nothing', () => {
    const h = createHistory(5);
    expect(pushHistory(h, 5, same)).toBe(h);
  });

  it('a new change clears the redo steps', () => {
    let h = pushHistory(createHistory(0), 1, same);
    h = undoHistory(h);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, 9, same);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(9);
  });

  it('undo and redo at the ends do nothing', () => {
    const h = createHistory(0);
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
  });

  it('keeps a bounded number of steps', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i += 1) h = pushHistory(h, i, same);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(h.present).toBe(HISTORY_LIMIT + 50);
  });
});
