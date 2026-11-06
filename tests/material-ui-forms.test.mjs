/**
 * Phase 9 integration: the Material UI settings screens
 * (examples/components/material-ui-forms.html and material-ui-forms-2.html)
 * use an app bar, tabs, a text field, a switch, a slider, a select, a
 * pagination, a stepper, a card, a snackbar and a bottom navigation TOGETHER.
 * Each component was built and tested alone; these tests hold what only shows
 * up when they share a page:
 *   - every component is recognized by name, the expected number of times, on
 *     the committed extraction (hidden tab panels and popups included);
 *   - no node is claimed twice, and nothing is ambiguous or throws;
 *   - a component never swallows another's text (every visible string is
 *     emitted once);
 *   - a select whose popup sits under a different parent (Material UI mounts
 *     the Menu in a Portal at the end of <body>) is linked to its popup.
 *
 * The click-driven check in real LVGL is spike/subjects/run-material-forms.sh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { node } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (path) => JSON.parse(readFileSync(join(here, path), 'utf8'));
const forms1 = () => load('fixtures/material_ui_forms.json');
const forms2 = () => load('fixtures-behavior/material-ui-forms-2.json');

/** Every recognized node: [component, props, node]. */
function recognizedNodes(tree) {
  const out = [];
  (function walk(n) {
    if (n.recognized) out.push([n.recognized.component, n.recognized.props, n]);
    n.children.forEach(walk);
  })(tree);
  return out;
}
/** Per component: how many nodes, not counting the popup part of a select. */
function countByComponent(tree) {
  const counts = {};
  for (const [name, props] of recognizedNodes(tree)) {
    if (name === 'select' && props?.part === 'popup') continue;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}
const run = (fixture) => {
  const diagnostics = createDiagnostics();
  const { tree } = recognize(structuredClone(fixture), { diagnostics });
  return { tree, diagnostics: diagnostics.list() };
};
const codes = (diagnostics) => diagnostics.map((d) => d.code);

test('forms 1: each component is recognized exactly where it should be, once by name', () => {
  const { tree, diagnostics } = run(forms1());
  const counts = countByComponent(tree);
  for (const [name, expected] of Object.entries({
    tabs: 1, appbar: 1, textfield: 1, 'bottom-navigation': 1,
    switch: 2, slider: 2, // the open General panel and the Display panel the page hides
  })) assert.equal(counts[name], expected, `${name}: ${JSON.stringify(counts)}`);
  // Nothing else on this page is a component of another kind.
  for (const name of ['select', 'menu', 'modal', 'drawer', 'accordion', 'stepper', 'pagination', 'snackbar', 'alert', 'breadcrumbs']) {
    assert.equal(counts[name], undefined, `${name} must not match anything on forms 1: ${JSON.stringify(counts)}`);
  }
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'), JSON.stringify(diagnostics));
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_ERROR'), JSON.stringify(diagnostics));
  assert.ok(!codes(diagnostics).includes('UNSUPPORTED_WIDGET'), JSON.stringify(diagnostics));
});

test('forms 2: each component is recognized exactly where it should be, once by name', () => {
  const { tree, diagnostics } = run(forms2());
  const counts = countByComponent(tree);
  for (const [name, expected] of Object.entries({
    appbar: 1, stepper: 1, card: 1, select: 1, pagination: 1, snackbar: 1, 'bottom-navigation': 1,
    alert: 1, // the Snackbar's role="alert" content is built by the Alert definition, by design
  })) assert.equal(counts[name], expected, `${name}: ${JSON.stringify(counts)}`);
  for (const name of ['tabs', 'menu', 'modal', 'drawer', 'accordion', 'textfield', 'switch', 'slider']) {
    assert.equal(counts[name], undefined, `${name} must not match anything on forms 2 (the select popup is not a Menu): ${JSON.stringify(counts)}`);
  }
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_AMBIGUOUS'), JSON.stringify(diagnostics));
  assert.ok(!codes(diagnostics).includes('RECOGNIZER_ERROR'), JSON.stringify(diagnostics));
  assert.ok(!codes(diagnostics).includes('UNSUPPORTED_WIDGET'), JSON.stringify(diagnostics));
});

test('no node is claimed by two components, on either page', () => {
  for (const fixture of [forms1(), forms2()]) {
    const { tree } = run(fixture);
    const keys = recognizedNodes(tree).map(([, , n]) => n.key);
    assert.equal(new Set(keys).size, keys.length, `a node was recognized twice: ${keys}`);
  }
});

/** The text="..." values of every label in the XML. */
const textsOf = (xml) => [...xml.matchAll(/ text="([^"]*)"/g)].map((m) => m[1]);

test('forms 1: no component swallows another one\'s text, and each visible string is emitted once', () => {
  const texts = textsOf(convert(forms1(), { name: 'material_ui_forms' }).xml);
  const once = ['Device name', 'Kitchen panel', 'Auto update', 'Volume', 'SAVE', 'GENERAL', 'DISPLAY', 'ABOUT', 'Home', 'Nearby', 'Dark mode', 'Brightness'];
  for (const text of once) assert.equal(texts.filter((t) => t === text).length, 1, `"${text}" in ${JSON.stringify(texts)}`);
  // "Settings" is the app bar title and the bottom navigation's open action: two different widgets.
  assert.equal(texts.filter((t) => t === 'Settings').length, 2);
  // The slider value captions are labels of their own, not part of the slider widget.
  assert.deepEqual(texts.filter((t) => t === '40' || t === '75'), ['40', '75']);
});

test('forms 2: no component swallows another one\'s text, and each visible string is emitted once', () => {
  const texts = textsOf(convert(forms2(), { name: 'material-ui-forms-2', screenMode: true }).xml);
  for (const text of ['Delivery', 'Address saved', 'UNDO', 'Home', 'Cart', 'Orders', 'Cart', 'Pay']) {
    // "Delivery" is the app bar title AND the active step's label, "Cart" the first step AND the open bottom action.
    const expected = text === 'Delivery' || text === 'Cart' ? 2 : 1;
    assert.equal(texts.filter((t) => t === text).length, expected, `"${text}" in ${JSON.stringify(texts)}`);
  }
  assert.ok(texts.some((t) => t === '1' || t === '2' || t === '3'), 'the stepper keeps its step numbers');
  // The select became one dropdown with both options; its Portal popup left no boxes behind.
  assert.ok(convert(forms2(), { name: 'x', screenMode: true }).xml.includes('options="Standard (3-5 days)&#10;Express (1-2 days)"'));
  assert.ok(!texts.includes('Express (1-2 days)'), 'the popup options must not also appear as labels');
});

test('forms: the emitted widgets are the native ones, in the places the components own', () => {
  const xml1 = convert(forms1(), { name: 'material_ui_forms' }).xml;
  for (const tag of ['lv_tabview', 'lv_textarea', 'lv_switch', 'lv_slider']) assert.ok(xml1.includes(`<${tag} `), `${tag} in forms 1`);
  // One tab view for the tabs and one for the bottom navigation (bar at the bottom).
  assert.equal((xml1.match(/<lv_tabview /g) ?? []).length, 2);
  assert.ok(xml1.includes('tab_bar_position="bottom"'));
  // The app bar floats above the page and the bottom bar is pinned over its bottom edge.
  assert.ok(/name="appbar"[^>]*floating="true"/.test(xml1));
  assert.ok(/name="bottom_navigation"[^>]*floating="true"/.test(xml1));
  const xml2 = convert(forms2(), { name: 'material-ui-forms-2', screenMode: true }).xml;
  for (const tag of ['lv_dropdown', 'lv_tabview']) assert.ok(xml2.includes(`<${tag} `), `${tag} in forms 2`);
});

test('the committed goldens equal what convert() writes now', () => {
  const g1 = readFileSync(join(here, 'golden', 'material_ui_forms.xml'), 'utf8');
  assert.equal(convert(forms1(), { name: 'material_ui_forms' }).xml, g1);
  const { xml, globalsXml } = convert(forms2(), { name: 'material-ui-forms-2', screenMode: true });
  assert.equal(xml, readFileSync(join(here, 'golden-behavior', 'material-ui-forms-2.xml'), 'utf8'));
  assert.equal(globalsXml, readFileSync(join(here, 'golden-behavior', 'material-ui-forms-2.globals.xml'), 'utf8'));
});

/* ----------------------------------------------- select + Portal popup */

const combobox = () => node('div', {
  role: 'combobox', text: 'Twenty', x: 12, y: 20, w: 200, h: 32,
  aria: { haspopup: 'listbox', expanded: 'false', controls: 'age-menu', labelledby: 'age-label' },
});
const popup = () => node('div', { classes: ['MuiPopover-root', 'MuiMenu-root'], role: 'presentation', hidden: true, revealed: true, x: 0, y: 0, w: 320, h: 240 }, [
  node('div', { classes: ['MuiPaper-root'], hidden: true, revealed: true, x: 12, y: 60, w: 200, h: 54 }, [
    node('ul', { id: 'age-menu', role: 'listbox', hidden: true, revealed: true, x: 12, y: 60, w: 200, h: 54, aria: { labelledby: 'age-label' } }, [
      node('li', { role: 'option', text: 'Ten', hidden: true, revealed: true }),
      node('li', { role: 'option', text: 'Twenty', hidden: true, revealed: true, aria: { selected: 'true' } }),
    ]),
  ]),
]);
const label = () => node('label', { id: 'age-label', text: 'Age', x: 12, y: 4, w: 40, h: 14 });

test('a select whose Portal popup sits under another parent is linked to it (no "always visible listbox" warning)', () => {
  // The select root's parent is a plain wrapper no component replaces; the popup is a later sibling of that wrapper.
  const page = node('body', { w: 320, h: 240 }, [
    node('div', { classes: ['MuiFormControl-root'], x: 0, y: 0, w: 320, h: 60 }, [
      label(),
      node('div', { classes: ['MuiInputBase-root', 'MuiOutlinedInput-root', 'MuiSelect-root'], x: 12, y: 20, w: 200, h: 32 }, [combobox()]),
    ]),
    popup(),
  ]);
  const { tree, diagnostics } = run(page);
  assert.deepEqual(codes(diagnostics), [], JSON.stringify(diagnostics));
  const parts = recognizedNodes(tree).filter(([name]) => name === 'select').map(([, props]) => props?.part ?? 'field');
  assert.deepEqual(parts, ['field'], 'the popup is recognized as the select\'s own and then dropped with the other hidden nodes');
  // The dropdown got both options from the popup, and the popup left nothing visible behind.
  const { xml } = convert(page, { name: 'portal' });
  assert.ok(xml.includes('options="Ten&#10;Twenty"') && xml.includes('selected="1"'), xml);
  assert.ok(!xml.includes('text="Ten"'));
});

test('a standalone, always-visible listbox is still reported (the fix does not link everything)', () => {
  const page = node('body', { w: 320, h: 240 }, [
    node('ul', { id: 'list', role: 'listbox', x: 0, y: 0, w: 200, h: 54 }, [node('li', { role: 'option', text: 'One' })]),
  ]);
  const { diagnostics } = run(page);
  assert.ok(codes(diagnostics).includes('UNSUPPORTED_WIDGET'));
});
