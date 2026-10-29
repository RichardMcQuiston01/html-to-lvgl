/**
 * Toolbar: a row of controls, usually inside an app bar (role=toolbar,
 * Material UI Toolbar).
 *
 * Signals: role="toolbar" (1), MuiToolbar-root (0.7). The row itself (flex
 * direction, `align-items`, the title's `flex-grow: 1`, the trailing
 * buttons) is converted from computed layout like any flex container, so
 * build() only names the node. MUI also uses an empty Toolbar as the spacer
 * under a fixed app bar; it matches too and is kept, because its height is
 * what keeps the content below the bar.
 */
import { SCORE_SEMANTIC, SCORE_MUI, hasMuiRoot, withName } from './shared.mjs';

/** @type {import('../recognize.mjs').ComponentDef} */
const toolbar = {
  name: 'toolbar',
  match(node) {
    if (node.role === 'toolbar') return SCORE_SEMANTIC;
    if (hasMuiRoot(node, 'Toolbar')) return SCORE_MUI;
    return false;
  },
  props: {},
  slots: ['items'],
  build(node) {
    return withName(node, 'toolbar');
  },
};

export default toolbar;
