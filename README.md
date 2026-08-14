# HTML to LVGL

## Overview

Transform plain HTML or React based HTML pages into LVGL code for use on devices like Arduino or ESP32.

The converter renders your page in headless Chromium at the target display resolution, extracts the resolved layout and styles, and emits [LVGL XML](https://lvgl.io/docs/open/xml) (v9.4 `lv_xml` runtime syntax). CSS flexbox maps onto LVGL's flex layout; everything else uses exact coordinates from the browser's layout engine. See [RESEARCH.md](RESEARCH.md) for the feasibility study and [spike/](spike/README.md) for the proof-of-concept with side-by-side screenshots.

## Usage

```sh
npm install

# Convert a page for a 320x240 display
node src/cli.mjs examples/dashboard.html --size 320x240 -o out/

# Emit plain C instead of (or alongside) XML — works on any LVGL 9.x,
# no lv_xml runtime needed
node src/cli.mjs examples/monitor.html -o out/ --format both

# Convert a React app: each function component becomes a reusable,
# parameterized LVGL XML component
node src/cli.mjs examples/react/panel.jsx -o out/

# Also save the Chromium reference screenshot and the extracted UI tree
node src/cli.mjs examples/dashboard.html -o out/ --screenshot --debug

# Watch mode: rebuild on save and serve a live side-by-side preview
node src/cli.mjs examples/dashboard.html -o out/ --watch

# Several pages become several screens, with links between them wired up
node src/cli.mjs examples/nav/home.html examples/nav/settings.html -o out/
```

This produces `out/dashboard.xml`, ready to load with LVGL v9.4's XML runtime:

```c
lv_xml_init();
/* register the montserrat fonts the page uses, then: */
lv_xml_register_component_from_data("dashboard", xml_string);
lv_xml_create(lv_screen_active(), "dashboard", NULL);
```

`spike/render/` contains a complete headless example (virtual display, font registration, framebuffer capture) that CI uses to validate every generated XML file against real LVGL.

## What maps today (Phases 1–2)

| HTML/CSS | LVGL |
|---|---|
| `display: flex` (direction, wrap, justify-content, align-items, gap, flex-grow) | LVGL flex (`flex_flow`, `style_flex_*`, `pad_row`/`pad_column`) |
| `display: grid` (tracks, gaps, `grid-column/row` spans) | LVGL grid (`style_layout="grid"`, track descriptor arrays, cell pos/span) |
| Block/absolute layout | Exact coordinates from Chromium |
| Two-stop `linear-gradient` | `bg_color` + `bg_grad_color` + `bg_grad_dir` |
| `box-shadow` | `style_shadow_*` (color, blur, offsets, spread) |
| `:hover` / `:active` declarations | pressed-state styles (`style_bg_color:pressed`) |
| `overflow: auto/scroll` | scrollable containers |
| `button` | `lv_button` + centered `lv_label` |
| Text elements | `lv_label`, sized with real LVGL font metrics |
| `input type=range` | `lv_slider` (min/max/value) |
| `input type=checkbox` | `lv_switch` (wide) or `lv_checkbox` |
| `input type=text/password` | `lv_textarea` (placeholder, password mode) |
| `select` | `lv_dropdown` |
| `progress` | `lv_bar` |
| `table` | `lv_table` (column widths, cell values) |
| `img` | `lv_image` + asset manifest |
| Colors, borders (incl. side-specific), radius, padding, opacity, text styles | LVGL style properties |

An optimizer pass collapses visually inert single-child wrapper divs (framework "wrapper soup") so they never become on-device widgets.

### Multi-screen navigation

Pass more than one page and each becomes a `<screen>` rather than a `<component>`, with `<a href>` links between them turned into navigation buttons:

```xml
<!-- home.xml -->
<screen>
  <view ...>
    <lv_button name="to_settings" width="160" height="34" ...>
      <lv_label align="center" text="Settings" .../>
      <screen_create_event screen="settings" />
    </lv_button>
  </view>
</screen>
```

`screen_create_event` instantiates the target on demand, so navigation works before a screen has ever been visited — no start-up ordering to manage. Links to external URLs or to pages outside the converted set stay plain text. Load a screen with `lv_xml_create(NULL, "home", NULL)` followed by `lv_screen_load()`; the render harness does exactly this and can simulate a click with `--click=<widget-name>` to verify a transition.

In C output each screen exports `ui_<screen>_create` instead of `ui_create` so the units can be linked together; navigation itself is left as a commented stub, since flattened C has no screen registry to look names up in.

### Watch mode and live preview

`--watch` rebuilds whenever you save and serves a preview at `http://localhost:8377` (override with `--port`): the Chromium reference next to the LVGL render, a live fidelity score, converter warnings, and the generated XML. The page refreshes itself over SSE after each build, so the edit → see-it-on-LVGL loop is a browser tab away.

The LVGL pane needs the render harness — `spike/build/render` by default, or point at another build with `--render-bin`. Without it the preview still serves the reference and the XML and tells you how to build one. Broken saves surface the error in the page instead of killing the server.

### Annotation attributes

When the automatic mapping needs a nudge, annotate the source HTML (React works too — put them on the JSX element):

| Attribute | Effect |
|---|---|
| `data-lv-widget="switch\|checkbox\|slider\|bar\|button\|label\|textarea\|dropdown\|table\|image"` | Force the widget, overriding tag and heuristic classification — e.g. a hand-rolled `<div>` toggle becomes an `lv_switch` |
| `data-lv-name="pump_enable"` | Set the widget's `name`, instead of deriving it from `id`/`class` — useful for looking the widget up with `lv_obj_get_child_by_name()` |
| `data-lv-ignore` | Drop the element and its subtree — design-time guides, print-only content, debug overlays |
| `data-lv-component="Name"` | Mark a component boundary by hand, giving plain HTML the same componentization React gets automatically |

`examples/annotations.html` exercises all of them.

### React input (Phase 3)

Point the CLI at a `.jsx`/`.tsx` file whose default export is a component; it is bundled with esbuild, mounted in headless Chromium, and each function component's DOM subtree is identified by walking the React fiber tree. The componentizer then turns repeated components into **reusable LVGL XML components with props**:

```xml
<!-- stat_card.xml — generated from function StatCard({label, value, unit}) -->
<component>
  <api>
    <prop type="string" name="label" default="311"/>
    ...
  </api>
  <view style_bg_color="0x1c2430" ...>
    <lv_label text="$label" .../>
  </view>
</component>

<!-- panel.xml references it -->
<stat_card flex_grow="1" width="92" height="78" label="311" label_2="CORE K"/>
```

Differing label texts become string props, differing colors become color props, and placement stays on the instances. Structurally inconsistent instances fall back to inline output with a warning. Plain HTML can opt into the same mechanism with `data-lv-component="Name"` attributes. C output (`--format c/both`) stays flattened and works for React input too.

### Output formats

- **XML** (default): for LVGL v9.4's `lv_xml` runtime and the LVGL Editor toolchain.
- **C** (`--format c` or `both`): self-contained `ui_<name>.c/.h` exporting `lv_obj_t * ui_create(lv_obj_t * parent)` — no XML runtime dependency, works on any LVGL 9.x. Both backends emit from the same widget tree; their renders are pixel-identical.

### Fidelity

`node scripts/fidelity.mjs <web.png> <lvgl.png|bmp>` pixel-scores a conversion. Current examples score 79–94% (tolerance 32, mostly font antialiasing differences), in line with the 80–90% expectation set in RESEARCH.md.

CSS `font-size` maps onto the built-in Montserrat sizes using per-glyph advance widths extracted from LVGL's font sources (`scripts/gen-font-metrics.mjs`), so labels never clip or wrap unexpectedly.

## Project layout

- `src/` — the `html2lvgl` CLI: `extract.mjs` / `extract-react.mjs` (Playwright), `convert.mjs` (mapping), `componentize.mjs`, `optimize.mjs`, `emit-xml.mjs`, `emit-c.mjs`, `fonts.mjs`, `preview.mjs` (watch mode)
- `examples/` — sample pages to convert, including `react/panel.jsx` and `annotations.html`
- `tests/` — golden-file tests (`npm test`); fixtures are committed extraction snapshots, so tests need no browser
- `spike/` — the Phase 0 proof-of-concept and the C render harness used for CI validation
- `scripts/` — font-metrics generator (run against an LVGL v9.4.0 checkout) and the fidelity scorer

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
