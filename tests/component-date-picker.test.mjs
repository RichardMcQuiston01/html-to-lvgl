/**
 * Date picker (lv_calendar): matching signals, what build() reads from the
 * DOM, the cases that report UNSUPPORTED_WIDGET, and convert()/emit output in
 * every format.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import datePicker, { parseMonthYear } from '../src/components/date-picker.mjs';
import { validateComponent, createRegistry, recognize } from '../src/recognize.mjs';
import { builtinComponents } from '../src/components/index.mjs';
import { convert } from '../src/convert.mjs';
import { emitC, emitCpp } from '../src/emit-c.mjs';
import { emitPy } from '../src/emit-py.mjs';
import { node, ctx, page, styles } from './helpers/ui-node.mjs';

const score = (n, c = ctx()) => Number(datePicker.match(n, c));

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONDAY_FIRST = [...WEEK.slice(1), WEEK[0]];

/**
 * A month grid. `firstWeekday` is the column of day 1 (0 = Sunday), `days` the
 * month length; `leading`/`trailing` add days of the neighbouring months.
 */
function grid({ firstWeekday = 0, days = 30, selected = null, today = null, leading = [], trailing = [], heads = WEEK, extra = {} } = {}) {
  const numbers = [...leading, ...Array.from({ length: days }, (_, i) => i + 1), ...trailing];
  const offset = firstWeekday - leading.length;
  const cells = numbers.map((day, i) => {
    const col = (((offset + i) % 7) + 7) % 7;
    const inMonth = i >= leading.length && i < leading.length + days;
    return node('button', {
      role: 'gridcell', text: String(day), x: 10 + col * 40, y: 30 + Math.floor((offset + i) / 7) * 28, w: 28, h: 28,
      aria: { ...(inMonth && day === selected ? { selected: 'true' } : {}), ...(inMonth && day === today ? { current: 'date' } : {}) },
      styles: styles({ fontSize: 12, color: [0, 0, 0, 222] }),
    });
  });
  const columnHeads = heads.map((label, i) => node('span', { role: 'columnheader', aria: { label }, text: label[0], x: 10 + i * 40 }));
  return node('div', { role: 'grid', aria: { labelledby: 'title' }, w: 280, h: 200, children: [node('div', { role: 'row', children: columnHeads }), ...cells], ...extra });
}

const title = (text = 'November 2026') => node('h3', { id: 'title', text, aria: { live: 'polite' } });
const byId = (...nodes) => new Map(nodes.map((n) => [n.id, n]));

/** A Material UI DateCalendar root: header (live title and arrows) plus the grid. */
function muiCalendar(options = {}, rootExtra = {}) {
  return node('div', {
    classes: ['MuiDateCalendar-root'], w: 304, h: 210,
    children: [
      node('div', { classes: ['MuiPickersCalendarHeader-root'], children: [node('div', { classes: ['MuiPickersCalendarHeader-label'], aria: { live: 'polite' }, text: options.title ?? 'November 2026' })] }),
      grid(options),
    ],
    ...rootExtra,
  });
}

test('the date picker definition is valid and registered by default', () => {
  assert.deepEqual(validateComponent(datePicker), { ok: true, errors: [] });
  assert.equal(datePicker.name, 'date-picker');
  assert.ok(builtinComponents.includes(datePicker));
  assert.equal(createRegistry([datePicker]).rejected.length, 0);
});

test('signal: a role=grid of a month of days scores 1, a Material UI calendar root 0.7', () => {
  assert.equal(score(grid()), 1);
  assert.equal(score(muiCalendar()), 0.7);
  assert.equal(score(node('div', { classes: ['MuiCalendarPicker-root'], children: [grid()] })), 0.7, 'MUI v5 name');
});

test('near misses: a small grid, a plain table, a calendar root without a grid, a spreadsheet', () => {
  assert.equal(score(grid({ days: 7 })), 0, 'a week is not a month');
  assert.equal(score(node('table', { children: [] })), 0);
  assert.equal(score(node('div', { classes: ['MuiDateCalendar-root'], children: [node('div', { classes: ['MuiYearCalendar-root'] })] })), 0, 'year view has no grid of days');
  assert.equal(score(node('div', { role: 'grid', children: [node('div', { role: 'gridcell', text: 'Name' })] })), 0);
  assert.equal(score(node('div', { role: 'row', children: [] })), 0);
});

test('match never throws on a bare node', () => {
  assert.doesNotThrow(() => datePicker.match({ tag: 'div', children: [] }, {}));
});

test('parseMonthYear reads "November 2026", "Nov 2026", "2026 November" and rejects other text', () => {
  assert.deepEqual(parseMonthYear('November 2026'), { year: 2026, month: 11 });
  assert.deepEqual(parseMonthYear('Nov 2026'), { year: 2026, month: 11 });
  assert.deepEqual(parseMonthYear('Nov. 2026'), { year: 2026, month: 11 });
  assert.deepEqual(parseMonthYear('2026 November'), { year: 2026, month: 11 });
  assert.deepEqual(parseMonthYear('calendar view is open, switch to year view'), null);
  assert.deepEqual(parseMonthYear('Chose 12 2026'), null);
  assert.deepEqual(parseMonthYear('Marchioness 2026'), null);
});

