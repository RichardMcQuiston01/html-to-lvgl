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
 * Flag constants (scrollable/hidden/ignore_layout/floating) live under the widget
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
 *
 * Behavior (src/behavior.mjs, Phase 8): view elements carry `meta.behavior`
 * (final, page-qualified names); the `subject_*_event` / `bind_flag_if_*`
 * child elements are skipped (isBehaviorElement) and rendered from it.
 * Checked against the PINNED binding (lv_micropython 44aa2b15, vendored
 * LVGL v9.3-era), which exposes `lv.subject_t()` with `.init_int()/.get_int()/
 * .set_int()` and `obj.bind_flag_if_{eq,not_eq,gt,ge,lt,le}(subject, flag,
 * ref)`, but NOT `lv_obj_add_subject_toggle_event` /
 * `lv_obj_add_subject_set_int_event` (LVGL v9.4 additions; absent from
 * `dir(lv.obj)`). That gap is closed with ordinary event callbacks that do
 * exactly what the v9.4 helpers do (toggle: `set_int(not get_int())`; set:
 * `set_int(value)`), so the generated code behaves the same on the pinned
 * binding and on a newer one, and the callbacks are marked in the output.
 * The subjects live in a module-level dict `subjects` (name -> lv.subject_t)
 * so application code can read or drive the state; ui_create() creates them
 * first (a bind may reference a subject whose owner comes later in the tree)
 * and resets them to their initial value if the screen is created again.
 * Timelines (Drawer slide): the pinned binding has no lv.anim_timeline_t and no
 * obj.add_play_timeline_event, so a timeline is a list of `lv.anim_t` built
 * with `set_custom_exec_cb(<Python callable>)` that a click handler starts
 * together. (`set_exec_cb` with a closure raises "Cannot convert 'closure' to
 * pointer"; a collected lv.anim_t crashes when it ticks, hence the module-level
 * `timelines` dict.) Starting a timeline again restarts a running one on the
 * same widget, like the LVGL timeline does.
 * Library XML components (`xmlComponent`, e.g. ui_accordion) have no
 * imperative equivalent: they are replaced by a comment, never by code that
 * would fail to run.
 */
import { FONT_SIZES } from './fonts.mjs';
import { isBehaviorElement, TIMELINE_PROPS } from './behavior.mjs';

// The *exact* set of built-in font names — see emit-c.mjs's identical guard
// for why this can't be a "starts with montserrat_" guess.
const BUILTIN_FONT_NAMES = new Set(FONT_SIZES.map((size) => `montserrat_${size}`));

/** lv_calendar attributes emitted as two grouped calls (see emitNode). */
const CALENDAR_DATE_ATTRS = new Set(['today_year', 'today_month', 'today_day', 'shown_year', 'shown_month']);

// obj.FLAG.<NAME>, not a top-level lv.OBJ_FLAG.<NAME> — verified above.
const FLAG_NAMES = { clickable: 'CLICKABLE', scrollable: 'SCROLLABLE', hidden: 'HIDDEN', ignore_layout: 'IGNORE_LAYOUT', floating: 'FLOATING', overflow_visible: 'OVERFLOW_VISIBLE' };

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
  'parent', 'root', 'lv', 'e', 'fonts', 'images', 'subjects', 'timelines',
]);

/**
 * lv_tabview parts (Phase 9). The tab bar, a tab page and a tab button are
 * child elements of `<lv_tabview>` in XML; on the binding they are got from, or
 * added to, the tabview. The pinned binding (LVGL v9.3-era) has no
 * `get_tab_button`, so a button is the bar's i-th child: the bar holds the
 * buttons and nothing else, in tab order.
 */
