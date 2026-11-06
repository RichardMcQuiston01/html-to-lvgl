/**
 * Material UI library plugin for html2lvgl.
 *
 * The core already recognizes Material UI by its `Mui<Name>-root` classes
 * (Card, Chip, Alert, Tabs, Drawer, ...) and keeps doing so. This plugin adds
 * what the core cannot or deliberately does not do:
 *
 *   - rules for components the core has no definition for, measured against
 *     real Material UI output: Checkbox, Radio, Rating, FormControlLabel,
 *     Material icons, Button naming and state;
 *   - matching by React component name (`node.framework`, supplied by the
 *     React plugin) so a component is still found when its class names were
 *     hashed or renamed.
 *
 * Use it with the React plugin:  html2lvgl App.jsx --plugin @richardmcquiston01/html-to-lvgl-mui
 * See ./README.md and COMPONENTS.md, "Plugins".
 */
import checkbox from './checkbox.mjs';
import formControlLabel from './form-control-label.mjs';
import radio from './radio.mjs';
import rating from './rating.mjs';
import icon from './icon.mjs';
import button from './button.mjs';

/**
 * The definitions, in the order they are offered to a node. Each is
 * independent: a node matches at most one of them.
 * @type {import('../../../src/recognize.mjs').ComponentDef[]}
 */
export const recognizers = [formControlLabel, checkbox, radio, rating, icon, button];

/**
 * The plugin contract version this package was built for (PLUGIN_API in the
 * core's src/plugin.mjs). It is a literal on purpose: that is how the core
 * detects a plugin built for another version.
 */
const PLUGIN_API_BUILT_FOR = 1;

/** @type {import('../../../src/plugin.mjs').Plugin} */
const muiPlugin = {
  name: 'mui',
  pluginApi: PLUGIN_API_BUILT_FOR,
  // Ask the React plugin for `node.framework` (component names and props).
  wantsFrameworkData: true,
  recognizers,
};

export default muiPlugin;
