/**
 * Stepper: matching signals, near misses, what build() rewrites (icons to
 * circles, connectors to solid lines, step names), orientation and state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import stepper from '../src/components/stepper.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { node, ctx, page, styles, layout } from './helpers/ui-node.mjs';

const score = (n) => Number(stepper.match(n, ctx()));
const BLUE = [25, 118, 210, 255];

/** A Material UI step: icon (svg in an icon container), label. `digit` null draws a check mark (no <text>). */
function muiStep({ digit = null, state = null, label = 'Step', x = 0, y = 0 } = {}) {
  const svg = node('svg', {
    x, y, w: 24, h: 24, aria: { hidden: 'true' }, styles: styles({ color: state ? BLUE : [158, 158, 158, 255] }),
    children: digit ? [node('circle'), node('text', { text: digit, w: 7, h: 14 })] : [node('path')],
  });
  return node('div', {
    classes: ['MuiStep-root', 'MuiStep-horizontal', ...(state === 'completed' ? ['Mui-completed'] : [])], w: 70, h: 24,
    children: [node('span', { classes: ['MuiStepLabel-root'], children: [
      node('span', { classes: ['MuiStepLabel-iconContainer'], children: [svg] }),
      node('span', { classes: ['MuiStepLabel-labelContainer'], children: [node('span', { classes: ['MuiStepLabel-label', ...(state === 'active' ? ['Mui-active'] : [])], text: label })] }),
    ] })],
  });
}

const connector = (completed = false, borderSide = 'top') => node('div', {
  classes: ['MuiStepConnector-root', 'MuiStepConnector-horizontal', ...(completed ? ['Mui-completed'] : [])], x: 70, y: 11, w: 40, h: 1,
  children: [node('span', { classes: ['MuiStepConnector-line'], x: 70, y: 11, w: 40, h: 1, styles: styles({ borderWidth: 1, borderColor: completed ? BLUE : [189, 189, 189, 255], borderSide }) })],
});

function muiStepper(extra = {}) {
  return node('div', {
    classes: ['MuiStepper-root', 'MuiStepper-horizontal'], w: 296, h: 24, layout: layout({ display: 'flex' }),
    children: [muiStep({ state: 'completed', label: 'Select' }), connector(true), muiStep({ digit: '2', state: 'active', label: 'Create' }), connector(), muiStep({ digit: '3', label: 'Publish' })],
    ...extra,
  });
}

const plainStep = (text, extra = {}) => node('li', { children: [node('span', { text: String(text) }), node('span', { text: `Step ${text}` })], ...extra });
const plainList = (extra = {}) => node('ol', {
  role: 'list', aria: { label: 'Progress' },
  children: [plainStep(1), plainStep(2, { aria: { current: 'step' } }), plainStep(3)],
  ...extra,
});

test('the stepper definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(stepper), { ok: true, errors: [] });
  assert.equal(stepper.name, 'stepper');
  assert.ok(builtinComponents.includes(stepper));
  assert.equal(createRegistry([stepper]).rejected.length, 0);
  assert.deepEqual(stepper.slots, ['steps']);
});

test('signal: a Material UI Stepper root scores 0.7; a list of steps with aria-current="step" scores 1', () => {
  assert.equal(score(muiStepper()), 0.7);
  assert.equal(score(plainList()), 1);
  assert.equal(score(node('ul', { children: [plainStep(1, { aria: { current: 'step' } }), plainStep(2)] })), 1, 'a ul without a role');
  assert.equal(score(node('div', { role: 'list', children: [node('div', { role: 'listitem', aria: { current: 'step' } }), node('div', { role: 'listitem' })] })), 1);
  assert.equal(score(plainList({ children: [plainStep(1), node('li', { children: [node('b', { aria: { current: 'step' } })] })] })), 1, 'the mark may sit inside the item');
});

test('near misses: a list with no current step, breadcrumbs, pagination, a single item', () => {
  assert.equal(score(plainList({ children: [plainStep(1), plainStep(2), plainStep(3)] })), 0, 'no aria-current: not necessarily steps');
  assert.equal(score(plainList({ children: [plainStep(1), plainStep(2, { aria: { current: 'page' } })] })), 0, 'aria-current="page" is breadcrumbs or pagination');
  assert.equal(score(plainList({ children: [plainStep(2, { aria: { current: 'step' } })] })), 0, 'one step is not a stepper');
  assert.equal(score(node('div', { children: [plainStep(1, { aria: { current: 'step' } }), plainStep(2)] })), 0, 'a div is not a list');
  assert.equal(score(node('div', { classes: ['MuiStep-root'] })), 0, 'a step alone is not a stepper');
});

test('match never throws on a bare node', () => {
  assert.doesNotThrow(() => stepper.match({ tag: 'ol', children: [] }, {}));
});

test('data-lv-widget="stepper" forces the match', () => {
  const tree = node('body', { children: [node('div', { widget: 'stepper', children: [muiStep({ digit: '1', state: 'active' })] })] });
  const out = recognize(structuredClone(tree), { registry: createRegistry([stepper]) });
  assert.equal(out.tree.children[0].recognized.component, 'stepper');
});

