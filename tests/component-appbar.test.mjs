/**
 * App bar component: each match signal and score, near misses, data-lv-widget
 * forcing, what build() returns, props/slots, and convert() output including
 * the `floating` pin in the XML, C, C++ and Python emitters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import appbar from '../src/components/appbar.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';

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
  x: 0, y: 0, w: 320, h: 56, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: `k${++keyCount}`,
  ...extra,
});
/** A page: body > [children]. */
const page = (...children) => node('body', { h: 240, children });
const run = (tree, parentOf) => {
  const root = structuredClone(tree);
  const { tree: out } = recognize(root, { registry: createRegistry([appbar]), diagnostics: createDiagnostics() });
  return parentOf ? parentOf(out) : out;
};
const score = (n, tree) => {
  const t = tree ?? page(n);
  const parent = t.children.includes(n) ? t : null;
  return Number(appbar.match(n, { tree: t, parent, diagnostics: createDiagnostics() }));
};

test('the app bar definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(appbar), { ok: true, errors: [] });
  assert.equal(appbar.name, 'appbar');
  assert.ok(builtinComponents.includes(appbar));
});

test('props and slots describe the palette entry', () => {
  assert.deepEqual(Object.keys(appbar.props), ['title', 'position']);
  assert.equal(appbar.props.title.type, 'string');
  assert.equal(appbar.props.position.default, 'static');
  assert.deepEqual(appbar.slots, ['leading', 'title', 'actions']);
});

test('role=banner scores 1, wherever the element sits', () => {
  const inner = node('div', { role: 'banner' });
  const t = page(node('main', { children: [inner] }));
  assert.equal(appbar.match(inner, { tree: t, parent: t.children[0] }), 1);
});

test('a header directly under the body scores 1', () => {
  const h = node('header');
  assert.equal(score(h), 1);
});

test('a header below lone wrapper divs (a React root) scores 1', () => {
  const h = node('header');
  const t = page(node('div', { id: 'root', children: [node('div', { children: [h] })] }));
  const inner = t.children[0].children[0];
  assert.equal(appbar.match(h, { tree: t, parent: inner }), 1);
});

test('a header inside article, section, main, aside or nav is NOT an app bar', () => {
  for (const tag of ['article', 'section', 'main', 'aside', 'nav']) {
    const h = node('header');
    const wrap = node(tag, { children: [h] });
    const t = page(wrap);
    assert.equal(Number(appbar.match(h, { tree: t, parent: wrap })), 0, tag);
  }
});

test('a header in a div that has siblings (a card heading) is NOT an app bar', () => {
  const h = node('header');
  const card = node('div', { children: [h, node('p')] });
  const t = page(card, node('div'));
  assert.equal(Number(appbar.match(h, { tree: t, parent: card })), 0);
});

test('MuiAppBar-root scores 0.7, and loses to a semantic signal', () => {
  const m = node('div', { classes: ['MuiPaper-root', 'MuiAppBar-root'] });
  assert.equal(score(m), 0.7);
  const both = node('header', { classes: ['MuiAppBar-root'] });
  assert.equal(score(both), 1);
});

test('near misses: a plain div, a footer, a toolbar-only node', () => {
  assert.equal(score(node('div')), 0);
  assert.equal(score(node('footer')), 0);
  assert.equal(score(node('div', { classes: ['MuiToolbar-root'] })), 0);
  assert.equal(score(node('div', { role: 'toolbar' })), 0);
});

test('match never throws on a bare node or missing context', () => {
  assert.doesNotThrow(() => appbar.match(node('header'), {}));
  assert.doesNotThrow(() => appbar.match({ tag: 'header', children: [] }, { tree: null, parent: null }));
});

test('data-lv-widget="appbar" forces a plain div', () => {
  const div = node('div', { widget: 'appbar', children: [node('h1', { text: 'Home' })] });
  const out = run(page(div), (t) => t.children[0]);
  assert.equal(out.recognized.component, 'appbar');
  assert.equal(out.recognized.props.title, 'Home');
});

test('build names the bar and its title, and reports title and position', () => {
  const title = node('h6', { text: 'Dashboard', classes: ['MuiTypography-h6'] });
  const btn = node('button', { text: 'Login' });
  const bar = node('header', { classes: ['MuiAppBar-root'], layout: layout({ position: 'fixed' }), children: [btn, title] });
  const out = run(page(bar), (t) => t.children[0]);
  assert.equal(out.lvName, 'appbar');
  assert.deepEqual(out.recognized.props, { title: 'Dashboard', position: 'fixed' });
  assert.equal(out.children[1].lvName, 'appbar_title');
  assert.equal(out.children[0].lvName, null);
  assert.equal(out.children[0].text, 'Login'); // content survives
});

test('title falls back to the first text outside a button, and to empty', () => {
  const bar = node('header', { children: [node('button', { text: 'Menu' }), node('span', { text: 'Home' })] });
  assert.equal(run(page(bar), (t) => t.children[0]).recognized.props.title, 'Home');
  const bare = node('header', { children: [node('button', { text: 'Menu' })] });
  assert.equal(run(page(bare), (t) => t.children[0]).recognized.props.title, '');
});

test('an author-set data-lv-name is kept', () => {
  const bar = node('header', { lvName: 'top_bar' });
  assert.equal(run(page(bar), (t) => t.children[0]).lvName, 'top_bar');
});

test('an unknown position falls back to static', () => {
  const bar = node('header', { layout: layout({ position: 'inherit' }) });
  assert.equal(run(page(bar), (t) => t.children[0]).recognized.props.position, 'static');
});

