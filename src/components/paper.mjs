/**
 * Paper: A plain surface (Material UI Paper).
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const paper = {
  name: 'paper',
  match: () => false,
  props: { variant: { type: 'string', default: 'elevation' } },
  slots: ['body'],
  build: () => null,
};

export default paper;
