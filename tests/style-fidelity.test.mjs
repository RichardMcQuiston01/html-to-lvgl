/**
 * Converter style fidelity: overhang, rounded image clip, translucent borders
 * and text, transparent buttons, padded text, negative margins, text-transform
 * and single-sided borders. Trees are extractor-shaped; no browser needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, applyTextTransform } from '../src/convert.mjs';

const styles = (extra = {}) => ({
  bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0, borderSide: null,
  borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 12,
  textAlign: 'start', textTransform: 'none', overflowHidden: false, opacity: 1,
  padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, gradient: null, shadow: null, scrollable: false, pressed: null, ...extra,
});
const layout = (extra = {}) => ({
  display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
  alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
  marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
  gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
  gridRowStart: 'auto', gridRowEnd: 'auto', ...extra,
});
const node = (tag, extra = {}) => {
  const { st, lay, ...rest } = extra;
  return {
    tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
    role: null, aria: {}, classes: [], testId: null, hidden: false,
    x: 0, y: 0, w: 40, h: 40, text: null, attrs: {}, styles: styles(st), layout: layout(lay), children: [], key: 'k',
    ...rest,
  };
};
const page = (...children) => node('body', { w: 320, h: 240, st: { bgColor: [255, 255, 255, 255] }, children });
/** The opening tag of the element with this name. */
const tagOf = (xml, name) => xml.match(new RegExp(`<[a-z_]+ name="${name}"[^>]*>`))?.[0] ?? assert.fail(`no element named ${name} in\n${xml}`);

test('a child that sticks out gives its parent and ancestors overflow_visible and an extended-draw outline', () => {
  const pin = node('span', { id: 'pin', x: 50, y: 14, w: 20, h: 20, st: { bgColor: [220, 38, 38, 255] }, layout: { position: 'absolute' } });
  const wrap = node('div', { id: 'wrap', x: 20, y: 20, w: 40, h: 40, st: { bgColor: [226, 232, 240, 255] }, children: [pin] });
  const outer = node('div', { id: 'outer', x: 10, y: 10, w: 100, h: 60, st: { bgColor: [240, 240, 240, 255] }, children: [wrap] });
  const { xml } = convert(page(outer));
  // pin reaches 6px above and 10px right of wrap; outer holds it, so only wrap needs the flag
  assert.match(tagOf(xml, 'wrap'), /overflow_visible="true"[^>]*style_outline_width="10" style_outline_opa="3" style_outline_color="0xf0f0f0"/);
  assert.doesNotMatch(tagOf(xml, 'outer'), /overflow_visible/);
});

test('every ancestor the child leaves gets the flag, and the outline hides on the color behind it', () => {
  const pin = node('span', { id: 'pin', x: 100, y: 10, w: 30, h: 10, st: { bgColor: [220, 38, 38, 255] }, layout: { position: 'absolute' } });
  const inner = node('div', { id: 'inner', x: 20, y: 10, w: 40, h: 40, st: { bgColor: [60, 60, 60, 255] }, children: [pin] });
  const outer = node('div', { id: 'outer', x: 10, y: 10, w: 100, h: 60, st: { bgColor: [30, 30, 30, 255] }, children: [inner] });
  const { xml } = convert(page(outer));
  assert.match(tagOf(xml, 'inner'), /overflow_visible="true"[^>]*style_outline_width="70" style_outline_opa="3" style_outline_color="0x1e1e1e"/);
  assert.match(tagOf(xml, 'outer'), /overflow_visible="true"[^>]*style_outline_width="20" style_outline_opa="3" style_outline_color="0xffffff"/);
});

test('a child inside its parent, or hidden by overflow: hidden, adds nothing', () => {
  const kid = node('div', { id: 'kid', x: 5, y: 5, w: 90, h: 10, st: { bgColor: [1, 2, 3, 255] } });
  const wide = node('div', { id: 'wide', x: 10, y: 10, w: 40, h: 40, st: { overflowHidden: true }, children: [kid] });
  const snug = node('div', { id: 'snug', x: 10, y: 60, w: 50, h: 40, children: [node('div', { id: 'in', x: 11, y: 61, w: 48, h: 38, st: { bgColor: [1, 2, 3, 255] } })] });
  const { xml } = convert(page(wide, snug));
  assert.doesNotMatch(xml, /overflow_visible/);
  assert.doesNotMatch(xml, /outline/);
});

