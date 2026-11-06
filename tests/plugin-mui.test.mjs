/**
 * @richardmcquiston01/html-to-lvgl-mui: unit tests on hand-built nodes, golden
 * tests on committed extraction snapshots of REAL Material UI (rendered by
 * React, with framework data), and one end-to-end run through the CLI.
 *
 * Core files are imported by relative path on purpose: a workspace install can
 * give the package a different copy of the core than the one under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_API, validatePlugin } from '../src/plugin.mjs';
import { createRegistry, recognize, validateComponent } from '../src/recognize.mjs';
import { registryFor } from '../src/plugin-loader.mjs';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import muiPlugin, { recognizers } from '../packages/mui/src/index.mjs';
import checkbox from '../packages/mui/src/checkbox.mjs';
import formControlLabel from '../packages/mui/src/form-control-label.mjs';
import radio from '../packages/mui/src/radio.mjs';
import rating from '../packages/mui/src/rating.mjs';
import icon, { iconNameOf, SYMBOLS } from '../packages/mui/src/icon.mjs';
import button from '../packages/mui/src/button.mjs';
import { componentName, hasPart, muiScore, propsOf } from '../packages/mui/src/shared.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', 'packages', 'mui');

/* ----------------------------------------------------------- node builders */

const styles = (over = {}) => ({
  bgColor: null, color: [0, 0, 0, 255], borderColor: null, borderWidth: 0, borderBottomWidth: 0, radius: 0,
  fontSize: 14, fontFamily: 'Roboto', fontWeight: 400, fontItalic: false, textAlign: 'start', textTransform: 'none',
  overflowHidden: false, opacity: 1, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0, gradient: null, shadow: null,
  scrollable: false, pressed: null, ...over,
});

/** A UiNode with every field a definition reads. */
function node(over = {}) {
  const { styles: s, framework, ...rest } = over;
  return {
    tag: 'div', id: null, className: null, classes: [], lvName: null, widget: null, component: null, link: null,
    role: null, aria: {}, testId: null, hidden: false, x: 0, y: 0, w: 100, h: 20, text: null, attrs: {}, children: [],
    layout: { display: 'block', position: 'static', flexGrow: 0, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0 },
    styles: styles(s), key: over.key ?? 'n', ...(framework ? { framework } : {}), ...rest,
  };
}

/** A framework stamp: chain innermost first, as the React plugin writes it. */
const fw = (...entries) => ({
  componentName: entries[0][0],
  props: entries[0][1] ?? {},
  chain: entries.map(([name, props]) => ({ name, props: props ?? {} })),
});

const ctxOf = (tree, parent = null) => ({ tree, parent, byId: new Map(), links: new Map(), diagnostics: { add() {} } });

/** A Checkbox root as Material UI 9 renders it (small, 32 px). */
function checkboxRoot({ checked = false, disabled = false, classes = [], framework } = {}) {
  return node({
    tag: 'span', key: 'cb', x: 8, y: 40, w: 32, h: 32,
    classes: ['MuiButtonBase-root', 'MuiCheckbox-root', ...(checked ? ['Mui-checked'] : []), ...(disabled ? ['Mui-disabled'] : []), ...classes],
    styles: { color: checked ? [25, 118, 210, 255] : [0, 0, 0, 138] },
    framework: framework ?? fw(['MuiButtonBaseRoot'], ['ButtonBase2'], ['MuiSwitchBase'], ['Checkbox2', { size: 'small' }]),
    children: [
      node({ tag: 'input', key: 'cb/in', w: 32, h: 32, x: 8, y: 40, attrs: { type: 'checkbox', checked, disabled } }),
      node({
        tag: 'svg', key: 'cb/svg', x: 14, y: 46, w: 20, h: 20, testId: checked ? 'CheckBoxIcon' : 'CheckBoxOutlineBlankIcon',
        children: [node({ tag: 'path', key: 'cb/p', x: 16, y: 48, w: 15, h: 15 })],
      }),
    ],
  });
}

/* ---------------------------------------------------------------- plugin */

test('the plugin satisfies the plugin contract and asks for framework data', () => {
  assert.deepEqual(validatePlugin(muiPlugin), { ok: true, errors: [] });
  assert.equal(muiPlugin.name, 'mui');
  assert.equal(muiPlugin.pluginApi, PLUGIN_API);
  assert.equal(muiPlugin.wantsFrameworkData, true);
  assert.equal(muiPlugin.load, undefined, 'a library plugin loads nothing');
});

