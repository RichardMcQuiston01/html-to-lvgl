/**
 * Small XML builder for LVGL XML output.
 *
 * Nodes carry attributes as plain objects (never concatenated strings), which
 * makes duplicate attribute names impossible in the output — the bug class
 * found during the Phase 0 spike (expat rejects duplicated attributes).
 * Merging attribute objects with spread has last-wins semantics; use that
 * deliberately for overrides.
 */

export function el(tag, attrs = {}, children = []) {
  return { tag, attrs, children };
}

const escText = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Literal newlines in attribute values are normalized to spaces by XML
// parsers; character references survive, so encode them (dropdown options).
const escAttr = (s) => escText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

export function render(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('');
  if (node.children.length === 0) return `${pad}<${node.tag}${attrs} />`;
  const inner = node.children.map((c) => render(c, indent + 1)).join('\n');
  return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
}
