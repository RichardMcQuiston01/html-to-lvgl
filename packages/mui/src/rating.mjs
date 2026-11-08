/**
 * Rating: Material UI's star `Rating` drawn as a row of dots.
 *
 * The core sees five SVG stars and keeps five empty 1 px outlined squares
 * (ICON_PLACEHOLDER), so a rating of 4 and a rating of 1 come out identical.
 * LVGL's built-in fonts have no star glyph and a star cannot be a rounded
 * box, so build() keeps what carries the information, which is how many of
 * the items are filled: a solid disc in the star's color for each filled item
 * and an outlined disc for each empty one, at the positions the page laid the
 * stars out. Swap the discs for a star image or an icon font glyph when the
 * firmware has one.
 *
 * Signals:
 *   0.8  the React component `Rating`
 *   0.7  `MuiRating-root`
 *
 * The value is read from the items the browser drew (`MuiRating-iconFilled`),
 * and from the `value` / `max` props when React supplied them.
 *
 * Limits: stars are discs; a half star (precision 0.5) counts as filled only
 * when the browser painted that icon filled; hover and focus are not drawn.
 */
import { backdropOf, findAll, hasClass, hasPart, muiScore, propsOf, shapeNode, solid, withName, asPositionedBox } from './shared.mjs';

/** @typedef {import('./shared.mjs').UiNode} UiNode */

/** @type {import('../../../src/recognize.mjs').ComponentDef} */
const rating = {
  name: 'mui-rating',
  description: 'A Material UI star Rating, drawn as a row of filled and outlined discs.',
  match(node) {
    if (node.hidden || node.native) return false;
    return muiScore(node, 'Rating');
  },
  props: {
    value: { type: 'number', default: 0 },
    max: { type: 'number', default: 5 },
    readOnly: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    const props = propsOf(node, 'Rating') ?? {};
    // The drawn stars: every `MuiRating-icon` container that holds an SVG.
    const icons = findAll(node, (n) => hasPart(n, 'Rating-icon') && n.w > 0 && findAll(n, (c) => c.tag === 'svg').length > 0);
    const backdrop = backdropOf(ctx, node);
    const filledColor = solid(findAll(node, (n) => hasPart(n, 'Rating-iconFilled'))[0]?.styles.color, backdrop) ?? [0xfa, 0xaf, 0x00];
    const emptyColor = solid(findAll(node, (n) => hasPart(n, 'Rating-iconEmpty'))[0]?.styles.color, backdrop) ?? [0xbd, 0xbd, 0xbd];

    // Hover and half precision draw one star as several overlapping icons;
    // keep the widest per position so each star is one disc.
    const byX = new Map();
    for (const icon of icons) {
      const slot = Math.round(icon.x / 4);
      const have = byX.get(slot);
      if (!have || icon.w > have.w) byX.set(slot, icon);
    }
    const stars = [...byX.values()].sort((a, b) => a.x - b.x);

    let filledCount = 0;
    const children = stars.map((icon, i) => {
      const filled = hasPart(icon, 'Rating-iconFilled');
      if (filled) filledCount += 1;
      const size = Math.max(4, Math.round(icon.w * 0.66));
      const box = { x: Math.round(icon.x + (icon.w - size) / 2), y: Math.round(icon.y + (icon.h - size) / 2), w: size, h: size };
      return shapeNode(node, `${node.key}~star${i + 1}`, `${node.lvName ?? 'rating'}_star_${i + 1}`, box, filled
        ? { radius: Math.ceil(size / 2), bgColor: [...filledColor, 255] }
        : { radius: Math.ceil(size / 2), borderWidth: 1, borderColor: [...emptyColor, 255] });
    });

    const value = typeof props.value === 'number' ? props.value : filledCount;
    const max = typeof props.max === 'number' ? props.max : stars.length || 5;
    const readOnly = props.readOnly === true || hasClass(node, 'Mui-readOnly');
    const out = asPositionedBox(withName(node, 'rating'), children);
    out.recognized = { component: 'mui-rating', props: { value, max, readOnly } };
    return out;
  },
};

export default rating;
