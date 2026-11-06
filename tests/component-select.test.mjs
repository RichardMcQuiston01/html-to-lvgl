/**
 * Select component: match signals and scores, near misses (a text-entry
 * combobox, a menu opener), data-lv-widget forcing, option and selection
 * extraction from the DOM/ARIA (listbox by aria-controls, by shared
 * aria-labelledby, or inside), the placeholder, the UNSUPPORTED_WIDGET cases,
 * popups removed from the page, the emitted lv_dropdown in XML/C/C++/MicroPython,
 * and the committed fixture against its goldens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import select from '../src/components/select.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { emitC } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node } from './helpers/tree.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = (children) => node('body', { w: 320, h: 240, layout: { display: 'flex', flexDirection: 'column', position: 'static' } }, children);
const option = (text, extra = {}) => node('li', { role: 'option', text, ...extra });
const listbox = (id, options, extra = {}) => node('ul', { id, role: 'listbox', hidden: true, revealed: true, x: 12, y: 60, w: 200, h: 90, ...extra }, options);
const combobox = (extra = {}) => node('div', {
  id: 'cb', role: 'combobox', text: 'Spanish', x: 12, y: 20, w: 200, h: 32,
  aria: { haspopup: 'listbox', expanded: 'false', controls: 'lb' },
  styles: { bgColor: [255, 255, 255, 255], borderColor: [206, 212, 218, 255], borderWidth: 1, radius: 4, padLeft: 10, fontSize: 13 },
  ...extra,
});
const abc = () => listbox('lb', [option('English'), option('Spanish', { aria: { selected: 'true' } }), option('German')]);

const diagnostics = () => createDiagnostics();
const run = (tree, diag = diagnostics()) => ({ tree: recognize(structuredClone(tree), { diagnostics: diag }).tree, diag });
const scoreOf = (tree, pick) => {
  let seen = null;
  const spy = { ...select, match: (n, ctx) => { const s = select.match(n, ctx); if (pick(n) && seen === null) seen = Number(s); return s; } };
  recognize(structuredClone(tree), { registry: createRegistry([spy]), diagnostics: diagnostics() });
  return seen;
};
const dropdownOf = (out) => out.children.find((c) => c.recognized?.component === 'select' && c.widget === 'dropdown');

test('the select definition is valid, registered by default, and describes props and slots', () => {
  assert.deepEqual(validateComponent(select), { ok: true, errors: [] });
  assert.ok(builtinComponents.includes(select));
  assert.deepEqual(Object.keys(select.props), ['selected', 'placeholder']);
  assert.deepEqual(select.slots, []);
});

test('signals: <select> 1, role=combobox 1, MuiSelect-root 0.7, a select popup 0.9, a bare listbox 0.3', () => {
  assert.equal(scoreOf(page([node('select', { id: 's', attrs: { options: ['a'], selectedIndex: 0 } })]), (n) => n.id === 's'), 1);
  assert.equal(scoreOf(page([combobox(), abc()]), (n) => n.id === 'cb'), 1);
  const mui = node('div', { id: 'm', classes: ['MuiInputBase-root', 'MuiSelect-root'] }, [combobox({ id: 'inner' })]);
  assert.equal(scoreOf(page([mui, abc()]), (n) => n.id === 'm'), 0.7);
  assert.equal(scoreOf(page([combobox(), abc()]), (n) => n.id === 'lb'), 0.9);
  assert.equal(scoreOf(page([listbox('free', [option('x')], { hidden: false, revealed: false })]), (n) => n.id === 'free'), 0.3);
});

test('near misses: an autocomplete input, a div, a menu opener', () => {
  assert.equal(scoreOf(page([node('input', { id: 'i', role: 'combobox', aria: { autocomplete: 'list', haspopup: 'listbox' } })]), (n) => n.id === 'i'), 0);
  assert.equal(scoreOf(page([node('div', { id: 'd' })]), (n) => n.id === 'd'), 0);
  assert.equal(scoreOf(page([node('button', { id: 'b', aria: { haspopup: 'menu' } })]), (n) => n.id === 'b'), 0);
});

test('match never throws on a bare node or missing context', () => {
  assert.doesNotThrow(() => select.match(node('div'), { tree: node('body'), byId: new Map(), links: new Map() }));
  assert.doesNotThrow(() => select.match({ tag: 'div', children: [] }, { tree: { children: [] }, byId: new Map() }));
});

test('build: options and the selected index come from the listbox named by aria-controls', () => {
  const { tree, diag } = run(page([combobox(), abc()]));
  const dd = dropdownOf(tree);
  assert.deepEqual(dd.attrs.options, ['English', 'Spanish', 'German']);
  assert.equal(dd.attrs.selectedIndex, 1);
  assert.equal(dd.children.length, 0);
  assert.equal(dd.recognized.props.selected, 1);
  assert.equal(diag.list().length, 0);
  assert.equal(tree.children.length, 1, 'the popup listbox is removed from the page');
});

test('build: without aria-selected the option equal to the displayed text is selected', () => {
  const lb = listbox('lb', [option('English'), option('Spanish'), option('German')]);
  assert.equal(dropdownOf(run(page([combobox(), lb])).tree).attrs.selectedIndex, 1);
});

test('build: Material UI links its keepMounted listbox by the shared aria-labelledby, with no aria-controls', () => {
  const label = node('span', { id: 'age-label', text: 'Age' });
  const inner = combobox({ id: 'sel', aria: { haspopup: 'listbox', labelledby: 'age-label sel' }, text: 'Twenty', styles: { padLeft: 14 } });
  const outline = node('fieldset', { styles: { borderWidth: 1, borderColor: [0, 0, 0, 59] } });
  const root = node('div', { id: 'root', classes: ['MuiInputBase-root', 'MuiSelect-root'], styles: { radius: 4 }, w: 200, h: 40 }, [inner, outline]);
  const popup = node('div', { classes: ['MuiPopover-root', 'MuiMenu-root'], hidden: true, revealed: true }, [
    node('div', { classes: ['MuiPaper-root'] }, [listbox('ml', [option('Ten', { aria: {} }), option('Twenty', { aria: { selected: 'true' } }), option('Thirty')], { aria: { labelledby: 'age-label' } })]),
  ]);
  const { tree } = run(page([label, root, popup]));
  const dd = tree.children.find((c) => c.widget === 'dropdown');
  assert.deepEqual(dd.attrs.options, ['Ten', 'Twenty', 'Thirty']);
  assert.equal(dd.attrs.selectedIndex, 1);
  assert.equal(dd.styles.borderWidth, 1, 'the border comes from the outline fieldset');
  assert.equal(dd.styles.padLeft, 14, 'the padding comes from the combobox');
  assert.equal(tree.children.some((c) => c.classes?.includes('MuiPopover-root')), false, 'the popover wrapper is removed');
});

test('build: displayed text that is no option becomes the first, selected option (a placeholder)', () => {
  const unselected = listbox('lb', [option('English'), option('Spanish'), option('German')]);
  const { tree } = run(page([combobox({ text: 'Choose a language' }), unselected]));
  const dd = dropdownOf(tree);
  assert.deepEqual(dd.attrs.options, ['Choose a language', 'English', 'Spanish', 'German']);
  assert.equal(dd.attrs.selectedIndex, 0);
  assert.equal(dd.recognized.props.placeholder, 'Choose a language');
});

test('build: no listbox in the page gives one option and UNSUPPORTED_WIDGET with a fix', () => {
  const { tree, diag } = run(page([combobox({ aria: { haspopup: 'listbox', expanded: 'false' } })]));
  assert.deepEqual(dropdownOf(tree).attrs.options, ['Spanish']);
  const entry = diag.list().find((d) => d.code === 'UNSUPPORTED_WIDGET');
  assert.ok(entry);
  assert.equal(entry.severity, 'warning');
  assert.match(entry.message, /not in the page/);
  assert.match(entry.fix, /keepMounted/);
});

test('UNSUPPORTED_WIDGET: a combobox that opens a grid, and an always-visible listbox, stay as boxes', () => {
  const grid = run(page([node('div', { id: 'g', role: 'combobox', aria: { haspopup: 'grid' } })]));
  assert.ok(grid.diag.list().some((d) => d.code === 'UNSUPPORTED_WIDGET' && /grid/.test(d.message)));
  assert.equal(grid.tree.children[0].widget, null);
  const free = run(page([listbox('free', [option('x')], { hidden: false, revealed: false })]));
  assert.ok(free.diag.list().some((d) => d.code === 'UNSUPPORTED_WIDGET' && /always visible/.test(d.message)));
});

test('UNSUPPORTED_WIDGET: a multiselectable listbox keeps the first selected option and says so', () => {
  const lb = listbox('lb', [option('A', { aria: { selected: 'true' } }), option('B', { aria: { selected: 'true' } })], { aria: { multiselectable: 'true' } });
  const { tree, diag } = run(page([combobox({ text: 'A' }), lb]));
  assert.equal(dropdownOf(tree).attrs.selectedIndex, 0);
  assert.ok(diag.list().some((d) => /multi-select/.test(d.message)));
});

test('data-lv-widget="select" forces a plain div', () => {
  const div = node('div', { widget: 'select', text: 'Two', aria: { controls: 'lb' }, w: 120, h: 30 });
  const { tree } = run(page([div, listbox('lb', [option('One'), option('Two')])]));
  const dd = tree.children.find((c) => c.widget === 'dropdown');
  assert.deepEqual(dd.attrs.options, ['One', 'Two']);
  assert.equal(dd.attrs.selectedIndex, 1);
});

test('a native <select> is recognized too and keeps its own options', () => {
  const sel = node('select', { id: 's', attrs: { options: ['Light', 'Dark'], selectedIndex: 1 }, styles: { bgColor: [239, 239, 239, 255], borderColor: [118, 118, 118, 255], borderWidth: 1 } });
  const dd = dropdownOf(run(page([sel])).tree);
  assert.deepEqual(dd.attrs.options, ['Light', 'Dark']);
  assert.equal(dd.recognized.props.selected, 1);
});

test('convert: lv_dropdown with options, selected index and the page box styles', () => {
  const { xml } = convert(structuredClone(page([combobox(), abc()])), { name: 'sel' });
  assert.match(xml, /<lv_dropdown [^>]*options="English&#10;Spanish&#10;German"[^>]* selected="1"/);
  assert.match(xml, /style_bg_color="0xffffff"[^>]*style_border_width="1"[^>]*style_border_color="0xced4da"[^>]*style_radius="4"/);
  assert.match(xml, /style_pad_left="10"/);
  assert.doesNotMatch(xml, /Spanish<|text="Spanish"/, 'the displayed text is not also drawn as a label');
});

test('a transparent border color keeps its alpha as style_border_opa', () => {
  const cb = combobox({ styles: { borderColor: [0, 0, 0, 59], borderWidth: 1, bgColor: null, padLeft: 14, fontSize: 14 } });
  const { xml } = convert(structuredClone(page([cb, abc()])), { name: 'sel' });
  assert.match(xml, /style_bg_opa="0"/);
  assert.match(xml, /style_border_opa="59"/);
});

test('C, C++ and MicroPython write the same dropdown calls', () => {
  const { view } = convert(structuredClone(page([combobox(), abc()])), { name: 'sel' });
  const c = emitC(view, { name: 'sel' }).c;
  assert.match(c, /lv_dropdown_set_options\(\w+, "English\\nSpanish\\nGerman"\);/);
  assert.match(c, /lv_dropdown_set_selected\(\w+, 1\);/);
  const py = emitPy(view, { name: 'sel' }).py;
  assert.match(py, /\.set_options\("English\\nSpanish\\nGerman"\)/);
  assert.match(py, /\.set_selected\(1\)/);
});

test('the committed fixture converts to the committed golden', () => {
  const tree = JSON.parse(readFileSync(join(here, 'fixtures/select.json'), 'utf8'));
  const { xml } = convert(tree, { name: 'select' });
  assert.equal(xml, readFileSync(join(here, 'golden/select.xml'), 'utf8'));
  assert.equal((xml.match(/<lv_dropdown /g) ?? []).length, 3);
  assert.match(xml, /options="Ten&#10;Twenty&#10;Thirty"[^>]*selected="1"/);
});
