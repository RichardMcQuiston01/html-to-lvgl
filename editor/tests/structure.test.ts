import { describe, expect, it } from 'vitest';
import {
  addedNames, addOperations, allNames, effectiveView, insertionPoint, movedNames, planDrop, planStep, positionOf, uniqueName, WIDGET_KINDS,
  withAddedWidgets, withOperation, withoutAddedWidget, type MovePlan,
} from '../src/lib/structure';
import { countDifferences, countEdits, emptySidecar, isEmptySidecar, withAttr, withRemoved, withStructure } from '../src/lib/sidecar';
import { flattenTree } from '../src/lib/irTree';
import type { IrNode, SidecarOverrides } from '../src/lib/types';

const node = (tag: string, name: string | null, children: IrNode[] = [], attrs: IrNode['attrs'] = {}): IrNode => ({
  tag,
  attrs: { ...(name === null ? {} : { name }), ...attrs },
  children,
});
/** page > [a, panel > [b, c], label, row(flex) > [chip]] */
const page = (): IrNode =>
  node('view', null, [
    node('lv_obj', 'a'),
    node('lv_obj', 'panel', [node('lv_obj', 'b'), node('lv_obj', 'c')]),
    node('lv_label', 'label', [], { text: 'Hi' }),
    node('lv_obj', 'row', [node('lv_obj', 'chip')], { flex_flow: 'row' }),
  ]);
const shape = (n: IrNode, depth = 0): string[] =>
  (typeof n.attrs['name'] === 'string' ? [`${'-'.repeat(depth)}${String(n.attrs['name'])}`] : []).concat(n.children.flatMap((c) => shape(c, typeof n.attrs['name'] === 'string' ? depth + 1 : depth)));

/** Carry out a plan as a move operation and return the resulting tree shape. */
const applyPlan = (name: string, plan: MovePlan, sidecar: SidecarOverrides = emptySidecar()): string[] => {
  if (!plan.ok) throw new Error(`plan refused: ${plan.reason}`);
  const next = withOperation(sidecar, { op: 'move', name, parent: plan.parent, index: plan.index });
  return shape(effectiveView(page(), next).view);
};

describe('effectiveView', () => {
  it('is the page itself when there is no structure', () => {
    const view = page();
    expect(effectiveView(view, emptySidecar())).toEqual({ view, problems: [] });
  });

  it('applies the converter\'s own operations and reports the ones it skips', () => {
    const sidecar = withStructure(emptySidecar(), [
      { op: 'add', name: 'n', tag: 'lv_label', parent: 'panel', index: 0 },
      { op: 'move', name: 'gone', parent: null, index: 0 },
    ]);
    const result = effectiveView(page(), sidecar);
    expect(shape(result.view)).toEqual(['a', 'panel', '-n', '-b', '-c', 'label', 'row', '-chip']);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/no widget named "gone"/);
  });

  it('does not change the page it was given', () => {
    const view = page();
    const before = JSON.stringify(view);
    effectiveView(view, withStructure(emptySidecar(), [{ op: 'move', name: 'a', parent: 'panel', index: 0 }]));
    expect(JSON.stringify(view)).toBe(before);
  });
});

describe('the structure list in a sidecar', () => {
  it('is version 2 with operations and back to 1 without, and counts as edits', () => {
    const move = { op: 'move', name: 'a', parent: null, index: 1 } as const;
    const withMove = withOperation(emptySidecar(), move);
    expect(withMove.version).toBe(2);
    expect(countEdits(withMove)).toBe(1);
    expect(isEmptySidecar(withMove)).toBe(false);
    const cleared = withStructure(withMove, []);
    expect(cleared.version).toBe(1);
    expect('structure' in cleared).toBe(false);
    expect(isEmptySidecar(cleared)).toBe(true);
  });

  it('a sidecar with only attribute edits stays version 1', () => {
    expect(withAttr(emptySidecar(), 'a', 'width', 5).version).toBe(1);
  });

  it('coalesces a move straight after a move of the same widget, but keeps the trail otherwise', () => {
    let sidecar = withOperation(emptySidecar(), { op: 'move', name: 'a', parent: null, index: 1 });
    sidecar = withOperation(sidecar, { op: 'move', name: 'a', parent: 'panel', index: 0 });
    expect(sidecar.structure).toEqual([{ op: 'move', name: 'a', parent: 'panel', index: 0 }]);
    sidecar = withOperation(sidecar, { op: 'move', name: 'label', parent: null, index: 0 });
    sidecar = withOperation(sidecar, { op: 'move', name: 'a', parent: null, index: 0 });
    expect(sidecar.structure).toHaveLength(3);
  });

  it('counts structure operations as differences between two sidecars', () => {
    const base = withOperation(emptySidecar(), { op: 'move', name: 'a', parent: null, index: 1 });
    expect(countDifferences(base, emptySidecar())).toBe(1);
    expect(countDifferences(withOperation(base, { op: 'move', name: 'label', parent: null, index: 0 }), base)).toBe(1);
    expect(countDifferences(base, base)).toBe(0);
  });

  it('lists the widgets added and moved', () => {
    const sidecar = withStructure(emptySidecar(), [
      { op: 'add', name: 'n', tag: 'lv_obj', parent: null, index: 0 },
      { op: 'move', name: 'a', parent: null, index: 1 },
    ]);
    expect([...addedNames(sidecar)]).toEqual(['n']);
    expect([...movedNames(sidecar)]).toEqual(['a']);
  });
});

