import { describe, expect, it } from 'vitest';
import {
  attrKeyProblem, countDifferences, countEdits, cssToHex, effectiveAttrs, emptySidecar, hexToCss, isColorKey, isEmptySidecar, isRemoved,
  knownAttrKeys, parseAttrInput, removedRowIds, sidecarsEqual, withAttr, withoutAttr, withRemoved,
} from '../src/lib/sidecar';
import { flattenTree } from '../src/lib/irTree';
import type { IrNode } from '../src/lib/types';

const node = (attrs: IrNode['attrs'], children: IrNode[] = []): IrNode => ({ tag: 'lv_obj', attrs, children });

describe('editing a sidecar', () => {
  it('sets an attribute without touching the original', () => {
    const before = emptySidecar();
    const after = withAttr(before, 'card', 'width', 200);
    expect(after.nodes).toEqual({ card: { attrs: { width: 200 } } });
    expect(before.nodes).toEqual({});
  });

  it('forgetting the last override removes the node entry, so an undone edit leaves an empty sidecar', () => {
    const edited = withAttr(emptySidecar(), 'card', 'width', 200);
    const cleared = withoutAttr(edited, 'card', 'width');
    expect(cleared.nodes).toEqual({});
    expect(isEmptySidecar(cleared)).toBe(true);
    expect(sidecarsEqual(cleared, emptySidecar())).toBe(true);
  });

  it('keeps other overrides when one is forgotten', () => {
    let sidecar = withAttr(emptySidecar(), 'card', 'width', 200);
    sidecar = withAttr(sidecar, 'card', 'height', 50);
    sidecar = withoutAttr(sidecar, 'card', 'width');
    expect(sidecar.nodes).toEqual({ card: { attrs: { height: 50 } } });
  });

  it('forgetting an override that is not there returns the same sidecar', () => {
    const sidecar = withAttr(emptySidecar(), 'card', 'width', 1);
    expect(withoutAttr(sidecar, 'card', 'nope')).toBe(sidecar);
    expect(withoutAttr(sidecar, 'other', 'width')).toBe(sidecar);
  });

  it('null means remove the attribute and is kept as null', () => {
    expect(withAttr(emptySidecar(), 'label', 'text', null).nodes).toEqual({ label: { attrs: { text: null } } });
  });

  it('removes and restores a node; restoring drops the entry', () => {
    const removed = withRemoved(emptySidecar(), 'stop', true);
    expect(removed.nodes).toEqual({ stop: { remove: true } });
    expect(isRemoved(removed, 'stop')).toBe(true);
    expect(isRemoved(removed, 'start')).toBe(false);
    expect(isRemoved(removed, null)).toBe(false);
    expect(withRemoved(removed, 'stop', false).nodes).toEqual({});
  });

  it('restoring a node keeps its attribute overrides', () => {
    let sidecar = withAttr(emptySidecar(), 'stop', 'width', 9);
    sidecar = withRemoved(sidecar, 'stop', true);
    expect(withRemoved(sidecar, 'stop', false).nodes).toEqual({ stop: { attrs: { width: 9 } } });
  });

  it('counts each attribute override and each removal', () => {
    let sidecar = withAttr(emptySidecar(), 'a', 'x', 1);
    sidecar = withAttr(sidecar, 'a', 'y', 2);
    sidecar = withRemoved(sidecar, 'b', true);
    expect(countEdits(sidecar)).toBe(3);
  });

  it('counts how many single changes differ between two sidecars', () => {
    const saved = withRemoved(withAttr(withAttr(emptySidecar(), 'card', 'height', 90), 'card', 'style_radius', 20), 'stop', true);
    expect(countDifferences(saved, saved)).toBe(0);
    expect(countDifferences(withAttr(saved, 'card', 'height', 70), saved)).toBe(1); // same key, another value
    expect(countDifferences(withAttr(saved, 'card', 'width', 5), saved)).toBe(1); // one added
    expect(countDifferences(withoutAttr(saved, 'card', 'height'), saved)).toBe(1); // one forgotten
    expect(countDifferences(emptySidecar(), saved)).toBe(3);
    expect(countDifferences(saved, emptySidecar())).toBe(3);
    expect(countDifferences(withRemoved(saved, 'stop', false), saved)).toBe(1);
  });

  it('compares sidecars by meaning, not key order', () => {
    const a = { version: 1 as const, nodes: { a: { attrs: { x: 1, y: 2 } }, b: { remove: true } } };
    const b = { version: 1 as const, nodes: { b: { remove: true }, a: { attrs: { y: 2, x: 1 } } } };
    expect(sidecarsEqual(a, b)).toBe(true);
    expect(sidecarsEqual(a, withAttr(a, 'a', 'x', 3))).toBe(false);
  });
});

