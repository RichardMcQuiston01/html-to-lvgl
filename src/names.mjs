/**
 * Widget-name helpers shared by convert() and the recognizers, so a name a
 * recognizer reserves is the one convert() finally emits.
 */

/** Lower-case identifier safe for C, C++ and MicroPython. */
export const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$|(_)_+/g, '$1') || 'obj';

/**
 * The name convert() would give a node before numbering duplicates, or null
 * when the node carries no name of its own.
 * @param {{ lvName?: string | null, id?: string | null, className?: string | null }} node
 * @returns {string | null}
 */
export function ownName(node) {
  const raw = node.lvName || node.id || node.className;
  return raw ? sanitize(raw) : null;
}
