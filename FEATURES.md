# Features

[Back to README](./README.md)

| [What Converts](#what-converts) | [Multi-Screen Navigation](#multi-screen-navigation) | [Custom Fonts](#custom-fonts) | [TODO.txt and Diagnostics](#todotxt-and-diagnostics) | [Watch Mode](#watch-mode) | [Annotation Attributes](#annotation-attributes) | [React Input](#react-input) | [Output Formats](#output-formats) | [Fidelity](#fidelity) |

## What Converts

| HTML and CSS | LVGL |
|---|---|
| `display: flex` (direction, wrap, justify-content, align-items, gap, flex-grow) | LVGL flex layout |
| `display: grid` (tracks, gaps, row and column spans) | LVGL grid layout |
| Block and absolute layout | Exact coordinates from Chromium |
| Two-stop `linear-gradient` | Background color and gradient |
| `box-shadow` | Shadow styles |
| `:hover` and `:active` rules | Pressed-state styles |
| `overflow: auto` or `scroll` | Scrollable containers |
| `button` | `lv_button` with a centered `lv_label` |
| Text elements | `lv_label`, sized with real LVGL font widths |
| `input type=range` | `lv_slider` |
| `input type=checkbox` | `lv_switch` or `lv_checkbox` |
| `input type=text` or `password` | `lv_textarea` |
| `select` | `lv_dropdown` |
| `progress` | `lv_bar` |
| `table` | `lv_table` |
| `img` | `lv_image` and an asset list |
| Colors, borders, radius, padding, opacity, text styles | LVGL style properties |

An optimizer step removes empty wrapper `div` elements, so they never become widgets on the device.

[Back to Top](#features)

## Multi-Screen Navigation

Pass more than one page and each page becomes a `<screen>`. Links such as `<a href="settings.html">` become navigation buttons.

Any other element can navigate too. Add `data-lv-link="settings.html"` to a `<button>`, a clickable card, or any element that is not a link. See [Annotation Attributes](#annotation-attributes).

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

- The target screen is created when you click, so you do not manage start-up order.
- Links to outside URLs, or to pages you did not convert, stay plain text.
- A `data-lv-link` value that matches no page prints a warning. It is more likely a typo than a real outside link.
- If an element has both `data-lv-link` and `href`, `data-lv-link` wins.
- Load a screen with `lv_xml_create(NULL, "home", NULL)`, then call `lv_screen_load()`.
- In C output, each screen exports `ui_<screen>_create` instead of `ui_create`. Link every screen that the UI can reach into the same program.

[Back to Top](#features)

## Custom Fonts

By default, text uses LVGL's built-in Montserrat font at the closest size. To use your own typeface, map a CSS font family to a font file:

```sh
node src/cli.mjs examples/typography.html -o out/ \
  --font-map "Liberation Sans=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf" \
  --font-map "Liberation Sans:700=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
```

- Each family, weight, and size is converted with [`lv_font_conv`](https://github.com/lvgl/lv_font_conv) at the exact pixel size.
- Each font only holds the characters the page uses, so files stay small.
- `@font-face` rules with local `url(...)` files are found for you.
- `Family:700` maps one weight.
- A family with no mapping falls back to Montserrat and prints one warning.

Each font is written twice, into `out/fonts/`:

- `<name>.c` compiles with the generated C code.
- `<name>.bin` loads at run time with `lv_binfont_create()`. The XML path uses this file.

Labels are sized from the real widths of the font that draws them. Generated C includes `"lvgl.h"`. If your project needs another path, pass `--lv-include lvgl/lvgl.h`.

[Back to Top](#features)

## TODO.txt and Diagnostics

Every problem the converter finds is a coded diagnostic: an unsupported tag, an unknown `data-lv-widget`, a `data-lv-link` with no matching page, `align-items: baseline`, a missing font, an image to register, or a component left inline. After a run, the console prints one summary line, such as `3 warnings. See out/TODO.txt for what to do about them.`

Two files are written to the output directory:

- `TODO.txt` is for people. It is grouped by output file, and each entry gives the code, the widget name, the source location, what happened, and a `Fix:` line.
- `diagnostics.json` is for tools. It holds the same entries as `{ "version": 1, "diagnostics": [...] }`.

Both files are replaced on every run. When a run finds nothing to report, neither file is written and any copy left by an earlier run is deleted.

[Back to Top](#features)

## Watch Mode

The `--watch` option rebuilds each time you save. It serves a preview at `http://localhost:8377`. Use `--port` to change the port.

The preview shows:

- The Chromium page next to the LVGL render.
- A live fidelity score.
- Converter warnings.
- The generated XML.

The LVGL side needs the render program. It is `spike/build/render` by default. Use `--render-bin` to point at another build. Without it, the preview still shows the browser page and the XML.

A broken save shows its error in the page. The server keeps running.

The tool watches the folder that holds the input file, including its subfolders. Changes to files outside that folder do not trigger a rebuild. Keep a React app's files under one folder, or run the command again.

[Back to Top](#features)

## Annotation Attributes

Add these attributes to your HTML when the automatic result needs a nudge. In React, put them on the JSX element.

| Attribute | Effect |
|---|---|
| `data-lv-widget="switch"` | Forces the widget type. Allowed values are `switch`, `checkbox`, `slider`, `bar`, `button`, `label`, `textarea`, `dropdown`, `table`, and `image`. |
| `data-lv-name="pump_enable"` | Sets the widget name. Use it with `lv_obj_get_child_by_name()`. |
| `data-lv-ignore` | Drops the element and everything inside it. |
| `data-lv-component="Name"` | Marks a component by hand, so plain HTML gets the same reuse that React gets. |
| `data-lv-link="settings.html"` | Turns the element into a button that opens another converted page. It only works when you convert several pages together. |

`examples/annotations.html` shows the first four attributes. `examples/nav/settings.html` shows `data-lv-link` in its "Back to Home" button.

[Back to Top](#features)

## React Input

Give the tool a `.jsx` or `.tsx` file with a default-exported component. The tool bundles it with esbuild and runs it in headless Chromium. It finds each function component by walking the React fiber tree.

Repeated components become reusable LVGL XML components with props:

```xml
<!-- stat_card.xml, made from function StatCard({label, value, unit}) -->
<component>
  <api>
    <prop type="string" name="label" default="311"/>
    ...
  </api>
  <view style_bg_color="0x1c2430" ...>
    <lv_label text="$label" .../>
  </view>
</component>

<!-- panel.xml uses it -->
<stat_card flex_grow="1" width="92" height="78" label="311" label_2="CORE K"/>
```

- Different label text becomes a string prop.
- Different colors become color props.
- Position stays on each instance.
- If instances differ too much, the tool writes them inline and prints a warning.
- C and C++ output stays flat. It works for React input too.

[Back to Top](#features)

## Output Formats

The `--format` option takes a comma-separated list: `xml`, `c`, `cpp`, `py`. The word `both` means `xml,c`.

- **XML** is the default. It targets the LVGL 9.4 `lv_xml` runtime and the LVGL Editor tools.
- **C** writes `ui_<name>.c` and `ui_<name>.h`. The code exports `lv_obj_t * ui_create(lv_obj_t * parent)`. It needs no XML runtime and works on any LVGL 9.x.
- **C++** writes `ui_<name>.cpp` and `ui_<name>.hpp` with the same code. The header uses `extern "C"` so the file links with the font files from `lv_font_conv`. Compile those font and image files as C, whatever `--format` you pick.
- **MicroPython** writes `ui_<name>.py` with plain `lv.*` calls. See [MICROPYTHON.md](./MICROPYTHON.md).

All four formats come from the same widget tree. XML, C, and C++ renders match pixel for pixel. The Python format targets an older LVGL inside the pinned MicroPython binding.

[Back to Top](#features)

## Fidelity

This command scores a conversion by comparing pixels:

```sh
node scripts/fidelity.mjs <web.png> <lvgl.png|bmp>
```

The current examples score 79 to 94 percent. Most of the gap is font smoothing.

CSS `font-size` maps to the built-in Montserrat sizes using real glyph widths from LVGL (`npm run metrics` rebuilds them). Labels do not clip or wrap by surprise. To skip the approximation, supply the real typeface. See [Custom Fonts](#custom-fonts).

[Back to Top](#features)

---

[Back to README](./README.md)
