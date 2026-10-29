/**
 * App bar: The top bar of a screen (`<header>`, role=banner, Material UI AppBar), pinned while the page scrolls.
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const appbar = {
  name: 'appbar',
  match: () => false,
  props: { title: { type: 'string', default: '' } },
  slots: ['leading', 'title', 'actions'],
  build: () => null,
};

export default appbar;
