/**
 * Stepper: a row or column of numbered steps with labels and connectors
 * (Material UI Stepper, a plain `<ol role="list">` of steps, one marked
 * `aria-current="step"`). Static: there is no behavior, it shows where the
 * user is. LVGL has no stepper widget, so this is a composite of ordinary
 * boxes, and what build() adds is what the converter alone gets wrong:
 *
 *  1. The step icon. Material UI draws it as an SVG (a filled circle with the
 *     step number, or a check mark when the step is done). An SVG becomes an
 *     icon placeholder (an empty outlined square). build() replaces each step
 *     icon (an `<svg>` inside `MuiStepLabel-iconContainer`) with a real circle:
 *     a box with half-its-size corner radius, the SVG's color as fill, and the
 *     step number centered in white. The number is the one the SVG shows, or
 *     the step's position when the SVG is a check mark (U+2713 is not in the
 *     built-in fonts, so a done step shows its number, not a check).
 *  2. The connector line. It is a 1px CSS border, which LVGL draws at the
 *     wrong color when the box is 1px tall. build() turns it into a box filled
 *     with the border color, as wide (or tall) as the border.
 *  3. Names: the stepper is `stepper`, each step `step_1`, `step_2`, ...
 *
 * Step state comes from the markup: `aria-current="step"` or a `Mui-active`
 * class on the step or anything inside it is the active step; a `Mui-completed`
 * class is a completed one; the rest are upcoming. It is kept in
 * `recognized.props` (orientation, count, active) for tools; the colors the
 * browser measured are what the converter draws.
 *
 * Horizontal and vertical both work: the orientation is the root's flex
 * direction, and every box keeps the layout the browser gave it.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const LIST_TAGS = new Set(['ol', 'ul']);
const WHITE = [255, 255, 255, 255];

/** @param {UiNode} node */
const isListItem = (node) => node.tag === 'li' || node.role === 'listitem';

/** @param {UiNode} node @returns {boolean} true at or below the node */
function holdsCurrentStep(node) {
  if (ariaOf(node, 'current') === 'step') return true;
  return node.children.some(holdsCurrentStep);
}

/** @param {UiNode} node @returns {boolean} */
function holdsClass(node, name) {
  return hasClass(node, name) || node.children.some((c) => holdsClass(c, name));
}

/** @param {UiNode} node @returns {boolean} */
const isActive = (node) => holdsCurrentStep(node) || holdsClass(node, 'Mui-active');

/** @param {UiNode} node @returns {boolean} */
const isCompleted = (node) => hasClass(node, 'Mui-completed');

/**
 * @param {UiNode} node
 * @returns {number | false}
 */
function match(node) {
  if (hasMuiRoot(node, 'Stepper')) return SCORE_MUI;
  const isList = LIST_TAGS.has(node.tag) || node.role === 'list';
  if (isList) {
    const items = node.children.filter(isListItem);
    if (items.length >= 2 && items.some(holdsCurrentStep)) return SCORE_SEMANTIC;
  }
  return false;
}

/** The steps of the stepper, in order. Material UI interleaves connectors; a list holds only items. @param {UiNode} root */
function stepsOf(root) {
  const mui = root.children.filter((c) => hasMuiRoot(c, 'Step'));
  return mui.length ? mui : root.children.filter(isListItem);
}

