/**
 * Plain-C emitter: turns the converter's element tree (the same one the XML
 * emitter renders) into self-contained LVGL C code with no lv_xml runtime
 * dependency. This matters because the lv_xml runtime was removed from LVGL
 * master — C output works on any LVGL 9.x.
 *
 * The generated unit exports a fixed symbol:
 *   lv_obj_t * ui_create(lv_obj_t * parent);
 *
 * Fonts are referenced directly (&lv_font_montserrat_N — enable the sizes in
 * lv_conf.h). Images are left as named extern lv_image_dsc_t declarations to
 * be provided by the asset pipeline.
 */

const FLAG_ATTRS = { scrollable: 'LV_OBJ_FLAG_SCROLLABLE', hidden: 'LV_OBJ_FLAG_HIDDEN', ignore_layout: 'LV_OBJ_FLAG_IGNORE_LAYOUT' };

const ENUMS = {
  flex_flow: (v) => `LV_FLEX_FLOW_${v.toUpperCase()}`,
  align: (v) => `LV_ALIGN_${v.toUpperCase()}`,
  style_flex_main_place: (v) => `LV_FLEX_ALIGN_${v.toUpperCase()}`,
  style_flex_cross_place: (v) => `LV_FLEX_ALIGN_${v.toUpperCase()}`,
  style_flex_track_place: (v) => `LV_FLEX_ALIGN_${v.toUpperCase()}`,
  style_bg_grad_dir: (v) => `LV_GRAD_DIR_${v.toUpperCase()}`,
  style_border_side: (v) => `LV_BORDER_SIDE_${v.toUpperCase()}`,
  style_text_align: (v) => `LV_TEXT_ALIGN_${v.toUpperCase()}`,
  style_layout: (v) => `LV_LAYOUT_${v.toUpperCase()}`,
};

const cstr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

// C keywords plus identifiers the generated function already uses
const C_RESERVED = new Set([
  'auto', 'bool', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extern', 'false', 'float', 'for', 'goto', 'if',
  'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed',
  'sizeof', 'static', 'struct', 'switch', 'true', 'typedef', 'union', 'unsigned',
  'void', 'volatile', 'while', 'parent', 'root',
]);