test('rounded corners with overflow: hidden clip an image child (style_clip_corner)', () => {
  const photo = node('img', { id: 'photo', x: 10, y: 10, w: 40, h: 40, attrs: { src: 'face.png' } });
  const ring = node('div', { id: 'ring', x: 10, y: 10, w: 40, h: 40, st: { radius: 20, overflowHidden: true, bgColor: [200, 200, 200, 255] }, children: [photo] });
  const sharp = node('div', { id: 'sharp', x: 60, y: 10, w: 40, h: 40, st: { radius: 0, overflowHidden: true, bgColor: [200, 200, 200, 255] }, children: [{ ...photo, id: 'p2', x: 60 }] });
  const open = node('div', { id: 'open', x: 110, y: 10, w: 40, h: 40, st: { radius: 20, overflowHidden: false, bgColor: [200, 200, 200, 255] }, children: [{ ...photo, id: 'p3', x: 110 }] });
  const { xml } = convert(page(ring, sharp, open));
  assert.match(tagOf(xml, 'ring'), /style_clip_corner="true"/);
  assert.doesNotMatch(tagOf(xml, 'sharp'), /clip_corner/);
  assert.doesNotMatch(tagOf(xml, 'open'), /clip_corner/);
});

test('rgba() alpha on a border and on text becomes style_border_opa and style_text_opa', () => {
  const glass = node('div', { id: 'glass', x: 10, y: 10, w: 100, h: 30, st: { borderWidth: 2, borderColor: [220, 38, 38, 102], bgColor: [255, 255, 255, 255] } });
  const grey = node('p', { id: 'grey', x: 10, y: 60, w: 80, h: 14, text: 'Soft', st: { color: [0, 0, 0, 140] } });
  const { xml } = convert(page(glass, grey));
  assert.match(tagOf(xml, 'glass'), /style_border_color="0xdc2626" style_border_opa="102"/);
  assert.match(tagOf(xml, 'grey'), /style_text_color="0x000000" style_text_opa="140"/);
  // a solid border or text color adds no opacity attribute
  const solid = convert(page(node('div', { id: 'solid', x: 0, y: 0, w: 10, h: 10, st: { borderWidth: 1, borderColor: [0, 0, 0, 255] } }))).xml;
  assert.doesNotMatch(tagOf(solid, 'solid'), /border_opa/);
});

test('a <button> with no background is transparent, a filled one keeps its color', () => {
  const ghost = node('button', { id: 'ghost', x: 10, y: 10, w: 70, h: 30, text: 'Ghost' });
  const filled = node('button', { id: 'filled', x: 100, y: 10, w: 70, h: 30, text: 'Ok', st: { bgColor: [29, 78, 216, 255] } });
  const { xml } = convert(page(ghost, filled));
  assert.match(tagOf(xml, 'ghost'), /style_bg_opa="0"/);
  assert.doesNotMatch(tagOf(xml, 'filled'), /style_bg_opa/);
  assert.match(tagOf(xml, 'filled'), /style_bg_color="0x1d4ed8"/);
});

test('a padded text-only block keeps its padding inside a box', () => {
  const note = node('p', { id: 'note', x: 10, y: 10, w: 150, h: 30, text: 'Padded', st: { padLeft: 14, padRight: 14, padTop: 8, padBottom: 8 } });
  const { xml } = convert(page(note));
  assert.match(tagOf(xml, 'note'), /<lv_obj name="note" [^>]*width="150" height="30"/);
  assert.match(tagOf(xml, 'note_2'), /<lv_label name="note_2" align="left_mid" x="14" text="Padded"/);
});

test('padded multi-line text wraps at the content width from the padded corner', () => {
  const para = node('p', { id: 'para', x: 10, y: 10, w: 120, h: 70, text: 'Several words that wrap over lines', st: { padLeft: 10, padRight: 10, padTop: 8, padBottom: 8 } });
  const { xml } = convert(page(para));
  assert.match(tagOf(xml, 'para_2'), /align="top_left" x="10" y="8" width="100"/);
});

test('lopsided vertical padding on one line places the label by the top padding', () => {
  const tag = node('p', { id: 'tag', x: 10, y: 10, w: 80, h: 30, text: 'Top', st: { padLeft: 6, padRight: 6, padTop: 12, padBottom: 2 } });
  const { xml } = convert(page(tag));
  assert.match(tagOf(xml, 'tag_2'), /align="top_left" x="6" y="12"/);
});

