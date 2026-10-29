/**
 * Breadcrumbs: matching signals and scores, near misses, data-lv-widget
 * forcing, what build() changes, props/slots, and convert() on hand-built
 * trees (single page, multi-page, unknown link target).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import breadcrumbs from '../src/components/breadcrumbs.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { createDiagnostics } from '../src/diagnostics.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';

function styles(extra = {}) {
  return {
    bgColor: null, color: [10, 20, 30, 255], borderColor: null, borderWidth: 0,
    borderBottomColor: null, borderBottomWidth: 0, radius: 0, fontSize: 14,
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
const node = (tag, extra = {}) => ({
  tag, id: null, className: null, lvName: null, widget: null, component: null, link: null,
  x: 0, y: 0, w: 40, h: 20, text: null, attrs: {}, styles: styles(), layout: layout(), children: [], key: 'k',
  ...extra,
});
const ctx = (parent = null) => ({ diagnostics: createDiagnostics(), parent });
const score = (n, parent = null) => Number(breadcrumbs.match(n, ctx(parent)));

const link = (text, href, extra = {}) => node('li', { children: [node('a', { text, attrs: { href }, ...extra })] });
const sep = (text = '/') => node('li', { text, aria: { hidden: 'true' }, w: 6 });

/** Plain ARIA trail: Home / Devices / Thermostat (current). */
function trail(extra = {}, listExtra = {}) {
  return node('nav', {
    aria: { label: 'Breadcrumb' }, w: 288, h: 20,
    children: [node('ol', {
      w: 288, layout: layout({ display: 'flex' }),
      children: [
        link('Home', 'home.html'), sep(),
        link('Devices', 'devices.html'), sep(),
        link('Thermostat', 'thermostat.html', { aria: { current: 'page' } }),
      ],
      ...listExtra,
    })],
    ...extra,
  });
}

/** The page nodes (list items that are not separators) of a built trail. */
const pagesOf = (nav) => nav.children[0].children.filter((li) => !li.aria?.hidden);

test('the breadcrumbs definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(breadcrumbs), { ok: true, errors: [] });
  assert.equal(breadcrumbs.name, 'breadcrumbs');
  assert.ok(builtinComponents.includes(breadcrumbs));
  assert.equal(createRegistry([breadcrumbs]).rejected.length, 0);
  assert.deepEqual(breadcrumbs.slots, ['items']);
  assert.deepEqual(breadcrumbs.props, { separator: { type: 'string', default: '/' } });
});

test('signal: a nav with a breadcrumb aria-label scores 1, in any case and plural', () => {
  assert.equal(score(node('nav', { aria: { label: 'breadcrumb' } })), 1);
  assert.equal(score(node('nav', { aria: { label: 'Breadcrumbs' } })), 1);
  assert.equal(score(node('nav', { aria: { label: 'Site BREADCRUMB trail' } })), 1);
  assert.equal(score(node('div', { role: 'navigation', aria: { label: 'breadcrumb' } })), 1);
});

test('signal: MuiBreadcrumbs-root scores 0.7, any tag', () => {
  assert.equal(score(node('nav', { classes: ['MuiBreadcrumbs-root'] })), 0.7);
  assert.equal(score(node('div', { classes: ['MuiBreadcrumbs-root', 'css-1'] })), 0.7);
  assert.equal(score(node('nav', { className: 'MuiBreadcrumbs-root' })), 0.7); // no classes field
});

test('the semantic signal beats the Material UI class when both are present', () => {
  assert.equal(score(node('nav', { aria: { label: 'breadcrumb' }, classes: ['MuiBreadcrumbs-root'] })), 1);
});

test('signal: Bootstrap .breadcrumb on a list scores 0.5, but not under a nav that already matched', () => {
  const ol = node('ol', { classes: ['breadcrumb'] });
  assert.equal(score(ol), 0.5);
  assert.equal(score(node('ul', { classes: ['breadcrumb'] })), 0.5);
  assert.equal(score(ol, node('nav', { aria: { label: 'breadcrumb' } })), 0, 'the labelled nav owns the list');
  assert.equal(score(ol, node('nav', { aria: { label: 'Main' } })), 0.5);
  assert.equal(score(node('div', { classes: ['breadcrumb'] })), 0, 'only lists carry Bootstrap breadcrumb');
});