test('transparent buttons take the bar color so LVGL does not paint them blue', () => {
  const btn = node('button', { text: 'Login', w: 60, h: 28 });
  const solid = node('header', { styles: styles({ bgColor: [25, 118, 210, 255] }), children: [btn] });
  const out = run(page(solid), (t) => t.children[0]);
  assert.deepEqual(out.children[0].styles.bgColor, [25, 118, 210, 255]);
  const clear = node('header', { children: [node('button', { text: 'x' })] });
  assert.equal(run(page(clear), (t) => t.children[0]).children[0].styles.bgColor, null);
});

test('the title node is the one findTitle chose, even when a button holds the same words', () => {
  const inner = node('span', { text: 'Home' });
  const heading = node('h1', { text: 'Home' });
  const bar = node('header', { children: [node('button', { children: [inner] }), heading] });
  const out = run(page(bar), (t) => t.children[0]);
  assert.equal(out.children[0].children[0].lvName, null, 'the button label must not be named');
  assert.equal(out.children[1].lvName, 'appbar_title');
});

test('a transparent button takes the nearest solid color behind it, not always the bar color', () => {
  const inBar = node('button', { text: 'a' });
  const inToolbar = node('button', { text: 'b' });
  const inGradient = node('button', { text: 'c' });
  const inGlass = node('button', { text: 'd' });
  const toolbar = node('div', { styles: styles({ bgColor: [255, 255, 255, 255] }), children: [inToolbar] });
  const gradient = node('div', { styles: styles({ gradient: { from: [0, 0, 0, 255], to: [255, 255, 255, 255], dir: 'hor' } }), children: [inGradient] });
  const glass = node('div', { styles: styles({ bgColor: [255, 255, 255, 120] }), children: [inGlass] });
  const bar = node('header', { styles: styles({ bgColor: [25, 118, 210, 255] }), children: [inBar, toolbar, gradient, glass] });
  const out = run(page(bar), (t) => t.children[0]);
  assert.deepEqual(out.children[0].styles.bgColor, [25, 118, 210, 255]);
  assert.deepEqual(out.children[1].children[0].styles.bgColor, [255, 255, 255, 255]);
  assert.equal(out.children[2].children[0].styles.bgColor, null, 'no single color behind a gradient');
  assert.equal(out.children[3].children[0].styles.bgColor, null, 'no single color behind a translucent layer');
});

/* ---- convert(): pinning ---- */

const bar = (position) => node('header', {
  w: 320, h: 56, styles: styles({ bgColor: [25, 118, 210, 255] }),
  layout: layout({ position, display: 'flex', alignItems: 'center' }),
  children: [node('h6', { text: 'Dashboard', w: 100, h: 24, x: 16, y: 16 })],
});
const rows = () => [1, 2, 3].map((i) => node('div', { y: 56 + i * 40, h: 32, w: 288, x: 16, text: `Row ${i}` }));

test('convert: a fixed bar gets floating="true", is named appbar, and is drawn last', () => {
  const { xml } = convert(page(bar('fixed'), ...rows()));
  assert.match(xml, /<lv_obj name="appbar"[^>]* floating="true"/);
  assert.ok(xml.indexOf('name="appbar"') > xml.indexOf('Row 3'), 'the bar must come after the content so it paints on top');
});

test('convert: a sticky bar is converted like a fixed one', () => {
  const { xml } = convert(page(bar('sticky'), ...rows()));
  assert.match(xml, /name="appbar"[^>]* floating="true"/);
});

test('convert: a static, relative or absolute bar is not floating, and stays in order', () => {
  for (const position of ['static', 'relative', 'absolute']) {
    const { xml } = convert(page(bar(position), ...rows()));
    assert.doesNotMatch(xml, /floating/, position);
    assert.ok(xml.indexOf('name="appbar"') < xml.indexOf('Row 1'), position);
  }
});

test('convert: a fixed non-app-bar element is not touched', () => {
  const plain = node('div', { layout: layout({ position: 'fixed' }), w: 100, h: 20 });
  assert.doesNotMatch(convert(page(plain)).xml, /floating/);
});

test('convert: a fixed bar in a flex parent is out of flow and floating', () => {
  const flexPage = page(bar('fixed'), ...rows());
  flexPage.layout = layout({ display: 'flex', flexDirection: 'column' });
  const { xml } = convert(flexPage);
  assert.match(xml, /name="appbar"[^>]* x="0" y="0" ignore_layout="true" floating="true"/);
  assert.match(xml, /name="appbar"[^>]* ignore_layout="true"/);
});

test('convert: the floating flag reaches the C, C++ and Python emitters', () => {
  const result = convert(page(bar('fixed'), ...rows()), { name: 'bar_page' });
  assert.match(emitC(result.view, { name: 'bar_page' }).c, /lv_obj_set_flag\(appbar, LV_OBJ_FLAG_FLOATING, true\);/);
  assert.match(emitCpp(result.view, { name: 'bar_page' }).c, /lv_obj_set_flag\(appbar, LV_OBJ_FLAG_FLOATING, true\);/);
  assert.match(emitPy(result.view, { name: 'bar_page' }).py, /appbar\.set_flag\(lv\.obj\.FLAG\.FLOATING, True\)/);
});

test('convert: the empty spacer toolbar under a fixed bar is kept with its height', () => {
  const spacer = node('div', { classes: ['MuiToolbar-root'], h: 56, w: 320 });
  const { xml } = convert(page(bar('fixed'), spacer, ...rows()));
  assert.match(xml, /<lv_obj name="toolbar"[^>]* height="56"/);
});
