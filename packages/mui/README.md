# @richardmcquiston01/html-to-lvgl-mui

Material UI recognizers for [html2lvgl](https://github.com/RichardMcQuiston01/html-to-lvgl).

The core already recognizes Material UI by its `Mui<Name>-root` class names (Card, Chip, Alert, Tabs, Drawer, Accordion, Select, and more) and keeps doing so with or without this package. This plugin adds only what the core cannot see or does not define:

| Recognizer | What the core does with real Material UI | What this plugin does |
|---|---|---|
| `mui-checkbox` | an `lv_checkbox` that shows LVGL's default "Check box" text, plus an empty square placeholder for the SVG | one native `lv_checkbox` over the drawn square, with its checked, disabled and color state |
| `mui-form-control-label` | a box, a placeholder and a separate label | one `lv_checkbox` that carries the label text; a Radio or Switch row is no longer clipped |
| `mui-radio` | an `lv_textarea` containing the text `on` | a ring, plus a dot when selected |
| `mui-rating` | five identical empty outlines, whatever the value | one disc per star, filled for the filled ones |
| `mui-icon` | an empty named placeholder | an LVGL symbol label (`LV_SYMBOL_TRASH`, `LV_SYMBOL_PLUS`, ...) for the icons LVGL has a symbol for; any other icon stays the core's placeholder |
| `mui-button` | `button_base`, `button_base_2`, ... names; no pressed color on a contained button | names from the label or `aria-label`, variant/color/size/disabled as props, the pressed color |

Every recognizer also matches by **React component name** (score 0.8), so it still works when class names are hashed or renamed (`ClassNameGenerator.configure`, a design system that rebrands the `Mui` prefix). A `Mui*-root` class is the fallback (0.7). Nothing scores above 1, ARIA's score; the icon recognizer scores 0.95 only when it can name the symbol.

## Use

```sh
npm install --save-dev @richardmcquiston01/html-to-lvgl @richardmcquiston01/html-to-lvgl-mui
html2lvgl App.jsx --plugin @richardmcquiston01/html-to-lvgl-mui
```

or in `html2lvgl.config.mjs`:

```js
import mui from '@richardmcquiston01/html-to-lvgl-mui';
export default { plugins: [mui] };
```

The plugin asks the React plugin for component names (`wantsFrameworkData`), so the page must be a `.jsx` / `.tsx` entry that renders Material UI in a **development** build (the loader bundles unminified, which keeps component names). Plain HTML pages still get the class-based recognizers, but no component names.

## Peer dependencies

`@richardmcquiston01/html-to-lvgl` (>= 0.8.0, the first core with the recognizer wiring and framework data this plugin needs), and `@mui/material` and `react` for the pages you convert. The package itself imports nothing from the core at run time.

## Examples

`examples/settings.jsx` and `examples/branded.jsx` are real Material UI 9.5 pages rendered at 320x240. `branded.jsx` renames every `Mui` class prefix; the core finds nothing on it and the plugin finds everything by component name.

```sh
html2lvgl packages/mui/examples/settings.jsx --plugin packages/mui/src/index.mjs --size 320x240 -o out/
```

Goldens in `tests/golden*` come from the extraction snapshots in `tests/fixtures`. Refresh them with `node packages/mui/scripts/update-golden.mjs [--extract]`.

## Limits

- An indeterminate Checkbox is shown checked (LVGL has no dash). Half stars in a Rating are not drawn.
- Radio circles are not interactive; LVGL has no radio group.
- Icon symbols come from LVGL's built-in Montserrat fonts, so the label sets that font itself and ignores `--font-map`. Only icons with an LVGL counterpart are mapped.
- An outlined or text Button has no pressed color (its pressed tint is a translucent wash that the core's pressed style cannot express).
- Component names need React's development build.
