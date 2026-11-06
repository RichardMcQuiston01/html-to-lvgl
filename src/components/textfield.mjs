/**
 * Text field: a labelled text box (ARIA `textbox`, `<input>` and `<textarea>`
 * with a label, Material UI TextField and InputBase). It maps to the native
 * `lv_textarea`; the label and helper text stay ordinary labels next to it.
 *
 * Signals, strongest first:
 *   1    a text-like <input> (text, email, password, number, search, tel, url)
 *        or a <textarea> that something describes: a <label for>, `aria-
 *        labelledby`, `aria-describedby`, `aria-invalid` or `aria-errormessage`;
 *        or `role="textbox"`. A bare input with none of these keeps the
 *        converter's own mapping, so existing pages do not change.
 *   0.7  MuiTextField-root, or MuiInputBase-root (an input with no label)
 *   2    data-lv-widget="textfield"
 *
 * What build() emits:
 *   - one `lv_textarea` for the field: `one_line` for an input and for a
 *     role=textbox without `aria-multiline`, multi-line for a <textarea>;
 *     `password_mode` for type=password; `text` from the value; `disabled`
 *     from `disabled`, `aria-disabled` or `Mui-disabled`;
 *   - Material UI: the textarea takes the input base's box and the notched
 *     outline's border and radius, and replaces both. A floating label that
 *     rests inside the field (not shrunk) becomes the placeholder, as the
 *     browser shows it that way when the field is empty and not focused. A
 *     shrunk label stays a label, drawn over the top border on a patch of the
 *     background color where the outline has its notch, above the textarea;
 *   - `aria-invalid="true"` (or Material UI's `Mui-error`) forces a red border
 *     when the page's own CSS did not already color it red, because a snapshot
 *     is only as red as the style sheet is.
 *
 * Limits: a Material UI "filled" or "standard" field draws its underline with
 * a pseudo-element that is not in the extracted tree, so those fields keep
 * their fill but lose the line; the floating label animation is static (a
 * snapshot); input masks, counters and `maxlength` are not reproduced.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasMuiRoot, hasClass, withName } from './shared.mjs';
import { solidBackdropOf } from './chip.mjs';
import { ownName } from '../names.mjs';
import { hexOf, nativeNode, findAll, findByClass, solidColor } from './native.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'number', 'search', 'tel', 'url', '']);

/** Material UI's own error color, used when only ARIA says the field is invalid. */
const ERROR_RED = [0xd3, 0x2f, 0x2f];

/** @param {UiNode} node */
const isTextControl = (node) =>
  node.tag === 'textarea' || (node.tag === 'input' && TEXT_INPUT_TYPES.has(String(node.attrs?.type ?? 'text').toLowerCase()));

/** The first text control under a node, itself included. @param {UiNode} node */
const controlIn = (node) => findAll(node, isTextControl)[0] ?? null;

/** Whether a <label for> or an aria-labelledby names this control. */
function isLabelled(node, ctx) {
  if (ctx.links?.get(node.key)?.labelledBy?.length) return true;
  return Boolean(node.id) && Boolean(ctx.tree && findAll(ctx.tree, (n) => n.tag === 'label' && n.attrs?.for === node.id)[0]);
}

/** @param {UiNode} node */
const isDescribed = (node) => ['describedby', 'invalid', 'errormessage'].some((k) => ariaOf(node, k) !== undefined);

/** A red-ish color: what a page already does to mark an error. @param {number[] | null | undefined} c */
const isReddish = (c) => Boolean(c) && c[0] >= 150 && c[1] <= 110 && c[2] <= 110;

/**
 * Whether the label sits above the border (shrunk) rather than inside the field.
 * @param {UiNode} label
 */
const isShrunk = (label) => hasClass(label, 'MuiInputLabel-shrink') || label.attrs?.shrink === 'true';

/** @param {UiNode} node */
function isDisabled(node) {
  return ariaOf(node, 'disabled') === 'true' || findAll(node, (n) => n.attrs?.disabled === true || hasClass(n, 'Mui-disabled')).length > 0;
}