describe('taking back an added widget', () => {
  const base = (): SidecarOverrides => {
    let sidecar = withAddedWidgets(emptySidecar(), [
      { op: 'add', name: 'box', tag: 'lv_obj', parent: null, index: 0 },
      { op: 'add', name: 'inner', tag: 'lv_label', parent: 'box', index: 0 },
      { op: 'add', name: 'other', tag: 'lv_obj', parent: null, index: 1 },
    ]);
    sidecar = withOperation(sidecar, { op: 'move', name: 'a', parent: 'box', index: 0 }); // an original widget moved into the added one
    sidecar = withOperation(sidecar, { op: 'move', name: 'other', parent: null, index: 0 });
    sidecar = withAttr(sidecar, 'inner', 'text', 'edited');
    sidecar = withAttr(sidecar, 'b', 'width', 7);
    return sidecar;
  };

  it('removes the add, what was added inside, every move of them, moves into it, and their overrides', () => {
    const result = withoutAddedWidget(base(), 'box');
    expect(result.structure).toEqual([
      { op: 'add', name: 'other', tag: 'lv_obj', parent: null, index: 1 },
      { op: 'move', name: 'other', parent: null, index: 0 },
    ]);
    // the override on a widget that remains is kept; the one on "inner" is gone
    expect(Object.keys(result.nodes)).toEqual(['b']);
    expect(result.version).toBe(2);
  });

  it('leaves a clean version 1 sidecar when it was the only structure', () => {
    const only = withAddedWidgets(emptySidecar(), [{ op: 'add', name: 'x', tag: 'lv_obj', parent: null, index: 0 }]);
    const result = withoutAddedWidget(only, 'x');
    expect(isEmptySidecar(result)).toBe(true);
    expect(result.version).toBe(1);
  });

  it('keeps a removal mark on an original widget (that is a different edit)', () => {
    const sidecar = withRemoved(withAddedWidgets(emptySidecar(), [{ op: 'add', name: 'x', tag: 'lv_obj', parent: null, index: 0 }]), 'a', true);
    expect(withoutAddedWidget(sidecar, 'x').nodes).toEqual({ a: { remove: true } });
  });
});

describe('positionOf', () => {
  it('says where a widget is and who holds it', () => {
    expect(positionOf(page(), 'a')).toMatchObject({ parentName: null, index: 0 });
    expect(positionOf(page(), 'c')).toMatchObject({ parentName: 'panel', index: 1 });
    expect(positionOf(page(), 'nothing')).toBeNull();
  });

  it('marks a holder without a name', () => {
    const view = node('view', null, [node('lv_obj', null, [node('lv_obj', 'x')])]);
    expect(positionOf(view, 'x')?.parentName).toBeUndefined();
  });
});

