/**
 * The `lv_tabview` element tree for a node a component marked with `tabview`
 * data (src/components/tabs.mjs). convert.mjs calls it with its own helpers,
 * because the box, text and placement rules live there.
 *
 * Output shape (LVGL v9.4.0 XML, src/others/xml/parsers/lv_xml_tabview_parser.c):
 *
 *   <lv_tabview active="1" tab_bar_position="bottom" ...box styles>
 *     <lv_tabview-tab_bar height="31" ...bar styles/>
 *     <lv_tabview-tab text="Overview" ...page styles> page content </lv_tabview-tab>
 *     ...
 *     <lv_tabview-tab_button index="0" ...button styles + :checked styles/>
 *   </lv_tabview>
 *
 * The bar and every page are created by the tabview itself, so tab switching,
 * the checked state and scroll-snapping come from LVGL with no extra code.
 * Tab buttons are addressed by index after all tabs exist (the parser warns
 * when a button is asked for before its tab).
 *
 * Why the `:checked` attributes are so complete: the default theme styles a
 * checked tab button (tinted background, primary-colored bottom border, extra
 * top padding). A style for the CHECKED state beats a plain local style, so a
 * checked look that mentions only the properties that differ would let the
 * theme show through for the rest. Every property the theme touches is
 * therefore stated for the checked state.
 */
import { el } from './emit-xml.mjs';

/** Properties the default theme sets on a checked tab button; each must be stated explicitly. */
const THEME_CHECKED = {
  style_bg_opa: '0',
  style_border_width: 0,
  style_border_side: 'full',
  style_pad_all: 0,
};

/** Opacity properties that return to opaque for the checked tab when only the unchecked tab sets them. */
const OPAQUE = { style_text_opa: 255, style_border_opa: 255, style_opa: 255 };

/**
 * @typedef {object} TabviewHelpers
 * @property {(ctx: object, node: object, fallback: string) => string} uid
 * @property {(node: object, parent: object, options?: object) => Record<string, string | number>} placement
 * @property {(node: object, ctx: object, options?: object) => Record<string, string | number>} boxStyles
 * @property {(node: object, ctx: object) => Record<string, string | number>} containerLayout
 * @property {(node: object, font: object) => Record<string, string | number>} textStyles
 * @property {(node: object, ctx: object, options?: object) => { font: object, width: number | null }} fitText
 * @property {(node: object, parent: object, ctx: object, index?: number) => object | null} emit
 * @property {(text: string, transform: string) => string} applyTextTransform
 * @property {(href: string | null, screens: Set<string> | null) => string | null} resolveScreen
 * @property {(color: number[]) => string} hex
 */

/** The element and everything below it that is an LVGL widget, made click-through. @param {{ tag: string, attrs: object, children: object[] }} element */
function unclickable(element) {
  if (element.tag.startsWith('lv_')) element.attrs.clickable = 'false';
  element.children.forEach(unclickable);
  return element;
}

/**
 * @param {object} node  A node with `tabview` data and the tab pages as `children`.
 * @param {object} parent
 * @param {object} ctx   convert()'s context.
 * @param {number} index Position among the parent's children (grid placement).
 * @param {TabviewHelpers} h
 */
