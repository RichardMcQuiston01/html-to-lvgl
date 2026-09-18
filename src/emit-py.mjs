/**
 * Idiomatic MicroPython emitter: turns the converter's element tree (the
 * same one the XML and C emitters render) into a plain `lv.*` Python module
 * for users who don't want to ship XML at runtime.
 *
 * The generated module exports a fixed function:
 *   def ui_create(parent): -> lv_obj   (or ui_<screen>_create for a screen)
 *
 * Mechanical rules mirror emit-c.mjs (same two tables: a per-widget
 * attribute map and an enum map), re-spelled for `lv_binding_micropython`'s
 * auto-generated Python API rather than assumed from the C macro/function
 * names. The mapping was verified against a real generated binding — built
 * lv_micropython's unix port at the same pinned commit CI uses (see
 * .github/workflows/ci.yml's validate-micropython-xml job) and introspected
 * it directly (`dir(lv.<GROUP>)`, a full smoke-render of every widget type)
 * rather than trusting a C-derived guess. Two real
 * divergences from a naive 1:1 C-call translation came out of that:
 *
 *   - `lv_slider_set_min_value`/`lv_slider_set_max_value` (and the lv_bar
 *     equivalents) don't exist on the pinned binding's vendored LVGL
 *     (v9.3.0-era) — only `lv_slider_set_range(obj, min, max)`/
 *     `lv_bar_set_range` do. The separate setters are a v9.4.0 addition
 *     (confirmed by grepping that vendored LVGL's headers); emit-c.mjs gets
 *     away with the separate calls only because the C harness compiles
 *     against a real v9.4.0 checkout. This emitter always emits a single
 *     `set_range(min, max)` call instead, which works on both LVGL
 *     versions.
 *   - `LV_ANIM_OFF`/`LV_ANIM_ON` aren't enum constants at all —
 *     `lv_anim_enable_t` is `typedef bool`, so the binding takes a plain
 *     Python bool; this emitter passes `False` where the C emitter passes
 *     the macro name.
 *
 * Flag constants (scrollable/hidden/ignore_layout) live under the widget
 * class's nested FLAG enum (`lv.obj.FLAG.HIDDEN`), not a top-level
 * `lv.OBJ_FLAG` — there is no such top-level name in the binding.
 *
 * Custom (lv_font_conv) fonts and images have no compile-time linkage to
 * borrow from C's `extern` declarations, so this emitter takes them as
 * runtime dict parameters instead: `ui_create(parent, fonts=None)` indexes
 * `fonts["<key>"]` for a non-builtin `style_text_font`, and
 * `ui_create(parent, images=None)` indexes `images["<key>"]` for an
 * `lv_image` `src` — the caller loads them (e.g. via `lv.binfont_create`)
 * and passes the dict in, the same "caller provides it" contract as C's
 * extern declaration, just resolved at call time instead of link time.
 * Verified end-to-end: a real `--no-compress` lv_font_conv .bin font loaded
 * via `lv.binfont_create` and passed through a `fonts` dict renders
 * correctly when referenced this way (an *uncompressed* conversion matters —
 * a compressed .bin crashed the renderer on this pinned binding, a decoder
 * gap unrelated to this emitter's own output, since the project's real font
 * pipeline in fonts-build.mjs already always converts with --no-compress).
 *
 * Multi-screen navigation has no `extern`/link step to prove correctness at
 * build time the way C's does, so each screen's `screen_create_event`
 * becomes a *lazily* imported call — `import ui_<screen>` happens inside the
 * click callback, not at module load, both to avoid a two-screen circular
 * import at import time and so the cost is only paid on an actual
 * navigation. This was verified against the real binding with two on-disk
 * modules and a real simulated click (not just a syntax check).
 */
import { FONT_SIZES } from './fonts.mjs';

// The *exact* set of built-in font names — see emit-c.mjs's identical guard
// for why this can't be a "starts with montserrat_" guess.
const BUILTIN_FONT_NAMES = new Set(FONT_SIZES.map((size) => `montserrat_${size}`));

// obj.FLAG.<NAME>, not a top-level lv.OBJ_FLAG.<NAME> — verified above.
const FLAG_NAMES = { scrollable: 'SCROLLABLE', hidden: 'HIDDEN', ignore_layout: 'IGNORE_LAYOUT' };