describe('effectiveAttrs', () => {
  const card = node({ name: 'card', width: 114, text: 'hi' });

  it('shows the page values when there is no override', () => {
    expect(effectiveAttrs(card, emptySidecar()).map((a) => [a.key, a.value, a.overridden])).toEqual([
      ['name', 'card', false], ['width', 114, false], ['text', 'hi', false],
    ]);
  });

  it('shows an override, a removal and an added attribute', () => {
    let sidecar = withAttr(emptySidecar(), 'card', 'width', 200);
    sidecar = withAttr(sidecar, 'card', 'text', null);
    sidecar = withAttr(sidecar, 'card', 'style_radius', 8);
    const rows = effectiveAttrs(card, sidecar);
    expect(rows.find((r) => r.key === 'width')).toMatchObject({ base: 114, value: 200, overridden: true });
    expect(rows.find((r) => r.key === 'text')).toMatchObject({ base: 'hi', value: undefined, overridden: true });
    expect(rows.find((r) => r.key === 'style_radius')).toMatchObject({ base: undefined, value: 8, overridden: true });
    expect(rows.at(-1)?.key).toBe('style_radius');
  });

  it('a node without a name has no overrides to show', () => {
    expect(effectiveAttrs(node({ width: 1 }), withAttr(emptySidecar(), 'x', 'width', 9))[0]).toMatchObject({ value: 1, overridden: false });
  });
});

describe('attribute input', () => {
  it('keeps the type of an existing attribute', () => {
    expect(parseAttrInput('120', 114)).toEqual({ ok: true, value: 120 });
    expect(parseAttrInput(' 1.5 ', 2)).toEqual({ ok: true, value: 1.5 });
    expect(parseAttrInput('abc', 114)).toEqual({ ok: false, message: '"abc" is not a number' });
    expect(parseAttrInput('', 114).ok).toBe(false);
    expect(parseAttrInput('true', false)).toEqual({ ok: true, value: true });
    expect(parseAttrInput('yes', true).ok).toBe(false);
    expect(parseAttrInput('0xff0000', 'x')).toEqual({ ok: true, value: '0xff0000' });
    expect(parseAttrInput('120', '100')).toEqual({ ok: true, value: '120' });
  });

  it('guesses the type of a new attribute, and 0x colours stay text', () => {
    expect(parseAttrInput('12', undefined)).toEqual({ ok: true, value: 12 });
    expect(parseAttrInput('-3', undefined)).toEqual({ ok: true, value: -3 });
    expect(parseAttrInput('false', undefined)).toEqual({ ok: true, value: false });
    expect(parseAttrInput('0xff0000', undefined)).toEqual({ ok: true, value: '0xff0000' });
    expect(parseAttrInput('Start', undefined)).toEqual({ ok: true, value: 'Start' });
  });

  it('checks attribute names', () => {
    expect(attrKeyProblem('width')).toBeNull();
    expect(attrKeyProblem('style_bg_color:pressed')).toBeNull();
    expect(attrKeyProblem('')).toMatch(/type/);
    expect(attrKeyProblem('name')).toMatch(/cannot be changed/);
    expect(attrKeyProblem('bad key')).toMatch(/letters, digits/);
    expect(attrKeyProblem('1x')).toMatch(/letters, digits/);
  });

  it('converts colours both ways', () => {
    expect(isColorKey('style_bg_color')).toBe(true);
    expect(isColorKey('style_text_color:pressed')).toBe(true);
    expect(isColorKey('width')).toBe(false);
    expect(hexToCss('0xF1F5F9')).toBe('#f1f5f9');
    expect(hexToCss('red')).toBeNull();
    expect(hexToCss(5)).toBeNull();
    expect(cssToHex('#0F172A')).toBe('0x0f172a');
  });
});

describe('tree helpers', () => {
  const tree = node({}, [node({ name: 'a' }, [node({ name: 'a1' })]), node({ name: 'b' })]);

  it('marks a removed node and its whole subtree', () => {
    const rows = flattenTree(tree);
    const removed = removedRowIds(rows, withRemoved(emptySidecar(), 'a', true));
    expect([...removed].sort()).toEqual(['root.0', 'root.0.0']);
  });

  it('lists the attribute names used in the tree, sorted, without name', () => {
    const t = node({ name: 'x', width: 1 }, [node({ style_radius: 2, width: 3 })]);
    expect(knownAttrKeys(t)).toEqual(['style_radius', 'width']);
  });
});