export function emitC(view, { name = 'page' } = {}) {
  const unit = `ui_${name}`;
  const lines = [];
  const statics = [];
  let varCount = 0;
  let gridDscCount = 0;

  function widgetVar(node) {
    let v = (node.attrs.name || `w${++varCount}`).replace(/[^a-z0-9_]/gi, '_');
    if (/^\d/.test(v)) v = `w_${v}`;
    if (C_RESERVED.has(v)) v = `${v}_w`;
    return v;
  }

  function emitNode(node, parentVar) {
    const v = node.tag === 'view' ? 'root' : widgetVar(node);
    const createFn = { view: 'lv_obj_create' }[node.tag] ?? `${node.tag.replace(/-.*/, '')}_create`;

    if (node.tag === 'lv_table-column') {
      lines.push(`    lv_table_set_column_width(${parentVar}, ${node.attrs.column}, ${node.attrs.width});`);
      return;
    }
    if (node.tag === 'lv_table-cell') {
      lines.push(`    lv_table_set_cell_value(${parentVar}, ${node.attrs.row}, ${node.attrs.column}, ${cstr(node.attrs.value)});`);
      return;
    }

    lines.push('');
    lines.push(`    lv_obj_t * ${v} = ${createFn}(${parentVar});`);

    for (const [key, raw] of Object.entries(node.attrs)) {
      if (raw === null || raw === undefined || raw === '' || key === 'name') continue;
      emitAttr(node, v, key, String(raw));
    }
    for (const child of node.children) emitNode(child, v);
    if (node.tag === 'view') lines.push('');
  }

  function emitAttr(node, v, key, value) {
    // Widget-specific attributes first
    const widget = node.tag === 'view' ? 'lv_obj' : node.tag;
    if (widget === 'lv_image' && key === 'src') {
      statics.push(`extern const lv_image_dsc_t img_${value}; /* provide via LVGL image converter */`);
      lines.push(`    lv_image_set_src(${v}, &img_${value});`);
      return;
    }
    const specific = WIDGET_ATTRS[widget]?.[key];
    if (specific) {
      lines.push(`    ${specific(v, value)}`);
      return;
    }

    if (key === 'x') return lines.push(`    lv_obj_set_x(${v}, ${value});`);
    if (key === 'y') return lines.push(`    lv_obj_set_y(${v}, ${value});`);
    if (key === 'width') return lines.push(`    lv_obj_set_width(${v}, ${value});`);
    if (key === 'height') return lines.push(`    lv_obj_set_height(${v}, ${value});`);
    if (key === 'align') return lines.push(`    lv_obj_set_align(${v}, ${ENUMS.align(value)});`);
    if (key === 'flex_flow') return lines.push(`    lv_obj_set_flex_flow(${v}, ${ENUMS.flex_flow(value)});`);
    if (key === 'flex_grow') return lines.push(`    lv_obj_set_flex_grow(${v}, ${value});`);
    if (key === 'checked') return lines.push(`    lv_obj_set_state(${v}, LV_STATE_CHECKED, ${value === 'true'});`);
    if (key in FLAG_ATTRS) return lines.push(`    lv_obj_set_flag(${v}, ${FLAG_ATTRS[key]}, ${value === 'true'});`);

    if (key.startsWith('style_')) {
      const [propPart, state] = key.split(':');
      const prop = propPart.slice(6);
      const selector = state ? `LV_STATE_${state.toUpperCase()}` : '0';

      if (prop === 'grid_column_dsc_array' || prop === 'grid_row_dsc_array') {
        const arr = `grid_dsc_${++gridDscCount}`;
        const items = value.split(' ').map((t) => {
          const fr = /^fr\((\d+)\)$/.exec(t);
          return fr ? `LV_GRID_FR(${fr[1]})` : t;
        });
        statics.push(`static const int32_t ${arr}[] = {${items.join(', ')}, LV_GRID_TEMPLATE_LAST};`);
        return lines.push(`    lv_obj_set_style_${prop}(${v}, ${arr}, ${selector});`);
      }

      let cValue = value;
      if (ENUMS[propPart]) cValue = ENUMS[propPart](value);
      else if (prop.endsWith('_color')) cValue = `lv_color_hex(${value})`;
      else if (prop === 'text_font') cValue = `&lv_font_${value}`;
      return lines.push(`    lv_obj_set_style_${prop}(${v}, ${cValue}, ${selector});`);
    }

    // Unknown attribute: surface it in the output rather than dropping it silently
    lines.push(`    /* unmapped attribute: ${key}="${value}" */`);
  }

  emitNode(view, 'parent');

  const h = `/* Generated by html2lvgl — do not edit by hand */
#ifndef ${unit.toUpperCase()}_H
#define ${unit.toUpperCase()}_H

#include "lvgl.h"

lv_obj_t * ui_create(lv_obj_t * parent);

#endif /* ${unit.toUpperCase()}_H */
`;

  const c = `/* Generated by html2lvgl — do not edit by hand */
#include "${unit}.h"

${statics.length ? statics.join('\n') + '\n\n' : ''}lv_obj_t * ui_create(lv_obj_t * parent)
{${lines.join('\n')}
    return root;
}
`;

  return { c, h, unit };
}

/* Widget-specific attribute translations. Each returns a full C statement. */
const WIDGET_ATTRS = {
  lv_label: {
    text: (v, val) => `lv_label_set_text(${v}, ${cstr(val)});`,
  },
  lv_checkbox: {
    text: (v, val) => `lv_checkbox_set_text(${v}, ${cstr(val)});`,
  },
  lv_slider: {
    min_value: (v, val) => `lv_slider_set_min_value(${v}, ${val});`,
    max_value: (v, val) => `lv_slider_set_max_value(${v}, ${val});`,
    value: (v, val) => `lv_slider_set_value(${v}, ${val}, LV_ANIM_OFF);`,
  },
  lv_bar: {
    min_value: (v, val) => `lv_bar_set_min_value(${v}, ${val});`,
    max_value: (v, val) => `lv_bar_set_max_value(${v}, ${val});`,
    value: (v, val) => `lv_bar_set_value(${v}, ${val}, LV_ANIM_OFF);`,
  },
  lv_textarea: {
    one_line: (v, val) => `lv_textarea_set_one_line(${v}, ${val === 'true'});`,
    placeholder_text: (v, val) => `lv_textarea_set_placeholder_text(${v}, ${cstr(val)});`,
    password_mode: (v, val) => `lv_textarea_set_password_mode(${v}, ${val === 'true'});`,
    text: (v, val) => `lv_textarea_set_text(${v}, ${cstr(val)});`,
  },
  lv_dropdown: {
    options: (v, val) => `lv_dropdown_set_options(${v}, ${cstr(val)});`,
    selected: (v, val) => `lv_dropdown_set_selected(${v}, ${val});`,
  },
  lv_table: {
    column_count: (v, val) => `lv_table_set_column_count(${v}, ${val});`,
    row_count: (v, val) => `lv_table_set_row_count(${v}, ${val});`,
  },
};
