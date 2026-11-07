/**
 * Behavior: the interaction IR (Phase 8). A component definition's build()
 * attaches `node.behavior` to say "this widget changes that piece of state" or
 * "this widget shows/hides depending on that state". State is an LVGL
 * *subject*; see COMPONENTS.md "The Disclosure Primitive" and
 * spike/subjects/README.md (verified on LVGL v9.4.0).
 *
 * ---------------------------------------------------------------------------
 * API for component authors (Accordion, Modal, Drawer, Tabs, ...)
 * ---------------------------------------------------------------------------
 *
 *   import { subjectFor, withBehavior, toggleEvent, setEvent, hiddenWhen,
 *            declareSubject, xmlComponent } from '../behavior.mjs';
 *
 * 1. Name the state once, in build(), from the node both sides share (usually
 *    the target): `const open = subjectFor(target, 'open')` gives a LOCAL
 *    name such as `acc1_open` (derived from the node's unique `key`).
 *    convert() prefixes the page name, so the emitted subject is
 *    `<screen>_acc1_open` and cannot collide across pages.
 *
 * 2. Attach behavior to nodes with withBehavior(node, patch) (returns a copy;
 *    patches merge, so call it from several build()s on the same node):
 *
 *      withBehavior(target, {
 *        subjects: [declareSubject(open, initialOpen ? 1 : 0)],   // declare ONCE
 *        binds:    [hiddenWhen(open, 'eq', 0)],        // hidden while open == 0
 *      })
 *      withBehavior(trigger, { events: [toggleEvent(open)] })
 *      withBehavior(closeBtn, { events: [setEvent(open, 0)] })   // a closer
 *      withBehavior(opener,   { events: [setEvent(open, 1)] })   // a modal opener
 *
 *    node.behavior shape (all keys optional):
 *      subjects: { name, type: 'int', initial }[]     name is LOCAL
 *      events:   { kind: 'toggle' | 'set', subject, value?, trigger? }[]
 *      binds:    { kind: 'flag', subject, flag, op, ref }[]
 *                flag: an LVGL object flag name ('hidden', 'clickable', ...)
 *                op:   'eq' | 'not_eq' | 'gt' | 'ge' | 'lt' | 'le'
 *                ref:  integer the subject is compared to
 *    The flag is SET while the comparison is true (bind_flag_if_<op>).
 *
 * 3. Collapsed panels and closed dialogs. The extractor shows a disclosure
 *    target (named by some aria-controls, or role dialog/alertdialog) while it
 *    measures, so it keeps its OPEN size, and flags it and its descendants
 *    `hidden: true, revealed: true`. Before matching, recognize() clears
 *    `hidden` on them (so match()/build() treat their contents like any other
 *    node, a Card inside a Modal included) and sets `initiallyHidden: true` on
 *    the subtree root. After recognition such a root is DROPPED unless a
 *    definition gave it `behavior` or `xmlComponent`; if it did, it stays with
 *    its measured x/y/w/h. The bind (hiddenWhen), not a static flag, hides it
 *    at run time, so declare its initial subject value 0 when
 *    `node.initiallyHidden` and 1 otherwise.
 *
 * 4. To instantiate a shared LIBRARY XML component (`ui_accordion`, written by
 *    hand or shipped by html2lvgl) instead of emitting the subtree, return
 *    `xmlComponent('ui_accordion', { title: 'Hi', subj: { subject: open } })`
 *    merged onto the node: `{ ...node, ...xmlComponent(...) }`. A prop value of
 *    `{ subject: local }` is qualified like any subject (per-instance subject
 *    props, verified in the spike); other values are written as-is. Such a
 *    node emits `<ui_accordion name=".." x=".." title="Hi" subj="home_acc1_open"/>`
 *    and its children are not emitted. Declare the subject via behavior.subjects.
 *
 * What convert() produces from behavior:
 *   - child elements on the widget, in this order: events then binds:
 *       <subject_toggle_event subject="home_acc1_open"/>
 *       <subject_set_int_event subject="home_modal_open" value="0"/>
 *       <bind_flag_if_eq subject="home_acc1_open" flag="hidden" ref_value="0"/>
 *   - convert() result `subjects`: [{ name, type: 'int', initial }] (final,
 *     page-qualified names) and `globalsXml` (see globalsXml()), which the CLI
 *     writes to `globals.xml` for XML output. The application registers it as
 *     the `globals` component (lv_xml_register_component_from_file) before any
 *     screen is created.
 *   - view element `meta.behavior` = the node's behavior with FINAL names
 *     (subjects/events/binds), for the C, C++ and MicroPython emitters, which
 *     should read that instead of parsing the child elements; they can skip
 *     child elements for which isBehaviorElement(el) is true.
 *   - the componentizer turns a differing `subject` attribute into a string
 *     prop (`subject="$subject"`), so repeated structures share one generated
 *     XML component with a per-instance subject, as in the spike.
 *
 * Diagnostics: BEHAVIOR_SUBJECT_UNDECLARED (used but never declared),
 * BEHAVIOR_SUBJECT_CONFLICT (declared twice with different initial values),
 * BEHAVIOR_TIMELINE_CONFLICT (a timeline name declared twice with different animations).
 *
 * 5. Animations (the Drawer slide; added by Phase 8 lane E, backward
 *    compatible: a behavior without these keys is unchanged).
 *
 *      withBehavior(panel, {
 *        timelines: [slideTimeline('d1_in', 'translate_x', -200, 0, 250),
 *                    slideTimeline('d1_out', 'translate_x', 0, -200, 250)],
 *      })
 *      withBehavior(opener, { events: [setEvent(open, 1), playEvent('d1_in')] })
 *
 *    node.behavior.timelines: { name, animations: { prop, start, end, duration,
 *    delay?, target? }[] }[]. A timeline belongs to the SCREEN (LVGL scope),
 *    so `name` must be unique on the page; derive it from a node key like a
 *    subject, e.g. `${subjectFor(node, 'in')}`. `prop` is any integer style
 *    property (translate_x, translate_y, opa, ...). `target` is omitted =
 *    the widget that declares the timeline; convert() fills in its final
 *    emitted widget name (the animation target is found BY NAME at run time).
 *    node.behavior.events gains { kind: 'play', timeline, trigger? }: play that
 *    timeline from the screen (target="self"), in document order with any set
 *    event on the same widget.
 *
 *    convert() emits, as the first child of <screen>/<component> (before
 *    <view>):
 *      <animations>
 *        <timeline name="d1_in">
 *          <animation prop="translate_x" target="drawer" start="-200" end="0" duration="250"/>
 *        </timeline>
 *      </animations>
 *    and on the widget:  <play_timeline_event target="self" timeline="d1_in"/>
 *    The convert() result gains `timelines`: [{ name, animations: [{ prop,
 *    target, start, end, duration, delay? }] }] (final names), and
 *    `meta.behavior.timelines` carries the same on the declaring widget, for
 *    the C/C++/MicroPython emitters (lv_anim_timeline_create + lv_anim_timeline_add
 *    and lv_obj_add_play_timeline_event, or hand-built equivalents).
 *
 * 6. Object STATE binds (added with the AppBar tabs): `bindState(subject,
 *    'checked', 'eq', i)` sets or clears an object STATE (not a flag) while
 *    the comparison is true, so a row of buttons can show which one is open
 *    with a style for the CHECKED state, exactly as lv_tabview does for its
 *    own buttons. node.behavior.binds entries then have kind 'state':
 *    { kind: 'state', subject, state, op, ref }. convert() emits
 *    `<bind_state_if_eq subject=".." state="checked" ref_value="1"/>`
 *    (verified in LVGL 9.4: lv_obj_xml_bind_state_apply), C emits
 *    lv_obj_bind_state_if_<op>, MicroPython obj.bind_state_if_<op>.
 *
 * Not covered yet (extend here, not in components): increment events,
 * string/float subjects, include_timeline.
 *
 * This module is pure: no browser, no file system.
 */
