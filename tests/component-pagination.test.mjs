/**
 * Pagination: matching signals, near misses, what build() changes (the
 * current page's link, SVG arrows, the ellipsis), navigation in a multi-page
 * run, and convert() output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pagination from '../src/components/pagination.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { node, ctx, page, layout } from './helpers/ui-node.mjs';

const score = (n, parent = null) => Number(pagination.match(n, ctx({ parent })));

const anchor = (text, href, extra = {}) => node('li', { children: [node('a', { text, attrs: { href }, w: 32, h: 32, ...extra })] });

/** Plain ARIA pager: < 1 2 [3] 4 >, links to results-N pages. */
function pager(extra = {}) {
  return node('nav', {
    aria: { label: 'Pagination' }, w: 288, h: 32,
    children: [node('ul', { layout: layout({ display: 'flex' }), children: [
      anchor('<', 'results-2.html', { aria: { label: 'Previous page' } }),
      anchor('1', 'results-1.html'),
      anchor('2', 'results-2.html'),
      anchor('3', 'results-3.html', { aria: { current: 'page' } }),
      anchor('4', 'results-4.html'),
      anchor('>', 'results-4.html', { aria: { label: 'Next page' } }),
    ] })],
    ...extra,
  });
}

const svgArrow = (label, disabled = false) => node('li', { children: [node('button', {
  w: 32, h: 32, aria: { label }, attrs: disabled ? { disabled: true } : {}, classes: ['MuiPaginationItem-root'],
  children: [node('svg', { w: 20, h: 20, aria: { hidden: 'true' }, children: [node('path')] })],
})] });

/** Material UI: prev (svg, disabled), selected page 1 with aria-current="true", pages, ellipsis, next (svg). */
function muiPagination() {
  const page = (n, current = false) => node('li', { children: [node('button', {
    text: String(n), w: 32, h: 32, aria: { label: current ? `page ${n}` : `Go to page ${n}`, ...(current ? { current: 'true' } : {}) },
    classes: ['MuiPaginationItem-root', ...(current ? ['Mui-selected'] : [])],
  })] });
  return node('nav', {
    aria: { label: 'pagination navigation' }, classes: ['MuiPagination-root'], w: 288, h: 32,
    children: [node('ul', { classes: ['MuiPagination-ul'], children: [
      svgArrow('Go to previous page', true), page(1, true), page(2), page(3),
      node('li', { children: [node('div', { classes: ['MuiPaginationItem-root', 'MuiPaginationItem-ellipsis'], text: '…' })] }),
      page(10), svgArrow('Go to next page'),
    ] })],
  });
}

test('the pagination definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(pagination), { ok: true, errors: [] });
  assert.equal(pagination.name, 'pagination');
  assert.ok(builtinComponents.includes(pagination));
  assert.equal(createRegistry([pagination]).rejected.length, 0);
  assert.deepEqual(pagination.slots, ['items']);
});

test('signals: pagination, pager and "Page navigation" labels score 1; MuiPagination-root 0.7; Bootstrap .pagination 0.5', () => {
  assert.equal(score(node('nav', { aria: { label: 'Pagination' } })), 1);
  assert.equal(score(node('nav', { aria: { label: 'pagination navigation' } })), 1);
  assert.equal(score(node('nav', { aria: { label: 'Page navigation' } })), 1);
  assert.equal(score(node('div', { role: 'navigation', aria: { label: 'Search results pager' } })), 1);
  assert.equal(score(node('div', { classes: ['MuiPagination-root'] })), 0.7);
  assert.equal(score(node('ul', { classes: ['pagination'] })), 0.5);
  assert.equal(score(node('nav', { aria: { label: 'x' }, classes: ['MuiPagination-root'] })), 0.7);
  assert.equal(score(node('nav', { aria: { label: 'pagination' }, classes: ['MuiPagination-root'] })), 1, 'the semantic signal beats the class');
});

test('Bootstrap: the list under a labelled nav is not matched twice', () => {
  const ul = node('ul', { classes: ['pagination'] });
  assert.equal(score(ul, node('nav', { aria: { label: 'Page navigation' } })), 0);
  assert.equal(score(ul, node('nav', { aria: { label: 'x' } })), 0.5);
});

test('near misses: breadcrumbs, a main nav, a tab list, a div with a pagination label', () => {
  assert.equal(score(node('nav', { aria: { label: 'breadcrumb' } })), 0);
  assert.equal(score(node('nav', { aria: { label: 'Main' } })), 0);
  assert.equal(score(node('nav', { role: 'tablist' })), 0);
  assert.equal(score(node('div', { aria: { label: 'pagination' } })), 0);
  assert.equal(score(node('ul')), 0);
  assert.equal(score(node('nav', { aria: { label: 'Paginator of nothing' } })), 0);
});

test('match never throws on a bare node', () => {
  assert.doesNotThrow(() => pagination.match({ tag: 'nav', children: [] }, {}));
  assert.doesNotThrow(() => pagination.match({ tag: 'ul', classes: ['pagination'], children: [] }, undefined));
});

test('data-lv-widget="pagination" forces the match', () => {
  const out = recognize(node('body', { children: [node('div', { widget: 'pagination', children: [node('ul', { children: [anchor('1', 'a.html')] })] })] }), { registry: createRegistry([pagination]) });
  assert.equal(out.tree.children[0].recognized.component, 'pagination');
});

