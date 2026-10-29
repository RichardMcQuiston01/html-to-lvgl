/**
 * Avatar: A circular image or initials.
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const avatar = {
  name: 'avatar',
  match: () => false,
  props: { label: { type: 'string', default: '' } },
  slots: [],
  build: () => null,
};

export default avatar;
