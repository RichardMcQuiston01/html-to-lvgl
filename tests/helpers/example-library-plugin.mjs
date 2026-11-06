/**
 * An example LIBRARY plugin, used only by tests. It shows the whole shape of
 * the `recognizers` hook: one definition matched by a class (works on plain
 * HTML) and, when the framework plugin supplied `node.framework`, by React
 * component name (works when class names are hashed).
 *
 * "Fancy" is an invented library, so no real component library's behavior is
 * implied. Output of a match: the node gets `lvName: 'fancy_button'` and
 * `recognized.props.variant`, which tests read from the generated XML.
 */
import { PLUGIN_API } from '../../src/plugin.mjs';

/** @type {import('../../src/recognize.mjs').ComponentDef} */
export const fancyButton = {
  name: 'fancy-button',
  match(node) {
    // A framework component name is stronger evidence than a class.
    if (node.framework?.chain?.some((c) => c.name === 'FancyButton')) return 3;
    if (node.classes?.includes('fancy-btn')) return 1.5;
    return false;
  },
  props: { variant: { type: 'string', default: 'text' } },
  slots: [],
  build(node) {
    const variant = node.framework?.chain?.find((c) => c.name === 'FancyButton')?.props?.variant ?? 'text';
    return { ...node, lvName: node.lvName ?? 'fancy_button', recognized: { component: 'fancy-button', props: { variant } } };
  },
};

/** @type {import('../../src/plugin.mjs').Plugin} */
const plugin = {
  name: 'example-library',
  pluginApi: PLUGIN_API,
  wantsFrameworkData: true,
  recognizers: [fancyButton],
};

export default plugin;