/** The digits an SVG's own <text> shows, or null (a check mark has none). @param {UiNode} svg */
function svgNumber(svg) {
  const walk = (n) => {
    if (n.tag === 'text' && n.text && /^\d{1,3}$/.test(n.text.trim())) return n.text.trim();
    for (const child of n.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(svg);
}

/**
 * A circle that stands for the SVG step icon.
 * @param {UiNode} svg
 * @param {string} label  The step number.
 * @param {string} name
 * @returns {UiNode}
 */
function circleFor(svg, label, name) {
  return {
    ...svg,
    tag: 'div',
    lvName: name,
    text: label,
    children: [],
    aria: {},
    classes: [],
    className: null,
    styles: {
      ...svg.styles,
      bgColor: svg.styles.color,
      color: WHITE,
      radius: Math.round(Math.min(svg.w, svg.h) / 2),
      borderWidth: 0,
      borderBottomWidth: 0,
      textAlign: 'center',
      fontSize: Math.max(10, Math.round(svg.h / 2)),
      fontWeight: 400,
      padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    },
    layout: { ...svg.layout, display: 'block' },
  };
}

/**
 * The connector's line as a box filled with its border color. The line is one
 * CSS border on one side of a box that can be much larger than the border (a
 * vertical connector's line is a left border on a box as wide as the step
 * column), so the new box is only the border's own strip.
 * @param {UiNode} line
 * @returns {UiNode}
 */
function solidLine(line) {
  const s = line.styles;
  const useTop = s.borderWidth > 0 && s.borderColor;
  const width = useTop ? s.borderWidth : s.borderBottomWidth;
  const color = useTop ? s.borderColor : s.borderBottomColor;
  const side = useTop ? s.borderSide : width > 0 ? 'bottom' : null;
  if (!(width > 0) || !color || !['top', 'bottom', 'left', 'right'].includes(side)) return line; // no single-edge border: nothing to turn solid
  const strip = {
    top: { w: line.w, h: width },
    bottom: { y: line.y + line.h - width, w: line.w, h: width },
    left: { w: width, h: line.h },
    right: { x: line.x + line.w - width, w: width, h: line.h },
  }[side];
  return {
    ...line,
    ...strip,
    styles: { ...s, bgColor: color, borderWidth: 0, borderBottomWidth: 0, borderSide: null },
  };
}

/**
 * Rebuild the subtree: step icons become circles, connector lines solid boxes.
 * @param {UiNode} node
 * @param {{ ordinal: number, insideIconContainer: boolean }} at
 * @returns {UiNode}
 */
function rewrite(node, at) {
  if (node.tag === 'svg' && at.insideIconContainer) {
    return circleFor(node, svgNumber(node) ?? String(at.ordinal), `step_${at.ordinal}_icon`);
  }
  if (hasClass(node, 'MuiStepConnector-line')) return solidLine(node);
  const inside = at.insideIconContainer || hasClass(node, 'MuiStepLabel-iconContainer');
  return { ...node, children: node.children.map((c) => rewrite(c, { ...at, insideIconContainer: inside })) };
}

/**
 * @param {UiNode} node
 * @returns {UiNode}
 */
function build(node) {
  const steps = stepsOf(node);
  const vertical = node.layout?.flexDirection === 'column' || hasClass(node, 'MuiStepper-vertical') || ariaOf(node, 'orientation') === 'vertical';

  let ordinal = 0;
  /** @type {Map<UiNode, UiNode>} */
  const rebuilt = new Map();
  for (const step of steps) {
    ordinal += 1;
    const named = step.lvName ? step : { ...step, lvName: `step_${ordinal}` };
    rebuilt.set(step, rewrite(named, { ordinal, insideIconContainer: false }));
  }
  // Connectors sit between steps, outside any step, and need the same rewrite.
  const children = node.children.map((child) => rebuilt.get(child) ?? rewrite(child, { ordinal, insideIconContainer: false }));

  const active = steps.findIndex(isActive);
  const completed = steps.filter(isCompleted).length;
  const out = withName({ ...node, children }, 'stepper');
  out.recognized = { component: 'stepper', props: { orientation: vertical ? 'vertical' : 'horizontal', count: steps.length, active, completed } };
  return out;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const stepper = {
  name: 'stepper',
  match,
  props: {
    orientation: { type: 'string', default: 'horizontal' },
    count: { type: 'number', default: 0 },
    active: { type: 'number', default: 0 },
    completed: { type: 'number', default: 0 },
  },
  slots: ['steps'],
  build,
};

export default stepper;