/** The label `for` this control: a <label for>, or the Material UI label in the same root. */
function labelFor(control, root, ctx) {
  const inRoot = root ? findByClass(root, 'MuiInputLabel-root', 'MuiFormLabel-root') : null;
  if (inRoot) return inRoot;
  return control.id && ctx.tree ? findAll(ctx.tree, (n) => n.tag === 'label' && n.attrs?.for === control.id)[0] ?? null : null;
}

/** Everything about the field's look the page shows, gathered from the parts. */
function fieldLook(control, base, outline, backdrop, invalid) {
  const source = outline ?? base ?? control;
  const s = source.styles ?? {};
  const fill = solidColor(base?.styles?.bgColor ?? control.styles?.bgColor, backdrop) ?? backdrop ?? [255, 255, 255];
  let borderWidth = s.borderWidth > 0 ? s.borderWidth : 0;
  let borderColor = borderWidth ? solidColor(s.borderColor, fill) : null;
  if (invalid && !isReddish(borderColor)) {
    borderWidth = Math.max(1, borderWidth);
    borderColor = ERROR_RED;
  }
  const radius = base?.styles?.radius ?? control.styles?.radius ?? s.radius ?? 0;
  return { fill, borderWidth, borderColor, radius };
}

/**
 * The native textarea for one control.
 * @param {UiNode} control  The <input>, <textarea> or role=textbox element.
 * @param {{ box: UiNode, base?: UiNode | null, outline?: UiNode | null, root?: UiNode | null, ctx: import('../recognize.mjs').RecognizeContext, invalid: boolean, labelText?: string | null }} where
 */
function textarea(control, { box, base = null, outline = null, ctx, invalid, labelText = null }) {
  const type = String(control.attrs?.type ?? 'text').toLowerCase();
  const multiline = control.tag === 'textarea' || ariaOf(control, 'multiline') === 'true' || (base !== null && hasClass(base, 'MuiInputBase-multiline'));
  const value = control.tag === 'input' || control.tag === 'textarea' ? control.attrs?.value ?? control.text ?? '' : control.text ?? '';
  const placeholder = control.attrs?.placeholder || labelText || '';
  const look = fieldLook(control, base, outline, solidBackdropOf(ctx, box), invalid);
  const s = control.styles;

  /** @type {Record<string, string | number>} */
  const attrs = {
    one_line: multiline ? 'false' : 'true',
    ...(placeholder ? { placeholder_text: placeholder } : {}),
    ...(value ? { text: String(value) } : {}),
    ...(type === 'password' ? { password_mode: 'true' } : {}),
    ...(isDisabled(control) || (base && isDisabled(base)) ? { disabled: 'true' } : {}),
    style_bg_color: hexOf(look.fill),
    style_border_width: look.borderWidth,
    ...(look.borderWidth ? { style_border_color: hexOf(look.borderColor) } : {}),
    style_radius: look.radius,
    style_shadow_width: 0,
    style_pad_hor: Math.max(0, s.padLeft || 8),
    // Multi-line text starts at the top padding; a single line is centered by convert().
    ...(multiline ? { style_pad_ver: Math.max(0, s.padTop || 6) } : {}),
  };
  const out = nativeNode(control, 'lv_textarea', attrs, {
    box: { x: box.x, y: box.y, w: box.w, h: box.h },
    fontText: String(value || placeholder || ' '),
  });
  out.native.centerLine = multiline ? null : look.borderWidth;
  // The text color is the input's own; a missing background must not leak in.
  out.styles = { ...control.styles, bgColor: null };
  return out;
}

/**
 * A copy of `node` with `target` swapped for `replacements`, searched
 * recursively. Returns the node unchanged when `target` is not below it.
 * @param {UiNode} node @param {UiNode} target @param {UiNode[]} replacements
 * @returns {UiNode}
 */
