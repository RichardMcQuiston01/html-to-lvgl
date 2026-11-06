/**
 * Select: a closed field that opens a list of options and shows the chosen
 * one. It maps to LVGL's own `lv_dropdown` (ARIA `role="combobox"` with a
 * `role="listbox"` popup, Material UI `MuiSelect-root`, a native `<select>`).
 * COMPONENTS.md, "Component Mapping".
 *
 * Signals and scores:
 *   1    a native `<select>`
 *   1    `role="combobox"` that is not a text input (an editable autocomplete
 *        is a text field, not a select) and whose popup is a listbox
 *   0.7  `MuiSelect-root` (the InputBase root that holds the combobox div, the
 *        hidden native input, the arrow icon and the outline)
 *   0.9  a popup that belongs to a select: a `role="listbox"` that a select
 *        controls, or the Material UI Popover/Menu wrapper around one. It is
 *        removed from the page (the dropdown draws its own list), so a popup
 *        that is open when the page is saved does not also appear as a box.
 *   0.3  a standalone visible `role="listbox"` (a list that is always open):
 *        reported as UNSUPPORTED_WIDGET and left as ordinary boxes, because a
 *        closed dropdown would be a different thing.
 *
 * What build() produces: the node itself becomes the dropdown. Its `children`
 * are dropped (the dropdown draws the arrow and the list), `widget` is set to
 * `dropdown` and the option labels and selected index go in `attrs`, so the
 * existing emitDropdown() writes `<lv_dropdown options=".." selected="..">`.
 *
 * Options and selection come from the DOM, in this order:
 *   - the listbox the combobox names with `aria-controls` / `aria-owns`, else a
 *     listbox that shares its `aria-labelledby` (Material UI), else one inside
 *     it. Its `role="option"` descendants are the options, in document order
 *     (option groups are flattened).
 *   - the selected option is the first with `aria-selected="true"`, else the
 *     first whose text equals the text the closed field shows.
 *   - when no option is selected but the field shows text (a placeholder such
 *     as "Choose..."), that text becomes the first option and is selected. (The
 *     dropdown's own `text` attribute would be the natural fit, but it is not
 *     usable: see the comment in build().)
 *
 * Closed state only: the dropdown is always drawn closed, whatever
 * `aria-expanded` said. Material UI does not mount a closed menu unless
 * `MenuProps={{ keepMounted: true }}` is set; with no listbox in the page the
 * dropdown gets one option (the value the field shows) and the converter
 * reports UNSUPPORTED_WIDGET so the author knows the list is incomplete.
 *
 * Limits: the open list is LVGL's default list (its colors, row height and
 * shadow are not taken from the page's popup); the dropdown's arrow is the
 * LVGL down symbol, not the page's icon; multiple selection (`aria-multiselectable`)
 * is not supported and is reported.
 */

import { SCORE_SEMANTIC, SCORE_MUI, classesOf, hasMuiRoot, withName } from './shared.mjs';
import { findNode } from './overlay.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */
/** @typedef {import('../recognize.mjs').RecognizeContext} RecognizeContext */

/** Higher than a role=menu popup would score, lower than nothing else matters here. */
const SCORE_POPUP = 0.9;
/** A listbox with no select in front of it loses every tie. */
const SCORE_STANDALONE_LISTBOX = 0.3;

/** Popups that are not lists of options (a combobox can point at these). */
const NON_LISTBOX_POPUPS = new Set(['menu', 'grid', 'tree', 'dialog']);

/** Text controls that carry role=combobox: an autocomplete input, not a select. */
const isTextEntry = (node) => node.tag === 'input' || node.tag === 'textarea';

/** @param {UiNode} node */
const isNativeSelect = (node) => node.tag === 'select';

/** @param {UiNode} node */
function isSelectCombobox(node) {
  if (node.role !== 'combobox' || isTextEntry(node) || node.hidden) return false;
  const popup = node.aria?.haspopup;
  return popup === undefined || popup === 'listbox' || popup === 'true';
}

/** A node's own text and everything under it, joined by single spaces. @param {UiNode} node @returns {string} */
function textOf(node) {
  return [node.text, ...node.children.map(textOf)].filter((t) => t && t.trim()).map((t) => t.trim()).join(' ').replace(/\s+/g, ' ');
}

/** @param {UiNode} node @param {(n: UiNode) => boolean} test @returns {UiNode[]} */
function findAll(node, test) {
  const out = test(node) ? [node] : [];
  for (const child of node.children) out.push(...findAll(child, test));
  return out;
}

/** @param {UiNode} tree @param {string} key @returns {UiNode | null} */
const byKey = (tree, key) => findNode(tree, (n) => n.key === key);

