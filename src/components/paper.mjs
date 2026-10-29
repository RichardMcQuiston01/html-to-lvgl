/**
 * Paper: A plain surface (Material UI Paper).
 *
 * Material UI builds Card, Alert, AppBar, Accordion and others on Paper, so
 * all of them carry `MuiPaper-root` too. Paper matches only when `Paper` is
 * the node's sole Material UI root, so it never competes with those and no
 * RECOGNIZER_AMBIGUOUS is raised for them.
 *
 * Like Card, a translucent outlined border is blended onto the surface color
 * (LVGL would draw it solid black). The surface itself (background, radius,
 * largest shadow layer) is already converted from computed style.
 */

import { SCORE_MUI, muiRoots, withName } from './shared.mjs';
import { solidBorderStyles, surfaceVariant } from './card.mjs';

/** @type {import('../recognize.mjs').ComponentDef} */
const paper = {
  name: 'paper',
  match(node) {
    const roots = muiRoots(node);
    return roots.length === 1 && roots[0] === 'Paper' ? SCORE_MUI : false;
  },
  props: { variant: { type: 'string', default: 'elevation' } },
  slots: ['body'],
  build(node, ctx) {
    return {
      ...withName(node, 'paper'),
      styles: solidBorderStyles(node, ctx?.parent),
      recognized: { component: 'paper', props: { variant: surfaceVariant(node) } },
    };
  },
};

export default paper;
