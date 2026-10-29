/**
 * Badge: A small count or dot pinned to the corner of another element.
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const badge = {
  name: 'badge',
  match: () => false,
  props: { content: { type: 'string', default: '' } },
  slots: ['anchor'],
  build: () => null,
};

export default badge;
