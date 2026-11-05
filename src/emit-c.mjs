/**
 * Plain-C (and C++) emitter: turns the converter's element tree (the same
 * one the XML emitter renders) into self-contained LVGL code with no lv_xml
 * runtime dependency. This matters because the lv_xml runtime was removed
 * from LVGL master — this output works on any LVGL 9.x.
 *
 * The generated unit exports a fixed symbol:
 *   lv_obj_t * ui_create(lv_obj_t * parent);
 *
 * Built-in Montserrat fonts are referenced as &lv_font_montserrat_N (enable
 * the sizes in lv_conf.h); lv_font_conv output is referenced by its own
 * generated symbol name and declared extern. Images are left as named
 * extern lv_image_dsc_t declarations to be provided by the asset pipeline.
 *
 * C vs C++ (emitC vs emitCpp): the generated *statements* are identical
 * either way — plain LVGL C-API calls, which compile unchanged under C++17
 * (verified against LVGL v9.4.0, whose public headers already carry their
 * own extern "C" guards). What differs is linkage of things this file
 * declares itself:
 *   - emitC's header wraps the function prototype in
 *     `#ifdef __cplusplus extern "C" { #endif ... #endif`, so the *same*
 *     plain-C output is already safe to #include from a C++ caller with no
 *     extra flag.
 *   - emitCpp targets a project whose build only compiles .cpp — the
 *     generated pair uses .cpp/.hpp and unconditional `extern "C"`.
 *   - Either way, the font/image `extern const ...` declarations this file
 *     writes into the body must themselves say `extern "C"` under emitCpp.
 *     This one is not optional: those symbols are *defined* in a separately
 *     compiled, always-C, lv_font_conv-generated .c file, so a C++
 *     translation unit referencing them without `extern "C"` asks the
 *     linker for a C++-mangled name that the C compiler never produced —
 *     confirmed by reproducing the resulting "undefined reference" link
 *     failure during development. Keep font/image .c files compiled as C;
 *     this declaration is what lets C++ code call into them correctly.
 *
 * Behavior (src/behavior.mjs, LVGL 9.4 observer API; names checked against
 * lvgl/src/others/observer/lv_observer.h and xml/lv_xml.h of v9.4.0):
 *   - Each subject is a file-scope `static lv_subject_t subject_<name>`, set
 *     up by a generated init_subjects(): lv_subject_init_int on the first
 *     create call, a reset to the initial value on later ones.
 *   - The same block registers it with lv_xml_register_subject(NULL, name, ..)
 *     inside `#if LV_USE_XML`, so a library XML component created with
 *     lv_xml_create can resolve a `subject` prop by name.
 *   - meta.behavior events become lv_obj_add_subject_toggle_event /
 *     lv_obj_add_subject_set_int_event and binds become lv_obj_bind_flag_if_<op>;
 *     all exist in 9.4, so no substitute was needed. The XML child elements
 *     convert() also writes for them are skipped via isBehaviorElement().
 *   - An xmlComponent instance (any tag not starting with lv_) becomes
 *     lv_xml_create(parent, "<tag>", attrs) with a static NULL-terminated
 *     name/value list; the application registers the component's XML first.
 *   Subjects come from opts.subjects (convert()'s final list) plus every
 *   element's meta.behavior.subjects.
 */
import { FONT_SIZES } from './fonts.mjs';
import { isBehaviorElement } from './behavior.mjs';

// The *exact* set of built-in font names — not a "starts with montserrat_"
// guess, which a custom family literally named "Montserrat" would also
// match (its generated key looks like montserrat_400_16, which is not one
// of these names but does share the prefix).
const BUILTIN_FONT_NAMES = new Set(FONT_SIZES.map((size) => `montserrat_${size}`));

const FLAG_ATTRS = { scrollable: 'LV_OBJ_FLAG_SCROLLABLE', hidden: 'LV_OBJ_FLAG_HIDDEN', ignore_layout: 'LV_OBJ_FLAG_IGNORE_LAYOUT', floating: 'LV_OBJ_FLAG_FLOATING', overflow_visible: 'LV_OBJ_FLAG_OVERFLOW_VISIBLE' };

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

/** A view element that stands for a library XML component (see convert.mjs emitLibraryComponent). */
const isXmlComponent = (node) => node.tag !== 'view' && !node.tag.startsWith('lv_') && !isBehaviorElement(node)
  && !['screen_create_event', 'screen_load_event'].includes(node.tag);

export function emitC(view, opts = {}) {
  return emit(view, { ...opts, lang: 'c' });
}

/** Same generation, targeting a project that only compiles .cpp/.hpp. */
export function emitCpp(view, opts = {}) {
  return emit(view, { ...opts, lang: 'cpp' });
}