test('every recognizer is a valid, uniquely named definition that does not clash with a core one', () => {
  const names = recognizers.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
  for (const def of recognizers) assert.deepEqual(validateComponent(def), { ok: true, errors: [] }, def.name);
  const registry = registryFor([muiPlugin]);
  for (const name of names) assert.ok(registry.get(name), `${name} reaches the registry`);
  assert.deepEqual(registry.rejected, []);
});

test('the package declares peer dependencies and no run-time dependency on the core', () => {
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@richardmcquiston01/html-to-lvgl-mui');
  assert.ok(manifest.peerDependencies['@richardmcquiston01/html-to-lvgl']);
  assert.ok(manifest.peerDependencies['@mui/material']);
  assert.equal(manifest.dependencies, undefined);
  for (const file of readdirSync(join(pkg, 'src'))) {
    const source = readFileSync(join(pkg, 'src', file), 'utf8');
    assert.doesNotMatch(source, /^import .* from ['"](?:\.\.\/)+src\//m, `${file} must not import core source at run time`);
    assert.doesNotMatch(source, /^import .* from ['"]@richardmcquiston01\/html-to-lvgl/m, `${file}`);
  }
});

/* ---------------------------------------------------------------- shared */

test('component names are normalized: bundler suffixes and the styled root fall away', () => {
  assert.equal(componentName('Button2'), 'Button');
  assert.equal(componentName('MuiButtonRoot'), 'Button');
  assert.equal(componentName('MuiFormControlLabelRoot'), 'FormControlLabel');
  assert.equal(componentName('Styled(div)'), 'Styled(div)');
  assert.equal(componentName('DeleteIcon'), 'DeleteIcon');
});

test('muiScore: fiber name 0.8, Mui root class 0.7, nothing otherwise; fiber wins over class', () => {
  assert.equal(muiScore(node({ framework: fw(['Checkbox2']) }), 'Checkbox'), 0.8);
  assert.equal(muiScore(node({ classes: ['MuiCheckbox-root'] }), 'Checkbox'), 0.7);
  assert.equal(muiScore(node({ classes: ['MuiCheckbox-root'], framework: fw(['Checkbox2']) }), 'Checkbox'), 0.8);
  assert.equal(muiScore(node({ classes: ['MuiButton-root'] }), 'Checkbox'), false);
  assert.equal(muiScore(node(), 'Checkbox'), false);
  assert.ok(0.8 < 1 && 0.7 < 0.8, 'never above ARIA, fiber above class');
});

test('propsOf takes the props of the component the author wrote, not the styled root', () => {
  const n = node({ framework: fw(['MuiButtonRoot', { disabled: false }], ['Button2', { variant: 'outlined' }]) });
  assert.deepEqual(propsOf(n, 'Button'), { variant: 'outlined' });
  assert.equal(propsOf(n, 'Checkbox'), null);
});

test('hasPart matches a part class whatever its prefix, but not a longer part', () => {
  assert.equal(hasPart(node({ classes: ['AcmeRating-iconFilled'] }), 'Rating-iconFilled'), true);
  assert.equal(hasPart(node({ classes: ['MuiRating-iconFilled'] }), 'Rating-iconFilled'), true);
  assert.equal(hasPart(node({ classes: ['MuiRating-iconFilled'] }), 'Rating-icon'), false);
  assert.equal(hasPart(node({ classes: ['Rating-iconFilled'] }), 'Rating-iconFilled'), true);
});

/* -------------------------------------------------------------- checkbox */

test('checkbox: matches by fiber name when every class is hashed, by class otherwise', () => {
  assert.equal(checkbox.match(node({ classes: ['css-1x2y3z'], framework: fw(['Checkbox2']) })), 0.8);
  assert.equal(checkbox.match(node({ classes: ['MuiCheckbox-root'] })), 0.7);
  assert.equal(checkbox.match(node({ classes: ['css-1x2y3z'] })), false);
  assert.equal(checkbox.match(node({ hidden: true, classes: ['MuiCheckbox-root'] })), false);
});

test('checkbox: a checked box is one native lv_checkbox over the drawn square, in the page\'s color', () => {
  const root = checkboxRoot({ checked: true });
  const out = checkbox.build(root, ctxOf(root));
  assert.equal(out.recognized.props.checked, true);
  assert.equal(out.lvName, 'checkbox');
  assert.equal(out.w, 32, 'the root keeps the footprint the page had');
  const [box] = out.children;
  assert.deepEqual([box.x, box.y, box.w, box.h], [16, 48, 15, 15], 'placed exactly over the path of the icon');
  assert.equal(box.native.tag, 'lv_checkbox');
  const a = box.native.attrs;
  assert.equal(a.checked, 'true');
  assert.equal(a.text, ' ', 'a space: LVGL would show "Check box" for an empty text');
  assert.equal(a['style_bg_color:checked:indicator'], '0x1976d2');
  assert.equal(a['style_border_width:indicator'], 2);
});

test('checkbox: an unchecked box takes the grey the page painted, blended onto the backdrop', () => {
  const root = checkboxRoot({ checked: false });
  const out = checkbox.build(root, ctxOf(root));
  const a = out.children[0].native.attrs;
  assert.equal(a.checked, undefined);
  assert.equal(a['style_border_color:indicator'], '0x757575', 'rgba(0,0,0,.54) over white');
  assert.equal(a['style_bg_color:checked:indicator'], undefined);
});

test('checkbox: disabled comes from Mui-disabled or the React props', () => {
  const byClass = checkbox.build(checkboxRoot({ disabled: true }), ctxOf(null));
  assert.equal(byClass.children[0].native.attrs.disabled, 'true');
  const root = checkboxRoot({ framework: fw(['Checkbox2', { disabled: true, defaultChecked: true }]) });
  const byProps = checkbox.build(root, ctxOf(root));
  assert.equal(byProps.recognized.props.disabled, true);
  assert.equal(byProps.recognized.props.checked, true, 'defaultChecked is read from the props');
});

test('checkbox: an indeterminate box is shown checked and says so', () => {
  const root = checkboxRoot({ checked: true });
  root.children[1].testId = 'IndeterminateCheckBoxIcon';
  const out = checkbox.build(root, ctxOf(root));
  assert.equal(out.recognized.props.indeterminate, true);
  assert.equal(out.children[0].native.attrs.checked, 'true');
});

test('checkbox: the marker is padded so LVGL draws a square as big as the page\'s', () => {
  const out = checkbox.build(checkboxRoot({ checked: true }), ctxOf(null));
  const a = out.children[0].native.attrs;
  // montserrat_12 has a 15 px line, so a 15 px square needs no padding.
  assert.equal(a.style_text_font, 'montserrat_12');
  assert.equal(a['style_pad_all:indicator'], 0);
});

/* ---------------------------------------------------- form control label */

function labelRow({ control, label = 'Email alerts', classes = [], framework } = {}) {
  return node({
    tag: 'label', key: 'row', x: 4, y: 40, w: 291, h: 32,
    classes: ['MuiFormControlLabel-root', ...classes], framework: framework ?? fw(['MuiFormControlLabelRoot'], ['FormControlLabel2', { label }]),
    children: [
      control,
      node({
        tag: 'span', key: 'row/label', x: 36, y: 46, w: 75, h: 20, text: label, classes: ['MuiTypography-root', 'MuiFormControlLabel-label'],
        styles: { fontSize: 14, color: [0, 0, 0, 255] },
      }),
    ],
  });
}

test('form control label: a label holding a Checkbox becomes one lv_checkbox carrying the text', () => {
  const row = labelRow({ control: checkboxRoot({ checked: true }) });
  assert.equal(formControlLabel.match(row), 0.8);
  const out = formControlLabel.build(row, ctxOf(row));
  assert.equal(out.native.tag, 'lv_checkbox');
  assert.equal(out.native.attrs.text, 'Email alerts');
  assert.equal(out.native.fontText, 'Email alerts', 'convert() chooses the label\'s font and color');
  assert.equal(out.native.attrs.checked, 'true');
  assert.equal(out.native.attrs.width, 'content', 'a fixed width would clip LVGL\'s wider font');
  assert.equal(out.native.attrs.style_pad_left, 12, 'the square sits where the page drew it');
  assert.equal(out.native.attrs.style_pad_column, 5, 'and the label starts where the page put it');
  assert.equal(out.children.length, 0);
  assert.deepEqual(out.recognized.props, { label: 'Email alerts', checked: true, disabled: false });
});

test('form control label: the disabled state of the row reaches the checkbox', () => {
  const row = labelRow({ control: checkboxRoot(), classes: ['Mui-disabled'] });
  const out = formControlLabel.build(row, ctxOf(row));
  assert.equal(out.native.attrs.disabled, 'true');
});

test('form control label: matches by fiber name with hashed classes; the label text is found without its class', () => {
  const row = labelRow({ control: checkboxRoot({ classes: [] }) });
  row.classes = ['css-abc'];
  row.children[1].classes = ['css-def'];
  assert.equal(formControlLabel.match(row), 0.8);
});

test('form control label: a Radio row stays a row that may overflow; no control, no match', () => {
  const radioRoot = node({ tag: 'span', key: 'r', classes: ['MuiRadio-root', 'Mui-checked'], w: 32, h: 32 });
  const row = labelRow({ control: radioRoot, label: 'Daily' });
  assert.equal(formControlLabel.match(row), 0.8);
  const out = formControlLabel.build(row, ctxOf(row));
  assert.equal(out.native, undefined);
  assert.equal(out.styles.overflowVisible, true);
  assert.equal(out.recognized.props.checked, true);
  assert.equal(formControlLabel.match(labelRow({ control: node({ tag: 'span' }) })), false, 'nothing to label');
  assert.equal(formControlLabel.match(node({ classes: ['MuiCard-root'] })), false);
});

/* ----------------------------------------------------------------- radio */

function radioRoot({ checked }) {
  return node({
    tag: 'span', key: 'rd', x: 8, y: 40, w: 32, h: 32,
    classes: ['MuiRadio-root', ...(checked ? ['Mui-checked'] : [])], styles: { color: checked ? [25, 118, 210, 255] : [0, 0, 0, 138] },
    framework: fw(['MuiButtonBaseRoot'], ['ButtonBase2'], ['MuiSwitchBase'], ['Radio2', { size: 'small' }]),
    children: [
      node({ tag: 'input', key: 'rd/in', w: 32, h: 32, attrs: { type: 'radio', checked } }),
      node({
        tag: 'span', key: 'rd/icon', x: 14, y: 46, w: 20, h: 20, children: [
          node({ tag: 'svg', key: 'rd/ring', x: 14, y: 46, w: 20, h: 20, testId: 'RadioButtonUncheckedIcon', children: [node({ tag: 'path', key: 'rd/rp', x: 15, y: 47, w: 17, h: 17 })] }),
          node({ tag: 'svg', key: 'rd/dot', x: 14, y: 46, w: checked ? 20 : 0, h: checked ? 20 : 0, testId: 'RadioButtonCheckedIcon', children: [node({ tag: 'path', key: 'rd/dp', x: 20, y: 52, w: checked ? 8 : 0, h: checked ? 8 : 0 })] }),
        ],
      }),
    ],
  });
}

test('radio: matches by fiber name (0.8) or class (0.7)', () => {
  assert.equal(radio.match(node({ classes: ['css-x'], framework: fw(['Radio2']) })), 0.8);
  assert.equal(radio.match(node({ classes: ['MuiRadio-root'] })), 0.7);
  assert.equal(radio.match(node({ classes: ['MuiCheckbox-root'] })), false);
});

test('radio: a selected radio is a ring with a dot, a plain one only the ring', () => {
  const on = radio.build(radioRoot({ checked: true }), ctxOf(null));
  assert.deepEqual(on.children.map((c) => c.lvName), ['radio_ring', 'radio_dot']);
  const [ring, dot] = on.children;
  assert.equal(ring.w, 17);
  assert.equal(ring.styles.borderWidth, 2);
  assert.equal(ring.styles.radius, 9, 'round: half the diameter, rounded up');
  assert.deepEqual(ring.styles.borderColor, [25, 118, 210, 255]);
  assert.equal(dot.w, 8);
  assert.deepEqual(dot.styles.bgColor, [25, 118, 210, 255]);
  assert.ok(Math.abs((dot.x + dot.w / 2) - (ring.x + ring.w / 2)) <= 1 && Math.abs((dot.y + dot.h / 2) - (ring.y + ring.h / 2)) <= 1, 'the dot is centered in the ring');
  assert.equal(on.recognized.props.checked, true);

  const off = radio.build(radioRoot({ checked: false }), ctxOf(null));
  assert.equal(off.children.length, 1);
  assert.deepEqual(off.children[0].styles.borderColor, [117, 117, 117, 255], 'grey, blended onto white');
  assert.equal(off.recognized.props.checked, false);
});

/* ---------------------------------------------------------------- rating */

function ratingRoot({ filled, total = 5, prefix = 'Mui', framework }) {
  return node({
    tag: 'span', key: 'rt', x: 12, y: 150, w: total * 18, h: 18, role: 'img', aria: { label: `${filled} Stars` },
    classes: [`${prefix}Rating-root`, `${prefix}Rating-sizeSmall`], framework,
    children: Array.from({ length: total }, (_, i) => node({
      tag: 'span', key: `rt/${i}`, x: 12 + i * 18, y: 150, w: 18, h: 18,
      children: [node({
        tag: 'span', key: `rt/${i}/c`, x: 12 + i * 18, y: 150, w: 18, h: 18,
        classes: [`${prefix}Rating-icon`, i < filled ? `${prefix}Rating-iconFilled` : `${prefix}Rating-iconEmpty`],
        styles: { color: i < filled ? [250, 175, 0, 255] : [0, 0, 0, 66] },
        children: [node({ tag: 'svg', key: `rt/${i}/s`, x: 12 + i * 18, y: 150, w: 18, h: 18 })],
      })],
    })),
  });
}

test('rating: one disc per star, filled for the filled ones, outlined for the rest', () => {
  const root = ratingRoot({ filled: 3 });
  assert.equal(rating.match(root), 0.7);
  const out = rating.build(root, ctxOf(root));
  assert.equal(out.children.length, 5);
  const filled = out.children.filter((c) => c.styles.bgColor);
  assert.equal(filled.length, 3);
  assert.deepEqual(filled[0].styles.bgColor, [250, 175, 0, 255]);
  const empty = out.children.filter((c) => !c.styles.bgColor);
  assert.equal(empty.length, 2);
  assert.equal(empty[0].styles.borderWidth, 1);
  assert.deepEqual(empty[0].styles.borderColor, [189, 189, 189, 255], 'rgba(0,0,0,.26) over white');
  assert.deepEqual(out.recognized.props, { value: 3, max: 5, readOnly: false });
  // each disc is centered in its star, left to right
  assert.ok(out.children.every((c, i) => i === 0 || c.x > out.children[i - 1].x));
});

test('rating: value, max and readOnly come from the React props when React gave them', () => {
  const root = ratingRoot({ filled: 2, total: 4, framework: fw(['MuiRatingRoot'], ['Rating2', { value: 3.5, max: 4, readOnly: true }]) });
  const out = rating.build(root, ctxOf(root));
  assert.deepEqual(out.recognized.props, { value: 3.5, max: 4, readOnly: true });
});

test('rating: still works when the class prefix was renamed, found by React component', () => {
  const root = ratingRoot({ filled: 2, prefix: 'Acme', framework: fw(['MuiRatingRoot'], ['Rating2']) });
  assert.equal(rating.match(root), 0.8);
  const out = rating.build(root, ctxOf(root));
  assert.equal(out.children.filter((c) => c.styles.bgColor).length, 2);
});

/* ------------------------------------------------------------------ icon */

const svgIcon = (over = {}) => node({ tag: 'svg', key: 'ic', x: 10, y: 10, w: 24, h: 24, styles: { color: [0, 0, 0, 138] }, children: [node({ tag: 'path', key: 'ic/p' })], ...over });

test('icon: the name comes from data-testid or the React component, without variant suffix', () => {
  assert.equal(iconNameOf(svgIcon({ testId: 'DeleteIcon' })), 'Delete');
  assert.equal(iconNameOf(svgIcon({ testId: 'DeleteOutlineIcon' })), 'Delete');
});

test('icon: variant suffixes map to the same symbol; unknown icons are left to the core placeholder', () => {
  assert.equal(iconNameOf(svgIcon({ testId: 'SettingsOutlinedIcon' })), 'Settings');
  assert.equal(iconNameOf(svgIcon({ testId: 'HomeRoundedIcon' })), 'Home');
  assert.equal(iconNameOf(svgIcon({ framework: fw(['MuiSvgIconRoot'], ['SvgIcon2'], ['AddIcon']) })), 'Add');
  assert.equal(iconNameOf(svgIcon({ testId: 'FingerprintIcon' })), null);
  assert.equal(icon.match(svgIcon({ testId: 'FingerprintIcon' })), false);
  assert.equal(icon.match(svgIcon()), false, 'a plain svg stays an svg');
});

test('icon: scores 0.95, above the core\'s 0.9 for any svg and below ARIA', () => {
  assert.equal(icon.match(svgIcon({ testId: 'AddIcon' })), 0.95);
});

test('icon: every mapped glyph is a distinct private-use LVGL symbol code point and a valid name', () => {
  for (const [name, [symbol, glyph]] of Object.entries(SYMBOLS)) {
    assert.match(symbol, /^[A-Z_]+$/, name);
    assert.equal(glyph.length, 1, name);
    const cp = glyph.codePointAt(0);
    assert.ok((cp >= 0xf000 && cp <= 0xf8ff), `${name} is a Font Awesome private-use code point`);
  }
  assert.equal(SYMBOLS.Delete[1], '');
  assert.equal(SYMBOLS.Add[1], '');
});

test('icon: build() returns a centered label of the built-in symbol font, in the page\'s color', () => {
  const svg = svgIcon({ testId: 'DeleteIcon' });
  const out = icon.build(svg, ctxOf(svg));
  assert.equal(out.tag, 'span', 'convert() skips svg before it looks at native');
  assert.equal(out.lvName, 'icon_delete');
  assert.equal(out.native.tag, 'lv_label');
  assert.equal(out.native.attrs.text, '');
  assert.match(out.native.attrs.style_text_font, /^montserrat_\d+$/);
  assert.equal(out.native.attrs.style_text_color, '0x757575');
  assert.equal(out.native.attrs.style_text_align, 'center');
  assert.deepEqual(out.children, []);
  assert.deepEqual(out.recognized.props, { icon: 'Delete', symbol: 'LV_SYMBOL_TRASH' });
});

/* ---------------------------------------------------------------- button */

function buttonNode({ label = 'Save', classes, framework, bg = [25, 118, 210, 255], tag = 'button', aria = {}, attrs = {}, pressed = null } = {}) {
  return node({
    tag, key: 'b', x: 8, y: 200, w: 64, h: 31, text: label, aria, attrs,
    classes: classes ?? ['MuiButtonBase-root', 'MuiButton-root', 'MuiButton-contained', 'MuiButton-sizeSmall', 'MuiButton-colorPrimary'],
    framework: framework === undefined ? fw(['MuiButtonBaseRoot'], ['ButtonBase2'], ['MuiButtonRoot'], ['Button2', { variant: 'contained', size: 'small' }]) : (framework ?? undefined),
    styles: { bgColor: bg, pressed },
  });
}

test('button: matches Button, IconButton, Fab and ToggleButton, by fiber (0.8) or class (0.7)', () => {
  assert.equal(button.match(buttonNode()), 0.8);
  assert.equal(button.match(buttonNode({ framework: null, classes: ['MuiButton-root'] })), 0.7);
  assert.equal(button.match(buttonNode({ label: '', classes: ['MuiIconButton-root'], framework: null })), 0.7);
  assert.equal(button.match(buttonNode({ classes: ['MuiFab-root'], framework: null })), 0.7);
  assert.equal(button.match(buttonNode({ classes: ['MuiToggleButton-root'], framework: null })), 0.7);
  assert.equal(button.match(buttonNode({ classes: ['css-1'], framework: fw(['IconButton2']) })), 0.8);
});

test('button: a plain ButtonBase, a non-button element and an unrelated button do not match', () => {
  assert.equal(button.match(buttonNode({ classes: ['MuiButtonBase-root'], framework: fw(['ButtonBase2']) })), false);
  assert.equal(button.match(buttonNode({ tag: 'div' })), false);
  assert.equal(button.match(node({ tag: 'button', classes: ['btn'] })), false);
});

test('button: named after its label instead of button_base', () => {
  assert.equal(button.build(buttonNode({ label: 'Save changes' }), ctxOf(null)).lvName, 'save_changes_button');
  const icon = buttonNode({ label: '', classes: ['MuiButtonBase-root', 'MuiIconButton-root'], framework: null, aria: { label: 'delete' } });
  icon.text = null;
  assert.equal(button.build(icon, ctxOf(null)).lvName, 'delete_button');
  const bare = buttonNode({ label: '', classes: ['MuiFab-root'], framework: null });
  bare.text = null;
  assert.equal(button.build(bare, ctxOf(null)).lvName, 'fab');
  const named = { ...buttonNode(), lvName: 'ok_btn' };
  assert.equal(button.build(named, ctxOf(null)).lvName, 'ok_btn', 'the author\'s name wins');
});

test('button: variant, color, size and disabled come from the React props, else from the classes', () => {
  const byProps = button.build(buttonNode({ framework: fw(['Button2', { variant: 'outlined', color: 'secondary', size: 'large', disabled: true }]) }), ctxOf(null));
  assert.deepEqual(byProps.recognized.props, { label: 'Save', variant: 'outlined', color: 'secondary', size: 'large', disabled: true });
  const byClass = button.build(buttonNode({
    framework: null, classes: ['MuiButtonBase-root', 'Mui-disabled', 'MuiButton-root', 'MuiButton-outlined', 'MuiButton-sizeLarge', 'MuiButton-colorError'],
  }), ctxOf(null));
  assert.deepEqual(byClass.recognized.props, { label: 'Save', variant: 'outlined', color: 'error', size: 'large', disabled: true });
});

test('button: the pressed color of a filled button is its fill darkened by 20 percent', () => {
  const out = button.build(buttonNode(), ctxOf(null));
  assert.deepEqual(out.styles.pressed, { bgColor: [20, 94, 168, 255] });
});

test('button: an existing pressed color, a disabled button and a button with no fill keep theirs', () => {
  const given = { bgColor: [1, 2, 3, 255] };
  assert.deepEqual(button.build(buttonNode({ pressed: given }), ctxOf(null)).styles.pressed, given);
  assert.equal(button.build(buttonNode({ framework: fw(['Button2', { disabled: true }]) }), ctxOf(null)).styles.pressed, null);
  assert.equal(button.build(buttonNode({ bg: null }), ctxOf(null)).styles.pressed, null);
});

/* ------------------------------------------------- through recognize() */

test('through the registry: the Checkbox inside a label is not offered twice, the radio and button are named', () => {
  const tree = node({
    tag: 'body', key: 'body', w: 320, h: 240, children: [
      labelRow({ control: checkboxRoot({ checked: true }) }),
      radioRoot({ checked: true }),
      buttonNode(),
    ],
  });
  const { tree: out } = recognize(structuredClone(tree), { registry: registryFor([muiPlugin]) });
  const [row, rd, btn] = out.children;
  assert.equal(row.recognized.component, 'mui-form-control-label');
  assert.equal(row.native.tag, 'lv_checkbox');
  assert.equal(rd.recognized.component, 'mui-radio');
  assert.equal(btn.recognized.component, 'mui-button');
});

test('through the registry: the icon definition beats the core\'s generic svg icon', () => {
  const tree = node({ tag: 'body', key: 'body', children: [svgIcon({ testId: 'AddIcon', key: 'ic1' }), svgIcon({ testId: 'FingerprintIcon', key: 'ic2' })] });
  const { tree: out } = recognize(structuredClone(tree), { registry: registryFor([muiPlugin]) });
  assert.equal(out.children[0].recognized.component, 'mui-icon');
  assert.equal(out.children[1].recognized.component, 'icon', 'an icon LVGL has no symbol for stays the core placeholder');
});

test('through the registry: a core Material UI component is left alone', () => {
  const card = node({ key: 'card', classes: ['MuiPaper-root', 'MuiCard-root'], w: 200, h: 100 });
  const withPlugin = recognize(structuredClone(node({ tag: 'body', key: 'body', children: [card] })), { registry: registryFor([muiPlugin]) }).tree;
  const coreOnly = recognize(structuredClone(node({ tag: 'body', key: 'body', children: [card] }))).tree;
  assert.equal(withPlugin.children[0].recognized?.component, coreOnly.children[0].recognized?.component);
});

test('through the registry: no framework data and no Mui classes means nothing is recognized', () => {
  const tree = node({ tag: 'body', key: 'body', children: [node({ tag: 'button', key: 'b', text: 'Go', classes: ['btn'] })] });
  const { recognized } = recognize(structuredClone(tree), { registry: createRegistry(recognizers) });
  assert.equal(recognized, 0);
});

/* ---------------------------------------------------------------- goldens */

const registry = registryFor([muiPlugin]);
const fixtures = readdirSync(join(pkg, 'tests', 'fixtures')).filter((f) => f.endsWith('.json'));
assert.ok(fixtures.length >= 2, 'expected the settings and branded snapshots');

for (const file of fixtures) {
  const name = file.replace(/\.json$/, '');
  const tree = () => JSON.parse(readFileSync(join(pkg, 'tests', 'fixtures', file), 'utf8'));
  const golden = (dir, f) => readFileSync(join(pkg, 'tests', dir, f), 'utf8');

  test(`golden xml: ${name}`, () => {
    assert.equal(convert(tree(), { name, registry }).xml, golden('golden', `${name}.xml`));
  });
  test(`golden c: ${name}`, () => {
    const { c, h, unit } = emitC(convert(tree(), { name, registry }).view, { name });
    assert.equal(c, golden('golden-c', `${unit}.c`));
    assert.equal(h, golden('golden-c', `${unit}.h`));
  });
  test(`golden cpp: ${name}`, () => {
    const { c, h, unit } = emitCpp(convert(tree(), { name, registry }).view, { name });
    assert.equal(c, golden('golden-cpp', `${unit}.cpp`));
    assert.equal(h, golden('golden-cpp', `${unit}.hpp`));
  });
  test(`golden py: ${name}`, () => {
    const { py, unit } = emitPy(convert(tree(), { name, registry }).view, { name });
    assert.equal(py, golden('golden-py', `${unit}.py`));
  });
}

test('golden xml: the plugin output differs from core-only output for the real Material UI pages (that is the point)', () => {
  for (const file of fixtures) {
    const name = file.replace(/\.json$/, '');
    const tree = JSON.parse(readFileSync(join(pkg, 'tests', 'fixtures', file), 'utf8'));
    const coreOnly = convert(tree, { name }).xml;
    const withPlugin = convert(tree, { name, registry }).xml;
    assert.notEqual(coreOnly, withPlugin, name);
    assert.doesNotMatch(withPlugin, /lv_textarea[^>]*text="on"/, `${name}: a Radio must not become a text area saying "on"`);
    assert.match(coreOnly, /lv_textarea[^>]*text="on"|lv_checkbox name="privateswitchbase/, `${name}: the core-only output shows the gap`);
  }
});

test('golden xml: renamed class prefixes are still recognized (core finds no Mui class on that page)', () => {
  const tree = JSON.parse(readFileSync(join(pkg, 'tests', 'fixtures', 'branded.json'), 'utf8'));
  const classes = JSON.stringify(tree);
  assert.doesNotMatch(classes, /"MuiCheckbox-root"/, 'the snapshot has no Mui class names left');
  const xml = convert(tree, { name: 'branded', registry }).xml;
  assert.equal((xml.match(/<lv_checkbox /g) ?? []).length, 2, 'both checkboxes found by their React component');
  assert.match(xml, /text="Keep me signed in"/);
});

/* ------------------------------------------------------------ end to end */

test('end to end: html2lvgl App.jsx --plugin <package> renders real Material UI through the plugin', { timeout: 120000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'html2lvgl-mui-'));
  execFileSync(process.execPath, [
    join(here, '..', 'src', 'cli.mjs'), join(pkg, 'examples', 'settings.jsx'),
    '--plugin', join(pkg, 'src', 'index.mjs'), '--size', '320x240', '-o', out, '--name', 'settings',
  ], { encoding: 'utf8' });
  const xml = readFileSync(join(out, 'settings.xml'), 'utf8');
  assert.match(xml, /<lv_checkbox name="checkbox"[^>]*checked="true"[^>]*text="Email alerts"/);
  assert.match(xml, /name="save_button"/);
  assert.match(xml, /name="icon_delete"/);
  assert.match(xml, /name="radio_ring"/);
  assert.equal(xml, readFileSync(join(pkg, 'tests', 'golden', 'settings.xml'), 'utf8'), 'the CLI output is the committed golden');
});
