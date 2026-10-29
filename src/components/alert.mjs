/**
 * Alert: A status message (role=alert) with an optional icon and action.
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const alert = {
  name: 'alert',
  match: () => false,
  props: { severity: { type: 'string', default: 'info' } },
  slots: ['icon', 'message', 'action'],
  build: () => null,
};

export default alert;