test('build, Material UI: each step icon SVG becomes a numbered circle in the SVG color', () => {
  const built = stepper.build(muiStepper(), ctx());
  const icons = built.children.filter((c) => c.classes.includes('MuiStep-root')).map((step) => step.children[0].children[0].children[0]);
  assert.deepEqual(icons.map((i) => i.tag), ['div', 'div', 'div']);
  assert.deepEqual(icons.map((i) => i.text), ['1', '2', '3'], 'the check mark has no number of its own, so it shows the position');
  assert.deepEqual(icons.map((i) => i.lvName), ['step_1_icon', 'step_2_icon', 'step_3_icon']);
  assert.deepEqual(icons[0].styles.bgColor, BLUE);
  assert.deepEqual(icons[2].styles.bgColor, [158, 158, 158, 255]);
  assert.deepEqual(icons[0].styles.color, [255, 255, 255, 255]);
  assert.equal(icons[0].styles.radius, 12);
  assert.equal(icons[0].styles.textAlign, 'center');
  assert.equal(icons[0].children.length, 0);
});

test('build: an SVG number is read from its own <text>, not from the position', () => {
  const root = muiStepper({ children: [muiStep({ digit: '7', state: 'active' }), muiStep({ digit: '8' })] });
  const built = stepper.build(root, ctx());
  assert.deepEqual(built.children.map((s) => s.children[0].children[0].children[0].text), ['7', '8']);
});

test('build: an SVG outside a step icon container is left alone', () => {
  const root = muiStepper();
  root.children[0].children[0].children.push(node('svg', { aria: { hidden: 'true' } }));
  const built = stepper.build(root, ctx());
  assert.equal(built.children[0].children[0].children[2].tag, 'svg');
});

test('build: a horizontal connector line becomes a strip as high as its border, filled with the border color', () => {
  const built = stepper.build(muiStepper(), ctx());
  const [, first, , second] = built.children;
  const line = first.children[0];
  assert.deepEqual([line.w, line.h], [40, 1]);
  assert.deepEqual(line.styles.bgColor, BLUE);
  assert.equal(line.styles.borderWidth, 0);
  assert.deepEqual(second.children[0].styles.bgColor, [189, 189, 189, 255]);
});

test('build: a vertical connector keeps the border strip only (a left border on a wide box)', () => {
  const root = muiStepper({ classes: ['MuiStepper-root', 'MuiStepper-vertical'], layout: layout({ display: 'flex', flexDirection: 'column' }) });
  root.children[1] = connector(true, 'left');
  root.children[1].children[0].w = 285;
  root.children[1].children[0].h = 14;
  const line = stepper.build(root, ctx()).children[1].children[0];
  assert.deepEqual([line.w, line.h], [1, 14]);
  assert.deepEqual(line.styles.bgColor, BLUE);
});

test('build: a connector with no single-edge border is left as it is', () => {
  const root = muiStepper();
  root.children[1].children[0].styles = styles();
  assert.equal(stepper.build(root, ctx()).children[1].children[0].w, 40);
});

test('build: names the stepper and its steps, keeps an author-set name, does not mutate the input', () => {
  const root = muiStepper();
  const built = stepper.build(root, ctx());
  assert.equal(built.lvName, 'stepper');
  assert.deepEqual(built.children.filter((c) => c.lvName?.startsWith('step_')).map((c) => c.lvName), ['step_1', 'step_2', 'step_3']);
  assert.equal(root.lvName, null);
  assert.equal(root.children[0].children[0].children[0].children[0].tag, 'svg');
  assert.equal(stepper.build(muiStepper({ lvName: 'checkout' }), ctx()).lvName, 'checkout');
});

test('build: state and orientation props, from aria-current, Mui-active and Mui-completed', () => {
  assert.deepEqual(stepper.build(muiStepper(), ctx()).recognized.props, { orientation: 'horizontal', count: 3, active: 1, completed: 1 });
  const plain = stepper.build(plainList({ layout: layout({ display: 'flex', flexDirection: 'column' }) }), ctx());
  assert.deepEqual(plain.recognized.props, { orientation: 'vertical', count: 3, active: 1, completed: 0 });
  assert.equal(stepper.build(plainList({ aria: { orientation: 'vertical' } }), ctx()).recognized.props.orientation, 'vertical');
});

test('build, plain ARIA: steps are named and everything else is kept', () => {
  const built = stepper.build(plainList(), ctx());
  assert.deepEqual(built.children.map((c) => c.lvName), ['step_1', 'step_2', 'step_3']);
  assert.deepEqual(built.children.map((c) => c.children.map((x) => x.text)), [['1', 'Step 1'], ['2', 'Step 2'], ['3', 'Step 3']]);
});

/* ---------------------------------------------------------------- convert */

test('convert: the Material UI icons are circles with numbers, not icon placeholders', () => {
  const { xml, diagnostics } = convert(page(muiStepper()), { name: 'steps' });
  assert.match(xml, /name="step_1_icon"[^>]*style_bg_color="0x1976d2"[^>]*style_radius="12"/);
  assert.match(xml, /text="2"/);
  assert.doesNotMatch(xml, /icon_icon/);
  assert.equal(diagnostics.list().filter((d) => d.code === 'ICON_PLACEHOLDER').length, 0);
  assert.match(xml, /name="stepper"/);
});

test('convert: without the component the icons are placeholders (what this fixes)', () => {
  const { xml } = convert(page(muiStepper()), { name: 'steps', registry: createRegistry(builtinComponents.filter((d) => d.name === 'icon')) });
  assert.match(xml, /icon_icon/);
});
