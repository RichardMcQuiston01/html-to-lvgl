/**
 * Alert: each detection signal and its score, severity and variant, build()
 * on an icon + message + action row, the Paper overlap, and convert().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateComponent, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';

const styles = (extra = {}) => ({
  bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0,
  borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 13,
  textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
  gradient: null, shadow: null, scrollable: false, pressed: null, ...extra,
});
const layout = (extra = {}) => ({
  display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
  alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
  marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
  gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
  gridRowStart: 'auto', gridRowEnd: 'auto', ...extra,
});
/** An extractor-shaped node: `aria` keys have no "aria-" prefix. */
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
const findBy = (tree, pred) => (pred(tree) ? tree : tree.children.map((c) => findBy(c, pred)).find(Boolean) ?? null);
const run = (tree) => {
  const diagnostics = createDiagnostics();
  const out = recognize(tree, { diagnostics });
  return { ...out, diagnostics };
};
const codes = (diagnostics) => diagnostics.list().map((d) => d.code);

import alert from '../src/components/alert.mjs';

const ctx = () => ({ diagnostics: createDiagnostics(), parent: null, tree: null });
const score = (n) => Number(alert.match(n, ctx()));

const muiAlert = (extra = {}) => node('div', {
  classes: ['MuiPaper-root', 'MuiPaper-elevation', 'MuiAlert-root', 'MuiAlert-colorWarning', 'MuiAlert-standardWarning'],
  role: 'alert', x: 10, y: 10, w: 300, h: 50,
  st: { bgColor: [255, 244, 229, 255], radius: 4, padLeft: 16, padRight: 16, padTop: 6, padBottom: 6, color: [102, 60, 0, 255], fontSize: 14 },
  lay: { display: 'flex' },
  children: [
    node('div', { classes: ['MuiAlert-icon'], x: 26, y: 16, w: 22, h: 36, st: { padTop: 7, padBottom: 7 }, lay: { marginRight: 12, display: 'flex' },
      children: [node('svg', { classes: ['MuiSvgIcon-root'], testId: 'ReportProblemOutlinedIcon', x: 26, y: 23, w: 22, h: 22 })] }),
    node('div', { classes: ['MuiAlert-message'], x: 60, y: 16, w: 200, h: 36, text: 'Check your battery level', st: { padTop: 8, padBottom: 8, fontSize: 14 } }),
  ],
  ...extra,
});

test('the alert definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(alert), { ok: true, errors: [] });
  assert.equal(alert.name, 'alert');
  assert.ok(builtinComponents.includes(alert));
  assert.deepEqual(alert.slots, ['icon', 'message', 'action']);
  assert.deepEqual(Object.keys(alert.props), ['severity', 'variant']);
});

test('signals and scores: role=alert 1, boxed role=status 0.8, MuiAlert-root 0.7, Bootstrap alert 0.5', () => {
  assert.equal(score(node('div', { role: 'alert' })), 1);
  assert.equal(score(node('div', { role: 'status', st: { bgColor: [240, 253, 244, 255] } })), 0.8);
  assert.equal(score(node('div', { role: 'status', st: { borderWidth: 1, borderColor: [1, 2, 3, 255] } })), 0.8);
  assert.equal(score(node('div', { classes: ['MuiAlert-root'] })), 0.7);
  assert.equal(score(node('div', { className: 'MuiAlert-root' })), 0.7);
  assert.equal(score(node('div', { classes: ['alert', 'alert-danger'] })), 0.5);
  assert.equal(score(muiAlert()), 1, 'real MUI markup carries role=alert');
});

test('near misses do not match', () => {
  assert.equal(score(node('div', { role: 'status' })), 0, 'a bare status region is plain text');
  assert.equal(score(node('div', { role: 'status', text: 'Saved' })), 0);
  assert.equal(score(node('div', { role: 'alertdialog' })), 0);
  assert.equal(score(node('div', { classes: ['alert-heading'] })), 0);
  assert.equal(score(node('div', { classes: ['alerts'] })), 0);
  assert.equal(score(node('div', { classes: ['MuiAlertTitle-root'] })), 0);
  assert.equal(score(node('div', { classes: ['MuiAlert-message'] })), 0);
  assert.equal(score(muiAlert({ hidden: true })), 0);
});

test('data-lv-widget="alert" forces it and is consumed', () => {
  const t = run(page(node('div', { widget: 'alert', text: 'Heads up', w: 200, h: 30 }))).tree.children[0];
  assert.equal(t.recognized.component, 'alert');
  assert.equal(t.widget, null);
});

test('severity comes from MUI classes, Bootstrap classes, or defaults to info', () => {
  const sev = (classes) => run(page(node('div', { role: 'alert', classes, text: 'x', w: 100, h: 30 }))).tree.children[0].recognized.props.severity;
  assert.equal(sev(['MuiAlert-root', 'MuiAlert-standardError']), 'error');
  assert.equal(sev(['MuiAlert-root', 'MuiAlert-colorWarning']), 'warning');
  assert.equal(sev(['MuiAlert-root', 'MuiAlert-filledSuccess']), 'success');
  assert.equal(sev(['MuiAlert-root', 'MuiAlert-outlinedInfo']), 'info');
  assert.equal(sev(['alert', 'alert-danger']), 'error');
  assert.equal(sev(['alert', 'alert-success']), 'success');
  assert.equal(sev(['alert', 'alert-warning']), 'warning');
  assert.equal(sev([]), 'info');
  assert.equal(sev(['MuiAlert-standardError', 'my-success-theme']), 'error', 'MUI classes outvote custom ones');
});