test('build, Material UI: month, year, selected day and header from the DOM', () => {
  const root = muiCalendar({ selected: 18, today: 6 });
  const built = datePicker.build(root, ctx());
  assert.deepEqual(built.xmlComponent.props, { today_year: 2026, today_month: 11, today_day: 18, shown_year: 2026, shown_month: 11 });
  assert.deepEqual(built.xmlComponent.children, [{ tag: 'lv_calendar-header_arrow', props: {} }]);
  assert.equal(built.xmlComponent.tag, 'lv_calendar');
  assert.equal(built.lvName, 'calendar');
  assert.deepEqual(built.recognized.props, { shownYear: 2026, shownMonth: 11, selectedDay: 18, today: 6, header: true });
  assert.equal(root.xmlComponent, undefined, 'the input is not mutated');
});

test('build, plain ARIA grid: the heading is found by aria-labelledby and no header child is added', () => {
  const g = grid({ selected: 9 });
  const built = datePicker.build(g, ctx({ byId: byId(title('November 2026')) }));
  assert.equal(built.xmlComponent.props.shown_month, 11);
  assert.equal(built.xmlComponent.props.today_day, 9);
  assert.deepEqual(built.xmlComponent.children, []);
});

test('build: the heading can come from aria-label on the grid, or an aria-live sibling in the same dialog', () => {
  const labelled = grid({ firstWeekday: 1, days: 31, extra: { aria: { label: 'March 2027' } } });
  assert.deepEqual(datePicker.build(labelled, ctx()).xmlComponent.props, { today_year: 2026, today_month: 3, today_day: 1, shown_year: 2027, shown_month: 3 });
  const g = grid({ firstWeekday: 2, days: 29, extra: { aria: {} } });
  const dialog = node('div', { children: [title('February 2028'), g] });
  const built = datePicker.build(g, ctx({ parent: dialog }));
  assert.equal(built.xmlComponent.props.shown_year, 2028);
  assert.equal(built.xmlComponent.props.shown_month, 2);
});

test('build: today is used when nothing is selected; the selected day wins over today', () => {
  assert.equal(datePicker.build(muiCalendar({ today: 6 }), ctx()).xmlComponent.props.today_day, 6);
  assert.equal(datePicker.build(muiCalendar({ today: 6, selected: 18 }), ctx()).xmlComponent.props.today_day, 18);
});

test('build: with no selected day and no today in the month, the marker is moved to another year', () => {
  const props = datePicker.build(muiCalendar(), ctx()).xmlComponent.props;
  assert.equal(props.today_year, 2025, 'LVGL defaults today to 2024-01-01, which would ring a day of a January 2024 page');
  assert.equal(props.shown_year, 2026);
});

test('build: aria-selected on an outside-month day is ignored, Mui-selected counts', () => {
  const g = grid({ firstWeekday: 3, days: 30, leading: [29, 30, 31], trailing: [1, 2] });
  g.children[1].aria = { selected: 'true' }; // "29" of the previous month
  g.children.at(-1).aria = { selected: 'true' }; // "2" of the next month
  const month = muiCalendar({ firstWeekday: 3, leading: [29, 30, 31], trailing: [1, 2], title: 'April 2026' });
  month.children[1] = g;
  assert.equal(datePicker.build(month, ctx()).xmlComponent.props.today_year, 2025, 'neither outside day is the selected one');
  const mui = muiCalendar({ today: 6 });
  mui.children[1].children[1 + 11].classes = ['Mui-selected']; // day 12
  assert.equal(datePicker.build(mui, ctx()).xmlComponent.props.today_day, 12);
});

test('build: a month that starts mid-week with days of the neighbouring months is read correctly', () => {
  const built = datePicker.build(muiCalendar({ firstWeekday: 3, days: 30, leading: [29, 30, 31], trailing: [1, 2], selected: 1, title: 'April 2026' }), ctx());
  assert.equal(built.xmlComponent.props.today_day, 1);
  assert.equal(built.xmlComponent.props.shown_month, 4);
});

test('the day cells give the calendar their font size and color', () => {
  const built = datePicker.build(muiCalendar({ selected: 3 }), ctx());
  assert.equal(built.styles.fontSize, 12);
  assert.deepEqual(built.styles.color, [0, 0, 0, 222]);
  assert.equal(built.xmlComponent.textStyles, true);
});