/**
 * Every node of a tree as it was extracted, by `key`. A select is a leaf: once
 * its build() has run, its combobox is no longer in `ctx.tree`, but the popup
 * listbox that Material UI mounts in a Portal at the end of <body> is visited
 * AFTER it and must still find the combobox that controls it. Without this the
 * popup was reported as "a listbox that is always visible" whenever the select
 * and its popup sat under different parents that no component had replaced.
 * match() runs on the root before anything is built, so the first call for a
 * tree sees it untouched.
 * @type {WeakMap<UiNode, Map<string, UiNode>>}
 */
const originalsByTree = new WeakMap();

/** @param {RecognizeContext} ctx @returns {Map<string, UiNode>} */
function originalsOf(ctx) {
  let originals = originalsByTree.get(ctx.tree);
  if (!originals) {
    originals = new Map();
    const index = (/** @type {UiNode} */ n) => { if (n.key) originals.set(n.key, n); n.children.forEach(index); };
    index(ctx.tree);
    originalsByTree.set(ctx.tree, originals);
  }
  return originals;
}

/**
 * The combobox inside a Material UI Select root, or the node itself.
 * @param {UiNode} node
 * @returns {UiNode}
 */
const comboboxOf = (node) => (node.role === 'combobox' ? node : findNode(node, (n) => n !== node && n.role === 'combobox') ?? node);

/**
 * The listbox a select opens: named by aria-controls / aria-owns, else one
 * that shares an aria-labelledby with the select, else one inside it.
 * @param {UiNode} root     The node being turned into a dropdown.
 * @param {UiNode} combobox The element with role=combobox.
 * @param {RecognizeContext} ctx
 * @returns {UiNode | null}
 */
function listboxFor(root, combobox, ctx) {
  const isListbox = (/** @type {UiNode} */ n) => n.role === 'listbox';
  for (const key of ctx.links?.get(combobox.key)?.controls ?? []) {
    const target = byKey(ctx.tree, key);
    const found = target && findNode(target, isListbox);
    if (found) return found;
  }
  const mine = new Set([combobox.key, root.key, ...(ctx.links?.get(combobox.key)?.labelledBy ?? [])]);
  const shared = findAll(ctx.tree, (n) => isListbox(n) && (ctx.links?.get(n.key)?.labelledBy ?? []).some((k) => mine.has(k))
    && !(ctx.links?.get(n.key)?.controlledBy ?? []).some((k) => !mine.has(k)));
  if (shared.length) return shared[0];
  return findNode(root, (n) => n !== root && isListbox(n));
}

/**
 * Whether a trigger node is something that opens a list of options.
 * @param {UiNode} node
 */
const opensListbox = (node) => isSelectCombobox(node) || (hasMuiRoot(node, 'Select') && Boolean(findNode(node, (n) => isSelectCombobox(n))));

/** A listbox that some select points at (it is that select's popup). */
function isSelectPopupListbox(node, ctx) {
  if (node.role !== 'listbox') return false;
  const links = ctx.links?.get(node.key);
  const triggers = (links?.controlledBy ?? []).map((key) => originalsOf(ctx).get(key) ?? byKey(ctx.tree, key)).filter(Boolean);
  if (triggers.some((t) => opensListbox(t))) return true;
  // Material UI keeps the menu mounted but does not link it by aria-controls when closed;
  // it names the same label the combobox names.
  const labels = links?.labelledBy ?? [];
  return [...originalsOf(ctx).values()].filter((n) => opensListbox(n)).some((s) => {
    const own = comboboxOf(s);
    return labels.includes(own.key) || (ctx.links?.get(own.key)?.labelledBy ?? []).some((k) => labels.includes(k));
  });
}

/** The Popover/Menu wrapper that holds a select's listbox. */
function isSelectPopupWrapper(node, ctx) {
  const wrapper = hasMuiRoot(node, 'Popover') || hasMuiRoot(node, 'Menu') || hasMuiRoot(node, 'Modal');
  if (!wrapper || node.role === 'listbox') return false;
  return Boolean(findNode(node, (n) => n !== node && isSelectPopupListbox(n, ctx)));
}

/** The border of the Material UI outline (a fieldset or notchedOutline child), if the root has none. */
function outlineStyles(node) {
  const outline = findNode(node, (n) => n !== node
    && (classesOf(n).includes('MuiOutlinedInput-notchedOutline') || n.tag === 'fieldset') && n.styles?.borderWidth > 0);
  return outline ? { borderWidth: outline.styles.borderWidth, borderColor: outline.styles.borderColor } : {};
}

/**
 * Every option: its label and whether the page marks it selected.
 * @param {UiNode} listbox
 * @returns {{ label: string, selected: boolean }[]}
 */
function optionsOf(listbox) {
  return findAll(listbox, (n) => n !== listbox && n.role === 'option')
    .map((option) => ({ label: textOf(option), selected: option.aria?.selected === 'true' }));
}

