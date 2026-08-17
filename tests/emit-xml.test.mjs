import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, render } from '../src/emit-xml.mjs';

test('newlines in attribute values are encoded as character references', () => {
  // Literal newlines are normalized to spaces by XML parsers; &#10; survives.
  const xml = render(el('lv_dropdown', { options: 'A\nB\nC' }));
  assert.equal(xml, '<lv_dropdown options="A&#10;B&#10;C" />');
});

test('special characters are escaped in attributes', () => {
  const xml = render(el('lv_label', { text: 'a<b & "c"' }));
  assert.equal(xml, '<lv_label text="a&lt;b &amp; &quot;c&quot;" />');
});

test('empty and null attributes are omitted', () => {
  const xml = render(el('lv_obj', { width: 0, x: null, name: '' }));
  assert.equal(xml, '<lv_obj width="0" />');
});

test('attribute objects cannot produce duplicate attributes', () => {
  // Spread-merge has last-wins semantics — a single attribute in the output,
  // unlike the string concatenation that bit the Phase 0 spike.
  const xml = render(el('lv_obj', { ...{ style_pad_all: 0 }, ...{ style_pad_all: 8 } }));
  assert.equal(xml, '<lv_obj style_pad_all="8" />');
});
