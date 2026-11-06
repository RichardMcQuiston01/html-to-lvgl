/**
 * Button, IconButton, Fab and ToggleButton: named, typed and pressable.
 *
 * The core already draws these (they are `<button>` elements), but it cannot
 * tell them apart. Measured on Material UI 9.5, every one of them is named
 * after its first class, `MuiButtonBase-root`, so a page full of buttons
 * comes out as `button_base`, `button_base_2`, `button_base_3`, ... in the
 * generated XML and C. A contained Button also loses its pressed color: the
 * hover rule that Material UI writes (`:hover` on the root) is not seen when
 * the page was just mounted.
 *
 * Signals:
 *   0.8  the React component `Button`, `IconButton`, `Fab` or `ToggleButton`
 *   0.7  `MuiButton-root`, `MuiIconButton-root`, `MuiFab-root`, `MuiToggleButton-root`
 *
 * build() names the node `<label>_button` (the visible text), `<aria-label>_button`
 * for an icon button, or the component (`fab`, `toggle_button`), unless the
 * author set a name; records variant, color, size and disabled as props; and,
 * for a filled button with no pressed color, gives it Material UI's pressed
 * color (the fill darkened by 20 percent, which is what `palette.*.dark` is).
 *
 * Limits: an outlined or text Button has no fill, so its pressed tint (a 4
 * percent wash of the color) cannot be expressed with the pressed style the
 * core emits; it keeps no pressed color.
 */
import { classesOf, hasClass, muiScore, propsOf, snake, withName } from './shared.mjs';

/** @typedef {import('./shared.mjs').UiNode} UiNode */

/** The Material UI components this definition covers, with the default widget name. */
const KINDS = [
  ['Button', 'button'],
  ['IconButton', 'icon_button'],
  ['Fab', 'fab'],
  ['ToggleButton', 'toggle_button'],
];

/** @param {UiNode} node @returns {[string, string] | null} */
function kindOf(node) {
  // The innermost named component wins: an IconButton is a ButtonBase too, but
  // never a `Button`, and the names are compared whole.
  for (const entry of KINDS) if (muiScore(node, entry[0]) !== false) return entry;
  return null;
}

/** The first text anywhere under the node. @param {UiNode} node @returns {string} */
const textOf = (node) => node.text || node.children.map(textOf).find(Boolean) || '';

/** Value of a `Mui<Component>-<word>` class group, e.g. variant: contained. @param {UiNode} node */
function classPart(node, component, words) {
  for (const c of classesOf(node)) {
    const m = new RegExp(`(?:^|[a-z])${component}-(${words.join('|')})$`).exec(c);
    if (m) return m[1];
  }
  return null;
}

/** @param {number[]} color @param {number} amount 0..1 */
const darken = (color, amount) => color.slice(0, 3).map((v) => Math.round(v * (1 - amount)));

/** @type {import('../../../src/recognize.mjs').ComponentDef} */
const button = {
  name: 'mui-button',
  match(node) {
    if (node.hidden || node.native || node.tag !== 'button') return false;
    const kind = kindOf(node);
    return kind ? muiScore(node, kind[0]) : false;
  },
  props: {
    label: { type: 'string', default: '' },
    variant: { type: 'string', default: 'text' },
    color: { type: 'string', default: 'primary' },
    size: { type: 'string', default: 'medium' },
    disabled: { type: 'bool', default: false },
  },
  slots: ['startIcon', 'endIcon'],
  build(node) {
    const [component, defaultName] = /** @type {[string, string]} */ (kindOf(node));
    const props = propsOf(node, component) ?? {};
    const disabled = hasClass(node, 'Mui-disabled') || node.attrs?.disabled === true || props.disabled === true;
    const variant = (typeof props.variant === 'string' ? props.variant : classPart(node, component, ['contained', 'outlined', 'text', 'filled', 'standard'])) ?? (component === 'Button' ? 'text' : 'standard');
    const color = (typeof props.color === 'string' ? props.color : classPart(node, component, ['colorPrimary', 'colorSecondary', 'colorError', 'colorInfo', 'colorSuccess', 'colorWarning', 'colorInherit', 'primary', 'secondary'])?.replace(/^color/, '').toLowerCase()) ?? 'primary';
    const size = (typeof props.size === 'string' ? props.size : classPart(node, component, ['sizeSmall', 'sizeMedium', 'sizeLarge'])?.replace(/^size/, '').toLowerCase()) ?? 'medium';
    const label = textOf(node).trim() || node.aria?.label?.trim() || '';

    const base = snake(label).slice(0, 24);
    const name = base ? `${base}_button` : (component === 'IconButton' && snake(node.aria?.label ?? '') ? `${snake(node.aria.label)}_button` : defaultName);

    let styles = node.styles;
    if (!disabled && !styles.pressed && styles.bgColor && styles.bgColor[3] >= 255 && !styles.gradient) {
      styles = { ...styles, pressed: { bgColor: [...darken(styles.bgColor, 0.2), 255] } };
    }
    const out = withName({ ...node, styles }, name);
    out.recognized = { component: 'mui-button', props: { label, variant, color, size, disabled } };
    return out;
  },
};

export default button;
