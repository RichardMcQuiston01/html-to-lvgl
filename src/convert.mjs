/**
 * UI-tree → LVGL XML conversion (pure; no browser, no filesystem).
 *
 * Input is the JSON tree produced by extract.mjs. Output is LVGL XML for the
 * v9.4 lv_xml runtime plus warnings and an asset manifest.
 *
 * Layout strategy (Phase 1):
 * - CSS flex containers map to LVGL flex (`flex_flow`, `style_flex_*`,
 *   `pad_row`/`pad_column` from gap, real padding); their in-flow children
 *   carry no x/y and keep `flex_grow` and margins.
 * - Everything else uses absolute positioning from Chromium's resolved
 *   layout (the html-to-figma baseline).
 * - `position: absolute` children inside a flex parent get `ignore_layout`
 *   plus coordinates, mirroring CSS out-of-flow behavior.
 *
 * Text strategy: labels use real LVGL Montserrat metrics (src/fonts.mjs).
 * Start from the largest font not exceeding the CSS size; if the text would
 * overflow its box, try one size smaller; if it still overflows, let the
 * label auto-size and report a warning.
 */
import { fontName, nearestSize, measure, FONT_SIZES } from './fonts.mjs';
import { el, render } from './emit-xml.mjs';
import { optimize } from './optimize.mjs';

const TEXT_TAGS = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a', 'div', 'em', 'strong', 'small', 'b', 'i']);
const UNSUPPORTED_TAGS = new Set(['canvas', 'svg', 'video', 'iframe', 'audio', 'object', 'embed']);
const FIT_TOLERANCE = 2; // px of acceptable overflow before stepping down

const JUSTIFY = {
  'flex-start': 'start', start: 'start', left: 'start', normal: 'start', stretch: 'start',
  center: 'center',
  'flex-end': 'end', end: 'end', right: 'end',
  'space-between': 'space_between', 'space-around': 'space_around', 'space-evenly': 'space_evenly',
};

export function convert(input, { name = 'page' } = {}) {
  const { tree, removed } = optimize(structuredClone(input));
  const ctx = { warnings: [], assets: [], names: new Map(), collapsed: removed };

  const rootAttrs = {
    width: tree.w,
    height: tree.h,
    ...boxStyles(tree, ctx, { transparentDefault: false }),
    ...containerLayout(tree),
    scrollable: 'false',
    ...textStyles(tree, nearestSize(tree.styles.fontSize)),
  };
  const view = el('view', rootAttrs, tree.children.map((c) => emit(c, tree, ctx)).filter(Boolean));
  const xml = `<component>\n${render(view, 1)}\n</component>\n`;
  return { xml, view, warnings: ctx.warnings, assets: ctx.assets, name, collapsed: ctx.collapsed };
}

/* ---------------------------------------------------------------- helpers */

function uid(ctx, node, fallback) {
  const base = sanitize(node.lvName || node.id || node.className || fallback || node.tag);
  const n = (ctx.names.get(base) ?? 0) + 1;
  ctx.names.set(base, n);
  return n === 1 ? base : `${base}_${n}`;
}

const sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$|(_)_+/g, '$1') || 'obj';

const hex = ([r, g, b]) => '0x' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

const isFlex = (node) => node.layout && node.layout.display === 'flex' && node.children.length > 0;

const isGrid = (node) => node.layout && node.layout.display === 'grid' && node.children.length > 0;

const isManaged = (node) => isFlex(node) || isGrid(node);

const outOfFlow = (node) => node.layout && (node.layout.position === 'absolute' || node.layout.position === 'fixed');

/**
 * Grid cell position/span from computed grid-column/row-start/end. Explicit
 * line numbers are honored; auto-placed items fall back to row-major order
 * (Chromium reports "auto" for them).
 */
function gridCell(node, parent, autoIndex) {
  const cols = parent.layout.gridColumns.length;
  const place = (start, end, fallbackPos) => {
    let pos = fallbackPos;
    let span = 1;
    if (/^\d+$/.test(start)) pos = Number(start) - 1;
    const spanMatch = /^span (\d+)$/.exec(end);
    if (spanMatch) span = Number(spanMatch[1]);
    else if (/^\d+$/.test(end)) span = Math.max(1, Number(end) - 1 - pos);
    return { pos, span };
  };
  const col = place(node.layout.gridColumnStart, node.layout.gridColumnEnd, autoIndex % cols);
  const row = place(node.layout.gridRowStart, node.layout.gridRowEnd, Math.floor(autoIndex / cols));
  return {
    style_grid_cell_column_pos: col.pos,
    style_grid_cell_row_pos: row.pos,
    ...(col.span > 1 ? { style_grid_cell_column_span: col.span } : {}),
    ...(row.span > 1 ? { style_grid_cell_row_span: row.span } : {}),
  };
}