// Enum group names verified against a real generated binding (see module
// doc comment) rather than assumed from the C macro spelling.
const ENUMS = {
  flex_flow: (v) => `lv.FLEX_FLOW.${v.toUpperCase()}`,
  align: (v) => `lv.ALIGN.${v.toUpperCase()}`,
  style_flex_main_place: (v) => `lv.FLEX_ALIGN.${v.toUpperCase()}`,
  style_flex_cross_place: (v) => `lv.FLEX_ALIGN.${v.toUpperCase()}`,
  style_flex_track_place: (v) => `lv.FLEX_ALIGN.${v.toUpperCase()}`,
  style_bg_grad_dir: (v) => `lv.GRAD_DIR.${v.toUpperCase()}`,
  style_border_side: (v) => `lv.BORDER_SIDE.${v.toUpperCase()}`,
  style_text_align: (v) => `lv.TEXT_ALIGN.${v.toUpperCase()}`,
  style_layout: (v) => `lv.LAYOUT.${v.toUpperCase()}`,
};

const pystr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
const pybool = (v) => (v === 'true' ? 'True' : 'False');

// Python keywords plus identifiers the generated function already uses
const PY_RESERVED = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'parent', 'root', 'lv', 'e', 'fonts', 'images',
]);

export function emitPy(view, opts = {}) {
  const { name = 'page', symbol = 'ui_create' } = opts;
  const unit = `ui_${name}`;
  const lines = [];
  const navFuncs = [];
  const navSeen = new Map(); // target screen name -> already-declared callback name
  let varCount = 0;
  let usesFonts = false;
  let usesImages = false;

  // MicroPython has no link step to prove a navigation target resolves, so
  // the import happens lazily inside the callback — see module doc comment.
  function navCallback(screen) {
    if (navSeen.has(screen)) return navSeen.get(screen);
    let id = String(screen).replace(/[^a-z0-9_]/gi, '_');
    if (/^\d/.test(id)) id = `s_${id}`;
    const targetModule = `ui_${id}`;
    const targetSymbol = `ui_${id}_create`;
    const cbName = `_nav_to_${id}`;
    navFuncs.push(
      `def ${cbName}(e):\n    import ${targetModule}\n    scr = ${targetModule}.${targetSymbol}(None)\n    lv.screen_load(scr)`,
    );
    navSeen.set(screen, cbName);
    return cbName;
  }

  function widgetVar(node) {
    let v = (node.attrs.name || `w${++varCount}`).replace(/[^a-z0-9_]/gi, '_');
    if (/^\d/.test(v)) v = `w_${v}`;
    if (PY_RESERVED.has(v)) v = `${v}_w`;
    return v;
  }

  function emitNode(node, parentVar) {
    const v = node.tag === 'view' ? 'root' : widgetVar(node);
    const ctor = node.tag === 'view' ? 'lv.obj' : `lv.${node.tag.replace(/^lv_/, '').replace(/-.*/, '')}`;

    if (node.tag === 'lv_table-column') {
      lines.push(`    ${parentVar}.set_column_width(${node.attrs.column}, ${node.attrs.width})`);
      return;
    }
    if (node.tag === 'lv_table-cell') {
      lines.push(`    ${parentVar}.set_cell_value(${node.attrs.row}, ${node.attrs.column}, ${pystr(node.attrs.value)})`);
      return;
    }
    if (node.tag === 'screen_create_event' || node.tag === 'screen_load_event') {
      lines.push(`    ${parentVar}.add_event_cb(${navCallback(node.attrs.screen)}, lv.EVENT.CLICKED, None)`);
      return;
    }

    lines.push('');
    lines.push(`    ${v} = ${ctor}(${parentVar})`);

    // lv_slider/lv_bar have no separate min/max setters on the pinned
    // binding's vendored LVGL — see module doc comment — so both attrs
    // (always emitted together by convert.mjs) collapse into one set_range.
    if ((node.tag === 'lv_slider' || node.tag === 'lv_bar') && 'min_value' in node.attrs && 'max_value' in node.attrs) {
      lines.push(`    ${v}.set_range(${node.attrs.min_value}, ${node.attrs.max_value})`);
    }

    for (const [key, raw] of Object.entries(node.attrs)) {
      if (raw === null || raw === undefined || raw === '' || key === 'name') continue;
      if ((node.tag === 'lv_slider' || node.tag === 'lv_bar') && (key === 'min_value' || key === 'max_value')) continue;
      emitAttr(node, v, key, String(raw));
    }
    for (const child of node.children) emitNode(child, v);
    if (node.tag === 'view') lines.push('');
  }

  function emitAttr(node, v, key, value) {
    const widget = node.tag === 'view' ? 'lv_obj' : node.tag;
    if (widget === 'lv_image' && key === 'src') {
      usesImages = true;
      lines.push(`    ${v}.set_src(images[${pystr(value)}])`);
      return;
    }
    const specific = WIDGET_ATTRS[widget]?.[key];
    if (specific) {
      lines.push(`    ${specific(v, value)}`);
      return;
    }

    if (key === 'x') return lines.push(`    ${v}.set_x(${value})`);
    if (key === 'y') return lines.push(`    ${v}.set_y(${value})`);
    if (key === 'width') return lines.push(`    ${v}.set_width(${value})`);
    if (key === 'height') return lines.push(`    ${v}.set_height(${value})`);
    if (key === 'align') return lines.push(`    ${v}.set_align(${ENUMS.align(value)})`);
    if (key === 'flex_flow') return lines.push(`    ${v}.set_flex_flow(${ENUMS.flex_flow(value)})`);
    if (key === 'flex_grow') return lines.push(`    ${v}.set_flex_grow(${value})`);
    if (key === 'checked') return lines.push(`    ${v}.set_state(lv.STATE.CHECKED, ${pybool(value)})`);
    if (key in FLAG_NAMES) return lines.push(`    ${v}.set_flag(lv.obj.FLAG.${FLAG_NAMES[key]}, ${pybool(value)})`);

    if (key.startsWith('style_')) {
      const [propPart, state] = key.split(':');
      const prop = propPart.slice(6);
      const selector = state ? `lv.STATE.${state.toUpperCase()}` : '0';

      if (prop === 'grid_column_dsc_array' || prop === 'grid_row_dsc_array') {
        const items = value.split(' ').map((t) => {
          const fr = /^fr\((\d+)\)$/.exec(t);
          return fr ? `lv.grid_fr(${fr[1]})` : t;
        });
        return lines.push(`    ${v}.set_style_${prop}([${items.join(', ')}, lv.GRID_TEMPLATE_LAST], ${selector})`);
      }

      let pyValue = value;
      if (ENUMS[propPart]) pyValue = ENUMS[propPart](value);
      else if (prop.endsWith('_color')) pyValue = `lv.color_hex(${value})`;
      else if (prop === 'text_font') {
        if (BUILTIN_FONT_NAMES.has(value)) {
          pyValue = `lv.font_${value}`;
        } else {
          usesFonts = true;
          pyValue = `fonts[${pystr(value)}]`;
        }
      }
      return lines.push(`    ${v}.set_style_${prop}(${pyValue}, ${selector})`);
    }

    // Unknown attribute: surface it in the output rather than dropping it silently
    lines.push(`    # unmapped attribute: ${key}="${value}"`);
  }

  emitNode(view, 'parent');

  const params = ['parent'];
  if (usesFonts) params.push('fonts=None');
  if (usesImages) params.push('images=None');
  const prologue = [];
  if (usesFonts) prologue.push('    fonts = fonts or {}');
  if (usesImages) prologue.push('    images = images or {}');

  const py = `# Generated by html2lvgl — do not edit by hand
import lvgl as lv


${navFuncs.length ? navFuncs.join('\n\n\n') + '\n\n\n' : ''}def ${symbol}(${params.join(', ')}):
${prologue.length ? prologue.join('\n') + '\n' : ''}${lines.join('\n')}
    return root
`;

  return { py, unit };
}

/* Widget-specific attribute translations. Each returns a full Python statement (no trailing newline). */
const WIDGET_ATTRS = {
  lv_label: {
    text: (v, val) => `${v}.set_text(${pystr(val)})`,
  },
  lv_checkbox: {
    text: (v, val) => `${v}.set_text(${pystr(val)})`,
  },
  lv_slider: {
    value: (v, val) => `${v}.set_value(${val}, False)`,
  },
  lv_bar: {
    value: (v, val) => `${v}.set_value(${val}, False)`,
  },
  lv_textarea: {
    one_line: (v, val) => `${v}.set_one_line(${pybool(val)})`,
    placeholder_text: (v, val) => `${v}.set_placeholder_text(${pystr(val)})`,
    password_mode: (v, val) => `${v}.set_password_mode(${pybool(val)})`,
    text: (v, val) => `${v}.set_text(${pystr(val)})`,
  },
  lv_dropdown: {
    options: (v, val) => `${v}.set_options(${pystr(val)})`,
    selected: (v, val) => `${v}.set_selected(${val})`,
  },
  lv_table: {
    column_count: (v, val) => `${v}.set_column_count(${val})`,
    row_count: (v, val) => `${v}.set_row_count(${val})`,
  },
};