test('negative margins on flex children are kept', () => {
  const a = node('div', { id: 'a', w: 40, h: 24, st: { bgColor: [1, 1, 1, 255] } });
  const b = node('div', { id: 'b', x: 24, w: 40, h: 24, st: { bgColor: [2, 2, 2, 255] }, lay: { marginLeft: -16, marginTop: -2 } });
  const row = node('div', { id: 'row', x: 0, y: 0, w: 300, h: 24, lay: { display: 'flex' }, children: [a, b] });
  const { xml } = convert(page(row));
  assert.match(tagOf(xml, 'b'), /style_margin_left="-16" style_margin_top="-2"/);
  assert.doesNotMatch(tagOf(xml, 'a'), /margin/);
});

test('text-transform is applied to the label text', () => {
  const mk = (id, text, textTransform, y) => node('p', { id, x: 0, y, w: 100, h: 14, text, st: { textTransform } });
  const { xml } = convert(page(mk('up', 'shout it', 'uppercase', 0), mk('low', 'WHISPER', 'lowercase', 20), mk('cap', 'make me a title', 'capitalize', 40), mk('none', 'As Is', 'none', 60)));
  assert.match(tagOf(xml, 'up'), /text="SHOUT IT"/);
  assert.match(tagOf(xml, 'low'), /text="whisper"/);
  assert.match(tagOf(xml, 'cap'), /text="Make Me A Title"/);
  assert.match(tagOf(xml, 'none'), /text="As Is"/);
});

test('text-transform covers button and container text too', () => {
  const button = node('button', { id: 'go', x: 0, y: 0, w: 60, h: 30, text: 'go', st: { textTransform: 'uppercase', bgColor: [1, 1, 1, 255] } });
  const box = node('div', { id: 'box', x: 0, y: 40, w: 60, h: 30, text: 'inside', st: { textTransform: 'uppercase', bgColor: [1, 1, 1, 255] }, children: [node('span', { x: 0, y: 40, w: 5, h: 5 })] });
  const { xml } = convert(page(button, box));
  assert.match(xml, /text="GO"/);
  assert.match(xml, /text="INSIDE"/);
});

test('applyTextTransform handles punctuation before a capitalized word and empty text', () => {
  assert.equal(applyTextTransform('"quoted" (words) 3d', 'capitalize'), '"Quoted" (Words) 3d');
  assert.equal(applyTextTransform('', 'uppercase'), '');
  assert.equal(applyTextTransform('keep', undefined), 'keep');
});

test('a border on one side only becomes style_border_side', () => {
  const left = node('div', { id: 'left', x: 0, y: 0, w: 100, h: 20, st: { borderWidth: 4, borderColor: [22, 163, 74, 255], borderSide: 'left' } });
  const right = node('div', { id: 'right', x: 0, y: 30, w: 100, h: 20, st: { borderWidth: 3, borderColor: [245, 158, 11, 255], borderSide: 'right' } });
  const top = node('div', { id: 'top', x: 0, y: 60, w: 100, h: 20, st: { borderWidth: 1, borderColor: [0, 0, 0, 255], borderSide: 'top' } });
  const frame = node('div', { id: 'frame', x: 0, y: 90, w: 100, h: 20, st: { borderWidth: 1, borderColor: [0, 0, 0, 255] } });
  const { xml } = convert(page(left, right, top, frame));
  assert.match(tagOf(xml, 'left'), /style_border_width="4" style_border_color="0x16a34a" style_border_side="left"/);
  assert.match(tagOf(xml, 'right'), /style_border_width="3" style_border_color="0xf59e0b" style_border_side="right"/);
  assert.match(tagOf(xml, 'top'), /style_border_side="top"/);
  assert.doesNotMatch(tagOf(xml, 'frame'), /border_side/);
});

test('a lone side border is a decoration: its label sits in a box', () => {
  const quote = node('div', { id: 'quote', x: 0, y: 0, w: 100, h: 28, text: 'Quote', st: { borderWidth: 4, borderColor: [22, 163, 74, 255], borderSide: 'left' } });
  const { xml } = convert(page(quote));
  assert.match(tagOf(xml, 'quote'), /<lv_obj name="quote" [^>]*style_border_side="left"/);
});
