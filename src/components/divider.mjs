/**
 * Divider: A thin separator line (`<hr>`, role=separator, Material UI Divider).
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const divider = {
  name: 'divider',
  match: () => false,
  props: { orientation: { type: 'string', default: 'horizontal' } },
  slots: [],
  build: () => null,
};

export default divider;
