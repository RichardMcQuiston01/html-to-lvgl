/**
 * Accordion: a header that opens and closes a body, with the content below it
 * moving out of the way (Material UI Accordion, Bootstrap accordion, a plain
 * `<button aria-expanded aria-controls>` disclosure).
 *
 * This is the first stateful component. State is an LVGL subject (see
 * src/behavior.mjs and COMPONENTS.md, "The Disclosure Primitive"):
 *
 *   - the TRIGGER (a node with `aria-expanded` and `aria-controls`) gets a
 *     `subject_toggle_event`, so a click flips the subject between 0 and 1;
 *   - the BODY gets `bind_flag_if_eq subject hidden 0`, so it is hidden while
 *     the subject is 0 and flex layout reflows whatever sits below it.
 *
 * One subject per item (named from the body's key, `<screen>_<body>_open`), so
 * several accordions on a page, and several items in one group, are
 * independent. The group is not exclusive: opening one item leaves the others
 * as they are, as in Material UI's default.
 *
 * Which node is "the accordion"? The lowest ancestor of a trigger and the node
 * it controls: the item (`MuiAccordion-root`, `.accordion-item`, or whatever
 * wrapper holds the header and the body). A node that holds several trigger
 * and body pairs directly (no per-item wrapper) owns all of them. A parent
 * whose children are items is the "group" and is matched at the lowest score.
 *
 * Signals and scores:
 *   1    a trigger whose `aria-controls` names a body inside this node
 *        (not a popup trigger, not a dialog/menu/listbox body)
 *   0.7  `MuiAccordion-root`
 *   0.5  an `accordion` or `accordion-item` class
 *   0.4  a node with an item among its direct children (the group)
 *
 * Collapsed bodies: the extractor measures a collapsed panel while open (see
 * "Collapsed panels" in src/behavior.mjs) and recognize() hands it over with
 * its open size, flagged `initiallyHidden`. Material UI wraps the body in
 * Collapse / wrapper / wrapperInner elements that are zero height while
 * closed, so the bind goes on the OUTERMOST wrapper of the body: hiding only
 * the inner region would leave the empty wrapper behind.
 *
 * Reflow (why the converter output moves): LVGL positions a block container's
 * children at fixed coordinates, so hiding one would leave a hole. For the
 * item, and for a group of items, build() turns the block container into a
 * flex column (each child keeps its measured gap as a top margin) and marks it
 * `layout.heightContent`, which convert() writes as `height="content"`. A
 * fixed height would pin the box, so the siblings would not move.
 * Ancestors above the group must be flex columns themselves for the page below
 * to move; the group and item are the only boxes this definition changes.
 *
 * Known limits: the expand icon is not rotated on open (a static chevron, and
 * SVG icons are placeholders anyway); there is no open/close animation;
 * `aria-expanded` is read once, at conversion time.
 */

import { SCORE_SEMANTIC, SCORE_MUI, SCORE_GENERIC_CLASS, hasClass, hasMuiRoot, withName } from './shared.mjs';
import { subjectFor, declareSubject, withBehavior, toggleEvent, hiddenWhen } from '../behavior.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */
/** @typedef {import('../recognize.mjs').RecognizeContext} RecognizeContext */

/** A group matched only by its structure loses every tie with a real signal. */
const SCORE_GROUP = 0.4;

/** Bodies that are overlays or widgets of their own, not an inline panel. */
const OVERLAY_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip', 'tree', 'grid']);

/** Triggers that open something other than an inline panel. */
const NON_DISCLOSURE_ROLES = new Set(['combobox', 'tab', 'menuitem']);

/**
 * @typedef {object} Pair
 * @property {UiNode} trigger
 * @property {UiNode} target     The node `aria-controls` names.
 */

/** @param {UiNode} node @param {string} key */
function contains(node, key) {
  if (node.key === key) return true;
  return node.children.some((child) => contains(child, key));
}

/** @param {UiNode} node @returns {boolean} */
function isDisclosureTrigger(node) {
  const aria = node.aria ?? {};
  if (node.hidden || aria.expanded === undefined || !aria.controls) return false;
  if (aria.haspopup && aria.haspopup !== 'false') return false;
  return !NON_DISCLOSURE_ROLES.has(node.role ?? '');
}

/**
 * The trigger/body pairs for which `node` is the lowest common ancestor.
 * @param {UiNode} node
 * @param {RecognizeContext} ctx
 * @returns {Pair[]}
 */
