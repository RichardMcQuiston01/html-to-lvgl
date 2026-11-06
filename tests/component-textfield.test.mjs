/**
 * Text field: the signals that make an <input> or <textarea> a labelled field,
 * the native lv_textarea that build() emits (one line vs multi-line, password,
 * value, placeholder, error), Material UI's resting and shrunk labels and
 * notched outline, and the shipped fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateComponent, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { convert } from '../src/convert.mjs';
import { node } from './helpers/tree.mjs';
import textfield from '../src/components/textfield.mjs';
import { lineHeight } from '../src/fonts.mjs';

const ctxFor = (tree, key) => ({ diagnostics: createDiagnostics(), parent: null, tree, links: new Map(), byId: new Map(), key });
const page = (...children) => node('body', { w: 320, h: 240, styles: { bgColor: [255, 255, 255, 255] } }, children);
const run = (tree) => recognize(tree, { diagnostics: createDiagnostics() }).tree;
const nativeOf = (tree) => {
  const find = (n) => (n.native ? n : n.children.map(find).find(Boolean));
  return find(tree);
};
const scoreIn = (tree, pick) => {
  const found = (n) => (pick(n) ? n : n.children.map(found).find(Boolean));
  const target = found(tree);
  return Number(textfield.match(target, { ...ctxFor(tree), links: new Map() }));
};

const inputStyles = { bgColor: [255, 255, 255, 255], borderWidth: 1, borderColor: [148, 163, 184, 255], radius: 4, padLeft: 8, padRight: 8, color: [15, 23, 42, 255], fontSize: 12 };
const input = (extra = {}) => node('input', { id: 'user', attrs: { type: 'text', value: 'jane_doe' }, x: 8, y: 22, w: 148, h: 28, styles: inputStyles, ...extra });
const label = (forId = 'user') => node('label', { attrs: { for: forId }, text: 'Username', x: 8, y: 8, w: 60, h: 12 });

test('the definition is valid and registered as "textfield"', () => {
  assert.deepEqual(validateComponent(textfield), { ok: true, errors: [] });
  assert.equal(textfield.name, 'textfield');
});

test('an input matches (score 1) when a <label for>, aria-labelledby, aria-describedby, aria-invalid or aria-errormessage describes it', () => {
  assert.equal(scoreIn(page(label(), input()), (n) => n.tag === 'input'), 1);
  for (const key of ['describedby', 'invalid', 'errormessage']) {
    assert.equal(scoreIn(page(input({ aria: { [key]: 'x' } })), (n) => n.tag === 'input'), 1, key);
  }
  const labelled = page(input({ key: 'k1' }));
  const ctx = { ...ctxFor(labelled), links: new Map([['k1', { controls: [], controlledBy: [], labelledBy: ['k2'] }]]) };
  assert.equal(Number(textfield.match(labelled.children[0], ctx)), 1);
});

test('a bare input, a checkbox and a button do not match, so existing pages keep their output', () => {
  assert.equal(scoreIn(page(input()), (n) => n.tag === 'input'), 0);
  assert.equal(scoreIn(page(input({ aria: { invalid: 'true' }, attrs: { type: 'checkbox' } })), (n) => n.tag === 'input'), 0);
  assert.equal(scoreIn(page(node('button', { aria: { describedby: 'x' } })), (n) => n.tag === 'button'), 0);
});

test('role="textbox", a Material UI TextField and an InputBase root match', () => {
  assert.equal(scoreIn(page(node('div', { role: 'textbox' })), (n) => n.role === 'textbox'), 1);
  const field = node('div', { classes: ['MuiTextField-root'] }, [node('div', { classes: ['MuiInputBase-root'] }, [input()])]);
  assert.equal(scoreIn(page(field), (n) => n.classes.includes('MuiTextField-root')), 0.7);
  const base = node('div', { classes: ['MuiInputBase-root'] }, [input()]);
  assert.equal(scoreIn(page(base), (n) => n.classes.includes('MuiInputBase-root')), 0.7);
  assert.equal(scoreIn(page(node('div', { classes: ['MuiTextField-root'] })), (n) => n.classes.includes('MuiTextField-root')), 0, 'no input inside');
  const select = node('div', { classes: ['MuiTextField-root'] }, [node('div', { classes: ['MuiSelect-select'] }), input()]);
  assert.equal(scoreIn(page(select), (n) => n.classes.includes('MuiTextField-root')), 0, 'a select belongs to the select definition');
});

test('hidden and already-built nodes never match', () => {
  assert.equal(Number(textfield.match({ ...input({ aria: { invalid: 'true' } }), hidden: true }, ctxFor(null))), 0);
  assert.equal(Number(textfield.match({ ...input({ aria: { invalid: 'true' } }), native: { tag: 'lv_textarea' } }, ctxFor(null))), 0);
});

test('build: a labelled text input is one single-line lv_textarea with the value and the page border', () => {
  const t = nativeOf(run(page(label(), input())));
  assert.equal(t.native.tag, 'lv_textarea');
  const a = t.native.attrs;
  assert.equal(a.one_line, 'true');
  assert.equal(a.text, 'jane_doe');
  assert.equal(a.style_border_color, '0x94a3b8');
  assert.equal(a.style_radius, 4);
  assert.equal(t.native.centerLine, 1, 'a single line is centered by convert() with the border width taken out');
  assert.equal(t.recognized.component, 'textfield');
});

test('build: type=password gives password mode, an empty value gives the placeholder', () => {
  const pw = nativeOf(run(page(label(), input({ attrs: { type: 'password', value: 'secret' } })))).native.attrs;
  assert.equal(pw.password_mode, 'true');
  const ph = nativeOf(run(page(label(), input({ attrs: { type: 'email', value: '', placeholder: 'you@example.com' } })))).native.attrs;
  assert.equal(ph.placeholder_text, 'you@example.com');
  assert.equal('text' in ph, false);
});

test('build: a <textarea> is multi-line with vertical padding and no centering', () => {
  const area = node('textarea', { id: 'note', attrs: { value: '', placeholder: 'Notes' }, x: 8, y: 22, w: 148, h: 52, styles: { ...inputStyles, padTop: 6 }, aria: { describedby: 'h' } });
  const t = nativeOf(run(page(area)));
  assert.equal(t.native.attrs.one_line, 'false');
  assert.equal(t.native.attrs.style_pad_ver, 6);
  assert.equal(t.native.centerLine, null);
});

test('build: aria-invalid forces a red border when the page did not color it', () => {
  const plain = nativeOf(run(page(label(), input({ aria: { invalid: 'true' } })))).native.attrs;
  assert.equal(plain.style_border_color, '0xd32f2f');
  const alreadyRed = input({ aria: { invalid: 'true' }, styles: { ...inputStyles, borderColor: [220, 38, 38, 255] } });
  assert.equal(nativeOf(run(page(label(), alreadyRed))).native.attrs.style_border_color, '0xdc2626', 'the page red is kept');
  const borderless = input({ aria: { invalid: 'true' }, styles: { ...inputStyles, borderWidth: 0, borderColor: null } });
  assert.equal(nativeOf(run(page(label(), borderless))).native.attrs.style_border_width, 1);
});

test('build: a disabled input gets the disabled state', () => {
  assert.equal(nativeOf(run(page(label(), input({ attrs: { type: 'text', value: 'x', disabled: true } })))).native.attrs.disabled, 'true');
});

test('data-lv-widget="textfield" on a plain input is built even with no label', () => {
  assert.equal(nativeOf(run(page(input({ widget: 'textfield' })))).native.tag, 'lv_textarea');
});

/**
 * A Material UI outlined TextField: label, input base (with the input and the
 * notched outline) and helper text. `shrunk` puts the label on the border.
 */