export function emitTabview(node, parent, ctx, index, h) {
  const data = node.tabview;
  const base = h.uid(ctx, node, 'tabs');
  const vertical = data.position === 'left' || data.position === 'right';
  const s = node.styles;

  // The tabview's own box. Its padding is the container's real padding: the bar
  // and the pages are laid out inside it by LVGL's flex layout.
  const tabviewAttrs = {
    name: base,
    ...h.placement(node, parent, { gridIndex: index }),
    ...h.boxStyles(node, ctx, { pad: 0 }),
    style_pad_left: s.padLeft, style_pad_right: s.padRight, style_pad_top: s.padTop, style_pad_bottom: s.padBottom,
    // The flex gap between the bar and the pages. Always explicit: the theme's default is not zero.
    style_pad_row: vertical ? 0 : data.gap,
    style_pad_column: vertical ? data.gap : 0,
    scrollable: 'false',
    ...(data.position !== 'top' ? { tab_bar_position: data.position } : {}),
    active: data.active,
  };

  /** @type {object[]} */
  const children = [];

  // Tab bar: its box, its padding (where the first button starts), the gap
  // between buttons, and its size along the cross axis.
  const bar = data.bar;
  const barBox = h.boxStyles(bar.node, ctx, { pad: 0 });
  children.push(el('lv_tabview-tab_bar', {
    name: h.uid(ctx, { lvName: `${base}_bar` }, 'bar'),
    ...(vertical ? { width: bar.w } : { height: bar.h }),
    ...barBox,
    style_pad_left: bar.pad.left, style_pad_right: bar.pad.right, style_pad_top: bar.pad.top, style_pad_bottom: bar.pad.bottom,
    style_pad_column: vertical ? 0 : bar.gap,
    style_pad_row: vertical ? bar.gap : 0,
    scrollable: 'false',
  }));

  // One page per tab. Its children keep the browser's offsets from the panel.
  // (Bottom navigation also carries the action buttons as children, flagged
  // `tabButton`: they hold the icons and went through recognition with the rest.)
  const pagesIn = node.children.filter((c) => !c.tabButton);
  const actions = node.children.filter((c) => c.tabButton);
  pagesIn.forEach((panel, i) => {
    const tab = data.tabs[i];
    if (panel.emptyTab) {
      // Nothing to show on this page (bottom navigation, or a panel that was never measured).
      children.push(el('lv_tabview-tab', { name: h.uid(ctx, { lvName: `${base}_page` }, 'page'), text: tab ? h.applyTextTransform(tab.text, (tab.textNode ?? tab.node).styles.textTransform) : '', scrollable: 'false' }));
      return;
    }
    const kids = panel.children.map((c, k) => h.emit(c, panel, ctx, k)).filter(Boolean);
    const pageName = h.uid(ctx, panel, `${base}_page`);
    if (panel.text) {
      const { font } = h.fitText(panel, ctx);
      kids.unshift(el('lv_label', { name: h.uid(ctx, panel, 'label'), text: panel.text, ...h.textStyles(panel, font) }));
    }
    children.push(el('lv_tabview-tab', {
      name: pageName,
      text: tab ? h.applyTextTransform(tab.text, (tab.textNode ?? tab.node).styles.textTransform) : '',
      ...h.boxStyles(panel, ctx),
      // A panel that is only text keeps its padding, so the label starts where the browser put the text.
      ...(panel.text ? { style_pad_left: panel.styles.padLeft, style_pad_right: panel.styles.padRight, style_pad_top: panel.styles.padTop, style_pad_bottom: panel.styles.padBottom } : {}),
      ...h.containerLayout(panel, ctx),
      scrollable: panel.styles.scrollable ? 'true' : 'false',
    }, kids));
  });

  // Tab buttons, once every tab exists.
  const selected = data.tabs[data.active];
  const other = data.tabs.find((_, i) => i !== data.active) ?? selected;
  data.tabs.forEach((tab, i) => {
    const look = (t, isChecked) => {
      const textNode = t.textNode ?? t.node;
      const font = ctx.fonts.for(textNode.styles);
      const box = h.boxStyles(t.node, ctx, { pad: 0 });
      const attrs = { ...box, ...h.textStyles(textNode, font) };
      if (isChecked && data.indicator && !(t.node.styles.borderWidth > 0)) {
        attrs.style_border_width = data.indicator.width;
        attrs.style_border_color = h.hex(data.indicator.color);
        attrs.style_border_side = data.indicator.side;
      }
      return attrs;
    };
    const unchecked = look(other, false);
    const checked = { ...THEME_CHECKED, ...look(selected, true) };
    // An opaque fill must be stated opaque for the checked state too, or the theme's tint opacity wins.
    if (checked.style_bg_color && checked.style_bg_opa === undefined) checked.style_bg_opa = 255;
    // A translucent look for the unchecked tab (Material UI's 60% text) must not carry over to the checked one.
    for (const [key, neutral] of Object.entries(OPAQUE)) if (key in unchecked && !(key in checked)) checked[key] = neutral;
    if (checked.style_border_width > 0 && checked.style_border_side === undefined) checked.style_border_side = 'full';

    const attrs = { index: i, name: h.uid(ctx, { lvName: `${base}_tab_${i + 1}` }, 'tab'), ...unchecked };
    for (const [key, value] of Object.entries(checked)) {
      if (key in unchecked && unchecked[key] === value && !(key in THEME_CHECKED)) continue;
      attrs[`${key}:checked`] = value;
    }
    if (!data.fillBar) {
      const r = tab.node;
      attrs.flex_grow = 0;
      attrs[vertical ? 'height' : 'width'] = vertical ? r.h : r.w;
    }
    // Bottom navigation: LVGL's own label first, then the icons the action held.
    // column_reverse draws the later children (icons) above it, as Material UI does.
    const action = actions[i];
    // Decoration inside a tab button must not take the tap: a plain lv_obj is clickable and does not
    // pass the event up, so a tap on the icon would never reach the button (and never switch tabs).
    const icons = action ? action.children.map((c, k) => h.emit(c, action, ctx, k)).filter(Boolean).map(unclickable) : [];
    if (data.stack) {
      Object.assign(attrs, {
        flex_flow: data.stack,
        style_flex_main_place: 'center', style_flex_cross_place: 'center', style_flex_track_place: 'center',
        style_pad_row: data.iconGap ?? 0, style_pad_column: 0,
      });
    }
    // A link navigates; the open action's own page is not worth reloading.
    const target = h.resolveScreen(tab.link || tab.href || null, ctx.screens);
    if (ctx.screens && tab.link && !target) {
      ctx.diagnostics.add({
        code: 'LINK_TARGET_UNKNOWN',
        message: `data-lv-link="${tab.link}" does not match any of the pages being converted together; ignoring`,
        fix: `Pass the page "${tab.link}" to html2lvgl together with the other pages, or correct the data-lv-link value to the name of a page in this run.`,
        source: { selector: tab.node.key },
      });
    }
    const nav = target && target !== ctx.page ? [el('screen_create_event', { screen: target })] : [];
    children.push(el('lv_tabview-tab_button', attrs, [...icons, ...nav]));
  });

  return el('lv_tabview', tabviewAttrs, children);
}
