/**
 * A tiny disclosure component used ONLY by the tests of src/behavior.mjs. It
 * exercises the whole behavior API the way Accordion / Modal / Drawer will
 * (lanes D and E), with none of their styling. It is not shipped.
 *
 *   trigger   a button with aria-controls and aria-expanded: toggles the state
 *   opener    a button with aria-controls and aria-haspopup="dialog": sets 1
 *   target    a node that some trigger controls: hidden while the state is 0;
 *             the state starts at 1 unless the node was initially hidden
 *   closer    data-testid="close:<target id>": sets the state back to 0
 *
 * One state subject per target, named from the target's key (subjectFor).
 */
import { subjectFor, withBehavior, toggleEvent, setEvent, hiddenWhen, declareSubject } from '../../src/behavior.mjs';
import { createRegistry } from '../../src/recognize.mjs';

const targetOf = (node, ctx) => (node.aria?.controls ? ctx.byId.get(node.aria.controls.split(/\s+/)[0]) : null);

/** @type {import('../../src/recognize.mjs').ComponentDef} */
export const demoTrigger = {
  name: 'demo-trigger',
  match: (node, ctx) => !node.hidden && Boolean(targetOf(node, ctx)) && node.aria.expanded !== undefined,
  props: {},
  slots: [],
  build(node, ctx) {
    const target = targetOf(node, ctx);
    const state = subjectFor(target, 'open');
    const event = node.aria.haspopup === 'dialog' ? setEvent(state, 1) : toggleEvent(state);
    return withBehavior(node, { events: [event] });
  },
};

/** @type {import('../../src/recognize.mjs').ComponentDef} */
export const demoTarget = {
  name: 'demo-target',
  match: (node, ctx) => (ctx.links.get(node.key)?.controlledBy.length ?? 0) > 0,
  props: {},
  slots: [],
  build(node) {
    const state = subjectFor(node, 'open');
    return withBehavior(node, {
      subjects: [declareSubject(state, node.initiallyHidden ? 0 : 1)],
      binds: [hiddenWhen(state, 'eq', 0)],
    });
  },
};

/** @type {import('../../src/recognize.mjs').ComponentDef} */
export const demoCloser = {
  name: 'demo-closer',
  match: (node) => /^close:/.test(node.testId ?? ''),
  props: {},
  slots: [],
  build(node, ctx) {
    const target = ctx.byId.get(node.testId.slice('close:'.length));
    return withBehavior(node, { events: [setEvent(subjectFor(target, 'open'), 0)] });
  },
};

export const demoRegistry = () => createRegistry([demoTrigger, demoTarget, demoCloser]);
