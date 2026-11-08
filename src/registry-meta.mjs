/**
 * Editor-facing facts about the CORE component definitions that the
 * definitions themselves do not carry: a one-line description, the allowed
 * values of enumerated props, a description per prop, and the signals
 * (behavior subjects and timelines) a component declares.
 *
 * Why a separate file: the definitions in src/components/ are busy files that
 * other work edits, and the converter never reads this data. Keeping it here
 * adds editor metadata without touching a single build(). A definition (core
 * or plugin) can also carry the same optional fields itself (`description`,
 * `signals`, and `description` / `enum` on a prop); those win over this table.
 * See ComponentDef and PropDef in src/recognize.mjs.
 *
 * Every entry is copied from what the definition's own source says (its header
 * comment and build()). tests/registry-export.test.mjs checks that each name
 * and prop here exists, that every core component has an entry, that enums
 * hold every value the shipped fixtures produce, and that each signal
 * is really emitted.
 *
 * @typedef {object} MetaSignal
 * @property {string} name         For a subject, the suffix of the emitted name
 *                                 (`<screen>_<key>_<name>`); for a timeline, the suffix of its name.
 * @property {'subject' | 'timeline'} kind
 * @property {'int'} [type]        Subjects only (src/behavior.mjs supports int subjects).
 * @property {string} description
 *
 * @typedef {object} ComponentMeta
 * @property {string} description
 * @property {Record<string, { description?: string, enum?: Array<string | number> }>} [props]
 * @property {MetaSignal[]} [signals]
 */

