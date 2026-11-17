import { describe, expect, it } from 'vitest';
import { alignSigns, availableHandles, layoutInfo, MIN_SIZE, planDrag } from '../src/lib/geometry';
import type { IrNode } from '../src/lib/types';

const node = (attrs: IrNode['attrs']): IrNode => ({ tag: 'lv_obj', attrs, children: [] });
const absoluteParent = node({ name: 'page' });
const flexRow = node({ name: 'row', flex_flow: 'row' });
const flexColumn = node({ name: 'col', flex_flow: 'column' });

describe('alignSigns', () => {
  it('follows the direction an offset grows for each alignment', () => {
    expect(alignSigns(undefined)).toEqual({ sx: 1, sy: 1 });
    expect(alignSigns('top_left')).toEqual({ sx: 1, sy: 1 });
    expect(alignSigns('center')).toEqual({ sx: 1, sy: 1 });
    expect(alignSigns('bottom_right')).toEqual({ sx: -1, sy: -1 });
    expect(alignSigns('top_right')).toEqual({ sx: -1, sy: 1 });
    expect(alignSigns('bottom_mid')).toEqual({ sx: 1, sy: -1 });
    expect(alignSigns('right_mid')).toEqual({ sx: -1, sy: 1 });
  });

  it('gives up on alignments measured from another widget', () => {
    expect(alignSigns('out_top_mid')).toBeNull();
    expect(alignSigns(5)).toBeNull();
  });
});