import { el } from './emit-xml.mjs';
import { sanitize } from './names.mjs';

/** @typedef {import('./recognize.mjs').UiNode} UiNode */

/**
 * @typedef {object} SubjectDecl
 * @property {string} name
 * @property {'int'} type
 * @property {number} initial
 *
 * @typedef {object} BehaviorEvent
 * @property {'toggle' | 'set' | 'play'} kind
 * @property {string} [subject]    toggle/set: the int subject (absent for play).
 * @property {number} [value]      set: the integer to store.
 * @property {string} [timeline]   play: the name of a timeline declared in behavior.timelines.
 * @property {string} [trigger]    LVGL event name; omitted = clicked.
 *
 * @typedef {object} BehaviorBind
 * @property {'flag' | 'state'} kind  flag: an LVGL object flag; state: an object state (see bindState).
 * @property {string} subject
 * @property {string} [flag]         kind 'flag': the flag name ('hidden', 'clickable', ...).
 * @property {string} [state]        kind 'state': 'checked' or another name from BIND_STATES.
 * @property {'eq' | 'not_eq' | 'gt' | 'ge' | 'lt' | 'le'} op
 * @property {number} ref
 *
 * @typedef {object} TimelineAnimation
 * @property {string} prop        An integer style property name: translate_x, opa, ...
 * @property {number} start
 * @property {number} end
 * @property {number} duration    Milliseconds.
 * @property {number} [delay]
 * @property {string} [target]    Widget name; omitted = the declaring widget (convert() fills it in).
 *
 * @typedef {object} Timeline
 * @property {string} name
 * @property {TimelineAnimation[]} animations
 *
 * @typedef {object} Behavior
 * @property {SubjectDecl[]} [subjects]
 * @property {BehaviorEvent[]} [events]
 * @property {BehaviorBind[]} [binds]
 * @property {Timeline[]} [timelines]
 */