/** Position/size attributes for a child, honoring the parent's layout mode. */
function placement(node, parent, { size = true, gridIndex = 0 } = {}) {
  const attrs = {};
  const managed = isManaged(parent) && !outOfFlow(node);
  if (!managed) {
    // Coordinates are relative to the parent's content origin. Absolute
    // containers always emit pad 0, so only the border offsets the origin.
    // Managed parents emit real padding, so subtract it for out-of-flow children.
    const padX = isManaged(parent) ? parent.styles.padLeft : 0;
    const padY = isManaged(parent) ? parent.styles.padTop : 0;
    attrs.x = node.x - parent.x - parent.styles.borderWidth - padX;
    attrs.y = node.y - parent.y - parent.styles.borderWidth - padY;
    if (isManaged(parent)) attrs.ignore_layout = 'true';
  } else {
    if (isGrid(parent)) Object.assign(attrs, gridCell(node, parent, gridIndex));
    if (node.layout.flexGrow > 0) attrs.flex_grow = Math.round(node.layout.flexGrow);
    for (const [css, lv] of [['marginLeft', 'style_margin_left'], ['marginRight', 'style_margin_right'], ['marginTop', 'style_margin_top'], ['marginBottom', 'style_margin_bottom']]) {
      if (node.layout[css] > 0) attrs[lv] = node.layout[css];
    }
  }
  if (size) {
    attrs.width = node.w;
    attrs.height = node.h;
  }
  return attrs;
}

/** Shared visual styles for boxes (containers, buttons, inputs). */
function boxStyles(node, ctx, { transparentDefault = true, pad = null } = {}) {
  const s = node.styles;
  const attrs = {};
  if (s.bgColor) {
    attrs.style_bg_color = hex(s.bgColor);
    if (s.bgColor[3] < 255) attrs.style_bg_opa = s.bgColor[3];
  } else if (transparentDefault) {
    attrs.style_bg_opa = '0';
  }
  if (s.borderWidth > 0 && s.borderColor) {
    attrs.style_border_width = s.borderWidth;
    attrs.style_border_color = hex(s.borderColor);
  } else if (s.borderBottomWidth > 0 && s.borderBottomColor) {
    attrs.style_border_width = s.borderBottomWidth;
    attrs.style_border_color = hex(s.borderBottomColor);
    attrs.style_border_side = 'bottom';
  } else {
    attrs.style_border_width = 0;
  }
  if (s.gradient) {
    // Two-stop CSS linear-gradient; bg_color/bg_grad_color take its place.
    attrs.style_bg_color = hex(s.gradient.from);
    attrs.style_bg_grad_color = hex(s.gradient.to);
    attrs.style_bg_grad_dir = s.gradient.dir;
    delete attrs.style_bg_opa;
  }
  attrs.style_radius = s.radius;
  if (s.shadow) {
    attrs.style_shadow_color = hex(s.shadow.color);
    attrs.style_shadow_opa = s.shadow.color[3];
    attrs.style_shadow_width = s.shadow.blur;
    if (s.shadow.x) attrs.style_shadow_offset_x = s.shadow.x;
    if (s.shadow.y) attrs.style_shadow_offset_y = s.shadow.y;
    if (s.shadow.spread) attrs.style_shadow_spread = s.shadow.spread;
  } else {
    attrs.style_shadow_width = 0;
  }
  if (pad !== null) {
    attrs.style_pad_all = pad;
  } else if (isManaged(node)) {
    // Managed children flow inside the content area, so real padding matters.
    attrs.style_pad_left = s.padLeft;
    attrs.style_pad_right = s.padRight;
    attrs.style_pad_top = s.padTop;
    attrs.style_pad_bottom = s.padBottom;
  } else {
    // Absolute children carry their own offsets; padding must not shift them.
    attrs.style_pad_all = 0;
  }
  if (s.opacity < 1) attrs.style_opa = Math.round(s.opacity * 255);
  if (s.pressed) {
    if (s.pressed.bgColor) attrs['style_bg_color:pressed'] = hex(s.pressed.bgColor);
    if (s.pressed.color) attrs['style_text_color:pressed'] = hex(s.pressed.color);
  }
  return attrs;
}

