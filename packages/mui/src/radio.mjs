/**
 * Radio: Material UI's `Radio` drawn as a ring with a dot.
 *
 * The core turns a Radio's hidden `<input type=radio>` into an `lv_textarea`
 * showing the text "on" and its two SVG icons into empty square placeholders.
 * LVGL has no radio widget, so build() draws what the page showed from two
 * rounded boxes: a ring (a transparent circle with a border) and, when
 * selected, a filled dot in the middle. Sizes and colors are measured: the
 * ring is the unchecked icon's drawn circle, the dot the checked icon's.
 *
 * Signals:
 *   0.8  the React component `Radio`
 *   0.7  `MuiRadio-root`
 *
 * The root stays a plain box with the footprint the page had. The state comes
 * from `Mui-checked`, the input and the React props.
 *
 * Limits: the circles are not interactive (LVGL has no radio group to drive);
 * give the group behavior with a click handler or data-lv-link in your app.
 */
import { backdropOf, findAll, findFirst, hasClass, muiScore, propsOf, shapeNode, solid, withName, asPositionedBox } from './shared.mjs';

/** @type {import('../../../src/recognize.mjs').ComponentDef} */
const radio = {
  name: 'mui-radio',
  match(node) {
    if (node.hidden || node.native) return false;
    return muiScore(node, 'Radio');
  },
  props: {
    checked: { type: 'bool', default: false },
    disabled: { type: 'bool', default: false },
  },
  slots: [],
  build(node, ctx) {
    const props = propsOf(node, 'Radio') ?? {};
    const input = findFirst(node, (n) => n.tag === 'input');
    const checked = hasClass(node, 'Mui-checked') || input?.attrs?.checked === true || props.checked === true;
    const disabled = hasClass(node, 'Mui-disabled') || input?.attrs?.disabled === true || props.disabled === true;

    // The two icons: the ring is always drawn; the dot is the checked icon, which
    // has no size while the radio is not selected.
    const icons = findAll(node, (n) => n.tag === 'svg');
    const ring = icons.find((n) => n.testId === 'RadioButtonUncheckedIcon') ?? icons[0];
    const dot = icons.find((n) => n.testId === 'RadioButtonCheckedIcon');
    const ringPath = ring ? findFirst(ring, (n) => n.tag === 'path' && n.w > 0) : null;
    const dotPath = dot ? findFirst(dot, (n) => n.tag === 'path' && n.w > 0) : null;

    const backdrop = backdropOf(ctx, node);
    const color = solid(node.styles.color, backdrop) ?? (checked ? [0x19, 0x76, 0xd2] : [0x75, 0x75, 0x75]);
    const iconSize = ring?.w || Math.round(node.w * 0.6);
    const diameter = ringPath?.w || Math.round(iconSize * 0.83);
    const cx = ring ? ring.x + ring.w / 2 : node.x + node.w / 2;
    const cy = ring ? ring.y + ring.h / 2 : node.y + node.h / 2;
    const stroke = Math.max(1, Math.round((iconSize / 24) * 2));

    const circle = (name, size, styles) => shapeNode(
      node, `${node.key}~${name}`, `${node.lvName ?? 'radio'}_${name}`,
      { x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), w: size, h: size },
      { radius: Math.ceil(size / 2), ...styles },
    );
    const ringBox = circle('ring', diameter, { borderWidth: stroke, borderColor: [...color, 255] });
    const children = [ringBox];
    if (checked) {
      const dotSize = Math.max(2, dotPath?.w || Math.round(diameter / 2));
      children.push(circle('dot', dotSize, { bgColor: [...color, 255] }));
    }

    const out = asPositionedBox(withName(node, 'radio'), children);
    out.recognized = { component: 'mui-radio', props: { checked, disabled } };
    return out;
  },
};

export default radio;