function emit(view, { name = 'page', symbol = 'ui_create', lvInclude = 'lvgl.h', lang = 'c', subjects: declared = [] } = {}) {
  const cpp = lang === 'cpp';
  const headerExt = cpp ? 'hpp' : 'h';
  // extern declarations for symbols DEFINED elsewhere (always-C font/image
  // files) need explicit "C" linkage in a C++ translation unit — see the
  // module doc comment for why this is not optional.
  const externC = cpp ? 'extern "C" ' : 'extern ';
  const unit = `ui_${name}`;
  const lines = [];
  const statics = [];
  const navCallbacks = [];
  const navSeen = new Map(); // target screen name -> already-declared callback name
  let varCount = 0;
  let gridDscCount = 0;

  // Flattened C has no runtime screen registry: each screen is a separate
  // translation unit exporting ui_<screen>_create (see cli.mjs), so a
  // navigation target is reachable by declaring that symbol extern and
  // calling it from a real click callback — the same convention every
  // screen's own entry point already follows.
  function navCallback(screen) {
    if (navSeen.has(screen)) return navSeen.get(screen);
    let id = String(screen).replace(/[^a-z0-9_]/gi, '_');
    if (/^\d/.test(id)) id = `s_${id}`;
    const targetSymbol = `ui_${id}_create`;
    const cbName = `nav_to_${id}_cb`;
    statics.push(`${externC}lv_obj_t * ${targetSymbol}(lv_obj_t * parent);`);
    navCallbacks.push(
      `static void ${cbName}(lv_event_t * e)\n{\n    LV_UNUSED(e);\n    lv_obj_t * scr = ${targetSymbol}(NULL);\n    lv_screen_load(scr);\n}`,
    );
    navSeen.set(screen, cbName);
    return cbName;
  }

  function widgetVar(node) {
    let v = (node.attrs.name || `w${++varCount}`).replace(/[^a-z0-9_]/gi, '_');
    if (/^\d/.test(v)) v = `w_${v}`;
    if (C_RESERVED.has(v)) v = `${v}_w`;
    return v;
  }

  // Behavior: every subject of the page, declared once. Declared ones keep
  // their initial value; one only referenced (already a convert() diagnostic)
  // starts at 0 so the unit still compiles.
  const subjects = new Map(declared.map((s) => [s.name, s.initial]));
  let usesXmlComponent = false;
  // Declarations first: a trigger often comes before the panel that declares
  // its subject, and must not claim the default 0 for it.
  (function collectDeclared(node) {
    for (const s of node.meta?.behavior?.subjects ?? []) if (!subjects.has(s.name)) subjects.set(s.name, s.initial);
    if (isXmlComponent(node)) usesXmlComponent = true;
    node.children.forEach(collectDeclared);
  })(view);
  (function collectReferenced(node) {
    for (const ref of [...(node.meta?.behavior?.events ?? []), ...(node.meta?.behavior?.binds ?? [])]) {
      if (ref.kind === 'play') continue; // timeline events carry no subject
      if (!subjects.has(ref.subject)) subjects.set(ref.subject, 0);
    }
    node.children.forEach(collectReferenced);
  })(view);
  const subjectVar = (subject) => `subject_${subject.replace(/[^a-z0-9_]/gi, '_')}`;
  let xmlAttrCount = 0;

  function emitBehavior(node, v) {
    for (const e of node.meta?.behavior?.events ?? []) {
      if (e.kind === 'play') continue; // TODO(phase8-f): timeline output
      const trigger = `LV_EVENT_${(e.trigger ?? 'clicked').toUpperCase()}`;
      lines.push(e.kind === 'set'
        ? `    lv_obj_add_subject_set_int_event(${v}, &${subjectVar(e.subject)}, ${trigger}, ${e.value});`
        : `    lv_obj_add_subject_toggle_event(${v}, &${subjectVar(e.subject)}, ${trigger});`);
    }
    for (const b of node.meta?.behavior?.binds ?? []) {
      lines.push(`    lv_obj_bind_flag_if_${b.op}(${v}, &${subjectVar(b.subject)}, LV_OBJ_FLAG_${b.flag.toUpperCase()}, ${b.ref});`);
    }
  }

  /** A library XML component instance: attributes go in a static name/value list. */
  function emitXmlComponent(node, parentVar) {
    const v = widgetVar(node);
    const arr = `xml_attrs_${++xmlAttrCount}`;
    const pairs = Object.entries(node.attrs).filter(([, val]) => val !== null && val !== undefined && val !== '')
      .flatMap(([k, val]) => [cstr(k), cstr(val)]);
    statics.push(`static const char * ${arr}[] = {${[...pairs, 'NULL'].join(', ')}};`);
    lines.push('');
    lines.push(`    lv_obj_t * ${v} = (lv_obj_t *)lv_xml_create(${parentVar}, ${cstr(node.tag)}, ${arr});`);
  }

  function emitNode(node, parentVar) {
    if (isXmlComponent(node)) return emitXmlComponent(node, parentVar);
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
    if (node.tag === 'screen_create_event' || node.tag === 'screen_load_event') {
      lines.push(`    lv_obj_add_event_cb(${parentVar}, ${navCallback(node.attrs.screen)}, LV_EVENT_CLICKED, NULL);`);
      return;
    }

    lines.push('');
    lines.push(`    lv_obj_t * ${v} = ${createFn}(${parentVar});`);

    for (const [key, raw] of Object.entries(node.attrs)) {
      if (raw === null || raw === undefined || raw === '' || key === 'name') continue;
      emitAttr(node, v, key, String(raw));
    }
    for (const child of node.children) if (!isBehaviorElement(child)) emitNode(child, v);
    emitBehavior(node, v);
    if (node.tag === 'view') lines.push('');
  }

  function emitAttr(node, v, key, value) {
    // Widget-specific attributes first
    const widget = node.tag === 'view' ? 'lv_obj' : node.tag;
    if (widget === 'lv_image' && key === 'src') {
      statics.push(`${externC}const lv_image_dsc_t img_${value}; /* provide via LVGL image converter */`);
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
    if (key === 'width') return lines.push(`    lv_obj_set_width(${v}, ${value === 'content' ? 'LV_SIZE_CONTENT' : value});`);
    if (key === 'height') return lines.push(`    lv_obj_set_height(${v}, ${value === 'content' ? 'LV_SIZE_CONTENT' : value});`);
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
      else if (prop === 'text_font') {
        // Built-ins are lv_font_<name>; lv_font_conv output uses the name
        // verbatim and has to be declared for this translation unit.
        if (BUILTIN_FONT_NAMES.has(value)) {
          cValue = `&lv_font_${value}`;
        } else {
          const decl = `${externC}const lv_font_t ${value}; /* generated by lv_font_conv */`;
          if (!statics.includes(decl)) statics.push(decl);
          cValue = `&${value}`;
        }
      }
      return lines.push(`    lv_obj_set_style_${prop}(${v}, ${cValue}, ${selector});`);
    }

    // Unknown attribute: surface it in the output rather than dropping it silently
    lines.push(`    /* unmapped attribute: ${key}="${value}" */`);
  }

  emitNode(view, 'parent');

  if (subjects.size) {
    const each = (fn) => [...subjects].map(([n, initial]) => fn(subjectVar(n), n, initial)).join('\n');
    statics.push(`${each((id) => `static lv_subject_t ${id};`)}
static bool subjects_ready;

/* Subjects outlive the widgets bound to them: set them up once, and start
 * every later create call from the initial state again. */
static void init_subjects(void)
{
    if(!subjects_ready) {
${each((id, n, initial) => `        lv_subject_init_int(&${id}, ${initial});`)}
#if LV_USE_XML
${each((id, n) => `        lv_xml_register_subject(NULL, ${cstr(n)}, &${id});`)}
#endif
        subjects_ready = true;
    }
    else {
${each((id, n, initial) => `        lv_subject_set_int(&${id}, ${initial});`)}
    }
}`);
    lines.unshift('', '    init_subjects();');
  }
  if (usesXmlComponent) statics.unshift('#if !LV_USE_XML\n#error "this UI instantiates library XML components: enable LV_USE_XML in lv_conf.h"\n#endif\n');

  const guard = `${unit.toUpperCase()}_${headerExt.toUpperCase()}`;
  // emitC's own function declaration stays plain-C but is wrapped so this
  // exact header is also safe to #include from a C++ caller with no extra
  // flag; emitCpp's target is unconditionally C++, so it wraps for real.
  const declOpen = cpp ? 'extern "C" {\n' : '#ifdef __cplusplus\nextern "C" {\n#endif\n';
  const declClose = cpp ? '\n}' : '\n#ifdef __cplusplus\n}\n#endif';

  const h = `/* Generated by html2lvgl — do not edit by hand */
#ifndef ${guard}
#define ${guard}

#include "${lvInclude}"

${declOpen}
lv_obj_t * ${symbol}(lv_obj_t * parent);
${declClose}

#endif /* ${guard} */
`;

  const c = `/* Generated by html2lvgl — do not edit by hand */
#include "${unit}.${headerExt}"

${statics.length ? statics.join('\n') + '\n\n' : ''}${navCallbacks.length ? navCallbacks.join('\n\n') + '\n\n' : ''}lv_obj_t * ${symbol}(lv_obj_t * parent)
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
