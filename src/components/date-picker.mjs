/**
 * Date picker: a month grid of days (the WAI-ARIA date picker dialog, Material
 * UI's DateCalendar / StaticDatePicker, any hand-written `role="grid"` of day
 * buttons) becomes LVGL's native `lv_calendar`.
 *
 * What the DOM says and where it goes (XML attributes confirmed in LVGL v9.4,
 * src/others/xml/parsers/lv_xml_calendar_parser.c):
 *
 *   month and year shown          shown_month, shown_year   (the heading text,
 *                                 "November 2026", or "2026 November")
 *   the selected day              today_year/month/day      (see below)
 *   today                         today_year/month/day
 *   header (title and arrows)     a <lv_calendar-header_arrow/> child, only when
 *                                 the matched element holds the header (MUI's
 *                                 root does; a bare `role="grid"` does not, its
 *                                 heading is a sibling and converts as before)
 *
 * The XML parser has no attribute for highlighted dates (`lv_calendar_set_
 * highlighted_dates` takes a C array) and no selected-day state, so the one
 * marker a calendar can draw is its "today" ring. A day marked
 * `aria-selected="true"` is what the user is looking at, so it takes that
 * marker; when there is no selected day, `aria-current="date"` (today) does.
 * When both exist and differ, the selected day wins and today is not drawn.
 * With neither, today is set to a date outside the shown month, because LVGL's
 * default today (2024-01-01) would otherwise ring a day of January 2024.
 *
 * The widget's own week starts on Sunday and cannot change. A grid whose week
 * starts on another day (a Monday-first column header, or day 1 sitting in a
 * column that does not match its weekday) cannot be matched with confidence:
 * the node is kept as the plain boxes the converter already makes, and
 * UNSUPPORTED_WIDGET says why. The same goes for a heading that cannot be read
 * as a month and a year.
 *
 * The opener (`<input type="date">`) is not handled here: it already converts
 * to a text field showing its value.
 *
 * Output formats: XML uses the attributes above. C and MicroPython use
 * `lv_calendar_set_today_date` and `lv_calendar_set_month_shown`, which exist
 * on every LVGL 9.x including the pinned lv_micropython binding (the per-field
 * `set_today_year` setters are 9.4 only). See emit-c.mjs and emit-py.mjs.
 */
import { SCORE_SEMANTIC, SCORE_MUI, ariaOf, hasClass, hasMuiRoot, withName } from './shared.mjs';

/** @typedef {import('../recognize.mjs').UiNode} UiNode */

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MIN_DAYS_IN_GRID = 28;
/** MUI v5 called the calendar CalendarPicker; v6 and later call it DateCalendar. */
const MUI_ROOTS = ['DateCalendar', 'CalendarPicker'];

/** @param {UiNode} node @returns {string} */
const textOf = (node) => ((node.text ?? '') + node.children.map(textOf).join(' ')).replace(/\s+/g, ' ').trim();

/** @param {UiNode} node @returns {UiNode[]} Every descendant, depth first. */
function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** @param {UiNode} node */
const isGrid = (node) => node.role === 'grid';

/** The cells of a grid that show a day number, in document order. @param {UiNode} grid */
function dayCells(grid) {
  return descendants(grid).filter((n) => n.role === 'gridcell' && !n.hidden && /^\d{1,2}$/.test(textOf(n)));
}

/** The first role=grid at or below the node that holds a month of days. @param {UiNode} node @returns {UiNode | null} */
function findGrid(node) {
  if (isGrid(node) && dayCells(node).length >= MIN_DAYS_IN_GRID) return node;
  for (const child of node.children) {
    const found = findGrid(child);
    if (found) return found;
  }
  return null;
}

/**
 * The month and year in a heading, in either order, with a full or three
 * letter English month name. Returns null when the text is anything else.
 * @param {string} text
 * @returns {{ year: number, month: number } | null}
 */