/** @type {import('../recognize.mjs').ComponentDef} */
const select = {
  name: 'select',
  leaf: true,
  match(node, ctx) {
    originalsOf(ctx); // snapshot while the tree is untouched (the root is matched first)
    if (node.hidden) return false;
    if (isNativeSelect(node)) return SCORE_SEMANTIC;
    if (isSelectCombobox(node)) return SCORE_SEMANTIC;
    if (hasMuiRoot(node, 'Select')) return SCORE_MUI;
    if (node.role === 'combobox' && !isTextEntry(node)) return SCORE_SEMANTIC; // a popup we cannot map: reported in build()
    if (isSelectPopupListbox(node, ctx) || isSelectPopupWrapper(node, ctx)) return SCORE_POPUP;
    if (node.role === 'listbox') return SCORE_STANDALONE_LISTBOX;
    return false;
  },
  props: {
    selected: { type: 'number', default: 0 },
    placeholder: { type: 'string', default: '' },
  },
  slots: [],
  build(node, ctx) {
    // The popup of a select: removed, the dropdown draws its own list.
    const forced = node.widget === 'select'; // data-lv-widget="select" on any box
    if (!forced && !isNativeSelect(node) && !isSelectCombobox(node) && !hasMuiRoot(node, 'Select')) {
      if (node.role === 'combobox' || (node.role === 'listbox' && !isSelectPopupListbox(node, ctx))) {
        ctx.diagnostics.add({
          code: 'UNSUPPORTED_WIDGET',
          message: node.role === 'combobox'
            ? `${node.key}: role="combobox" with aria-haspopup="${node.aria?.haspopup}" opens a ${node.aria?.haspopup}, not a list of options, so it is left as ordinary boxes`
            : `${node.key}: a role="listbox" that is always visible is a list, not a closed select; it is left as ordinary boxes`,
          fix: node.role === 'combobox'
            ? `Give the element aria-haspopup="listbox" with role="option" items to get an lv_dropdown, or add data-lv-widget to ${node.key} to choose the mapping by hand.`
            : `Put role="combobox" on the control that opens the list, or add data-lv-widget="dropdown" to ${node.key}.`,
          source: { selector: node.key },
        });
        return null;
      }
      return { ...node, initiallyHidden: true, recognized: { component: 'select', props: { part: 'popup' } } };
    }

    if (isNativeSelect(node)) {
      const selected = Math.max(0, node.attrs?.selectedIndex ?? 0);
      return { ...node, widget: 'dropdown', children: [], recognized: { component: 'select', props: { selected } } };
    }

    const combobox = comboboxOf(node);
    const shown = textOf(combobox).trim();
    const listbox = listboxFor(node, combobox, ctx);
    const found = listbox ? optionsOf(listbox) : [];

    if (combobox.aria?.multiselectable === 'true' || listbox?.aria?.multiselectable === 'true') {
      ctx.diagnostics.add({
        code: 'UNSUPPORTED_WIDGET',
        message: `${node.key}: a multi-select listbox cannot be a dropdown (it shows one value); only the first selected option is kept`,
        fix: 'Use a set of checkboxes for a multiple choice, or accept the single-value dropdown.',
        source: { selector: node.key },
      });
    }

    /** @type {string[]} */
    let labels = found.map((o) => o.label);
    if (!labels.length) {
      labels = [shown];
      ctx.diagnostics.add({
        code: 'UNSUPPORTED_WIDGET',
        message: `${node.key}: the list of options is not in the page (a closed Material UI Select does not mount its menu), so the dropdown has only the value it shows${shown ? ` ("${shown}")` : ''}`,
        fix: 'Mount the menu in the page (Material UI: MenuProps={{ keepMounted: true }}) or give the select a listbox with role="option" items, then convert again.',
        source: { selector: node.key },
      });
    }

    let selected = found.findIndex((o) => o.selected);
    if (selected < 0 && shown) selected = labels.indexOf(shown);
    // Showing text that is none of the options is a placeholder ("Choose a color").
    // lv_dropdown_set_text would draw it, but LVGL stores that pointer without
    // copying it and the XML loader frees its attribute strings, so it renders
    // blank (checked in LVGL 9.4). The placeholder becomes the first option instead.
    const placeholder = selected < 0 && shown ? shown : '';
    if (placeholder) labels = [placeholder, ...labels];
    selected = Math.max(0, placeholder ? 0 : selected);

    const outline = outlineStyles(node);
    const named = withName(node, 'dropdown');
    return {
      ...named,
      widget: 'dropdown',
      children: [],
      attrs: { ...node.attrs, options: labels, selectedIndex: selected },
      // The text sits in the combobox, which carries the padding; the root (Material UI) has none.
      styles: { ...node.styles, ...(node.styles.borderWidth > 0 ? {} : outline), padLeft: node.styles.padLeft || combobox.styles.padLeft },
      recognized: { component: 'select', props: { selected, placeholder } },
    };
  },
};

export default select;