/** Layout attributes for a flex or grid container node (empty otherwise). */
function containerLayout(node) {
  if (isGrid(node)) {
    const l = node.layout;
    // Computed grid templates are resolved px tracks at the target
    // resolution; emitting them verbatim reproduces the browser's geometry.
    // Gaps are always explicit — LVGL themes default pad_row/pad_column to
    // a nonzero value, which would add phantom spacing for CSS gap: 0.
    return {
      style_layout: 'grid',
      style_grid_column_dsc_array: l.gridColumns.join(' '),
      style_grid_row_dsc_array: l.gridRows.join(' '),
      style_pad_row: l.rowGap,
      style_pad_column: l.columnGap,
    };
  }
  if (!isFlex(node)) return {};
  const l = node.layout;
  const dir = l.flexDirection.startsWith('column') ? 'column' : 'row';
  const rev = l.flexDirection.endsWith('reverse') ? '_reverse' : '';
  const wrap = l.flexWrap === 'wrap' ? '_wrap' : '';
  const attrs = { flex_flow: `${dir}${wrap}${rev}` };
  const main = JUSTIFY[l.justifyContent];
  const cross = JUSTIFY[l.alignItems];
  if (main && main !== 'start') attrs.style_flex_main_place = main;
  if (cross && cross !== 'start') {
    // LVGL flex tracks are content-sized, unlike CSS lines which fill the
    // container — align the track too so items center visually.
    attrs.style_flex_cross_place = cross;
    attrs.style_flex_track_place = cross;
  }
  // Always explicit: LVGL themes default pad_row/pad_column to a nonzero
  // value, which would add phantom spacing for CSS gap: 0.
  attrs.style_pad_row = l.rowGap;
  attrs.style_pad_column = l.columnGap;
  return attrs;
}

function textStyles(node, size) {
  const s = node.styles;
  const attrs = { style_text_font: fontName(size) };
  if (s.color) attrs.style_text_color = hex(s.color);
  if (s.textAlign === 'center') attrs.style_text_align = 'center';
  else if (s.textAlign === 'right') attrs.style_text_align = 'right';
  return attrs;
}

/**
 * Pick a font size for a text node and decide label sizing.
 * Returns { size, width } where width is null for an auto-sized label.
 *
 * A label's width is a hard wrap boundary in LVGL, so a kept width must never
 * be smaller than the measured text — flex-managed and left-aligned labels
 * simply auto-size, and centered labels get max(box, measured).
 */
function fitText(node, ctx, { managed = false } = {}) {
  let size = nearestSize(node.styles.fontSize);
  if (!node.text) return { size, width: managed ? null : node.w };

  const multiline = node.h >= node.styles.fontSize * 2;
  if (multiline) return { size, width: node.w }; // keep box, let LVGL wrap

  if (managed) return { size, width: null }; // flex places and sizes it

  // Absolute placement: honor the browser box; step one size down if the
  // LVGL font renders wider than the box allows.
  if (measure(size, node.text) > node.w + FIT_TOLERANCE) {
    const smallerIdx = FONT_SIZES.indexOf(size) - 1;
    if (smallerIdx >= 0 && measure(FONT_SIZES[smallerIdx], node.text) <= node.w + FIT_TOLERANCE) {
      size = FONT_SIZES[smallerIdx];
    }
  }
  const centered = node.styles.textAlign === 'center' || node.styles.textAlign === 'right';
  if (centered) return { size, width: Math.max(node.w, measure(size, node.text)) };
  return { size, width: null }; // auto-size; keeps left edge, avoids clipping
}

/* ------------------------------------------------------------------ emit */

function emit(node, parent, ctx, index = 0) {
  if (UNSUPPORTED_TAGS.has(node.tag)) {
    ctx.warnings.push(`<${node.tag}> is not supported; skipped`);
    return null;
  }

  const out = emitByTag(node, parent, ctx, index);
  // Carry component boundaries (React fiber walk or data-lv-component)
  // through to the element tree for the componentizer.
  if (out && node.component) out.meta = { component: node.component };
  return out;
}