function ownPairs(node, ctx) {
  /** @type {Pair[]} */
  const pairs = [];
  const byId = ctx?.byId;
  if (!byId || !node.key) return pairs;

  /** @param {UiNode} n */
  const visit = (n) => {
    if (isDisclosureTrigger(n)) {
      for (const id of n.aria.controls.split(/\s+/).filter(Boolean)) {
        const target = byId.get(id);
        if (!target || !target.key || target.key === n.key || target.key === node.key) continue;
        if (OVERLAY_ROLES.has(target.role ?? '') || target.aria?.modal === 'true') continue;
        if (!contains(node, target.key) || contains(n, target.key) || contains(target, n.key)) continue;
        // node must be the LOWEST ancestor: no single child holds both.
        const lower = node.children.some((c) => contains(c, n.key) && contains(c, target.key));
        if (!lower) pairs.push({ trigger: n, target });
        break;
      }
    }
    for (const child of n.children) visit(child);
  };
  for (const child of node.children) visit(child);
  return pairs;
}

/** An item: a Material UI or Bootstrap accordion root, or a header/body holder. */
function isItem(node, ctx) {
  return hasMuiRoot(node, 'Accordion') || hasClass(node, 'accordion-item') || ownPairs(node, ctx).length > 0;
}

/**
 * The node that must carry the hidden bind for `target`: the outermost
 * zero-height wrapper chain around it, else the target itself.
 * @param {UiNode} item     The accordion node (contains the trigger).
 * @param {Pair} pair
 * @returns {UiNode}
 */
function bodyRoot(item, { trigger, target }) {
  /** @type {UiNode[]} */
  const path = [];
  /** @param {UiNode} n @returns {boolean} */
  const find = (n) => {
    if (n.key === target.key) { path.push(n); return true; }
    for (const child of n.children) {
      if (find(child)) { path.unshift(n); return true; }
    }
    return false;
  };
  find(item);
  // path = [item, ..., target]. Below the deepest ancestor that also holds
  // the trigger, a node flagged initiallyHidden is the revealed collapse root.
  let start = 0;
  for (let i = 0; i < path.length - 1; i++) if (contains(path[i], trigger.key)) start = i;
  const below = path.slice(start + 1);
  const revealedRoot = below.find((n) => n.initiallyHidden);
  if (revealedRoot) return revealedRoot;
  // Open at conversion time: climb while each parent wraps only this node
  // (Collapse > wrapper > wrapperInner > region), so a reflow hides the lot.
  let top = below.length - 1;
  while (top > 0 && below[top - 1].children.length === 1) top -= 1;
  return below[top];
}

/**
 * Turn a block container into a column of its in-flow children, each keeping
 * the gap the browser gave it as a top margin. Returns the node unchanged when
 * it already is a flex or grid container, has its own text, or its children do
 * not stack top to bottom (side by side or overlapping), because then flex
 * would move things the browser did not.
 *
 * @param {UiNode} node
 * @param {{ heightContent: boolean }} options
 * @returns {UiNode}
 */
function stackAsColumn(node, { heightContent }) {
  const display = node.layout?.display;
  if (display === 'flex' || display === 'grid' || display === 'inline-flex') {
    return heightContent ? { ...node, layout: { ...node.layout, heightContent: true } } : node;
  }
  if (node.text || !node.children.length) return node;

  const s = node.styles ?? {};
  const originX = node.x + (s.borderWidth || 0) + (s.padLeft || 0);
  let bottom = node.y + (s.borderWidth || 0) + (s.padTop || 0);
  const margins = new Map();
  for (const child of node.children) {
    if (child.hidden) continue;
    const position = child.layout?.position;
    if (position === 'absolute' || position === 'fixed') continue;
    if (child.y < bottom - 1) return node; // overlaps the previous box: not a plain stack
    margins.set(child.key, { top: Math.max(0, child.y - bottom), left: Math.max(0, child.x - originX) });
    bottom = child.y + child.h;
  }
  if (!margins.size) return node;

  return {
    ...node,
    layout: {
      ...node.layout,
      display: 'flex', flexDirection: 'column', flexWrap: 'nowrap',
      justifyContent: 'flex-start', alignItems: 'flex-start',
      rowGap: 0, columnGap: 0,
      ...(heightContent ? { heightContent: true } : {}),
    },
    children: node.children.map((child) => {
      const m = margins.get(child.key);
      if (!m) return child;
      return { ...child, layout: { ...child.layout, marginTop: m.top, marginBottom: 0, marginLeft: m.left } };
    }),
  };
}

/**
 * True when convert() draws this node as a bare `lv_label`: text with no
 * background, border or padding. A label is not clickable in LVGL.
 * @param {UiNode} node
 */
function isBareLabel(node) {
  const s = node.styles ?? {};
  const decorated = s.bgColor || s.gradient || (s.borderWidth > 0 && s.borderColor)
    || (s.borderBottomWidth > 0 && s.borderBottomColor)
    || s.padLeft || s.padRight || s.padTop || s.padBottom;
  return Boolean(node.text) && node.children.length === 0 && !decorated;
}

