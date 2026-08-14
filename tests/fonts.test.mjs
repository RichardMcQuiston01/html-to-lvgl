import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONT_SIZES, nearestSize, measure, lineHeight, fontName } from '../src/fonts.mjs';

test('all expected Montserrat sizes are present', () => {
  assert.deepEqual(FONT_SIZES, [10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48]);
});

test('nearestSize rounds down, never up', () => {
  assert.equal(nearestSize(13), 12);
  assert.equal(nearestSize(14), 14);
  assert.equal(nearestSize(46), 40);
  assert.equal(nearestSize(11), 10);
  assert.equal(nearestSize(8), 10); // floor of the range
});

test('measurement grows with font size and text length', () => {
  const short = measure(14, 'Hi');
  const long = measure(14, 'Hi there');
  const bigger = measure(24, 'Hi');
  assert.ok(short > 0);
  assert.ok(long > short);
  assert.ok(bigger > short);
});

test('line height comes from the font, not the CSS', () => {
  assert.equal(lineHeight(14), 16);
});

test('font names match harness registration', () => {
  assert.equal(fontName(14), 'montserrat_14');
});
