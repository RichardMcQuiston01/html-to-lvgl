/**
 * Widget-name helpers shared by convert() and the recognizers, so a name a
 * recognizer reserves is the one convert() finally emits.
 */

/** Lower-case identifier safe for C, C++ and MicroPython. */
export const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$|(_)_+/g, '$1') || 'obj';

const MUI_CLASS = /^Mui([A-Za-z0-9]+)-([A-Za-z0-9]+)$/;

/**
 * A readable name for a class-derived name, or null when the class is noise.
 * "MuiIconButton-root" -> "icon_button" (the slot is dropped when it is
 * "root", kept otherwise); "css-1x2y3z" -> null.
 * @param {string} cls
 * @returns {string | null}
 */
export function readableClassName(cls) {
  const mui = MUI_CLASS.exec(cls);
  if (mui) {
    const part = mui[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    return sanitize(mui[2] === 'root' ? part : `${part}_${mui[2]}`);
  }
  if (/^css-/.test(cls)) return null;
  return sanitize(cls);
}

/**
 * The name convert() would give a node before numbering duplicates, or null
 * when the node carries no name of its own. Author-chosen names (data-lv-name,
 * id) win; a Material UI or generated class gives way to the aria-label, then
 * to a cleaned-up part name, so output reads "menu" or "icon_button" rather
 * than "muiiconbutton_root".
 * @param {{ lvName?: string | null, id?: string | null, className?: string | null, aria?: { label?: string } | null }} node
 * @returns {string | null}
 */
export function ownName(node) {
  const explicit = node.lvName || node.id;
  if (explicit) return sanitize(explicit);
  if (!node.className) return null;
  const isMui = MUI_CLASS.test(node.className);
  if (isMui || /^css-/.test(node.className)) {
    const label = node.aria?.label?.trim();
    if (label && label.length <= 24) return sanitize(label);
  }
  const cls = readableClassName(node.className);
  return cls && cls !== 'obj' ? cls : null;
}
