import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinFonts, customFonts, measure } from '../src/fonts.mjs';
import { assignLabelFonts, fitsBox, FIT_TOLERANCE } from '../src/label-sizes.mjs';
import { convert } from '../src/convert.mjs';

const layout = { display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal', alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static', gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto', gridRowStart: 'auto', gridRowEnd: 'auto' };
const base = { id: null, className: '', component: null, widget: null, lvName: null, link: null, role: null, aria: {}, classes: [], testId: null, hidden: false, attrs: {}, layout };
const styles = (over = {}) => ({ bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0, radius: 0, opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, gradient: null, shadow: null, scrollable: false, pressed: null, fontSize: 12, fontFamily: 'Helvetica', fontWeight: 400, fontItalic: false, textAlign: 'start', ...over });
/** A single-line text node whose browser box is `w` px wide. */
const label = (text, w, { styles: css, ...rest } = {}) => ({ ...base, tag: 'span', text, x: 0, y: 0, w, h: 14, children: [], ...rest, styles: styles(css) });
const box = (...children) => ({ ...base, tag: 'div', x: 0, y: 0, w: 320, h: 240, children, styles: styles() });
const run = (tree, extra = {}) => {
  assignLabelFonts(tree, { fonts: builtinFonts(), displayText: (n) => n.text, isManaged: () => false, ...extra });
  return tree;
};
const sizes = (nodes) => nodes.map((n) => n.fitFont?.size);

// Box widths relative to the montserrat_12 text: too narrow at 12 (but 10 fits), or roomy.
const overflowing = (text) => measure(12, text) - FIT_TOLERANCE - 1; // too narrow at 12
const roomy = (text) => measure(12, text) + 10;

test('same CSS size, different text lengths: one shared size', () => {
  const cart = label('Cart', overflowing('Cart'));
  const delivery = label('Delivery', overflowing('Delivery'));
  const pay = label('Pay', roomy('Pay')); // fits at 12 on its own
  run(box(cart, delivery, pay));
  assert.deepEqual(sizes([cart, delivery, pay]), [10, 10, 10]);
});

test('a label that fits keeps its nominal size when every sibling fits', () => {
  const a = label('Cart', roomy('Cart'));
  const b = label('Delivery', roomy('Delivery'));
  run(box(a, b));
  assert.deepEqual(sizes([a, b]), [12, 12]);
});

test('a long label that never fits rides along with the group, one step only', () => {
  const short = label('Hi', roomy('Hi'));
  const gains = label('Cart', overflowing('Cart'));
  const long = label('A much longer caption than the box', 20); // does not fit even at 10
  run(box(short, gains, long));
  assert.deepEqual(sizes([short, gains, long]), [10, 10, 10]); // never below montserrat_10's single step
});

test('no label gains from a smaller size: nominal size is kept', () => {
  // Overflows at 12 and at 10, so stepping down would shrink text for nothing.
  const a = label('Overflowing caption', 5);
  const b = label('Another overflowing one', 5);
  run(box(a, b));
  assert.deepEqual(sizes([a, b]), [12, 12]);
});

test('the same group is page-wide: labels in different parents are merged', () => {
  const cart = label('Cart', overflowing('Cart'));
  const pay = label('Pay', roomy('Pay'));
  run(box(box(cart), box(box(pay))));
  assert.deepEqual(sizes([cart, pay]), [10, 10]);
});

test('different CSS sizes, weights or families are separate groups', () => {
  const small = label('Cart', overflowing('Cart'));
  const big = label('Pay', roomy('Pay'), { styles: { fontSize: 13 } });
  const bold = label('Pay', roomy('Pay'), { styles: { fontWeight: 700 } });
  const serif = label('Pay', roomy('Pay'), { styles: { fontFamily: 'Georgia' } });
  run(box(small, big, bold, serif));
  assert.deepEqual(sizes([small, big, bold, serif]), [10, 12, 12, 12]);
});

test('centered and right-aligned labels take part in the group', () => {
  const left = label('Cart', overflowing('Cart'));
  const centered = label('Pay', roomy('Pay'), { styles: { textAlign: 'center' } });
  const right = label('Done', roomy('Done'), { styles: { textAlign: 'right' } });
  run(box(left, centered, right));
  assert.deepEqual(sizes([left, centered, right]), [10, 10, 10]);
});

test('flex-managed labels and multi-line labels are left out', () => {
  const free = label('Cart', overflowing('Cart'));
  const managed = label('Pay', roomy('Pay'));
  const wrapped = label('Two lines of text', 30, { h: 30 });
  run(box(free, managed, wrapped), { isManaged: (n) => n === managed });
  assert.equal(managed.fitFont, undefined);
  assert.equal(wrapped.fitFont, undefined);
  assert.equal(free.fitFont.size, 10);
});

test('text-transform is measured as rendered', () => {
  const upper = label('undo', measure(12, 'undo') + 10);
  // UNDO is wider than undo, so it no longer fits at 12.
  run(box(upper), { displayText: (n) => n.text.toUpperCase() });
  const rendered = 'UNDO';
  assert.equal(fitsBox(builtinFonts().for(styles()), rendered, upper.w), measure(12, rendered) <= upper.w + FIT_TOLERANCE);
});

test('custom fonts are untouched: they are exact and have no smaller size', () => {
  const adv = Object.fromEntries([...'CartPay'].map((c) => [c.codePointAt(0), 30]));
  const fonts = customFonts([{ family: 'Helvetica', weight: 400, italic: false, size: 12, key: 'helvetica_12', adv }]);
  const cart = label('Cart', 10);
  run(box(cart), { fonts });
  assert.equal(cart.fitFont, undefined);
});

test('end to end: sibling steps render at one size and Pay no longer differs', () => {
  const step = (text, w, x) => ({ ...base, tag: 'div', x, y: 0, w: 90, h: 30, children: [label(text, w)], styles: styles() });
  const tree = {
    ...base, tag: 'body', x: 0, y: 0, w: 320, h: 240, styles: styles(),
    children: [step('Cart', overflowing('Cart'), 0), step('Delivery', overflowing('Delivery'), 100), step('Pay', roomy('Pay'), 200)],
  };
  const { xml } = convert(tree, { name: 'steps' });
  for (const text of ['Cart', 'Delivery', 'Pay']) assert.match(xml, new RegExp(`text="${text}"[^>]*style_text_font="montserrat_10"`));
  assert.doesNotMatch(xml, /text="Pay"[^>]*montserrat_12/);
});

test('fitsBox honours the tolerance', () => {
  const font = builtinFonts().for(styles());
  const w = font.measure('Cart');
  assert.ok(fitsBox(font, 'Cart', w));
  assert.ok(fitsBox(font, 'Cart', w - FIT_TOLERANCE));
  assert.ok(!fitsBox(font, 'Cart', w - FIT_TOLERANCE - 1));
});
