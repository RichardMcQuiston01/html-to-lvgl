/**
 * The `lv_button` for a tab button that carries `checkable` data
 * (src/components/appbar-tabs.mjs). convert.mjs calls it with its own helpers,
 * because the box, text and placement rules live there.
 *
 * What differs from a plain button (convert.mjs emitButton):
 *   - The button has two looks, an unchecked one and a CHECKED one, taken from
 *     the tab that was open in the browser and one that was not. LVGL keeps the
 *     open tab's button CHECKED through the `bind_state_if_eq` the component
 *     attached (a `<bind_state_if_eq state="checked">` child, C
 *     lv_obj_bind_state_if_eq, MicroPython obj.bind_state_if_eq).
 *   - Text styles (font, colour, text opacity) sit on the BUTTON, and its label
 *     sets none: a label draws in the colour it inherits from its parent as the
 *     parent is in its current state, so only then does `style_text_color:checked`
 *     reach it. A style on the label itself would be fixed for both states.
 *   - Every property the default theme sets for a checked button is restated
 *     for that state. The theme's CHECKED style (bg_color_secondary) sets a
 *     background colour AND a white text colour, and a style for the CHECKED
 *     state beats a plain local style, so a look that only mentions what
 *     differs would let the theme's teal and white show through. Verified in
 *     real LVGL v9.4.0 renders (the checked button turned teal before
 *     style_bg_color:checked and style_text_color:checked were always stated).
 *   - A property only the unchecked look sets (Material UI's 60% text and
 *     button opacity) returns to opaque for the checked state.
 */
import { el } from './emit-xml.mjs';

/** Properties the default theme sets for a checked button: always stated for that state. */
const THEME_CHECKED = ['style_bg_color', 'style_text_color'];

/** What a property returns to in the checked state when only the unchecked look sets it. */
const NEUTRAL = { style_opa: 255, style_text_opa: 255, style_border_opa: 255, style_border_side: 'full' };

/**
 * @typedef {object} CheckableHelpers
 * @property {(ctx: object, node: object, fallback: string) => string} uid
 * @property {(node: object, parent: object, options?: object) => Record<string, string | number>} placement
 * @property {(node: object, ctx: object, options?: object) => Record<string, string | number>} boxStyles
 * @property {(node: object, font: object) => Record<string, string | number>} textStyles
 * @property {(node: object, ctx: object, options?: object) => { font: object, width: number | null }} fitText
 * @property {(node: object) => Record<string, string | number>} buttonLabelPlacement
 * @property {(node: object, ctx: object) => Record<string, string | number>} containerLayout
 * @property {(node: object, parent: object, ctx: object, index?: number) => object | null} emit
 * @property {(color: number[]) => string} hex
 */

/**
 * @param {object} node  A button node with `checkable` data (see CheckableTab).
 * @param {object} parent
 * @param {object} ctx   convert()'s context.
 * @param {number} index Position among the parent's children (grid placement).
 * @param {CheckableHelpers} h
 */
export function emitCheckableTab(node, parent, ctx, index, h) {
  const { selected, unselected, indicator } = node.checkable;

  /**
   * One state's attributes. A tab with no background of its own (Material UI)
   * shows what is behind it; a background the app bar workaround gave this
   * node (appbar.mjs fillTransparentButtons) applies to both looks.
   */
  const look = (/** @type {any} */ t, /** @type {boolean} */ isChecked) => {
    const styled = t.styles.bgColor || !node.styles.bgColor ? t : { ...t, styles: { ...t.styles, bgColor: node.styles.bgColor } };
    const attrs = { ...h.boxStyles(styled, ctx, { pad: 0 }), ...h.textStyles(styled, h.fitText({ ...styled, text: node.text }, ctx).font) };
    if (isChecked && indicator && !(t.styles.borderWidth > 0)) {
      attrs.style_border_width = indicator.width;
      attrs.style_border_color = h.hex(indicator.color);
      attrs.style_border_side = indicator.side;
    }
    return attrs;
  };
  const normal = look(unselected, false);
  const open = look(selected, true);

  const attrs = { name: h.uid(ctx, node, 'tab'), ...h.placement(node, parent, { gridIndex: index }), ...normal };
  /** @type {Record<string, string | number>} */
  const checked = {};
  for (const [key, value] of Object.entries(open)) {
    if (normal[key] !== value || THEME_CHECKED.includes(key)) checked[key] = value;
  }
  for (const [key, neutral] of Object.entries(NEUTRAL)) {
    if (key in normal && !(key in open)) checked[key] = neutral;
  }
  for (const [key, value] of Object.entries(checked)) attrs[`${key}:checked`] = value;

  const children = node.children.map((c, k) => h.emit(c, node, ctx, k)).filter(Boolean);
  // A tab with an icon is a flex box in the page (Material UI's labelIcon tab is a
  // column: icon, then label), and its children carry flex margins. A plain
  // lv_button has no layout, so the children would pile up at its corner.
  const flexed = node.layout?.display === 'flex' && node.children.length > 0;
  if (flexed) {
    Object.assign(attrs, h.containerLayout(node, ctx));
    const flow = flexFlowWithTextFirst(node, attrs.flex_flow);
    if (flow) attrs.flex_flow = flow;
  }
  if (node.text) {
    // The label sets no style of its own: it inherits the button's, state included.
    children.unshift(el('lv_label', { name: h.uid(ctx, node, 'label'), ...(flexed ? {} : h.buttonLabelPlacement(node)), text: node.text }));
  }
  return el('lv_button', attrs, children);
}

/**
 * LVGL's label is the button's first child, but in the page the icon came
 * first when it sits before the text (above it in a column, left of it in a
 * row). The reversed flow draws the later children (the icons) first, which is
 * how bottom navigation stacks its icon over the label too. The side comes from
 * the measured boxes: the icon's centre against the button's centre.
 * @param {{ x: number, y: number, w: number, h: number, children: { x: number, y: number, w: number, h: number }[] }} node
 * @param {string | undefined} flow  The flex_flow containerLayout chose.
 * @returns {string | null} The flow to use, or null to keep it.
 */
function flexFlowWithTextFirst(node, flow) {
  if (!flow || flow.endsWith('_reverse')) return null;
  const icon = node.children[0];
  const column = flow.startsWith('column');
  const iconMid = column ? icon.y + icon.h / 2 : icon.x + icon.w / 2;
  const nodeMid = column ? node.y + node.h / 2 : node.x + node.w / 2;
  return iconMid < nodeMid - 2 ? `${flow}_reverse` : null;
}