describe('planStep (the four buttons)', () => {
  it('up and down change the index within the same parent', () => {
    expect(planStep(page(), 'c', 'up')).toEqual({ ok: true, parent: 'panel', index: 0, unchanged: false });
    expect(planStep(page(), 'b', 'down')).toEqual({ ok: true, parent: 'panel', index: 1, unchanged: false });
    expect(applyPlan('c', planStep(page(), 'c', 'up'))).toEqual(['a', 'panel', '-c', '-b', 'label', 'row', '-chip']);
    expect(applyPlan('a', planStep(page(), 'a', 'down'))).toEqual(['panel', '-b', '-c', 'a', 'label', 'row', '-chip']);
  });

  it('refuses up at the top and down at the end, with the reason', () => {
    expect(planStep(page(), 'a', 'up')).toEqual({ ok: false, reason: 'already first' });
    expect(planStep(page(), 'row', 'down')).toEqual({ ok: false, reason: 'already last' });
  });

  it('out puts the widget right after its parent', () => {
    expect(applyPlan('b', planStep(page(), 'b', 'out'))).toEqual(['a', 'panel', '-c', 'b', 'label', 'row', '-chip']);
    expect(planStep(page(), 'a', 'out')).toEqual({ ok: false, reason: 'already directly on the page' });
  });

  it('in makes the widget the last child of the one before it', () => {
    expect(planStep(page(), 'label', 'in')).toEqual({ ok: true, parent: 'panel', index: 2, unchanged: false });
    expect(applyPlan('label', planStep(page(), 'label', 'in'))).toEqual(['a', 'panel', '-b', '-c', '-label', 'row', '-chip']);
    expect(planStep(page(), 'b', 'in')).toEqual({ ok: false, reason: 'there is no widget before it to move into' });
  });

  it('in refuses a widget that cannot hold others, with the reason', () => {
    const plan = planStep(page(), 'row', 'in'); // the widget before row is the label
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/label is a lv_label, which cannot hold other widgets/);
  });

  it('refuses when the parent has no name, because the move could not be saved', () => {
    const view = node('view', null, [node('lv_obj', null, [node('lv_obj', 'x'), node('lv_obj', 'y')])]);
    const plan = planStep(view, 'y', 'up');
    expect(!plan.ok && plan.reason).toMatch(/parent has no name/);
  });
});

describe('planDrop (dragging in the tree)', () => {
  it('before and after a sibling', () => {
    expect(applyPlan('label', planDrop(page(), 'label', 'a', 'before'))).toEqual(['label', 'a', 'panel', '-b', '-c', 'row', '-chip']);
    expect(applyPlan('a', planDrop(page(), 'a', 'label', 'after'))).toEqual(['panel', '-b', '-c', 'label', 'a', 'row', '-chip']);
  });

  it('counts the parent\'s children with the dragged widget taken out', () => {
    // a is first; dropping it "after panel" is index 1 of [panel, label, row]
    expect(planDrop(page(), 'a', 'panel', 'after')).toEqual({ ok: true, parent: null, index: 1, unchanged: false });
    // b is first of [b, c]; dropping it after c is index 1 of [c]
    expect(planDrop(page(), 'b', 'c', 'after')).toEqual({ ok: true, parent: 'panel', index: 1, unchanged: false });
  });

  it('into a container puts it last, and into the page (null target)', () => {
    expect(applyPlan('a', planDrop(page(), 'a', 'panel', 'into'))).toEqual(['panel', '-b', '-c', '-a', 'label', 'row', '-chip']);
    expect(applyPlan('b', planDrop(page(), 'b', null, 'into'))).toEqual(['a', 'panel', '-c', 'label', 'row', '-chip', 'b']);
  });

  it('recognises a drop that changes nothing', () => {
    expect(planDrop(page(), 'a', 'panel', 'before')).toMatchObject({ ok: true, unchanged: true });
    expect(planDrop(page(), 'c', 'panel', 'into')).toMatchObject({ ok: true, unchanged: true });
  });

  it('refuses a drop on itself, inside itself, or into a widget that cannot hold others', () => {
    const own = planDrop(page(), 'panel', 'panel', 'into');
    expect(!own.ok && own.reason).toMatch(/itself/);
    const inside = planDrop(page(), 'panel', 'b', 'into');
    expect(!inside.ok && inside.reason).toMatch(/b is inside panel|inside panel/);
    const insideBefore = planDrop(page(), 'panel', 'b', 'before');
    expect(!insideBefore.ok && insideBefore.reason).toMatch(/inside panel/);
    const leaf = planDrop(page(), 'a', 'label', 'into');
    expect(!leaf.ok && leaf.reason).toMatch(/label is a lv_label/);
  });

  it('refuses a drop whose parent has no name', () => {
    const view = node('view', null, [node('lv_obj', 'a'), node('lv_obj', null, [node('lv_obj', 'x')])]);
    const plan = planDrop(view, 'a', 'x', 'before');
    expect(!plan.ok && plan.reason).toMatch(/has no name/);
  });
});

