/**
 * Breadcrumbs: A navigation trail (`<nav aria-label="breadcrumb">`, Material UI Breadcrumbs).
 *
 * Phase 7 stub. It never matches, so registering it changes no output; the
 * lane that owns this file replaces `match` and `build`. Shared matching
 * helpers and the score convention are in ./shared.mjs.
 */

/** @type {import('../recognize.mjs').ComponentDef} */
const breadcrumbs = {
  name: 'breadcrumbs',
  match: () => false,
  props: {},
  slots: ['items'],
  build: () => null,
};

export default breadcrumbs;
