/**
 * Chip: A compact pill with a label and an optional icon or delete control.
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const chip = {
  name: 'chip',
  match: () => false,
  props: { label: { type: 'string', default: '' } },
  slots: ['icon', 'delete'],
  build: () => null,
};

export default chip;