test('UNSUPPORTED_WIDGET: an unreadable heading keeps the node and says why', () => {
  const c = ctx();
  const root = muiCalendar({ title: 'Choose a date' });
  assert.equal(datePicker.build(root, c), null);
  const [d] = c.diagnostics.list();
  assert.equal(d.code, 'UNSUPPORTED_WIDGET');
  assert.equal(d.severity, 'warning');
  assert.match(d.message, /month and year could not be read/);
  assert.ok(d.fix.length > 0);
});

test('UNSUPPORTED_WIDGET: a Monday-first week (column header, then column positions)', () => {
  const byHeader = ctx();
  assert.equal(datePicker.build(muiCalendar({ heads: MONDAY_FIRST }), byHeader), null);
  assert.match(byHeader.diagnostics.list()[0].message, /week starts on "monday"/);

  // No headers: Nov 2026 starts on a Sunday, but the browser put day 1 in the second column.
  const byPosition = ctx();
  assert.equal(datePicker.build(muiCalendar({ heads: [], firstWeekday: 1 }), byPosition), null);
  assert.match(byPosition.diagnostics.list()[0].message, /day 1 sits in column 2/);
});

test('UNSUPPORTED_WIDGET: through recognize() the node stays plain and the run reports it', () => {
  const diagnostics = ctx().diagnostics;
  const tree = node('body', { children: [muiCalendar({ title: 'Choose a date' })] });
  const out = recognize(tree, { registry: createRegistry([datePicker]), diagnostics });
  assert.equal(out.tree.children[0].xmlComponent, undefined);
  assert.equal(diagnostics.list().filter((d) => d.code === 'UNSUPPORTED_WIDGET').length, 1);
});

test('data-lv-widget="date-picker" forces the match', () => {
  const tree = node('body', { children: [node('div', { widget: 'date-picker', children: [muiCalendar().children[0], grid({ extra: { aria: { label: 'November 2026' } } })] })] });
  const out = recognize(structuredClone(tree), { registry: createRegistry([datePicker]) });
  assert.equal(out.tree.children[0].recognized.component, 'date-picker');
  assert.equal(out.tree.children[0].xmlComponent.props.shown_month, 11);
});

/* ---------------------------------------------------------------- convert */

const calendarPage = (root) => page(root);

test('convert: the XML has an lv_calendar with the dates, the header, and the DOM children are gone', () => {
  const { xml } = convert(calendarPage(muiCalendar({ selected: 18 })), { name: 'cal' });
  assert.match(xml, /<lv_calendar name="calendar" [^>]*width="304" height="210" today_year="2026" today_month="11" today_day="18" shown_year="2026" shown_month="11" style_text_font="montserrat_12"/);
  assert.match(xml, /<lv_calendar-header_arrow \/>/);
  assert.doesNotMatch(xml, /gridcell|text="18"/);
});

test('convert: a bare grid becomes a calendar with no header element', () => {
  const g = grid({ selected: 9 });
  const { xml } = convert(calendarPage(node('div', { children: [title(), g] })), { name: 'cal' });
  assert.match(xml, /<lv_calendar name="calendar"/);
  assert.doesNotMatch(xml, /header_arrow/);
  assert.match(xml, /text="November 2026"/, 'the page heading next to the grid still converts');
});

test('convert: a Monday-first calendar stays plain boxes and the run carries UNSUPPORTED_WIDGET', () => {
  const { xml, diagnostics } = convert(calendarPage(muiCalendar({ heads: MONDAY_FIRST })), { name: 'cal' });
  assert.doesNotMatch(xml, /lv_calendar/);
  assert.ok(diagnostics.list().some((d) => d.code === 'UNSUPPORTED_WIDGET'));
});

test('emit C and C++: grouped date calls and the header call, no unmapped attributes', () => {
  const { view } = convert(calendarPage(muiCalendar({ selected: 18 })), { name: 'cal' });
  for (const { c } of [emitC(view, { name: 'cal' }), emitCpp(view, { name: 'cal' })]) {
    assert.match(c, /lv_obj_t \* calendar = lv_calendar_create\(root\);/);
    assert.match(c, /lv_calendar_set_today_date\(calendar, 2026, 11, 18\);/);
    assert.match(c, /lv_calendar_set_month_shown\(calendar, 2026, 11\);/);
    assert.match(c, /lv_calendar_add_header_arrow\(calendar\);/);
    assert.doesNotMatch(c, /unmapped attribute/);
  }
});

test('emit MicroPython: only calls the pinned binding has (set_today_date, set_month_shown, add_header_arrow)', () => {
  const { view } = convert(calendarPage(muiCalendar({ selected: 18 })), { name: 'cal' });
  const { py } = emitPy(view, { name: 'cal' });
  assert.match(py, /calendar = lv\.calendar\(root\)/);
  assert.match(py, /calendar\.set_today_date\(2026, 11, 18\)/);
  assert.match(py, /calendar\.set_month_shown\(2026, 11\)/);
  assert.match(py, /calendar\.add_header_arrow\(\)/);
  assert.doesNotMatch(py, /set_today_year|set_shown_month|unmapped|unsupported/);
});
