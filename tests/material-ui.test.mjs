/**
 * End-to-end Material UI example: one 320x240 page that uses every Phase 7
 * component together (app bar with toolbar, breadcrumbs, card, paper, divider,
 * chip, avatar, badge, alert and icon placeholders), converted from the
 * committed extraction fixture with the default registry. No browser needed.
 *
 * The page mixes both recognition paths: plain ARIA/semantic markup (nav
 * aria-label=breadcrumb, role=alert, hr) and Material UI class names (the rest).
 * The second half holds regression tests for the cross-component defects this
 * page exposed in the individual lanes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { formatTodo, createDiagnostics } from '../src/diagnostics.mjs';
import { recognize, defaultRegistry } from '../src/recognize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () => JSON.parse(readFileSync(join(here, 'fixtures', 'material-ui.json'), 'utf8'));

const result = convert(fixture(), { name: 'material-ui' });
const diagnostics = result.diagnostics.list();

/** Names of every `name="..."` in the XML, in document order. */
const xmlNames = [...result.xml.matchAll(/ name="([^"]+)"/g)].map((m) => m[1]);

test('every Phase 7 component is recognized at least once', () => {
  const { tree } = recognize(fixture(), { registry: defaultRegistry, diagnostics: createDiagnostics() });
  const counts = new Map();
  (function walk(n) {
    const c = n.recognized?.component;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    n.children.forEach(walk);
  })(tree);
  for (const name of ['appbar', 'toolbar', 'breadcrumbs', 'card', 'divider', 'chip', 'avatar', 'badge', 'alert', 'paper']) {
    assert.ok(counts.get(name) >= 1, `${name} was not recognized (counts: ${JSON.stringify([...counts])})`);
  }
  // Icons are recognized too, one per svg in the page.
  assert.equal(counts.get('icon'), 5);
  // The three chips, two avatars (one inside a chip) and two badges (one on an icon, one on an icon button).
  assert.equal(counts.get('chip'), 3);
  assert.equal(counts.get('avatar'), 2);
  assert.equal(counts.get('badge'), 2);
});

test('the XML carries a named widget for every component', () => {
  for (const name of ['appbar', 'toolbar', 'breadcrumbs', 'card', 'divider', 'chip', 'avatar', 'badge', 'alert', 'paper']) {
    assert.ok(xmlNames.includes(name), `no widget named "${name}" in the XML`);
  }
  // The fixed bar is pinned and drawn last (on top), after the content it floats over.
  assert.match(result.xml, /name="appbar"[^>]* floating="true"/);
  const topLevel = [...result.xml.matchAll(/^ {4}<lv_\w+ name="([^"]+)"/gm)].map((m) => m[1]);
  assert.equal(topLevel.at(-1), 'appbar');
});

test('no ambiguous or failed recognition', () => {
  assert.deepEqual(diagnostics.filter((d) => /^RECOGNIZER_/.test(d.code)), []);
});

test('widget names are unique', () => {
  const dupes = xmlNames.filter((n, i) => xmlNames.indexOf(n) !== i);
  assert.deepEqual(dupes, []);
});

