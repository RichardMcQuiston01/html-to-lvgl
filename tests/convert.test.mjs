/**
 * Golden-file tests: converting each committed extraction fixture must
 * reproduce the committed LVGL XML exactly. No browser needed.
 *
 * On an intentional converter change, refresh with `npm run golden:update`
 * and review the XML diff like any other code change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../src/convert.mjs';
import { emitC } from '../src/emit-c.mjs';
import { optimize } from '../src/optimize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.json'));

assert.ok(fixtures.length >= 4, 'expected at least 4 fixtures');

for (const file of fixtures) {
  const name = file.replace(/\.json$/, '');
  test(`golden xml: ${name}`, () => {
    const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
    const { xml } = convert(tree, { name });
    const golden = readFileSync(join(here, 'golden', `${name}.xml`), 'utf8');
    assert.equal(xml, golden);
  });

  test(`golden c: ${name}`, () => {
    const tree = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8'));
    const { view } = convert(tree, { name });
    const { c, h, unit } = emitC(view, { name });
    assert.equal(c, readFileSync(join(here, 'golden-c', `${unit}.c`), 'utf8'));
    assert.equal(h, readFileSync(join(here, 'golden-c', `${unit}.h`), 'utf8'));
  });
}

test('warnings surface unsupported tags', () => {
  const tree = {
    tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {},
    styles: base(), layout: block(),
    children: [
      { tag: 'canvas', x: 0, y: 0, w: 100, h: 100, text: null, attrs: {}, styles: base(), layout: block(), children: [] },
    ],
  };
  const { warnings, xml } = convert(tree);
  assert.ok(warnings.some((w) => w.includes('<canvas>')));
  assert.ok(!xml.includes('canvas'));
});

test('optimizer collapses inert single-child wrappers', () => {
  const label = { tag: 'span', x: 10, y: 10, w: 50, h: 12, text: 'hi', attrs: {}, styles: base(), layout: block(), children: [] };
  const wrapper = { tag: 'div', x: 5, y: 5, w: 100, h: 20, text: null, attrs: {}, styles: base(), layout: block(), children: [label] };
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [wrapper] };
  const { tree: out, removed } = optimize(structuredClone(tree));
  assert.equal(removed, 1);
  assert.equal(out.children[0].tag, 'span'); // wrapper gone, label hoisted
});

test('optimizer keeps wrappers that carry visuals or manage layout', () => {
  const label = { tag: 'span', x: 10, y: 10, w: 50, h: 12, text: 'hi', attrs: {}, styles: base(), layout: block(), children: [] };
  const styled = { tag: 'div', x: 5, y: 5, w: 100, h: 20, text: null, attrs: {}, styles: { ...base(), bgColor: [255, 0, 0, 255] }, layout: block(), children: [label] };
  const flex = { tag: 'div', x: 5, y: 30, w: 100, h: 20, text: null, attrs: {}, styles: base(), layout: { ...block(), display: 'flex' }, children: [structuredClone(label)] };
  const tree = { tag: 'body', x: 0, y: 0, w: 320, h: 240, text: null, attrs: {}, styles: base(), layout: block(), children: [styled, flex] };
  const { removed } = optimize(structuredClone(tree));
  assert.equal(removed, 0);
});

function base() {
  return {
    bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null,
  };
}
function block() {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto',
  };
}