describe('every plan, applied by the converter\'s own function, lands where it said', () => {
  it('for every widget, every step and every drop zone', () => {
    const names = [...allNames(page())];
    for (const name of names) {
      for (const step of ['up', 'down', 'out', 'in'] as const) {
        const plan = planStep(page(), name, step);
        if (!plan.ok) continue;
        const after = effectiveView(page(), withOperation(emptySidecar(), { op: 'move', name, parent: plan.parent, index: plan.index }));
        expect(after.problems, `${name} ${step}`).toEqual([]);
        const landed = positionOf(after.view, name);
        expect([landed?.parentName, landed?.index], `${name} ${step}`).toEqual([plan.parent, plan.index]);
      }
      for (const target of [null, ...names]) {
        for (const zone of ['before', 'after', 'into'] as const) {
          const plan = planDrop(page(), name, target, zone);
          if (!plan.ok) continue;
          const after = effectiveView(page(), withOperation(emptySidecar(), { op: 'move', name, parent: plan.parent, index: plan.index }));
          expect(after.problems, `${name} ${String(target)} ${zone}`).toEqual([]);
          const landed = positionOf(after.view, name);
          expect([landed?.parentName, landed?.index], `${name} ${String(target)} ${zone}`).toEqual([plan.parent, plan.index]);
        }
      }
    }
  });
});

describe('adding widgets', () => {
  it('makes unique names', () => {
    expect(uniqueName('label', new Set(['a']))).toBe('label');
    expect(uniqueName('label', new Set(['label']))).toBe('label_2');
    expect(uniqueName('label', new Set(['label', 'label_2', 'label_3']))).toBe('label_4');
  });

  it('a label is one operation; a button is two (the button and its label)', () => {
    const label = WIDGET_KINDS.find((k) => k.tag === 'lv_label')!;
    const button = WIDGET_KINDS.find((k) => k.tag === 'lv_button')!;
    expect(addOperations(label, null, 0, new Set(), false)).toEqual([{ op: 'add', name: 'label', tag: 'lv_label', parent: null, index: 0, attrs: { text: 'Label', x: 10, y: 10 } }]);
    const two = addOperations(button, 'panel', 2, new Set(['button']), false);
    expect(two.map((o) => [o.name, o.tag, o.parent])).toEqual([['button_2', 'lv_button', 'panel'], ['button_2_label', 'lv_label', 'button_2']]);
  });

  it('a widget in a flex parent gets no starting position', () => {
    const box = WIDGET_KINDS.find((k) => k.tag === 'lv_obj')!;
    const [op] = addOperations(box, 'row', 0, new Set(), true);
    expect(op && 'attrs' in op ? Object.keys(op.attrs ?? {}) : []).not.toContain('x');
  });

  it('every kind the editor offers is a valid, applicable operation', () => {
    for (const kind of WIDGET_KINDS) {
      const operations = addOperations(kind, null, 0, allNames(page()), false);
      const result = effectiveView(page(), withAddedWidgets(emptySidecar(), operations));
      expect(result.problems, kind.tag).toEqual([]);
      expect(allNames(result.view).has(operations[0]!.name)).toBe(true);
    }
  });

  it('puts a new widget inside the selected container, after the selected leaf, or at the end of the page', () => {
    const view = page();
    expect(insertionPoint(view, 'panel')).toMatchObject({ parent: 'panel', index: 2 });
    expect(insertionPoint(view, 'label')).toMatchObject({ parent: null, index: 3 });
    expect(insertionPoint(view, 'c')).toMatchObject({ parent: 'c', index: 0 }); // c is a box, so it holds the new widget
    expect(insertionPoint(view, null)).toMatchObject({ parent: null, index: 4 });
  });

  it('there is nowhere to put a widget next to a widget whose parent has no name', () => {
    const view = node('view', null, [node('lv_obj', null, [node('lv_label', 'x')])]);
    expect(insertionPoint(view, 'x')).toBeNull();
  });
});

describe('the tree shows the structure', () => {
  it('rows follow the effective tree, with an added widget in its place', () => {
    const sidecar = withStructure(emptySidecar(), [{ op: 'add', name: 'note', tag: 'lv_label', parent: 'panel', index: 1 }]);
    const names = flattenTree(effectiveView(page(), sidecar).view).map((row) => row.name);
    expect(names).toEqual([null, 'a', 'panel', 'b', 'note', 'c', 'label', 'row', 'chip']);
  });
});