function replaceNode(node, target, replacements) {
  let changed = false;
  const children = node.children.flatMap((c) => {
    if (c === target) {
      changed = true;
      return replacements;
    }
    const next = replaceNode(c, target, replacements);
    changed ||= next !== c;
    return [next];
  });
  // Untouched subtrees keep their identity, so later steps can still find nodes by reference.
  return changed ? { ...node, children } : node;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const textfield = {
  name: 'textfield',
  match(node, ctx) {
    // `native` marks a widget this definition already built; the registry offers children again.
    if (node.hidden || node.native) return false;
    if (node.role === 'textbox') return SCORE_SEMANTIC;
    if (isTextControl(node)) return isLabelled(node, ctx) || isDescribed(node) ? SCORE_SEMANTIC : false;
    // A select-style TextField belongs to the select definition, not to this one.
    if (hasMuiRoot(node, 'TextField') || (hasClass(node, 'MuiInputBase-root') && !hasClass(node, 'MuiSelect-root'))) {
      return controlIn(node) && !findByClass(node, 'MuiSelect-select') ? SCORE_MUI : false;
    }
    return false;
  },
  props: {
    label: { type: 'string', default: '' },
    value: { type: 'string', default: '' },
    placeholder: { type: 'string', default: '' },
    helperText: { type: 'string', default: '' },
    multiline: { type: 'bool', default: false },
    password: { type: 'bool', default: false },
    error: { type: 'bool', default: false },
    disabled: { type: 'bool', default: false },
  },
  slots: ['label', 'helper'],
  build(node, ctx) {
    const isControl = node.role === 'textbox' || isTextControl(node);
    const root = isControl ? null : node;
    const control = isControl ? node : controlIn(node);
    if (!control) return null; // data-lv-widget="textfield" on something with no input inside

    const base = root ? (hasClass(root, 'MuiInputBase-root') ? root : findByClass(root, 'MuiInputBase-root')) : null;
    const outline = root ? findByClass(root, 'MuiOutlinedInput-notchedOutline') : null;
    const invalid = ariaOf(control, 'invalid') === 'true' || (root ? findAll(root, (n) => hasClass(n, 'Mui-error')).length > 0 : false);
    const label = labelFor(control, root, ctx);
    const resting = label !== null && root !== null && !isShrunk(label);
    const props = {
      label: label?.text ?? '',
      value: String(control.attrs?.value ?? ''),
      placeholder: control.attrs?.placeholder ?? '',
      multiline: control.tag === 'textarea',
      password: control.attrs?.type === 'password',
      error: invalid,
      disabled: isDisabled(control),
    };

    // A bare control (plain HTML): just the native widget.
    if (!root) {
      const out = textarea(control, { box: control, ctx, invalid });
      out.recognized = { component: 'textfield', props };
      return ownName(out) ? out : withName(out, 'textfield');
    }

    const field = textarea(control, {
      box: base ?? control, base, outline, ctx, invalid, labelText: resting ? label.text : null,
    });
    field.lvName = control.lvName ?? control.id ?? 'textfield';
    field.key = `${control.key ?? node.key}~field`;
    field.id = null;
    field.className = null;
    field.classes = [];

    // Adornments (an icon or button inside the input base) stay as they were.
    const adornments = base ? base.children.filter((c) => c !== control && c !== outline && !hasClass(c, 'MuiOutlinedInput-notchedOutline') && !c.hidden && c.tag !== 'fieldset') : [];

    /** @type {UiNode[]} */
    const replacements = [field, ...adornments];
    let tree = base && base !== root ? replaceNode(root, base, replacements) : { ...root, children: replacements };

    // The label: a resting one became the placeholder; a shrunk one sits over
    // the border, on the background color, after (above) the field.
    if (label) tree = replaceNode(tree, label, []);
    if (label && !resting) {
      const patchColor = solidBackdropOf(ctx, root) ?? [255, 255, 255];
      const scale = 0.75; // Material UI scales the shrunk label by this, and the extractor measured the box but not the font
      const padX = 4;
      const shrunk = {
        ...label,
        x: label.x - padX,
        w: label.w + 2 * padX,
        styles: {
          ...label.styles,
          fontSize: Math.round(label.styles.fontSize * scale * 10) / 10,
          bgColor: [...patchColor, 255],
          padLeft: padX,
          padRight: padX,
          padTop: 0,
          padBottom: 0,
        },
      };
      const at = tree.children.indexOf(field);
      tree = { ...tree, children: [...tree.children] };
      tree.children.splice(at < 0 ? tree.children.length : at + 1 + adornments.length, 0, shrunk);
    }

    tree = { ...tree };
    tree.recognized = { component: 'textfield', props };
    return withName(tree, 'text_field');
  },
};

export default textfield;