test('variant: standard, filled, outlined', () => {
  const v = (c) => run(page(node('div', { role: 'alert', classes: c, text: 'x', w: 100, h: 30 }))).tree.children[0].recognized.props.variant;
  assert.equal(v(['MuiAlert-root', 'MuiAlert-standardInfo']), 'standard');
  assert.equal(v(['MuiAlert-root', 'MuiAlert-filledInfo']), 'filled');
  assert.equal(v(['MuiAlert-root', 'MuiAlert-outlinedInfo']), 'outlined');
  assert.equal(v([]), 'standard');
});

test('build() names the alert, icon and message; the icon is its own component', () => {
  const { tree, diagnostics } = run(page(muiAlert()));
  const a = tree.children[0];
  assert.equal(a.lvName, 'alert');
  assert.deepEqual(a.recognized.props, { severity: 'warning', variant: 'standard' });
  assert.deepEqual(a.children.map((c) => c.lvName), ['alert_icon', 'alert_message']);
  assert.equal(a.children[0].children[0].recognized.component, 'icon');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'), 'Alert is also a Paper; they must not tie');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_ERROR'));
});

test('an Alert without role="alert" does not tie with the Paper definition', () => {
  const { tree, diagnostics } = run(page(muiAlert({ role: null })));
  assert.equal(tree.children[0].recognized.component, 'alert');
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'), codes(diagnostics).join());
});

test('a one-line message loses its padding-inflated height; the row is centered', () => {
  const a = run(page(muiAlert())).tree.children[0];
  const msg = a.children[1];
  assert.equal(msg.styles.padTop, 0);
  assert.equal(msg.styles.padBottom, 0);
  assert.equal(msg.h, 20);
  assert.equal(a.layout.alignItems, 'center');
});

test('a multi-line message is left alone and the row is not centered', () => {
  const a = muiAlert();
  a.children[1] = node('div', { classes: ['MuiAlert-message'], x: 60, y: 16, w: 200, h: 80, text: 'A long message that wraps onto several lines of text', st: { padTop: 8, padBottom: 8, fontSize: 14 } });
  const out = run(page(a)).tree.children[0];
  assert.equal(out.children[1].h, 80);
  assert.equal(out.children[1].styles.padTop, 8);
  assert.notEqual(out.layout.alignItems, 'center');
});

test('an action <button> with no background is transparent; the action keeps its place', () => {
  const a = muiAlert();
  a.children.push(node('div', { classes: ['MuiAlert-action'], x: 250, y: 16, w: 50, h: 24, lay: { display: 'flex' },
    children: [node('button', { x: 250, y: 16, w: 50, h: 24, text: 'Update' })] }));
  const out = run(page(a)).tree.children[0];
  assert.equal(out.children[2].lvName, 'alert_action');
  assert.deepEqual(out.children[2].children[0].styles.bgColor, [0, 0, 0, 0]);
  assert.equal(out.children[2].children[0].text, 'Update');
});

test('role=status with a box and text: text and children are both kept', () => {
  const ico = node('svg', { x: 20, y: 18, w: 16, h: 16 });
  const a = run(page(node('div', {
    role: 'status', x: 10, y: 10, w: 300, h: 36, text: 'Settings saved',
    st: { bgColor: [240, 253, 244, 255], radius: 6, padLeft: 12, padRight: 12 }, lay: { display: 'flex', alignItems: 'center' }, children: [ico],
  }))).tree.children[0];
  assert.equal(a.recognized.component, 'alert');
  assert.equal(a.text, null);
  assert.equal(a.children.length, 2);
  assert.equal(a.children[0].recognized.component, 'icon', 'the svg is still there, as an icon placeholder, before the text');
  assert.equal(a.children.find((c) => c.text).text, 'Settings saved');
});

test('a translucent text color is blended onto the solid background', () => {
  const a = muiAlert();
  a.styles.bgColor = [0, 0, 0, 0];
  a.children[1].styles.color = [0, 0, 0, 128];
  const out = run(page(a)).tree.children[0];
  const c = out.children[1].styles.color;
  assert.equal(c[3], 255);
  assert.ok(c[0] > 100 && c[0] < 140, `got ${c}`); // half black over white
});

test('convert(): icon placeholder, message text and the action stay in one flex row', () => {
  const a = muiAlert();
  a.children.push(node('div', { classes: ['MuiAlert-action'], x: 250, y: 16, w: 50, h: 24, children: [node('button', { x: 250, y: 16, w: 50, h: 24, text: 'Update' })] }));
  const { xml, diagnostics } = convert(page(a));
  assert.match(xml, /<lv_obj name="alert"[^>]*flex_flow="row"/);
  assert.match(xml, /name="icon_report_problem_outlined"|name="icon_/);
  assert.match(xml, /text="Check your battery level"/);
  assert.match(xml, /text="Update"/);
  assert.ok(codes(diagnostics).includes('ICON_PLACEHOLDER'));
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'));
});