/**
 * Integer style properties an animation may drive. This is exactly the set
 * LVGL's XML loader accepts for <animation prop=".."> (style_prop_anim_get_type
 * in lv_xml_component.c, v9.4.0); each has an lv_obj_set_style_<prop>() in C
 * and an obj.set_style_<prop>() in the pinned MicroPython binding (checked), so
 * the C, C++ and Python emitters can drive it without a style-value union.
 */
export const TIMELINE_PROPS = Object.freeze(new Set([
  'width', 'min_width', 'max_width', 'height', 'min_height', 'max_height', 'length', 'radius',
  'pad_left', 'pad_right', 'pad_top', 'pad_bottom', 'pad_row', 'pad_column', 'pad_radial',
  'margin_left', 'margin_right', 'margin_top', 'margin_bottom',
  'bg_opa', 'bg_main_stop', 'bg_grad_stop', 'bg_image_recolor_opa',
  'border_width', 'border_opa', 'outline_width', 'outline_opa', 'outline_pad',
  'shadow_width', 'shadow_offset_x', 'shadow_offset_y', 'shadow_spread', 'shadow_opa',
  'text_opa', 'text_letter_space', 'text_line_space', 'image_opa', 'image_recolor_opa',
  'line_opa', 'line_width', 'line_dash_width', 'line_dash_gap', 'arc_opa', 'arc_width',
  'opa', 'opa_layered', 'color_filter_opa', 'transform_width', 'transform_height',
  'translate_x', 'translate_y', 'translate_radial', 'transform_scale_x', 'transform_scale_y',
  'transform_rotation', 'transform_pivot_x', 'transform_pivot_y', 'recolor_opa',
]));

export const BIND_OPS = Object.freeze(['eq', 'not_eq', 'gt', 'ge', 'lt', 'le']);

/** Object states a bind may drive (lv_xml_state_to_enum names that make sense for a bound state). */
export const BIND_STATES = Object.freeze(['checked', 'disabled', 'focused']);

const EVENT_TAGS = Object.freeze({ toggle: 'subject_toggle_event', set: 'subject_set_int_event', play: 'play_timeline_event' });