test('near misses: other navs, tab bars, pagination, menus are not breadcrumbs', () => {
  assert.equal(score(node('nav', { aria: { label: 'Main' } })), 0);
  assert.equal(score(node('nav', { aria: { label: 'Page navigation' } })), 0);
  assert.equal(score(node('nav', { aria: { label: 'pagination' }, classes: ['MuiPagination-root'] })), 0);
  assert.equal(score(node('nav', { role: 'tablist' })), 0);
  assert.equal(score(node('nav', { classes: ['navbar'] })), 0);
  assert.equal(score(node('nav')), 0);
  assert.equal(score(node('div', { aria: { label: 'breadcrumb' } })), 0, 'a label on a non-navigation div is not enough');
  assert.equal(score(node('ul', { classes: ['pagination'] })), 0);
  assert.equal(score(node('ol')), 0);
});

test('match never throws on a bare node', () => {
  assert.doesNotThrow(() => breadcrumbs.match({ tag: 'nav', children: [] }, {}));
  assert.doesNotThrow(() => breadcrumbs.match({ tag: 'ol', classes: ['breadcrumb'], children: [] }, undefined));
});

test('data-lv-widget="breadcrumbs" forces the match (registry score 2)', () => {
  const tree = node('body', { children: [node('div', { widget: 'breadcrumbs', children: [node('ol', { children: [link('Home', 'a.html')] })] })] });
  const out = recognize(structuredClone(tree), { registry: createRegistry([breadcrumbs]) });
  assert.equal(out.recognized, 1);
  assert.equal(out.tree.children[0].recognized.component, 'breadcrumbs');
});

test('build: the current page loses its link, the other pages keep theirs', () => {
  const built = breadcrumbs.build(trail(), ctx());
  const [home, devices, current] = pagesOf(built);
  assert.equal(home.children[0].tag, 'a');
  assert.equal(home.children[0].attrs.href, 'home.html');
  assert.equal(devices.children[0].tag, 'a');
  assert.equal(current.children[0].tag, 'span');
  assert.equal(current.children[0].attrs.href, undefined);
  assert.equal(current.children[0].link, null);
  assert.equal(current.children[0].text, 'Thermostat', 'the label survives');
});

test('build: a data-lv-link on the current item is cleared too', () => {
  const nav = trail();
  nav.children[0].children[4].children[0].link = 'thermostat';
  const built = breadcrumbs.build(nav, ctx());
  assert.equal(pagesOf(built)[2].children[0].link, null);
});

test('build: a Material UI current page (a <p>) is left as it is', () => {
  const nav = node('nav', {
    classes: ['MuiBreadcrumbs-root'], aria: { label: 'breadcrumb' },
    children: [node('ol', { classes: ['MuiBreadcrumbs-ol'], children: [
      node('li', { classes: ['MuiBreadcrumbs-li'], children: [node('a', { text: 'Home', attrs: { href: '/' } })] }),
      node('li', { classes: ['MuiBreadcrumbs-separator'], aria: { hidden: 'true' }, text: '/' }),
      node('li', { classes: ['MuiBreadcrumbs-li'], children: [node('p', { text: 'Network', aria: { current: 'page' } })] }),
    ] })],
  });
  const built = breadcrumbs.build(nav, ctx());
  assert.equal(built.children[0].children[2].children[0].tag, 'p');
  assert.equal(built.children[0].children[0].children[0].tag, 'a');
});

