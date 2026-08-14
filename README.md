# HTML to LVGL

## Overview

Transform plain HTML or React based HTML pages into LVGL code for use on devices like Arduino or ESP32.

The converter renders your page in headless Chromium at the target display resolution, extracts the resolved layout and styles, and emits [LVGL XML](https://lvgl.io/docs/open/xml) (v9.4 `lv_xml` runtime syntax). CSS flexbox maps onto LVGL's flex layout; everything else uses exact coordinates from the browser's layout engine. See [RESEARCH.md](RESEARCH.md) for the feasibility study and [spike/](spike/README.md) for the proof-of-concept with side-by-side screenshots.

## Usage

```sh
npm install

# Convert a page for a 320x240 display
node src/cli.mjs examples/dashboard.html --size 320x240 -o out/

# Also save the Chromium reference screenshot and the extracted UI tree
node src/cli.mjs examples/dashboard.html -o out/ --screenshot --debug
```

This produces `out/dashboard.xml`, ready to load with LVGL v9.4's XML runtime:

```c
lv_xml_init();
/* register the montserrat fonts the page uses, then: */
lv_xml_register_component_from_data("dashboard", xml_string);
lv_xml_create(lv_screen_active(), "dashboard", NULL);
```

`spike/render/` contains a complete headless example (virtual display, font registration, framebuffer capture) that CI uses to validate every generated XML file against real LVGL.

## What maps today (Phase 1)

| HTML/CSS | LVGL |
|---|---|
| `display: flex` (direction, wrap, justify-content, align-items, gap, flex-grow) | LVGL flex (`flex_flow`, `style_flex_*`, `pad_row`/`pad_column`) |
| Block/absolute layout | Exact coordinates from Chromium |
| `button` | `lv_button` + centered `lv_label` |
| Text elements | `lv_label`, sized with real LVGL font metrics |
| `input type=range` | `lv_slider` (min/max/value) |
| `input type=checkbox` | `lv_switch` (wide) or `lv_checkbox` |
| `input type=text/password` | `lv_textarea` (placeholder, password mode) |
| `select` | `lv_dropdown` |
| `progress` | `lv_bar` |
| `img` | `lv_image` + asset manifest |
| Colors, borders (incl. side-specific), radius, padding, opacity, text styles | LVGL style properties |

CSS `font-size` maps onto the built-in Montserrat sizes using per-glyph advance widths extracted from LVGL's font sources (`scripts/gen-font-metrics.mjs`), so labels never clip or wrap unexpectedly.

## Project layout

- `src/` — the `html2lvgl` CLI: `extract.mjs` (Playwright), `convert.mjs` (mapping), `emit-xml.mjs`, `fonts.mjs`
- `examples/` — sample pages to convert
- `tests/` — golden-file tests (`npm test`); fixtures are committed extraction snapshots, so tests need no browser
- `spike/` — the Phase 0 proof-of-concept and the C render harness used for CI validation
- `scripts/` — font-metrics generator (run against an LVGL v9.4.0 checkout)

## Development

```sh
npm test                 # unit + golden-file tests
npm run golden:update    # refresh goldens after an intentional converter change
```

CI runs the test suite and additionally builds the spike render harness against LVGL v9.4.0, then loads every golden XML through the stock `lv_xml` runtime.

Note: the project pins **LVGL v9.4.0** — the last release with the in-tree `lv_xml` runtime (XML tooling is consolidating into LVGL Pro upstream).

## Resources

- <https://lvgl.io/docs/open/introduction/requirements>
- <https://www.elecrow.com/blog/everything-you-should-know-about-lvgl.html>
- <https://espressif-docs.readthedocs-hosted.com/projects/espressif-esp-iot-solution/en/latest/gui/lvgl_gui.html>
- <https://lvgl.io/>

## License

MIT

## Copyright

(c)2026 Richard McQuiston.  All rights reserved.