test('the generated C, C++ and Python agree with the XML on widget names', () => {
  // The view's own root is called "root" in code and has no name in the XML.
  const c = emitC(result.view, { name: 'material-ui' }).c;
  const cpp = emitCpp(result.view, { name: 'material-ui' }).c;
  const py = emitPy(result.view, { name: 'material-ui' }).py;
  const cNames = [...c.matchAll(/lv_obj_t \* (\w+) = lv_\w+_create\(/g)].map((m) => m[1]).filter((n) => n !== 'root');
  const cppNames = [...cpp.matchAll(/lv_obj_t \* (\w+) = lv_\w+_create\(/g)].map((m) => m[1]).filter((n) => n !== 'root');
  const pyNames = [...py.matchAll(/^ {4}(\w+) = lv\.\w+\(/gm)].map((m) => m[1]).filter((n) => n !== 'root');
  assert.deepEqual(cNames, xmlNames);
  assert.deepEqual(cppNames, xmlNames);
  assert.deepEqual(pyNames, xmlNames);
});

// FONT_FALLBACK (Helvetica has no font file) is added by the CLI's font step, not by convert().
test('the diagnostics are exactly the expected set', () => {
  const seen = diagnostics.map((d) => `${d.code}${d.output?.widget ? ` ${d.output.widget}` : ''}`).sort();
  assert.deepEqual(seen, [
    'ICON_PLACEHOLDER icon_cancel', // chip delete icon
    'ICON_PLACEHOLDER icon_menu', // app bar menu button
    'ICON_PLACEHOLDER icon_notifications', // app bar action, under a badge
    'ICON_PLACEHOLDER icon_warning', // alert icon
    'ICON_PLACEHOLDER icon_wifi', // card header action, under a badge
    'TOUCH_TARGET_SMALL', // breadcrumb link "Home" (32x14)
    'TOUCH_TARGET_SMALL', // breadcrumb link "Devices" (43x14)
    'TOUCH_TARGET_SMALL', // the "Away" chip, a role=button 67x24
  ].sort());
  // Every icon placeholder's widget exists under that exact name in the XML.
  for (const d of diagnostics.filter((x) => x.code === 'ICON_PLACEHOLDER')) {
    assert.ok(xmlNames.includes(d.output.widget), `${d.output.widget} is not an emitted widget`);
  }
});

test('TODO.txt lists every icon placeholder by its emitted name', () => {
  const todo = formatTodo(diagnostics);
  for (const name of ['icon_menu', 'icon_notifications', 'icon_wifi', 'icon_cancel', 'icon_warning']) {
    assert.match(todo, new RegExp(`\\[ICON_PLACEHOLDER\\] ${name}`));
  }
  assert.match(todo, /\[TOUCH_TARGET_SMALL\]/);
});

test('the transparent icon buttons in the bar take the bar color, not LVGL blue', () => {
  assert.match(result.xml, /name="muiiconbutton_root"[^>]* style_bg_color="0x1976d2"/);
  assert.match(result.xml, /name="muiiconbutton_root_2"[^>]* style_bg_color="0x1976d2"/);
});

// ---- Regression tests for cross-component fixes -------------------------------------------

function styles(extra = {}) {
  return {
    bgColor: null, color: [10, 20, 30, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 16,
    textAlign: 'start', opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0,
    gradient: null, shadow: null, scrollable: false, pressed: null, ...extra,
  };
}
function layout(extra = {}) {
  return {
    display: 'block', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'normal',
    alignItems: 'normal', rowGap: 0, columnGap: 0, flexGrow: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, position: 'static',
    gridColumns: null, gridRows: null, gridColumnStart: 'auto', gridColumnEnd: 'auto',
    gridRowStart: 'auto', gridRowEnd: 'auto', ...extra,
  };
}
let keyCount = 0;
const node = (tag, extra = {}) => ({
  tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
  role: null, aria: {}, classes: [], testId: null, hidden: false,
  x: 0, y: 0, w: 100, h: 24, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: `k${++keyCount}`,
  ...extra,
});
const find = (tree, pred) => {
  if (pred(tree)) return tree;
  for (const c of tree.children) {
    const f = find(c, pred);
    if (f) return f;
  }
  return null;
};
const run = (tree) => recognize(structuredClone(tree), { registry: defaultRegistry, diagnostics: createDiagnostics() }).tree;

test('an avatar in the app bar is not taken for the bar title', () => {
  // No heading in the bar: the title search falls back to the first text, which
  // used to be the avatar's initials, so the avatar was renamed "appbar_title".
  const avatar = node('div', { classes: ['MuiAvatar-root'], w: 28, h: 28, styles: styles({ bgColor: [255, 87, 34, 255], radius: 14 }), children: [node('span', { text: 'A', w: 10, h: 14 })] });
  const title = node('span', { text: 'Thermostat', w: 90, h: 20 });
  const bar = node('header', { role: 'banner', w: 320, h: 48, children: [avatar, title] });
  const out = run(node('body', { w: 320, h: 240, children: [bar] }));
  const appbar = find(out, (n) => n.recognized?.component === 'appbar');
  assert.equal(appbar.recognized.props.title, 'Thermostat');
  const named = find(appbar, (n) => n.lvName === 'appbar_title');
  assert.equal(named.text, 'Thermostat');
  const kept = find(appbar, (n) => n.recognized?.component === 'avatar');
  assert.equal(kept.lvName, 'avatar');
  assert.equal(kept.children[0].text, 'A', 'the avatar keeps its initials');
});

test('a transparent IconButton in a card header or body does not take the default blue', () => {
  const header = node('div', { classes: ['MuiCardHeader-root'], children: [node('button', { aria: { label: 'settings' }, w: 32, h: 32 })] });
  const body = node('div', { classes: ['MuiCardContent-root'], children: [node('div', { role: 'button', w: 40, h: 24, text: 'Go' })] });
  const card = node('div', { classes: ['MuiPaper-root', 'MuiCard-root'], w: 200, h: 100, children: [header, body] });
  const out = run(node('body', { w: 320, h: 240, children: [card] }));
  const button = find(out, (n) => n.tag === 'button');
  assert.deepEqual(button.styles.bgColor, [0, 0, 0, 0]);
  assert.equal(find(out, (n) => n.recognized?.component === 'card').children.length, 2, 'no child is dropped');
});

test('a transparent button directly in a paper does not take the default blue', () => {
  const paper = node('div', { classes: ['MuiPaper-root'], w: 200, h: 60, styles: styles({ bgColor: [255, 255, 255, 255] }), children: [node('button', { text: 'Undo', w: 60, h: 28 })] });
  const out = run(node('body', { w: 320, h: 240, children: [paper] }));
  assert.deepEqual(find(out, (n) => n.tag === 'button').styles.bgColor, [0, 0, 0, 0]);
});
