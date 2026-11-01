/**
 * Touch-target check: a finger needs about 30 px to press something reliably,
 * and Material UI controls at 320x240 are often smaller. This pass reads the
 * recognized tree, adds one TOUCH_TARGET_SMALL (info) diagnostic per pressable
 * element that is too small, and never changes the tree, so generated output
 * is identical with or without it.
 */

/** @typedef {import('./recognize.mjs').UiNode} UiNode */

const TARGET_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'slider', 'tab', 'menuitem', 'option']);
const TARGET_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'button', 'submit']);
const TARGET_WIDGETS = new Set(['switch', 'checkbox', 'slider']);
const TARGET_TAGS = new Set(['button', 'select', 'textarea']);

/**
 * Whether a node is something a finger presses.
 * @param {UiNode} node
 * @returns {boolean}
 */
export function isTouchTarget(node) {
  if (TARGET_TAGS.has(node.tag)) return true;
  if (node.tag === 'a' && node.attrs?.href != null && node.attrs.href !== '') return true;
  if (node.tag === 'input' && TARGET_INPUT_TYPES.has(String(node.attrs?.type ?? '').toLowerCase())) return true;
  if (node.role && TARGET_ROLES.has(String(node.role).toLowerCase())) return true;
  if (node.link) return true;
  if (node.widget && TARGET_WIDGETS.has(node.widget)) return true;
  return false;
}

/** The visible text under a node, joined with single spaces. */
function visibleText(node) {
  if (node.hidden) return '';
  const parts = [];
  if (node.text) parts.push(String(node.text));
  for (const child of node.children ?? []) parts.push(visibleText(child));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** The tag plus a short label: the aria-label, else the visible text. */
function describe(node) {
  const label = node.aria?.label || visibleText(node);
  const shown = label.length > 30 ? `${label.slice(0, 27)}...` : label;
  const tag = node.tag === 'input' && node.attrs?.type ? `<input type="${node.attrs.type}">` : `<${node.tag}>`;
  return `${tag}${shown ? ` "${shown}"` : ''}`;
}

/**
 * Report pressable elements smaller than `minSize` px in width or height.
 * A target inside another target is not reported (the outer one is what a
 * finger hits), and hidden nodes are skipped. A `minSize` of 0 disables it.
 *
 * @param {UiNode} tree  The recognized tree.
 * @param {{ diagnostics: { add(d: object): unknown }, minSize?: number }} options
 * @returns {number} How many diagnostics were added.
 */
export function checkTouchTargets(tree, { diagnostics, minSize = 30 }) {
  if (!(minSize > 0)) return 0;
  let added = 0;
  const visit = (/** @type {UiNode} */ node) => {
    if (node.hidden) return;
    if (isTouchTarget(node)) {
      const { w, h } = node;
      if (Number.isFinite(w) && Number.isFinite(h) && (w < minSize || h < minSize)) {
        diagnostics.add({
          code: 'TOUCH_TARGET_SMALL',
          message: `${describe(node)} (${node.key ?? 'unknown'}) is ${w}x${h} px; touch targets should be at least ${minSize} px in both width and height`,
          fix: `Make the element at least ${minSize}x${minSize} px, or add padding or a larger hit area around it, in the HTML or in the generated XML (set width and height on the generated widget; the selector above names the source element). Pass --min-touch-target 0 to turn this check off.`,
          source: { selector: node.key },
        });
        added += 1;
      }
      return; // nested targets are covered by this one
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return added;
}