test('build: names the nav, reports the separator prop, keeps every item and separator', () => {
  const nav = trail();
  const built = breadcrumbs.build(nav, ctx());
  assert.equal(built.lvName, 'breadcrumbs');
  assert.deepEqual(built.recognized.props, { separator: '/' });
  assert.equal(built.children[0].children.length, 5);
  assert.equal(built.children[0].children[1].text, '/');
  assert.equal(nav.lvName, null, 'the input node is not mutated');
  assert.equal(nav.children[0].children[4].children[0].tag, 'a', 'the input tree keeps its anchor');
});

test('build: the separator prop is read from the page ("›" stays "›")', () => {
  const nav = trail();
  nav.children[0].children[1] = sep('›');
  nav.children[0].children[3] = sep('›');
  assert.equal(breadcrumbs.build(nav, ctx()).recognized.props.separator, '›');
});

test('build: an author-set data-lv-name is kept', () => {
  assert.equal(breadcrumbs.build(trail({ lvName: 'crumbs' }), ctx()).lvName, 'crumbs');
});

test('build: Bootstrap items without separator elements get "/" separators', () => {
  const item = (text, href, cls = []) => node('li', {
    classes: ['breadcrumb-item', ...cls],
    children: [href ? node('a', { text, attrs: { href } }) : node('span', { text })],
  });
  const nav = node('nav', {
    aria: { label: 'breadcrumb' },
    children: [node('ol', { classes: ['breadcrumb'], children: [item('Home', 'a.html'), item('Library', 'b.html'), item('Data', null, ['active'])] })],
  });
  const built = breadcrumbs.build(nav, ctx());
  const kids = built.children[0].children;
  assert.equal(kids.length, 5);
  assert.deepEqual(kids.map((k) => k.text ?? k.children[0].text), ['Home', '/', 'Library', '/', 'Data']);
  assert.equal(kids[1].lvName, 'separator');
  assert.equal(kids[1].aria.hidden, 'true');
});

test('build: plain ARIA markup with no separator elements is not guessed at', () => {
  const nav = trail();
  nav.children[0].children = [link('Home', 'a.html'), link('Devices', 'b.html')];
  assert.equal(breadcrumbs.build(nav, ctx()).children[0].children.length, 2);
});

test('build: a single item gets no separator', () => {
  const nav = node('nav', {
    aria: { label: 'breadcrumb' },
    children: [node('ol', { classes: ['breadcrumb'], children: [node('li', { classes: ['breadcrumb-item', 'active'], children: [node('span', { text: 'Home' })] })] })],
  });
  assert.equal(breadcrumbs.build(nav, ctx()).children[0].children.length, 1);
});

test('build: a nav with no list is only named', () => {
  const built = breadcrumbs.build(node('nav', { aria: { label: 'breadcrumb' }, children: [node('a', { text: 'Home', attrs: { href: '/' } })] }), ctx());
  assert.equal(built.lvName, 'breadcrumbs');
  assert.equal(built.children[0].tag, 'a');
});

test('recognize: Bootstrap nav + ol is recognized once, not twice', () => {
  const nav = node('nav', {
    aria: { label: 'breadcrumb' },
    children: [node('ol', { classes: ['breadcrumb'], children: [link('Home', 'a.html')] })],
  });
  const out = recognize(node('body', { children: [nav] }), { registry: createRegistry([breadcrumbs]) });
  assert.equal(out.recognized, 1);
});

test('recognize: a site menu nav and a labelled "Main" nav are left alone', () => {
  const menu = node('nav', { aria: { label: 'Main' }, children: [node('ul', { children: [link('Home', 'a.html'), link('About', 'b.html')] })] });
  const out = recognize(node('body', { children: [menu] }), { registry: createRegistry([breadcrumbs]) });
  assert.equal(out.recognized, 0);
  assert.equal(out.tree.children[0].lvName, null);
});

/* ---------------------------------------------------------------- convert */

const page = (nav) => node('body', { w: 320, h: 240, layout: layout({ display: 'flex', flexDirection: 'column' }), children: [nav] });
const labelsOf = (xml) => [...xml.matchAll(/<lv_label [^>]*text="([^"]*)"/g)].map((m) => m[1]);