function emitByTag(node, parent, ctx, index) {
  // data-lv-widget overrides tag-based and heuristic classification
  if (node.widget) {
    const forced = emitForced(node, parent, ctx, index);
    if (forced) return forced;
    ctx.warnings.push(`data-lv-widget="${node.widget}" is not a supported widget; using the default mapping`);
  }

  if (node.tag === 'button') return emitButton(node, parent, ctx, index);
  if (node.tag === 'input') return emitInput(node, parent, ctx, index);
  if (node.tag === 'select') return emitDropdown(node, parent, ctx, index);
  if (node.tag === 'img') return emitImage(node, parent, ctx, index);
  if (node.tag === 'progress') return emitBar(node, parent, ctx, index);
  if (node.tag === 'table') return emitTable(node, parent, ctx, index);

  if (node.text && node.children.length === 0 && TEXT_TAGS.has(node.tag)) {
    return emitText(node, parent, ctx, index);
  }
  return emitContainer(node, parent, ctx, index);
}

/**
 * Honor data-lv-widget. Widgets backed by <input> reuse emitInput with a
 * synthesized `type`; emitInput consults node.widget for the switch vs
 * checkbox decision instead of its aspect-ratio heuristic.
 */
function emitForced(node, parent, ctx, index) {
  switch (node.widget) {
    case 'button': return emitButton(node, parent, ctx, index);
    case 'label': return emitText(node, parent, ctx, index);
    case 'dropdown': return emitDropdown(node, parent, ctx, index);
    case 'bar': return emitBar(node, parent, ctx, index);
    case 'table': return emitTable(node, parent, ctx, index);
    case 'image': return emitImage(node, parent, ctx, index);
    case 'switch':
    case 'checkbox':
    case 'slider':
    case 'textarea': {
      const type = { switch: 'checkbox', checkbox: 'checkbox', slider: 'range', textarea: 'text' }[node.widget];
      return emitInput({ ...node, attrs: { ...node.attrs, type } }, parent, ctx, index);
    }
    default: return null;
  }
}

function emitContainer(node, parent, ctx, index) {
  const children = node.children.map((c, i) => emit(c, node, ctx, i)).filter(Boolean);
  if (node.text) {
    const { size } = fitText(node, ctx);
    children.unshift(el('lv_label', { name: uid(ctx, node, 'label'), text: node.text, ...textStyles(node, size) }));
  }
  return el('lv_obj', {
    name: uid(ctx, node, 'box'),
    ...placement(node, parent, { gridIndex: index }),
    ...boxStyles(node, ctx),
    ...containerLayout(node),
    scrollable: node.styles.scrollable ? 'true' : 'false',
  }, children);
}

function emitText(node, parent, ctx, index) {
  const s = node.styles;
  const managed = isManaged(parent) && !outOfFlow(node);
  const { size, width } = fitText(node, ctx, { managed });

  if (s.bgColor || (s.borderWidth > 0 && s.borderColor)) {
    // Decorated text block (title bar, badge): box + vertically centered label,
    // the way browsers center line boxes.
    const align = s.textAlign === 'center' ? 'center' : 'left_mid';
    return el('lv_obj', {
      name: uid(ctx, node, 'box'),
      ...placement(node, parent, { gridIndex: index }),
      ...boxStyles(node, ctx, { pad: 0 }),
      scrollable: 'false',
    }, [
      el('lv_label', {
        name: uid(ctx, node, 'label'),
        align,
        ...(align === 'left_mid' && s.padLeft ? { x: s.padLeft } : {}),
        text: node.text,
        ...textStyles(node, size),
      }),
    ]);
  }

  const attrs = {
    name: uid(ctx, node, 'label'),
    ...placement(node, parent, { size: false, gridIndex: index }),
    ...(width !== null ? { width } : {}),
    text: node.text,
    ...textStyles(node, size),
  };
  return el('lv_label', attrs);
}

function emitButton(node, parent, ctx, index) {
  const children = node.children.map((c) => emit(c, node, ctx)).filter(Boolean);
  if (node.text) {
    const { size } = fitText(node, ctx);
    children.unshift(el('lv_label', {
      name: uid(ctx, node, 'label'),
      align: 'center',
      text: node.text,
      ...textStyles(node, size),
    }));
  }
  return el('lv_button', {
    name: uid(ctx, node, 'button'),
    ...placement(node, parent, { gridIndex: index }),
    ...boxStyles(node, ctx, { transparentDefault: false, pad: 0 }),
  }, children);
}

