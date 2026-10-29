/**
 * Card: A container with a raised or outlined surface (Material UI Card, Bootstrap card).
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const card = {
  name: 'card',
  match: () => false,
  props: { variant: { type: 'string', default: 'elevation' } },
  slots: ['header', 'body', 'actions'],
  build: () => null,
};

export default card;