/** Tags convert() emits for behavior, for emitters that need to skip them. */
export const BEHAVIOR_TAGS = Object.freeze(new Set([
  ...Object.values(EVENT_TAGS),
  ...BIND_OPS.map((op) => `bind_flag_if_${op}`),
  ...BIND_OPS.map((op) => `bind_state_if_${op}`),
]));

/** @param {{ tag: string }} element  A node of the XML element tree. */
export const isBehaviorElement = (element) => BEHAVIOR_TAGS.has(element.tag);

/** @param {UiNode} node */
export const hasBehavior = (node) => Boolean(node && (node.behavior || node.xmlComponent));

/**
 * A local subject name for `node`, unique within the page because it comes
 * from the node's unique `key` (falling back to its tag when recognition has
 * not assigned one).
 * @param {UiNode} node
 * @param {string} suffix  What the state means: 'open', 'selected', ...
 * @returns {string}
 */
export function subjectFor(node, suffix) {
  const base = sanitize(String(node.key ?? node.tag).replace(/~/g, '_'));
  return `${base}_${sanitize(suffix)}`;
}

/** @returns {SubjectDecl} */
export function declareSubject(name, initial = 0) {
  if (!name) throw new Error('declareSubject needs a subject name');
  if (!Number.isInteger(initial)) throw new Error(`subject "${name}": initial value must be an integer, got ${initial}`);
  return { name, type: 'int', initial };
}

/** @returns {BehaviorEvent} Flip an int subject between 0 and 1. */
export function toggleEvent(subject, trigger) {
  return { kind: 'toggle', subject, ...(trigger ? { trigger } : {}) };
}

/** @returns {BehaviorEvent} Store an integer. */
export function setEvent(subject, value, trigger) {
  if (!Number.isInteger(value)) throw new Error(`setEvent("${subject}"): value must be an integer, got ${value}`);
  return { kind: 'set', subject, value, ...(trigger ? { trigger } : {}) };
}

/** @returns {BehaviorEvent} Play a timeline declared in behavior.timelines. */
export function playEvent(timeline, trigger) {
  if (!timeline) throw new Error('playEvent needs a timeline name');
  return { kind: 'play', timeline, ...(trigger ? { trigger } : {}) };
}

/**
 * A one-animation timeline that moves an integer style property from `start`
 * to `end` on the widget that declares it (the Drawer slide).
 * @returns {Timeline}
 */
export function slideTimeline(name, prop, start, end, duration = 250) {
  if (!name) throw new Error('slideTimeline needs a timeline name');
  if (!TIMELINE_PROPS.has(prop)) throw new Error(`slideTimeline("${name}"): "${prop}" is not an animatable integer style property`);
  for (const [label, value] of [['start', start], ['end', end], ['duration', duration]]) {
    if (!Number.isInteger(value)) throw new Error(`slideTimeline("${name}"): ${label} must be an integer, got ${value}`);
  }
  return { name, animations: [{ prop, start, end, duration }] };
}

/** @returns {BehaviorBind} Set an object flag while `subject <op> ref`. */
export function bindFlag(subject, flag, op, ref) {
  if (!BIND_OPS.includes(op)) throw new Error(`bindFlag: op must be one of ${BIND_OPS.join(', ')}, got "${op}"`);
  if (!Number.isInteger(ref)) throw new Error(`bindFlag("${subject}"): ref must be an integer, got ${ref}`);
  return { kind: 'flag', subject, flag, op, ref };
}

/** @returns {BehaviorBind} Set an object state (checked, ...) while `subject <op> ref`. */
export function bindState(subject, state, op, ref) {
  if (!BIND_OPS.includes(op)) throw new Error(`bindState: op must be one of ${BIND_OPS.join(', ')}, got "${op}"`);
  if (!BIND_STATES.includes(state)) throw new Error(`bindState("${subject}"): state must be one of ${BIND_STATES.join(', ')}, got "${state}"`);
  if (!Number.isInteger(ref)) throw new Error(`bindState("${subject}"): ref must be an integer, got ${ref}`);
  return { kind: 'state', subject, state, op, ref };
}