/**
 * Make the whole header press the toggle. LVGL delivers a click to the
 * innermost clickable object under the finger and does not pass it up, so an
 * event on the header alone misses every press that lands on a box inside it
 * (the Material UI summary holds a content box and an icon box). The same
 * toggle is therefore put on each descendant that could take the press: boxes
 * and buttons' inner boxes, not bare labels or images, which are not clickable.
 * A text-only trigger that would become a bare label gets a box around the
 * label so that it can be pressed at all.
 *
 * @param {UiNode} trigger
 * @param {import('../behavior.mjs').BehaviorEvent} event
 * @returns {UiNode}
 */
export function makePressable(trigger, event) {
  /** @param {UiNode} n @returns {UiNode} */
  const spread = (n) => ({
    ...n,
    children: n.children.map((child) => {
      const takesPress = !isBareLabel(child) && child.tag !== 'img' && !child.link && child.tag !== 'a' && child.tag !== 'button'
        && !child.behavior?.events?.length;
      const next = takesPress ? withBehavior(child, { events: [event] }) : child;
      return next.children.length ? spread(next) : next;
    }),
  });

  let header = trigger;
  if (isBareLabel(trigger)) {
    const label = {
      ...trigger,
      tag: 'span', id: null, className: null, classes: [], lvName: null, widget: null, component: null,
      link: null, role: null, aria: {}, testId: null, children: [], key: `${trigger.key}/text`,
      layout: { ...trigger.layout, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, flexGrow: 0 },
    };
    header = { ...trigger, text: null, children: [label] };
  }
  return withBehavior(header.children.length ? spread(header) : header, { events: [event] });
}

/**
 * Grow the recorded box to the size it has when open. A collapsed item was
 * measured with only its header, so its open body would hang below the box,
 * and convert() would answer by letting the item draw outside itself (an
 * overflow_visible outline). The emitted height is "content" either way, so
 * the recorded height only has to be honest about the largest state.
 * @param {UiNode} node
 * @returns {UiNode}
 */
function coverOpenExtent(node) {
  const border = node.styles?.borderWidth || 0;
  const bottom = Math.max(...node.children.filter((c) => !c.hidden).map((c) => c.y + c.h), node.y);
  const h = Math.max(node.h, bottom - node.y + border);
  return h === node.h ? node : { ...node, h };
}

/**
 * A copy of `node` with `edits[key]` applied to every descendant (or itself)
 * whose key is listed. Untouched branches are shared, not copied.
 * @param {UiNode} node
 * @param {Map<string, (n: UiNode) => UiNode>} edits
 * @returns {UiNode}
 */
function rewrite(node, edits) {
  let children = node.children;
  let changed = false;
  const mapped = children.map((child) => {
    const next = rewrite(child, edits);
    if (next !== child) changed = true;
    return next;
  });
  if (changed) children = mapped;
  let out = changed ? { ...node, children } : node;
  const edit = out.key ? edits.get(out.key) : undefined;
  if (edit) out = edit(out);
  return out;
}

/** @type {import('../recognize.mjs').ComponentDef} */
const accordion = {
  name: 'accordion',
  match(node, ctx) {
    if (ownPairs(node, ctx).length) return SCORE_SEMANTIC;
    if (hasMuiRoot(node, 'Accordion')) return SCORE_MUI;
    if (hasClass(node, 'accordion', 'accordion-item')) return SCORE_GENERIC_CLASS;
    if (node.children.some((child) => isItem(child, ctx))) return SCORE_GROUP;
    return false;
  },
  props: { expanded: { type: 'bool', default: false } },
  slots: ['header', 'body'],
  build(node, ctx) {
    const pairs = ownPairs(node, ctx);
    const named = pairs.length === 1 || hasMuiRoot(node, 'Accordion') || hasClass(node, 'accordion', 'accordion-item');
    let next = named ? withName(node, 'accordion') : node;

    if (!pairs.length) {
      // A group (or an item with no linkable body): just keep its items in a column.
      if (next.children.some((child) => isItem(child, ctx))) {
        next = stackAsColumn(next, { heightContent: Boolean(ctx?.parent) });
      }
      return { ...next, recognized: { component: 'accordion', props: {} } };
    }

    /** @type {Map<string, (n: UiNode) => UiNode>} */
    const edits = new Map();
    for (const pair of pairs) {
      const expanded = pair.trigger.aria.expanded === 'true';
      const state = subjectFor(pair.target, 'open');
      const body = bodyRoot(node, pair);
      edits.set(pair.trigger.key, (n) => makePressable(n, toggleEvent(state)));
      edits.set(body.key, (n) => withBehavior(n, {
        subjects: [declareSubject(state, expanded ? 1 : 0)],
        binds: [hiddenWhen(state, 'eq', 0)],
      }));
    }
    next = rewrite(next, edits);
    next = stackAsColumn(next, { heightContent: true });
    next = coverOpenExtent(next);
    return {
      ...next,
      recognized: { component: 'accordion', props: { expanded: pairs[0].trigger.aria.expanded === 'true' } },
    };
  },
};

export default accordion;
