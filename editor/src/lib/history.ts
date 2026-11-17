/** Undo and redo for a value of any type. Values are treated as immutable. */
export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

/** How many undo steps are kept. */
export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;

/** Make `next` the present. Returns the same history when nothing changed; a change clears the redo steps. */
export function pushHistory<T>(history: History<T>, next: T, equals: (a: T, b: T) => boolean): History<T> {
  if (equals(history.present, next)) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