/** @type {Record<string, ComponentMeta>} */
export const CORE_COMPONENT_META = {
  icon: {
    description: 'An SVG, icon-font glyph or Material Icons ligature, drawn as a named, fixed-size placeholder box because the glyph itself cannot become a label.',
    props: { hint: { description: 'Name taken from the icon (class, test id or ligature text); the placeholder is called icon_<hint>.' } },
  },
  card: {
    description: 'A container with a raised or outlined surface (Material UI Card, Bootstrap card).',
    props: { variant: { description: 'Outlined when the surface has a visible border and no shadow, otherwise elevation.', enum: ['elevation', 'outlined'] } },
  },
  paper: {
    description: 'A plain surface (Material UI Paper that is not part of a Card, Alert, AppBar or Accordion).',
    props: { variant: { description: 'Outlined when the surface has a visible border and no shadow, otherwise elevation.', enum: ['elevation', 'outlined'] } },
  },
  divider: {
    description: 'A thin separator line (hr, role=separator, Material UI Divider).',
    props: { orientation: { description: 'Direction of the line.', enum: ['horizontal', 'vertical'] } },
  },
  chip: {
    description: 'A compact pill with a label and an optional leading icon, avatar or delete control.',
    props: {
      label: { description: 'The chip text.' },
      variant: { description: 'Outlined when the chip has a border and no fill.', enum: ['filled', 'outlined'] },
    },
  },
  avatar: {
    description: 'A circle (or rounded square) holding a photo or initials.',
    props: {
      shape: { description: 'Read from the corner radius.', enum: ['circular', 'rounded', 'square'] },
      initials: { description: 'The text shown when there is no image.' },
      src: { description: 'Image source when the avatar holds a photo.' },
    },
  },
  badge: {
    description: 'A small count or dot pinned to a corner of another element, or an inline pill label (Bootstrap).',
    props: {
      content: { description: 'The text of the count; empty for a dot.' },
      variant: { description: 'A dot has no content.', enum: ['standard', 'dot'] },
    },
  },
  alert: {
    description: 'A status message with an optional icon and action.',
    props: {
      severity: { description: 'Read from the Material UI class (standardError, colorWarning, ...).', enum: ['error', 'warning', 'info', 'success'] },
      variant: { description: 'Read from the Material UI filled / outlined class.', enum: ['standard', 'filled', 'outlined'] },
    },
  },
  appbar: {
    description: 'The top bar of a screen (header with role=banner, Material UI AppBar), pinned while the page scrolls.',
    props: {
      title: { description: 'The bar title text.' },
      position: { description: 'The computed CSS position; fixed and sticky pin the bar.', enum: ['fixed', 'sticky', 'static', 'absolute', 'relative'] },
    },
  },
  toolbar: {
    description: 'A row of controls, usually inside an app bar (role=toolbar, Material UI Toolbar).',
  },
  breadcrumbs: {
    description: 'A navigation trail (nav aria-label=breadcrumb, Material UI Breadcrumbs, Bootstrap .breadcrumb).',
    props: { separator: { description: 'The separator text between items.' } },
  },
  accordion: {
    description: 'A header that opens and closes a body; the content below moves out of the way.',
    props: { expanded: { description: 'Whether the body is shown when the page loads (aria-expanded of the trigger).' } },
    signals: [{ name: 'open', kind: 'subject', type: 'int', description: '1 while the body is shown, 0 while it is hidden; the trigger toggles it.' }],
  },
  modal: {
    description: 'A dialog that blocks the page until it is dismissed (role=dialog or alertdialog, Material UI Dialog, Bootstrap .modal).',
    props: {
      title: { description: 'The dialog title text.' },
      modal: { description: 'Whether the dialog blocks the page behind it: a backdrop layer is drawn. false gives a floating dialog with no backdrop.' },
      open: { description: 'Whether the dialog is shown when the page loads.' },
    },
    signals: [{ name: 'open', kind: 'subject', type: 'int', description: '1 while the dialog is shown; an opener sets it to 1, a button inside the dialog (and the backdrop, when the dialog is dismissible) sets it to 0.' }],
  },
  drawer: {
    description: 'A panel that slides in from a screen edge over a dimmed page (Material UI Drawer, a navigation side sheet).',
    props: {
      anchor: { description: 'The screen edge the panel is docked to.', enum: ['left', 'right', 'top', 'bottom'] },
      open: { description: 'Whether the drawer is shown when the page loads.' },
      title: { description: 'The panel title text.' },
    },
    signals: [
      { name: 'open', kind: 'subject', type: 'int', description: '1 while the drawer is shown; an opener sets it to 1 and a closer sets it to 0.' },
      { name: 'slide_in', kind: 'timeline', description: 'Slides the panel in from its edge; played when the opener is pressed.' },
      { name: 'slide_out', kind: 'timeline', description: 'Slides the panel back out; played when a closer is pressed.' },
    ],
  },
  select: {
    description: 'A closed field that opens a list of options and shows the chosen one; maps to lv_dropdown (native select, role=combobox, Material UI Select).',
    props: {
      selected: { description: 'Index of the selected option.' },
      placeholder: { description: 'Text shown by the closed field when no option is selected; it becomes the first option.' },
    },
  },
  menu: {
    description: 'A button that opens a floating list of commands (role=menu, Material UI Menu, Bootstrap dropdown menu).',
    props: { open: { description: 'Whether the menu is shown when the page loads.' } },
    signals: [{ name: 'open', kind: 'subject', type: 'int', description: '1 while the menu is shown; the opener sets it to 1 and pressing an item or outside the popup sets it to 0.' }],
  },
  snackbar: {
    description: 'A short message bar that floats over the page, usually at the bottom, with an optional action (Material UI Snackbar, Bootstrap toast).',
    props: {
      message: { description: 'The message text.' },
      open: { description: 'Whether the snackbar is shown when the page loads.' },
    },
    signals: [{ name: 'open', kind: 'subject', type: 'int', description: '1 while the snackbar is shown; an opener sets it to 1 and a button inside the snackbar sets it to 0.' }],
  },
  'date-picker': {
    description: 'A month grid of days (ARIA date picker, Material UI DateCalendar); maps to lv_calendar.',
    props: {
      shownYear: { description: 'Year of the month the grid shows.' },
      shownMonth: { description: 'Month (1 to 12) the grid shows.' },
      selectedDay: { description: 'Day of the shown month that is selected; 0 when none.' },
      today: { description: 'Day of the shown month marked as today; 0 when none.' },
      header: { description: 'Whether lv_calendar draws its own month header with arrows (false for a grid that has its own).' },
    },
  },
  stepper: {
    description: 'A row or column of numbered steps with labels and connectors (Material UI Stepper, ol of steps).',
    props: {
      orientation: { description: 'Direction the steps run.', enum: ['horizontal', 'vertical'] },
      count: { description: 'Number of steps.' },
      active: { description: 'Index of the step marked active (aria-current=step or a Mui-active class); the converter reports -1 when none is marked.' },
      completed: { description: 'Number of completed steps.' },
    },
  },
  pagination: {
    description: 'A row of page buttons with previous and next, the current page highlighted (Material UI Pagination, Bootstrap .pagination).',
    props: {
      count: { description: 'Number of items in the list, the previous and next arrows included.' },
      current: { description: 'Index of the item marked aria-current (or Mui-selected / active) in that list; the converter reports -1 when none is marked.' },
    },
  },
  tabs: {
    description: 'A tab bar plus one panel per tab (role=tablist / tab / tabpanel, Material UI Tabs); maps to lv_tabview.',
    props: {
      active: { description: 'Index of the open tab.' },
      position: { description: 'Side of the panels the tab bar sits on.', enum: ['top', 'bottom', 'left', 'right'] },
    },
  },
  'appbar-tabs': {
    description: 'Working tabs whose strip sits inside an app bar and whose panels are elsewhere on the page.',
    props: { active: { description: 'Index of the open tab.' } },
    signals: [{ name: 'selected', kind: 'subject', type: 'int', description: 'Index of the open tab; pressing a tab sets it and the panels bind their visibility to it.' }],
  },
  'bottom-navigation': {
    description: 'A bar of 3 to 5 icon-over-label actions pinned to the bottom edge of the screen (Material UI BottomNavigation); maps to an lv_tabview with the tab bar at the bottom.',
    props: { active: { description: 'Index of the selected action.' } },
  },
  switch: {
    description: 'An on/off toggle (role=switch, Material UI Switch); maps to lv_switch.',
    props: {
      checked: { description: 'The state the page shows (aria-checked, the checkbox behind it, or Mui-checked).' },
      disabled: { description: 'aria-disabled, disabled or Mui-disabled.' },
    },
  },
  textfield: {
    description: 'A labelled text box (textbox, input and textarea with a label, Material UI TextField); maps to lv_textarea with the label and helper text as labels.',
    props: {
      label: { description: 'The field label text.' },
      value: { description: 'The text in the field.' },
      placeholder: { description: 'The placeholder text.' },
      helperText: { description: 'The helper or error text under the field.' },
      multiline: { description: 'A textarea, aria-multiline, or a multiline Material UI input.' },
      password: { description: 'type=password: the text is masked.' },
      error: { description: 'aria-invalid or a Material UI error state.' },
      disabled: { description: 'The field is disabled.' },
    },
  },
  slider: {
    description: 'Pick a value on a line (role=slider, Material UI Slider); maps to lv_slider.',
    props: {
      min: { description: 'aria-valuemin.' },
      max: { description: 'aria-valuemax.' },
      value: { description: 'aria-valuenow (the first thumb of a range slider).' },
      disabled: { description: 'The slider is disabled.' },
    },
  },
  progress: {
    description: 'How far a task has got (role=progressbar, Material UI LinearProgress and CircularProgress); maps to lv_bar or lv_arc.',
    props: {
      variant: { description: 'A bar or a ring.', enum: ['linear', 'circular'] },
      value: { description: 'aria-valuenow, clamped to the range; 40 percent of it when indeterminate.' },
      min: { description: 'aria-valuemin.' },
      max: { description: 'aria-valuemax.' },
      indeterminate: { description: 'No value: drawn as a static 40 percent bar or arc (LVGL XML has no animated progress).' },
    },
  },
};
