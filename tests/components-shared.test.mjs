import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classesOf, muiRoots, hasMuiRoot, hasClass, ariaOf, withName } from '../src/components/shared.mjs';

const node = (extra = {}) => ({ tag: 'div', className: null, lvName: null, children: [], ...extra });

test('classesOf prefers the full list and falls back to the first class', () => {
  assert.deepEqual(classesOf(node({ classes: ['a', 'b'], className: 'a' })), ['a', 'b']);
  assert.deepEqual(classesOf(node({ className: 'a' })), ['a']);
  assert.deepEqual(classesOf(node()), []);
});

test('muiRoots lists every Material UI component the element is the root of', () => {
  const card = node({ classes: ['MuiPaper-root', 'MuiCard-root', 'MuiCard-outlined', 'css-1abc'] });
  assert.deepEqual(muiRoots(card), ['Paper', 'Card']);
  assert.ok(hasMuiRoot(card, 'Card'));
  assert.ok(!hasMuiRoot(card, 'Alert'));
  assert.deepEqual(muiRoots(node({ classes: ['MuiButton-label'] })), []);
});

test('hasClass, ariaOf and withName', () => {
  assert.ok(hasClass(node({ classes: ['card'] }), 'card', 'panel'));
  assert.ok(!hasClass(node({ classes: ['x'] }), 'card'));
  assert.equal(ariaOf(node({ aria: { label: 'hi' } }), 'label'), 'hi');
  assert.equal(ariaOf(node(), 'label'), undefined);
  assert.equal(withName(node(), 'card').lvName, 'card');
  assert.equal(withName(node({ lvName: 'mine' }), 'card').lvName, 'mine');
});