describe('layoutInfo', () => {
  it('lets a child of a plain parent move and resize', () => {
    const info = layoutInfo(absoluteParent, node({ name: 'a', x: 1, y: 2 }));
    expect(info).toMatchObject({ canMove: true, canResizeWidth: true, canResizeHeight: true, moveReason: null });
  });

  it('forbids moving a flex child, and says why, but lets it resize', () => {
    const info = layoutInfo(flexRow, node({ name: 'chip' }));
    expect(info.canMove).toBe(false);
    expect(info.moveReason).toMatch(/chip is placed by its parent's flex layout/);
    expect(info.canResizeWidth && info.canResizeHeight).toBe(true);
  });

  it('forbids moving a grid child', () => {
    expect(layoutInfo(node({ grid_dsc: 'x' }), node({ name: 'g' })).moveReason).toMatch(/grid layout/);
  });

  it('locks the axis a flex_grow child is stretched along', () => {
    const inRow = layoutInfo(flexRow, node({ name: 'card', flex_grow: 1 }));
    expect(inRow.canResizeWidth).toBe(false);
    expect(inRow.widthReason).toMatch(/fills the row with flex_grow/);
    expect(inRow.canResizeHeight).toBe(true);
    const inColumn = layoutInfo(flexColumn, node({ name: 'card', flex_grow: 1 }));
    expect(inColumn.canResizeHeight).toBe(false);
    expect(inColumn.canResizeWidth).toBe(true);
    expect(layoutInfo(flexRow, node({ name: 'card', flex_grow: 0 })).canResizeWidth).toBe(true);
  });

  it('treats the root (no parent) as fixed', () => {
    const info = layoutInfo(null, node({ name: 'page' }));
    expect(info.canMove || info.canResizeWidth || info.canResizeHeight).toBe(false);
  });

  it('refuses a drag for a position that is not in pixels', () => {
    const info = layoutInfo(absoluteParent, node({ name: 'a', x: '50%' }));
    expect(info.canMove).toBe(false);
    expect(info.moveReason).toMatch(/not a pixel value/);
  });

  it('lists the handles that make sense', () => {
    expect(availableHandles(layoutInfo(absoluteParent, node({ name: 'a' }))).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    expect(availableHandles(layoutInfo(flexRow, node({ name: 'a' }))).sort()).toEqual(['e', 's', 'se']);
    expect(availableHandles(layoutInfo(flexRow, node({ name: 'a', flex_grow: 1 }))).sort()).toEqual(['s', 'se']);
    expect(availableHandles(layoutInfo(null, node({ name: 'a' })))).toEqual([]);
  });
});

describe('planDrag: move', () => {
  const box = { x: 20, y: 30, width: 100, height: 50 };
  const widget = node({ name: 'a', x: 20, y: 30, width: 100, height: 50 });

  it('adds the distance to the widget\'s own x and y', () => {
    const plan = planDrag(widget, absoluteParent, box, { type: 'move' }, 10, -5);
    expect(plan).toEqual({ ok: true, preview: { x: 30, y: 25, width: 100, height: 50 }, changes: { x: 30, y: 25 } });
  });

  it('writes only the axis that changed', () => {
    const plan = planDrag(widget, absoluteParent, box, { type: 'move' }, 0, 4);
    expect(plan).toMatchObject({ ok: true, changes: { y: 34 } });
    expect(plan.ok && 'x' in plan.changes).toBe(false);
  });

  it('starts from zero when the widget has no x or y attribute', () => {
    const plan = planDrag(node({ name: 'a' }), absoluteParent, { x: 8, y: 8, width: 10, height: 10 }, { type: 'move' }, 5, 6);
    expect(plan).toMatchObject({ ok: true, changes: { x: 5, y: 6 } });
  });

  it('reverses the offset for a widget aligned to the right or bottom', () => {
    const anchored = node({ name: 'a', align: 'bottom_right', x: -10, y: -10 });
    const plan = planDrag(anchored, absoluteParent, { x: 250, y: 190, width: 50, height: 40 }, { type: 'move' }, 12, 8);
    expect(plan).toMatchObject({ ok: true, changes: { x: -22, y: -18 } });
  });

  it('refuses a flex child with the reason, and an alignment it cannot follow', () => {
    const flexPlan = planDrag(node({ name: 'chip' }), flexRow, box, { type: 'move' }, 5, 5);
    expect(flexPlan).toMatchObject({ ok: false });
    expect(!flexPlan.ok && flexPlan.reason).toMatch(/flex layout/);
    const outside = planDrag(node({ name: 'tip', align: 'out_top_mid' }), absoluteParent, box, { type: 'move' }, 5, 5);
    expect(!outside.ok && outside.reason).toMatch(/cannot follow/);
  });
});

describe('planDrag: resize', () => {
  const box = { x: 20, y: 30, width: 100, height: 50 };
  const widget = node({ name: 'a', x: 20, y: 30, width: 90, height: 50 });

  it('resizes from the south-east corner, starting from the drawn size', () => {
    const plan = planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'se' }, 20, 10);
    // the width attribute says 90 but 100 is drawn: the widget follows the pointer from what is drawn
    expect(plan).toEqual({ ok: true, preview: { x: 20, y: 30, width: 120, height: 60 }, changes: { width: 120, height: 60 } });
  });

  it('resizes one side only', () => {
    expect(planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'e' }, 7, 99)).toMatchObject({ ok: true, changes: { width: 107 } });
    expect(planDrag(widget, absoluteParent, box, { type: 'resize', handle: 's' }, 99, -9)).toMatchObject({ ok: true, changes: { height: 41 } });
  });

  it('the west and north edges move the widget so the opposite edge stays put', () => {
    const west = planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'w' }, 10, 0);
    expect(west).toEqual({ ok: true, preview: { x: 30, y: 30, width: 90, height: 50 }, changes: { width: 90, x: 30 } });
    const north = planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'n' }, 0, -10);
    expect(north).toEqual({ ok: true, preview: { x: 20, y: 20, width: 100, height: 60 }, changes: { height: 60, y: 20 } });
    const corner = planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'nw' }, 5, 5);
    expect(corner).toMatchObject({ ok: true, changes: { width: 95, x: 25, height: 45, y: 35 } });
  });

  it('never goes below the minimum size, and then stops moving the edge', () => {
    const plan = planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'w' }, 500, 0);
    expect(plan).toMatchObject({ ok: true, preview: { width: MIN_SIZE, x: 20 + 100 - MIN_SIZE }, changes: { width: MIN_SIZE, x: 119 } });
    expect(planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'se' }, -500, -500)).toMatchObject({ changes: { width: MIN_SIZE, height: MIN_SIZE } });
  });

  it('writes nothing for a drag that changes nothing', () => {
    expect(planDrag(widget, absoluteParent, box, { type: 'resize', handle: 'e' }, 0, 0)).toMatchObject({ ok: true, changes: {} });
  });

  it('lets a flex child resize on its free sides but not move', () => {
    const chip = node({ name: 'chip', width: 40, height: 30 });
    const chipBox = { x: 10, y: 10, width: 40, height: 30 };
    expect(planDrag(chip, flexRow, chipBox, { type: 'resize', handle: 'e' }, 10, 0)).toMatchObject({ ok: true, changes: { width: 50 } });
    const west = planDrag(chip, flexRow, chipBox, { type: 'resize', handle: 'w' }, 10, 0);
    expect(west.ok).toBe(false);
  });

  it('refuses to resize along a flex_grow axis, but resizes the other one from a corner', () => {
    const card = node({ name: 'card', flex_grow: 1, width: 100, height: 60 });
    const cardBox = { x: 0, y: 0, width: 94, height: 60 };
    const east = planDrag(card, flexRow, cardBox, { type: 'resize', handle: 'e' }, 10, 0);
    expect(!east.ok && east.reason).toMatch(/flex_grow/);
    const corner = planDrag(card, flexRow, cardBox, { type: 'resize', handle: 'se' }, 10, 10);
    expect(corner).toMatchObject({ ok: true, changes: { height: 70 } });
    expect(corner.ok && 'width' in corner.changes).toBe(false);
  });

  it('refuses everything for the page itself', () => {
    expect(planDrag(node({ name: 'page' }), null, box, { type: 'move' }, 1, 1).ok).toBe(false);
    expect(planDrag(node({ name: 'page' }), null, box, { type: 'resize', handle: 'se' }, 1, 1).ok).toBe(false);
  });
});