export function parseMonthYear(text) {
  const monthIndex = (word) => MONTH_NAMES.findIndex((m) => m === word.toLowerCase() || (word.length >= 3 && m.startsWith(word.toLowerCase().replace(/\.$/, ''))));
  const nameFirst = /\b([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(text);
  if (nameFirst && monthIndex(nameFirst[1]) >= 0) return { year: Number(nameFirst[2]), month: monthIndex(nameFirst[1]) + 1 };
  const yearFirst = /\b(\d{4})\s+([A-Za-z]{3,9})\b/.exec(text);
  if (yearFirst && monthIndex(yearFirst[2]) >= 0) return { year: Number(yearFirst[1]), month: monthIndex(yearFirst[2]) + 1 };
  return null;
}

/**
 * Where the heading is: inside the matched element (MUI), named by the grid's
 * aria-labelledby or aria-label (ARIA), or in a sibling inside the same dialog.
 * @param {UiNode} node the matched element
 * @param {UiNode} grid
 * @param {import('../recognize.mjs').RecognizeContext | undefined} ctx
 */
function readHeading(node, grid, ctx) {
  /** @type {string[]} */
  const candidates = [];
  const labelledBy = String(ariaOf(grid, 'labelledby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of labelledBy) {
    const target = ctx?.byId?.get(id);
    if (target) candidates.push(textOf(target));
  }
  const label = ariaOf(grid, 'label');
  if (label) candidates.push(String(label));
  // The live region is where ARIA pickers announce the shown month.
  const scopes = node === grid ? (ctx?.parent ? [ctx.parent] : []) : [node];
  for (const scope of scopes) {
    for (const n of [scope, ...descendants(scope)]) {
      if (n === grid || descendants(grid).includes(n)) continue;
      if (ariaOf(n, 'live') && textOf(n)) candidates.push(textOf(n));
    }
    for (const n of descendants(scope)) {
      if (n === grid || descendants(grid).includes(n)) continue;
      if (n.text) candidates.push(n.text);
    }
  }
  for (const text of candidates) {
    const parsed = parseMonthYear(text);
    if (parsed) return parsed;
  }
  return null;
}

/** @param {number} year @param {number} month 1 to 12 */
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Classify each day cell as part of the shown month or of a neighbouring one.
 * A grid in document order is: optional days of the previous month, then 1 up
 * to the month's length, then optional days of the next month.
 * @param {UiNode[]} cells
 * @param {number} length days in the shown month
 * @returns {{ cell: UiNode, day: number, inMonth: boolean }[]}
 */
function classifyDays(cells, length) {
  let started = false;
  let finished = false;
  return cells.map((cell) => {
    const day = Number(textOf(cell));
    if (!started && day === 1) started = true;
    const inMonth = started && !finished;
    if (inMonth && day === length) finished = true;
    return { cell, day, inMonth };
  });
}

/** The column (0 to 6) each day cell sits in, from the browser's x, or null when the cells have no usable spread. @param {UiNode[]} cells */
function columnsOf(cells) {
  const xs = cells.map((c) => c.x);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (!(max - min > 0)) return null;
  const step = (max - min) / 6;
  return cells.map((c) => Math.round((c.x - min) / step));
}

/** @param {UiNode} node @returns {boolean} */
function isSelected(node) {
  return ariaOf(node, 'selected') === 'true' || hasClass(node, 'Mui-selected');
}

/** @param {UiNode} node @returns {boolean} */
function isToday(node) {
  const current = ariaOf(node, 'current');
  return (Boolean(current) && current !== 'false') || hasClass(node, 'MuiPickersDay-today');
}

/**
 * A reason this calendar cannot be a Sunday-first lv_calendar, or null.
 * @param {UiNode} grid
 * @param {{ year: number, month: number }} shown
 * @param {{ cell: UiNode, day: number, inMonth: boolean }[]} days
 * @returns {string | null}
 */
function weekStartProblem(grid, shown, days) {
  const heads = descendants(grid).filter((n) => n.role === 'columnheader');
  if (heads.length >= 7) {
    const first = String(ariaOf(heads[0], 'label') ?? textOf(heads[0])).toLowerCase();
    if (first && !/^(su|sun)/.test(first)) return `its week starts on "${first}", and lv_calendar always starts on Sunday`;
  }
  const columns = columnsOf(days.map((d) => d.cell));
  const firstOfMonth = days.findIndex((d) => d.inMonth && d.day === 1);
  if (columns && firstOfMonth >= 0) {
    const expected = new Date(Date.UTC(shown.year, shown.month - 1, 1)).getUTCDay();
    if (columns[firstOfMonth] !== expected) return `day 1 sits in column ${columns[firstOfMonth] + 1}, but a Sunday-first week puts it in column ${expected + 1}; lv_calendar always starts on Sunday`;
  }
  return null;
}

/**
 * @param {UiNode} node
 * @returns {number | false}
 */
function match(node) {
  if (MUI_ROOTS.some((root) => hasMuiRoot(node, root))) return findGrid(node) ? SCORE_MUI : false;
  if (isGrid(node) && dayCells(node).length >= MIN_DAYS_IN_GRID) return SCORE_SEMANTIC;
  return false;
}

/**
 * @param {UiNode} node
 * @param {import('../recognize.mjs').RecognizeContext} [ctx]
 * @returns {UiNode | null}
 */
function build(node, ctx) {
  const grid = isGrid(node) ? node : findGrid(node);
  /** @param {string} why */
  const unsupported = (why) => {
    ctx?.diagnostics.add({
      code: 'UNSUPPORTED_WIDGET',
      message: `date picker ${node.key ?? node.tag} cannot be matched to lv_calendar: ${why}; kept as plain boxes`,
      fix: 'Show the month as "November 2026" in a heading the grid is labelled by, start the week on Sunday, or rebuild this calendar by hand with lv_calendar. The plain-box conversion stays in use until then.',
      source: { selector: node.key ?? node.tag },
    });
    return null;
  };
  if (!grid) return unsupported('it holds no grid of days');

  const shown = readHeading(node, grid, ctx);
  if (!shown) return unsupported('the shown month and year could not be read (expected a heading such as "November 2026", named by aria-labelledby or aria-label on the grid, or in an aria-live heading)');

  const cells = dayCells(grid);
  const days = classifyDays(cells, daysInMonth(shown.year, shown.month));
  if (!days.some((d) => d.inMonth && d.day === 1)) return unsupported('the grid has no cell for day 1');
  const problem = weekStartProblem(grid, shown, days);
  if (problem) return unsupported(problem);

  const inMonth = days.filter((d) => d.inMonth);
  const selected = inMonth.find((d) => isSelected(d.cell))?.day ?? null;
  const today = inMonth.find((d) => isToday(d.cell))?.day ?? null;
  const marked = selected ?? today;
  const todayDate = marked
    ? { year: shown.year, month: shown.month, day: marked }
    : { year: shown.year - 1, month: shown.month, day: 1 }; // outside the shown month, so nothing is ringed

  const withHeader = !isGrid(node);
  const out = withName(node, 'calendar');
  // The days are drawn by the calendar itself, in the size and color of the
  // browser's day cells, so the grid keeps the page's type scale.
  const dayStyles = cells[0].styles;
  return {
    ...out,
    styles: { ...node.styles, fontSize: dayStyles.fontSize, fontFamily: dayStyles.fontFamily, fontWeight: dayStyles.fontWeight, fontItalic: dayStyles.fontItalic, color: dayStyles.color },
    xmlComponent: {
      tag: 'lv_calendar',
      props: {
        today_year: todayDate.year,
        today_month: todayDate.month,
        today_day: todayDate.day,
        shown_year: shown.year,
        shown_month: shown.month,
      },
      children: withHeader ? [{ tag: 'lv_calendar-header_arrow', props: {} }] : [],
      textStyles: true,
    },
    recognized: { component: 'date-picker', props: { shownYear: shown.year, shownMonth: shown.month, selectedDay: selected, today: today, header: withHeader } },
  };
}

/** @type {import('../recognize.mjs').ComponentDef} */
const datePicker = {
  name: 'date-picker',
  match,
  props: {
    shownYear: { type: 'number', default: 2024 },
    shownMonth: { type: 'number', default: 1 },
    selectedDay: { type: 'number', default: 0 },
    header: { type: 'bool', default: true },
  },
  slots: [],
  leaf: true,
  build,
};

export default datePicker;