const mui = ({ shrunk, value = '', helper = null, error = false, type = 'text' }) => {
  const base = node('div', { classes: ['MuiInputBase-root', 'MuiOutlinedInput-root', ...(error ? ['Mui-error'] : [])], x: 164, y: 15, w: 148, h: 31, styles: { radius: 4, color: [0, 0, 0, 222], fontSize: 12 } }, [
    node('input', { id: 'f', classes: ['MuiInputBase-input'], aria: { invalid: String(error) }, attrs: { type, value }, x: 164, y: 15, w: 148, h: 31, styles: { padLeft: 12, color: [0, 0, 0, 222], fontSize: 12 } }),
    node('fieldset', { classes: ['MuiOutlinedInput-notchedOutline'], x: 164, y: 10, w: 148, h: 36, styles: { borderWidth: 1, borderColor: error ? [211, 47, 47, 255] : [0, 0, 0, 59], radius: 4 } }),
  ]);
  const lab = node('label', { classes: ['MuiInputLabel-root', ...(shrunk ? ['MuiInputLabel-shrink'] : [])], attrs: { for: 'f' }, text: 'City', x: shrunk ? 172 : 176, y: shrunk ? 8 : 22, w: 28, h: 14, styles: { fontSize: 12, color: [0, 0, 0, 153] } });
  const kids = [lab, base, ...(helper ? [node('p', { classes: ['MuiFormHelperText-root'], text: helper, x: 176, y: 48, w: 60, h: 12 })] : [])];
  return node('div', { classes: ['MuiFormControl-root', 'MuiTextField-root'], x: 164, y: 15, w: 148, h: 31, layout: { display: 'flex' } }, kids);
};