test('build: the current page loses its link; the other pages and their data-lv-link keep theirs', () => {
  const nav = pager();
  nav.children[0].children[2].children[0].link = 'results-2';
  const built = pagination.build(nav, ctx());
  const items = built.children[0].children;
  assert.equal(items[3].children[0].tag, 'span');
  assert.equal(items[3].children[0].attrs.href, undefined);
  assert.equal(items[3].children[0].text, '3', 'the label survives');
  assert.equal(items[2].children[0].tag, 'a');
  assert.equal(items[2].children[0].link, 'results-2');
  assert.equal(items[1].children[0].attrs.href, 'results-1.html');
  assert.equal(nav.children[0].children[3].children[0].tag, 'a', 'the input is not mutated');
});

test('build: a Material UI selected page (aria-current="true" and Mui-selected) is found; buttons stay buttons', () => {
  const built = pagination.build(muiPagination(), ctx());
  assert.deepEqual(built.recognized.props, { count: 7, current: 1 });
  assert.equal(built.children[0].children[1].children[0].tag, 'button');
});

test('build: a Bootstrap active list item marks the current page', () => {
  const item = (text, active) => node('li', { classes: ['page-item', ...(active ? ['active'] : [])], children: [node('a', { classes: ['page-link'], text, attrs: { href: `${text}.html` } })] });
  const nav = node('nav', { aria: { label: 'Page navigation' }, children: [node('ul', { classes: ['pagination'], children: [item('1', false), item('2', true), item('3', false)] })] });
  const built = pagination.build(nav, ctx());
  assert.equal(built.recognized.props.current, 1);
  assert.equal(built.children[0].children[1].children[0].tag, 'span');
  assert.equal(built.children[0].children[0].children[0].tag, 'a');
});

test('build: aria-current="false" is not a current page', () => {
  const nav = pager();
  nav.children[0].children.forEach((li) => { li.children[0].aria = { ...li.children[0].aria, current: 'false' }; });
  assert.equal(pagination.build(nav, ctx()).recognized.props.current, -1);
});

test('build: SVG arrows get a glyph from their aria-label; a text arrow, an unlabelled svg and a page are left alone', () => {
  const built = pagination.build(muiPagination(), ctx());
  const items = built.children[0].children;
  const prev = items[0].children[0];
  assert.equal(prev.text, '<');
  assert.equal(prev.children.length, 0);
  assert.equal(prev.styles.textAlign, 'center');
  assert.equal(items[6].children[0].text, '>');
  assert.equal(items[1].children[0].text, '1');

  const mixed = node('nav', { aria: { label: 'Pagination' }, children: [node('ul', { children: [
    svgArrow('Go to first page'), svgArrow('Go to last page'),
    node('li', { children: [node('button', { aria: { label: 'something else' }, children: [node('svg')] })] }),
  ] })] });
  const out = pagination.build(mixed, ctx()).children[0].children;
  assert.equal(out[0].children[0].text, '<<');
  assert.equal(out[1].children[0].text, '>>');
  assert.equal(out[2].children[0].children[0].tag, 'svg', 'no direction word: untouched');
});

test('build: the ellipsis U+2026 is written as three dots (the built-in fonts have no U+2026)', () => {
  const built = pagination.build(muiPagination(), ctx());
  assert.equal(built.children[0].children[4].children[0].text, '...');
});

test('build: names the nav, keeps an author name, and a nav with no list still gets named', () => {
  assert.equal(pagination.build(pager(), ctx()).lvName, 'pagination');
  assert.equal(pagination.build(pager({ lvName: 'pages' }), ctx()).lvName, 'pages');
  const bare = pagination.build(node('nav', { aria: { label: 'Pagination' }, children: [node('a', { text: '1', attrs: { href: 'a.html' }, aria: { current: 'page' } })] }), ctx());
  assert.equal(bare.lvName, 'pagination');
  assert.equal(bare.children[0].tag, 'span');
});

/* ---------------------------------------------------------------- convert */

const SCREENS = new Set(['results_1', 'results_2', 'results_3', 'results_4']);

test('convert, single page: labels for every page, the SVG arrows as < and >, named pagination', () => {
  const { xml, diagnostics } = convert(page(muiPagination()), { name: 'results' });
  const labels = [...xml.matchAll(/<lv_label [^>]*text="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['&lt;', '1', '2', '3', '...', '10', '&gt;'], 'the XML escapes < and >');
  assert.match(xml, /name="pagination"/);
  assert.equal(diagnostics.list().filter((d) => d.code === 'ICON_PLACEHOLDER').length, 0);
});

test('convert, multi-page: other pages navigate, the current page does not, prev and next keep their links', () => {
  const { xml } = convert(page(pager()), { name: 'results_3', screenMode: true, screens: SCREENS });
  assert.match(xml, /<screen_create_event screen="results_1" \/>/);
  assert.match(xml, /<screen_create_event screen="results_2" \/>/);
  assert.match(xml, /<screen_create_event screen="results_4" \/>/);
  assert.doesNotMatch(xml, /screen="results_3"/, 'the current page must not navigate to itself');
});

test('convert, multi-page: without the component the current page would link to itself', () => {
  const { xml } = convert(page(pager()), { name: 'results_3', screenMode: true, screens: SCREENS, registry: createRegistry([]) });
  assert.match(xml, /screen="results_3"/);
});