test('convert, single page: a flex row of labels with the separators, named breadcrumbs', () => {
  const { xml, diagnostics } = convert(page(trail()), { name: 'trail' });
  assert.deepEqual(labelsOf(xml), ['Home', '/', 'Devices', '/', 'Thermostat']);
  assert.match(xml, /name="breadcrumbs"/);
  assert.match(xml, /flex_flow="row"/);
  assert.doesNotMatch(xml, /<lv_button/);
  assert.equal(diagnostics.list().filter((d) => d.code === 'LINK_TARGET_UNKNOWN').length, 0);
});

test('convert, multi-page: links to sibling pages become buttons, the current page stays a label', () => {
  const { xml } = convert(page(trail()), { name: 'thermostat', screenMode: true, screens: new Set(['home', 'devices', 'thermostat']) });
  assert.match(xml, /<lv_button name="to_home"/);
  assert.match(xml, /<screen_create_event screen="home" \/>/);
  assert.match(xml, /<lv_button name="to_devices"/);
  assert.match(xml, /<screen_create_event screen="devices" \/>/);
  assert.doesNotMatch(xml, /to_thermostat/, 'the current page must not navigate to itself');
  assert.doesNotMatch(xml, /screen="thermostat"/);
  assert.deepEqual(labelsOf(xml), ['Home', '/', 'Devices', '/', 'Thermostat']);
});

test('convert, multi-page: without the component the current page would be a self-link button', () => {
  const { xml } = convert(page(trail()), { name: 'thermostat', screenMode: true, screens: new Set(['home', 'devices', 'thermostat']), registry: createRegistry([]) });
  assert.match(xml, /to_thermostat/);
});

test('convert, multi-page: a data-lv-link to an unknown page raises LINK_TARGET_UNKNOWN and stays a label', () => {
  const nav = trail();
  nav.children[0].children[2] = node('li', { children: [node('a', { text: 'Devices', link: 'nowhere', attrs: { href: 'devices.html' } })] });
  const { xml, diagnostics } = convert(page(nav), { name: 'thermostat', screenMode: true, screens: new Set(['home', 'thermostat']) });
  const unknown = diagnostics.list().filter((d) => d.code === 'LINK_TARGET_UNKNOWN');
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].message, /nowhere/);
  assert.doesNotMatch(xml, /screen="nowhere"/);
  assert.ok(labelsOf(xml).includes('Devices'));
  assert.match(xml, /<lv_button name="to_home"/);
});

test('convert: a nowrap trail wider than its parent keeps its item widths (clipped, not collapsed)', () => {
  const nav = trail();
  nav.children[0].children = [
    link('Home', 'a.html'), sep(), link('Devices', 'b.html'), sep(), link('Living room', 'c.html'), sep(),
    link('Thermostat', 'd.html'), sep(), node('li', { children: [node('span', { text: 'Schedule', aria: { current: 'page' } })] }),
  ].map((li) => ({ ...li, w: 80 }));
  nav.children[0].w = 288;
  const { xml } = convert(page(nav), { name: 'long' });
  assert.equal(labelsOf(xml).length, 9, 'every item is kept, none is collapsed into an ellipsis');
  assert.doesNotMatch(xml, /\.\.\.|…/);
});

test('convert: row_wrap is kept for a wrapping (Material UI) trail', () => {
  const nav = trail({}, { layout: layout({ display: 'flex', flexWrap: 'wrap' }) });
  const { xml } = convert(page(nav), { name: 'wrap' });
  assert.match(xml, /flex_flow="row_wrap"/);
});

test('convert: a plain site nav is unchanged by the registry', () => {
  const menu = node('nav', { aria: { label: 'Main' }, children: [node('ul', { layout: layout({ display: 'flex' }), children: [link('Home', 'a.html'), link('About', 'b.html')] })] });
  const withComponent = convert(page(menu), { name: 'm' }).xml;
  const without = convert(page(structuredClone(menu)), { name: 'm', registry: createRegistry([]) }).xml;
  assert.equal(withComponent, without);
});