test('build: Material UI replaces the input base and the outline with one textarea that has the outline border and the base box', () => {
  const tree = run(page(mui({ shrunk: true, value: 'Jane' })));
  const root = tree.children[0];
  const field = root.children.find((c) => c.native);
  assert.deepEqual([field.x, field.y, field.w, field.h], [164, 15, 148, 31]);
  assert.equal(field.native.attrs.style_border_color, '0xc4c4c4', 'black at 23 percent over white');
  assert.equal(field.native.attrs.style_radius, 4);
  assert.equal(field.native.attrs.text, 'Jane');
  assert.equal(field.native.attrs.style_pad_hor, 12);
  assert.equal(root.children.some((c) => c.tag === 'fieldset' || (c.classes ?? []).includes('MuiInputBase-root')), false);
});

test('build: a resting (not shrunk) label becomes the placeholder and the label node is gone', () => {
  const root = run(page(mui({ shrunk: false }))).children[0];
  assert.equal(root.children.find((c) => c.native).native.attrs.placeholder_text, 'City');
  assert.equal(root.children.some((c) => c.tag === 'label'), false);
});

test('build: a shrunk label stays, after the field (drawn above it), on the background color with padding for the notch', () => {
  const root = run(page(mui({ shrunk: true, value: 'x' }))).children[0];
  const [field, lab] = root.children;
  assert.equal(Boolean(field.native), true);
  assert.equal(lab.tag, 'label');
  assert.deepEqual(lab.styles.bgColor, [255, 255, 255, 255]);
  assert.equal(lab.styles.fontSize, 9, '12 px at the 0.75 scale Material UI shrinks a label by');
  assert.equal(lab.x, 168, '4 px of notch on the left');
  assert.equal(lab.w, 36);
});

test('build: Material UI error state, password and helper text', () => {
  const root = run(page(mui({ shrunk: true, value: '1234', error: true, type: 'password', helper: 'Too short' }))).children[0];
  const field = root.children.find((c) => c.native);
  assert.equal(field.native.attrs.style_border_color, '0xd32f2f');
  assert.equal(field.native.attrs.password_mode, 'true');
  assert.equal(root.children.some((c) => c.text === 'Too short'), true, 'the helper text stays a label');
  assert.equal(root.recognized.props.error, true);
});

test('convert: a single line is centered in the field using the line height of its font', () => {
  const { xml } = convert(page(label(), input()), { name: 'p' });
  const expected = Math.floor((28 - 2 * 1 - lineHeight(12)) / 2);
  assert.match(xml, new RegExp(`<lv_textarea name="user"[^>]*one_line="true"[^>]*style_pad_ver="${expected}"`));
});

test('the shipped fixture: every field becomes an lv_textarea; the textarea and password keep their kind', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/textfield.json', import.meta.url), 'utf8'));
  const { xml } = convert(fixture, { name: 'textfield' });
  const tags = xml.match(/<lv_textarea [^>]*>/g);
  assert.equal(tags.length, 7);
  assert.equal(tags.filter((t) => /password_mode="true"/.test(t)).length, 2);
  assert.equal(tags.filter((t) => /one_line="false"/.test(t)).length, 1);
  assert.equal(/<lv_obj name="note"/.test(xml), false, 'a <textarea> is no longer a plain box');
});