function emitInput(node, parent, ctx, index) {
  const t = node.attrs.type;

  if (t === 'range') {
    // Browsers draw a thin track inside the input's box; approximate with a
    // slim slider vertically centered in the original rect.
    const trackH = 8;
    const place = placement(node, parent, { size: false, gridIndex: index });
    if (place.y !== undefined) place.y += Math.round((node.h - trackH) / 2);
    else place.style_margin_top = (place.style_margin_top ?? 0) + Math.round((node.h - trackH) / 2);
    return el('lv_slider', {
      name: uid(ctx, node, 'slider'),
      ...place,
      width: node.w,
      height: trackH,
      min_value: node.attrs.min ?? 0,
      max_value: node.attrs.max ?? 100,
      value: node.attrs.value ?? 0,
    });
  }

  if (t === 'checkbox') {
    // A wide, styled checkbox is almost always meant as a toggle, unless
    // data-lv-widget says otherwise.
    const widget =
      node.widget === 'switch' ? 'lv_switch'
      : node.widget === 'checkbox' ? 'lv_checkbox'
      : node.w >= node.h * 1.5 ? 'lv_switch' : 'lv_checkbox';
    return el(widget, {
      name: uid(ctx, node, widget === 'lv_switch' ? 'switch' : 'checkbox'),
      ...placement(node, parent, { size: widget === 'lv_switch', gridIndex: index }),
      ...(widget === 'lv_checkbox' ? { text: '' } : {}),
      ...(node.attrs.checked ? { checked: 'true' } : {}),
    });
  }

  const { size } = fitText({ ...node, text: node.attrs.placeholder ?? node.attrs.value ?? '' }, ctx);
  return el('lv_textarea', {
    name: uid(ctx, node, 'textarea'),
    ...placement(node, parent, { gridIndex: index }),
    one_line: 'true',
    ...(node.attrs.placeholder ? { placeholder_text: node.attrs.placeholder } : {}),
    ...(node.attrs.value ? { text: node.attrs.value } : {}),
    ...(t === 'password' ? { password_mode: 'true' } : {}),
    ...boxStyles(node, ctx, { transparentDefault: false, pad: 8 }),
    style_pad_hor: node.styles.padLeft || 8,
    ...textStyles(node, size),
  });
}

function emitDropdown(node, parent, ctx, index) {
  return el('lv_dropdown', {
    name: uid(ctx, node, 'dropdown'),
    ...placement(node, parent, { gridIndex: index }),
    options: (node.attrs.options ?? []).join('\n'),
    ...(node.attrs.selectedIndex > 0 ? { selected: node.attrs.selectedIndex } : {}),
    ...textStyles(node, nearestSize(node.styles.fontSize)),
  });
}

function emitImage(node, parent, ctx, index) {
  const src = node.attrs.src ?? '';
  const assetName = sanitize(src.split('/').pop()?.replace(/\.[a-z]+$/i, '') || 'image');
  ctx.assets.push({ src, name: assetName });
  ctx.warnings.push(`<img src="${src}">: register image "${assetName}" with lv_xml_register_image() after converting it with LVGL's image converter`);
  return el('lv_image', {
    name: uid(ctx, node, assetName),
    ...placement(node, parent, { gridIndex: index }),
    src: assetName,
  });
}

function emitBar(node, parent, ctx, index) {
  return el('lv_bar', {
    name: uid(ctx, node, 'bar'),
    ...placement(node, parent, { gridIndex: index }),
    min_value: 0,
    // <progress> defaults to max=1 per HTML; a div forced to a bar with
    // data-lv-widget has no such convention, so use a percentage range.
    max_value: node.attrs.max ?? (node.tag === 'progress' ? 1 : 100),
    value: node.attrs.value ?? 0,
  });
}

function emitTable(node, parent, ctx, index) {
  const cells = node.attrs.cells ?? [];
  const columnCount = Math.max(0, ...cells.map((r) => r.length));
  const children = [];
  (node.attrs.columnWidths ?? []).forEach((w, column) => {
    children.push(el('lv_table-column', { column, width: w }));
  });
  cells.forEach((rowCells, row) => {
    rowCells.forEach((value, column) => {
      children.push(el('lv_table-cell', { row, column, value }));
    });
  });
  return el('lv_table', {
    name: uid(ctx, node, 'table'),
    ...placement(node, parent, { gridIndex: index }),
    column_count: columnCount,
    row_count: cells.length,
    ...textStyles(node, nearestSize(node.styles.fontSize)),
  }, children);
}
