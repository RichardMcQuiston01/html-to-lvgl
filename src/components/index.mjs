import icon from '../recognize-icons.mjs';
import card from './card.mjs';
import paper from './paper.mjs';
import divider from './divider.mjs';
import chip from './chip.mjs';
import avatar from './avatar.mjs';
import badge from './badge.mjs';
import alert from './alert.mjs';
import appbar from './appbar.mjs';
import toolbar from './toolbar.mjs';
import breadcrumbs from './breadcrumbs.mjs';

/**
 * The component definitions that ship with html2lvgl, in the order they are
 * offered to a node. Each lives in its own file in this folder. Phase 7 listed
 * every static component up front, so the lanes that fill them in never edit
 * this file. A later phase adds its components with one import and one entry.
 * See COMPONENTS.md, "The Registry".
 *
 * @type {import('../recognize.mjs').ComponentDef[]}
 */
export const builtinComponents = [
  icon,
  card,
  paper,
  divider,
  chip,
  avatar,
  badge,
  alert,
  appbar,
  toolbar,
  breadcrumbs,
];