const TABVIEW_PARTS = {
  'lv_tabview-tab': { create: (parent, a) => `${parent}.add_tab(${pystr(a.text ?? '')})`, consumed: new Set(['text']) },
  'lv_tabview-tab_bar': { create: (parent) => `${parent}.get_tab_bar()`, consumed: new Set() },
  'lv_tabview-tab_button': { create: (parent, a) => `${parent}.get_tab_bar().get_child(${a.index ?? 0})`, consumed: new Set(['index']) },
};

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

  // Subjects first: a bind or event may name a subject declared further down.
  const subjectDecls = new Map();
  (function collectSubjects(node) {
    for (const decl of node.meta?.behavior?.subjects ?? []) subjectDecls.set(decl.name, decl);
    for (const child of node.children) collectSubjects(child);
  })(view);
  // Timelines: see emitTimelines().
  const timelines = new Map(); // name -> timeline
  const playEvents = []; // { widget var, event }
  const varByName = new Map(); // widget name -> Python variable
  (function collectTimelines(node) {
    for (const t of node.meta?.behavior?.timelines ?? []) if (!timelines.has(t.name)) timelines.set(t.name, t);
    for (const child of node.children) collectTimelines(child);
  })(view);
  let usesToggle = false;
  let usesSet = false;

  function emitBehavior(v, behavior) {
    for (const event of behavior.events ?? []) {
      if (event.kind === 'play') {
        playEvents.push({ v, event });
        continue;
      }
      const trigger = event.trigger ? `lv.EVENT.${event.trigger.toUpperCase()}` : 'lv.EVENT.CLICKED';
      if (event.kind === 'toggle') {
        usesToggle = true;
        lines.push(`    ${v}.add_event_cb(_toggle_subject(subjects[${pystr(event.subject)}]), ${trigger}, None)`);
      } else {
        usesSet = true;
        lines.push(`    ${v}.add_event_cb(_set_subject(subjects[${pystr(event.subject)}], ${event.value}), ${trigger}, None)`);
      }
    }
    for (const bind of behavior.binds ?? []) {
      lines.push(`    ${v}.bind_flag_if_${bind.op}(subjects[${pystr(bind.subject)}], lv.obj.FLAG.${bind.flag.toUpperCase()}, ${bind.ref})`);
    }
  }

  function emitNode(node, parentVar) {
    if (isBehaviorElement(node)) return; // rendered from the parent's meta.behavior
    if (node.tag !== 'view' && !node.tag.startsWith('lv_') && !/^screen_(create|load)_event$/.test(node.tag)) {
      lines.push('');
      lines.push(`    # unsupported: <${node.tag}> is a library XML component with no MicroPython equivalent; use --format xml for it`);
      return;
    }
    const v = node.tag === 'view' ? 'root' : widgetVar(node);
    if (node.attrs.name) varByName.set(node.attrs.name, v);
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

    // A calendar's header is added by a call on its parent: the binding
    // exposes lv_calendar_add_header_arrow as a method of lv.calendar.
    if (node.tag === 'lv_calendar-header_arrow') {
      lines.push(`    ${parentVar}.add_header_arrow()`);
      return;
    }

    const part = TABVIEW_PARTS[node.tag];
    lines.push('');
    lines.push(`    ${v} = ${part ? part.create(parentVar, node.attrs) : `${ctor}(${parentVar})`}`);

    // The pinned binding has set_today_date and set_month_shown only (the
    // per-field setters are LVGL 9.4), so the date attributes go out as two calls.
    if (node.tag === 'lv_calendar') {
      const a = node.attrs;
      if ('today_year' in a && 'today_month' in a && 'today_day' in a) lines.push(`    ${v}.set_today_date(${a.today_year}, ${a.today_month}, ${a.today_day})`);
      if ('shown_year' in a && 'shown_month' in a) lines.push(`    ${v}.set_month_shown(${a.shown_year}, ${a.shown_month})`);
    }

    // lv_slider/lv_bar have no separate min/max setters on the pinned
    // binding's vendored LVGL — see module doc comment — so both attrs
    // (always emitted together by convert.mjs) collapse into one set_range.
    if ((node.tag === 'lv_slider' || node.tag === 'lv_bar') && 'min_value' in node.attrs && 'max_value' in node.attrs) {
      lines.push(`    ${v}.set_range(${node.attrs.min_value}, ${node.attrs.max_value})`);
    }

    for (const [key, raw] of Object.entries(node.attrs)) {
      if (raw === null || raw === undefined || raw === '' || key === 'name') continue;
      if ((node.tag === 'lv_slider' || node.tag === 'lv_bar') && (key === 'min_value' || key === 'max_value')) continue;
      if (node.tag === 'lv_calendar' && CALENDAR_DATE_ATTRS.has(key)) continue;
      if (part?.consumed.has(key)) continue;
      emitAttr(node, v, key, String(raw));
    }
    for (const child of node.children) emitNode(child, v);
    if (node.meta?.behavior) emitBehavior(v, node.meta.behavior);
    if (node.tag === 'view') lines.push('');
  }

  /**
   * Timelines come after the whole tree: a trigger often precedes the panel
   * its animation moves, and the animation holds the widget itself.
   */
  function emitTimelines() {
    if (!timelines.size && !playEvents.length) return;
    lines.push('');
    for (const [name, timeline] of timelines) {
      const steps = [];
      for (const a of timeline.animations) {
        const target = varByName.get(a.target);
        if (!target || !TIMELINE_PROPS.has(a.prop)) {
          lines.push(`    # timeline ${name}: skipped an animation of ${a.prop} on ${a.target} (${target ? 'not an animatable property' : 'no such widget'})`);
          continue;
        }
        steps.push(`        (${target}, ${pystr(a.prop)}, ${a.start}, ${a.end}, ${a.duration}, ${a.delay ?? 0}),`);
      }
      lines.push(`    _timeline(${pystr(name)}, [`, ...steps, '    ])');
    }
    for (const { v, event } of playEvents) {
      if (!timelines.has(event.timeline)) {
        lines.push(`    # play event: no timeline named ${event.timeline} on this page`);
        continue;
      }
      const trigger = event.trigger ? `lv.EVENT.${event.trigger.toUpperCase()}` : 'lv.EVENT.CLICKED';
      lines.push(`    ${v}.add_event_cb(_play_timeline(${pystr(event.timeline)}), ${trigger}, None)`);
    }
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
    if (key === 'width') return lines.push(`    ${v}.set_width(${value === 'content' ? 'lv.SIZE_CONTENT' : value})`);
    if (key === 'height') return lines.push(`    ${v}.set_height(${value === 'content' ? 'lv.SIZE_CONTENT' : value})`);
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
  emitTimelines();

  const params = ['parent'];
  if (usesFonts) params.push('fonts=None');
  if (usesImages) params.push('images=None');
  const prologue = [];
  if (subjectDecls.size) {
    prologue.push('    # State: one lv.subject_t per subject, shared through the module-level `subjects`.');
    for (const decl of subjectDecls.values()) prologue.push(`    _subject(${pystr(decl.name)}, ${decl.initial})`);
  }
  const behaviorHelpers = [];
  if (subjectDecls.size) {
    behaviorHelpers.push(`# Subject name -> lv.subject_t, filled by ${symbol}(). Kept at module level so the
# application can read or set the UI state: ${unit}.subjects[name].set_int(1).
subjects = {}


def _subject(name, initial):
    subject = subjects.get(name)
    if subject is None:
        subject = subjects[name] = lv.subject_t()
        subject.init_int(initial)
    else:
        subject.set_int(initial)  # screen created again: back to the initial state`);
  }
  // The pinned binding lacks lv_obj_add_subject_{toggle,set_int}_event (LVGL
  // v9.4), so these closures stand in for them — see the module doc comment.
  if (usesToggle) {
    behaviorHelpers.push(`def _toggle_subject(subject):
    # Stand-in for lv_obj_add_subject_toggle_event (not in the pinned binding).
    def toggle(e):
        subject.set_int(0 if subject.get_int() else 1)
    return toggle`);
  }
  if (usesSet) {
    behaviorHelpers.push(`def _set_subject(subject, value):
    # Stand-in for lv_obj_add_subject_set_int_event (not in the pinned binding).
    def set_value(e):
        subject.set_int(value)
    return set_value`);
  }
  if (timelines.size) {
    // The pinned binding has no lv.anim_timeline_t / lv_obj_add_play_timeline_event
    // (LVGL v9.3-era), so a timeline is a list of lv.anim_t that the play handler
    // starts together. set_custom_exec_cb takes a Python callable, and the
    // lv.anim_t objects (with their callbacks) are kept in `timelines`: a
    // collected one crashes the interpreter when the animation next ticks.
    behaviorHelpers.push(`# Timeline name -> [lv.anim_t]; module level so the animations stay alive while they run.
timelines = {}


def _timeline(name, steps):
    anims = []
    for target, prop, start, end, duration, delay in steps:
        anim = lv.anim_t()
        anim.init()
        anim.set_var(target)
        anim.set_values(start, end)
        anim.set_duration(duration)
        anim.set_delay(delay)
        anim.set_custom_exec_cb(_set_prop(target, prop))
        anims.append(anim)
    timelines[name] = anims


def _set_prop(target, prop):
    setter = getattr(target, "set_style_" + prop)
    return lambda anim, value: setter(value, 0)


def _play_timeline(name):
    # Stand-in for lv_obj_add_play_timeline_event (not in the pinned binding).
    def play(e):
        for anim in timelines[name]:
            anim.start()
    return play`);
  }
  if (usesFonts) prologue.push('    fonts = fonts or {}');
  if (usesImages) prologue.push('    images = images or {}');

  const py = `# Generated by html2lvgl — do not edit by hand
import lvgl as lv


${[...behaviorHelpers, ...navFuncs].length ? [...behaviorHelpers, ...navFuncs].join('\n\n\n') + '\n\n\n' : ''}def ${symbol}(${params.join(', ')}):
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
  lv_tabview: {
    active: (v, val) => `${v}.set_active(${val}, False)`,
    tab_bar_position: (v, val) => `${v}.set_tab_bar_position(lv.DIR.${val.toUpperCase()})`,
  },
  lv_table: {
    column_count: (v, val) => `${v}.set_column_count(${val})`,
    row_count: (v, val) => `${v}.set_row_count(${val})`,
  },
};
