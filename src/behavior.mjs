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
 * BEHAVIOR_SUBJECT_CONFLICT (declared twice with different initial values).
 *
 * Not covered yet (extend here, not in components): increment events,
 * bind_state_if_*, string/float subjects, play_timeline_event / <animations>
 * (the Drawer slide, lane E).
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
 * @property {'toggle' | 'set'} kind
 * @property {string} subject
 * @property {number} [value]      set: the integer to store.
 * @property {string} [trigger]    LVGL event name; omitted = clicked.
 *
 * @typedef {object} BehaviorBind
 * @property {'flag'} kind
 * @property {string} subject
 * @property {string} flag
 * @property {'eq' | 'not_eq' | 'gt' | 'ge' | 'lt' | 'le'} op
 * @property {number} ref
 *
 * @typedef {object} Behavior
 * @property {SubjectDecl[]} [subjects]
 * @property {BehaviorEvent[]} [events]
 * @property {BehaviorBind[]} [binds]
 */

export const BIND_OPS = Object.freeze(['eq', 'not_eq', 'gt', 'ge', 'lt', 'le']);

const EVENT_TAGS = Object.freeze({ toggle: 'subject_toggle_event', set: 'subject_set_int_event' });

/** Tags convert() emits for behavior, for emitters that need to skip them. */
export const BEHAVIOR_TAGS = Object.freeze(new Set([
  ...Object.values(EVENT_TAGS),
  ...BIND_OPS.map((op) => `bind_flag_if_${op}`),
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

/** @returns {BehaviorBind} Set an object flag while `subject <op> ref`. */
export function bindFlag(subject, flag, op, ref) {
  if (!BIND_OPS.includes(op)) throw new Error(`bindFlag: op must be one of ${BIND_OPS.join(', ')}, got "${op}"`);
  if (!Number.isInteger(ref)) throw new Error(`bindFlag("${subject}"): ref must be an integer, got ${ref}`);
  return { kind: 'flag', subject, flag, op, ref };
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
  for (const key of /** @type {const} */ (['subjects', 'events', 'binds'])) {
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
    events: (behavior.events ?? []).map((e) => ({ ...e, subject: q(e.subject) })),
    binds: (behavior.binds ?? []).map((b) => ({ ...b, subject: q(b.subject) })),
  };
}

/**
 * The XML child elements for an already-qualified behavior.
 * @param {Required<Behavior>} b
 */
export function behaviorElements(b) {
  const events = b.events.map((e) => el(EVENT_TAGS[e.kind], {
    subject: e.subject,
    ...(e.kind === 'set' ? { value: e.value } : {}),
    trigger: e.trigger,
  }));
  const binds = b.binds.map((x) => el(`bind_flag_if_${x.op}`, { subject: x.subject, flag: x.flag, ref_value: x.ref }));
  return [...events, ...binds];
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
