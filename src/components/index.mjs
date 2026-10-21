import icon from '../recognize-icons.mjs';

/**
 * The component definitions that ship with html2lvgl, in the order they are
 * offered to a node. Each lives in its own file in this folder and is added
 * here with one import and one array entry, so lanes that add components do
 * not touch the same lines of code.
 *
 * Holds the icon placeholder until Phase 7 adds the rest. See COMPONENTS.md, "The Registry".
 *
 * @type {import('../recognize.mjs').ComponentDef[]}
 */
export const builtinComponents = [icon];