/** Shorthand for bindFlag(subject, 'hidden', op, ref). */
export const hiddenWhen = (subject, op, ref) => bindFlag(subject, 'hidden', op, ref);

/**
 * A copy of the node with the patch merged into its behavior. Lists append;
 * an identical entry is not added twice, so two build()s can both declare.
 * @param {UiNode} node
 * @param {Behavior} patch
 * @returns {UiNode}
 */
export function withBehavior(node, patch) {
  const merged = { ...(node.behavior ?? {}) };
  for (const key of /** @type {const} */ (['subjects', 'events', 'binds', 'timelines'])) {
    if (!patch[key]?.length) continue;
    const list = [...(merged[key] ?? [])];
    for (const entry of patch[key]) {
      if (!list.some((e) => JSON.stringify(e) === JSON.stringify(entry))) list.push(entry);
    }
    merged[key] = list;
  }
  return { ...node, behavior: merged };
}

/**
 * Fields to merge onto a node so it is emitted as an instance of a library
 * XML component. See "To instantiate a shared LIBRARY XML component" above.
 * @param {string} tag
 * @param {Record<string, string | number | { subject: string }>} [props]
 */
export function xmlComponent(tag, props = {}) {
  return { xmlComponent: { tag, props } };
}

/* ----------------------------------------------------- used by convert() */

/**
 * Resolve a node's behavior to final (page-qualified) names.
 * @param {Behavior} behavior
 * @param {string} page  Page/screen name; sanitized and used as the prefix.
 * @returns {Required<Behavior>}
 */
export function qualifyBehavior(behavior, page) {
  const q = (name) => `${sanitize(page)}_${name}`;
  return {
    subjects: (behavior.subjects ?? []).map((s) => ({ ...s, name: q(s.name) })),
    events: (behavior.events ?? []).map((e) => (e.subject === undefined ? { ...e } : { ...e, subject: q(e.subject) })),
    binds: (behavior.binds ?? []).map((b) => ({ ...b, subject: q(b.subject) })),
    // Timelines are scoped to the screen, so their names are not prefixed.
    // Animation targets are resolved to widget names by convert().
    timelines: (behavior.timelines ?? []).map((t) => ({ ...t, animations: t.animations.map((a) => ({ ...a })) })),
  };
}

/**
 * The XML child elements for an already-qualified behavior.
 * @param {Required<Behavior>} b
 */
export function behaviorElements(b) {
  const events = b.events.map((e) => el(EVENT_TAGS[e.kind], e.kind === 'play'
    ? { target: 'self', timeline: e.timeline, trigger: e.trigger }
    : { subject: e.subject, ...(e.kind === 'set' ? { value: e.value } : {}), trigger: e.trigger }));
  const binds = b.binds.map((x) => (x.kind === 'state'
    ? el(`bind_state_if_${x.op}`, { subject: x.subject, state: x.state, ref_value: x.ref })
    : el(`bind_flag_if_${x.op}`, { subject: x.subject, flag: x.flag, ref_value: x.ref })));
  return [...events, ...binds];
}

/**
 * The `<animations>` element for a screen's timelines, or null when empty.
 * @param {Timeline[]} timelines  Animation targets already resolved to names.
 */
export function animationsElement(timelines) {
  if (!timelines.length) return null;
  return el('animations', {}, timelines.map((t) => el('timeline', { name: t.name }, t.animations.map((a) => el('animation', {
    prop: a.prop, target: a.target, start: a.start, end: a.end, duration: a.duration, delay: a.delay,
  })))));
}

/**
 * The text of `globals.xml` for a list of subjects, or null when empty.
 * @param {SubjectDecl[]} subjects  Final names.
 * @returns {string | null}
 */
export function globalsXml(subjects) {
  if (!subjects.length) return null;
  const lines = subjects.map((s) => `    <int name="${s.name}" value="${s.initial}"/>`);
  return `<globals>\n  <subjects>\n${lines.join('\n')}\n  </subjects>\n</globals>\n`;
}
