# Components

[Back to README](./README.md)

| [Goal](#goal) | [How Recognition Works](#how-recognition-works) | [The Registry](#the-registry) | [The Disclosure Primitive](#the-disclosure-primitive) | [Modal](#modal) | [Component Mapping](#component-mapping) | [Icons](#icons) | [TODO.txt and Diagnostics](#todotxt-and-diagnostics) | [Plugins](#plugins) | [Editor Constraints](#editor-constraints) | [Known Gotchas](#known-gotchas) |

This is a design document. Nothing here is built yet. See [ROADMAP.md](./ROADMAP.md) for the build order.

## Goal

Convert complex web components, such as the ones in React Material UI, into LVGL. Examples are Accordion, App Bar, Drawer, Breadcrumbs, Card, and Modal.

Today the tool reads one rendered snapshot from Chromium and maps tags to widgets. That is not enough for these components:

1. **They have state and behavior.** A collapsed Accordion panel has no height, so extraction drops it. A Drawer or Modal is rendered outside the React root and is not visible until opened.
2. **They are styled `div` elements.** No tag says "accordion".

The design adds a recognition layer in front of the converter, a registry of component definitions, and a diagnostics system that tells the user what still needs manual work.

[Back to Top](#components)

## How Recognition Works

Recognition is **ARIA-first**. ARIA roles and states are a web standard, so one recognizer works for Material UI, Bootstrap, Radix, Vuetify, and hand-written HTML.

Signals, from most to least general:

| Signal | Example | Works for |
|---|---|---|
| ARIA | `aria-expanded`, `role="tablist"`, `<nav aria-label="breadcrumb">` | Any library, plain HTML |
| Explicit annotation | `data-lv-widget="accordion"` | Anything |
| Library class names | `MuiAccordion-root` | One library (via a library plugin) |
| Framework component name | React fiber `Accordion` | One framework (via a framework plugin) |

The annotation always wins, so a user can fix a wrong guess.

### Extractor changes

`src/extract.mjs` must also capture:

- `role`, every `aria-*` attribute, `id`, `class`, and `data-testid`.
- Hidden subtrees. They are kept and flagged `hidden: true` instead of dropped.
- For recognized toggles, a **state sweep**: read the mounted but hidden DOM, or click the trigger in the browser and snapshot the result.

[Back to Top](#components)

## The Registry

A new `src/recognize.mjs` holds a registry. It runs on the extracted tree before `convert.mjs`.

Each entry is **data, not code paths**:

```js
{
  name: 'accordion',
  match(node, ctx) { /* ARIA test, returns a score or false */ },
  props: {
    title:    { type: 'string', default: '' },
    expanded: { type: 'bool',   default: false },
  },
  slots: ['header', 'body'],
  build(node, ctx) { /* returns IR nodes and any diagnostics */ },
}
```

- `match` returns a confidence score. The highest score wins. A tie prints a diagnostic.
- `props` and `slots` are plain JSON. The converter does not need them, but the future [editor](#editor-constraints) builds its palette and property panel from them.
- Entries are pure functions of the tree. They need no browser, so they are unit-testable with fixture trees.

[Back to Top](#components)

## The Disclosure Primitive

Most interactive components share one ARIA pattern: a **trigger** with `aria-controls="id"` and `aria-expanded`, and a **target** with that `id`. The recognizer links the two once. The variants depend on what the target is:

| Target | Pattern | LVGL |
|---|---|---|
| Inline panel | `aria-expanded` button and a region | Accordion: header and a body that reflows its siblings |
| Edge-anchored, full height | `role="dialog"` against a screen edge | Drawer: container on `lv_layer_top()` with a slide animation |
| Centered overlay | `role="dialog"` and `aria-modal="true"` | [Modal](#modal) |
| Small overlay | `role="menu"` or `aria-haspopup` | Menu: dropdown or list |

Drawer and Modal are told apart by geometry, which the extractor already has.

### Behavior with LVGL subjects

State lives in an LVGL **subject**. The trigger changes it. The target binds a flag to it. In a flex column, hiding the body reflows its siblings, so an Accordion needs no manual layout:

```xml
<!-- globals.xml -->
<globals>
  <subjects>
    <int name="acc1_open" value="0"/>
  </subjects>
</globals>

<!-- page -->
<lv_obj flex_flow="column">
  <lv_button> <!-- header -->
    <subject_toggle_event subject="acc1_open"/>
  </lv_button>
  <lv_obj name="acc1_body">
    <bind_flag_if_eq subject="acc1_open" flag="hidden" ref_value="0"/>
  </lv_obj>
</lv_obj>
```

These tags were checked against the LVGL v9.4.0 source and docs (`src/others/xml/lv_xml.c`, `docs/src/details/xml/`):

| Need | Tag | Notes |
|---|---|---|
| Declare state | `<int name value/>` inside `<subjects>` in `globals.xml` | Only `int` and `string` are documented. Source also has float events. |
| Toggle on click | `<subject_toggle_event subject trigger/>` | Registered in 9.4.0 but missing from the docs. `trigger` defaults to `clicked`. The subject must be `int`, or it logs a warning and does nothing. |
| Set a value | `<subject_set_int_event trigger subject value/>` | There is also `_float_` and `_string_`. |
| Step a value | `<subject_increment_event trigger subject step min_value max_value rollover/>` | `int` or `float` subjects. Useful for Stepper and Pagination. |
| Show or hide | `<bind_flag_if_eq/not_eq/gt/ge/lt/le subject flag ref_value/>` | The `lv_obj-` prefix is optional. `bind_state_if_*` works the same way for states. |
| Run code | `<event_cb callback trigger user_data/>` | The user must register the function. The exported C assumes it exists. |
| Load a screen | `<screen_load_event>` and `<screen_create_event>` | Already used for navigation. |
| Animate | `<animations>` with `<timeline>` and `<animation prop target start end duration delay/>`, played by `<play_timeline_event>` | For the Drawer slide. |

Consequences for the design:

- **Subjects are global.** Every subject lives in `globals.xml`, in one shared scope. Generated names must be unique per page and per component instance (for example `<screen>_<name>_open`), and conversion must write a `globals.xml`. This is new output.
- **Open question:** whether a component can declare subjects in its own scope. The source passes a `scope` to `lv_xml_get_subject`, but the docs only show `globals.xml`. Phase 5's spike answers this.
- **No dedicated Modal or Drawer tags.** Use the same pattern: a subject, a toggle or set event on the opener, and `bind_flag_if_*` on the target.
- **Top layer.** Nothing in the XML docs mentions `lv_layer_top()`. A Modal or Drawer may need a small C helper, or a child created on the top layer by the application. The spike must check whether XML alone can do this.
- The C, C++, and MicroPython emitters need equivalent output (`lv_subject_init_int`, `lv_obj_add_subject_toggle_event`, `lv_obj_bind_flag_if_eq`, and so on). A subject-aware helper replaces most of the hand-written glue.

Shared pieces ship as **library XML components** (`ui_accordion`, `ui_drawer`, and so on). The existing componentize step already makes parameterized components, so the recognizer only fills in the props.

[Back to Top](#components)

## Modal

- **Detect** `role="dialog"` or `role="alertdialog"`. `aria-modal="true"` means a blocking backdrop. `aria-labelledby` and `aria-describedby` give the title and body.
- **Emit** a container on `lv_layer_top()`. The backdrop is a full-screen object with about 50 percent black opacity. It is clickable, so it blocks input beneath. The dialog sits centered on top. A simple confirm dialog (a title, a message, one or two buttons) could map to `lv_msgbox` instead.
- **State:** hidden by default and shown by a subject flag. The opener is any element with `aria-controls` or `aria-haspopup="dialog"` that points at the dialog. A dialog that is already open when the page loads starts open.
- **Dismissal:** a close or cancel button sets the flag back. Click on the backdrop to close is optional.
- **Portals:** a modal usually sits outside the root DOM. The recognizer matches by `role`, not by DOM position, so this works.

[Back to Top](#components)

## Component Mapping

| Component | LVGL | Notes |
|---|---|---|
| Card, Paper, Divider, Chip, Avatar, Badge, Alert | Styled `lv_obj`, `lv_label`, `lv_image` | Mostly works today. Needs elevation to shadow and a round radius for avatars. |
| App Bar and Toolbar | Top flex-row container | Pinned to the top and kept out of scrolling. |
| Breadcrumbs | Flex row of labels and buttons | Reuses `data-lv-link` navigation. Separators are plain labels. |
| Tabs | `lv_tabview` | Native. |
| Switch, Slider, Select, Linear progress | Existing widgets | Add ARIA detection. |
| Circular progress | `lv_spinner` or `lv_arc` | Native. |
| Text field | `lv_textarea` and a label | Floating labels are static in a snapshot. |
| Dialog, Snackbar, Menu | `lv_msgbox` or a top-layer container | Portals need a special case. |
| Bottom navigation | `lv_tabview` at the bottom, or a button row | |
| Date picker | `lv_calendar` | |
| Accordion | Header button and body container | Composite. See [The Disclosure Primitive](#the-disclosure-primitive). |
| Drawer | Container on `lv_layer_top()` and a backdrop | Slide animation. Opened by the app bar's menu button. |
| Stepper, Pagination, Speed dial | Composites | Later. |
| Data grid, Autocomplete, Tree view | Out of scope | Needs its own design. |

[Back to Top](#components)

## Icons

Icons (an SVG, an icon font, or a Material Icons ligature) cannot become a label. The first version emits a **named placeholder**:

- A fixed-size `lv_obj` with an outline, so the layout stays stable.
- The name comes from the best available hint, in this order: `data-testid`, `aria-label`, the SVG `<title>`, then the class. For example `icon_menu`. This makes it easy to find and swap in code.
- Every placeholder adds a `TODO.txt` entry that says where it is and how to replace it.

Later options, not part of the first version:

- A map from known names to built-in `LV_SYMBOL_*`.
- A Material Icons subset built with `lv_font_conv`, using the existing font pipeline.
- Arbitrary SVG rasterized to `lv_image`.

[Back to Top](#components)

## TODO.txt and Diagnostics

Convert today's `ctx.warnings` strings into structured diagnostics:

```js
{ code, severity, source: { file, selector, line }, output: { file, widgetName }, message, fix }
```

- Codes are stable: `ICON_PLACEHOLDER`, `DISCLOSURE_NO_TARGET`, `FONT_FALLBACK`, `UNSUPPORTED_WIDGET`, and so on.
- **`TODO.txt`** is human-readable and grouped by output file. Each entry says what to do and where, in the source file or in the output file. It is regenerated on every run, so it never goes stale.
- **`diagnostics.json`** carries the same data for tooling and the editor.
- Source locations: for HTML, `data-lv-name` or a CSS path. For React in a development build, the fiber's `_debugSource` gives `file:line`.
- Console warnings stay, but shrink to a short summary that points to `TODO.txt`.

Example entry:

```
ui_home.xml
  [ICON_PLACEHOLDER] icon_menu (src/App.tsx:42)
    An icon was replaced by an empty 24x24 box.
    Fix: replace the lv_obj named "icon_menu" with an lv_image or an lv_label using LV_SYMBOL_LIST.
```

Everything else reports through this system, so it is built first.

[Back to Top](#components)

## Plugins

Rendering happens in Chromium, so the core never needs to know which framework made the DOM. A framework package covers only the parts that need framework knowledge:

| Hook | Job | React today |
|---|---|---|
| `load(entry)` | Bundle or mount the input and return a ready page | esbuild and `createRoot` (`src/extract-react.mjs`) |
| `components(page)` | Find component boundaries for reusable XML components | Walk the fiber tree |
| `sourceOf(el)` | Source file and line for `TODO.txt` | `_debugSource` |
| `recognizers` | Library-specific recognizers (optional) | none yet |

There are two kinds of package, kept separate:

- **Framework plugins:** `html-to-lvgl-react`, `-vue`, `-angular`. They provide `load`, `components`, and `sourceOf`.
- **Library plugins:** `html-to-lvgl-mui`, `-bootstrap`, `-vuetify`. They provide `recognizers`. A library like Bootstrap works with any framework, so it must not depend on one.

Rules:

- The core package keeps plain HTML, the ARIA recognizers, and the emitters.
- **Discovery:** an explicit `--plugin <pkg>` flag, or an `html2lvgl.config.mjs` file. Detection by file extension (`.jsx` selects react, `.vue` selects vue) is a convenience on top.
- A plugin exports a default object `{ name, pluginApi, extensions, load, components, sourceOf, recognizers }`.
- **Versioning:** `pluginApi` is an integer. The core refuses a plugin built for an incompatible version with a clear message.
- Each plugin lists its framework and bundler as peer dependencies, so users install only what they use.

### Sequencing

React is built into the core today. It moves behind this interface first, with no change in output and the golden tests as the safety net. Only then is a second framework added, so the interface is checked against more than one example. Vue is the likely second one, because its mounting model is closest to React's.

Deferred:

- **Angular** needs a CLI build, which does not fit "bundle one file". Start with a "convert a built or running app URL" mode. Non-framework users benefit from that mode too.
- **Server-rendered frameworks** (Next, Nuxt) can use the same URL mode.

[Back to Top](#components)

## Editor Constraints

A drag-and-drop editor is planned. It is not built now, but these rules keep it possible:

1. **Declarative registry entries.** The editor's palette and property panel come from the same `props` and `slots` the converter uses.
2. **Serializable IR with stable names.** Every node has a persistent `name`, and the IR is plain JSON.
3. **Overrides in a sidecar file**, such as `page.lvgl.json`, keyed by node name and applied after conversion. Editor changes then survive a re-conversion without rewriting the user's HTML.
4. **The editor edits the IR or the sidecar** and re-runs the emitters. It does not parse generated XML.
5. **Reuse watch mode.** `src/preview.mjs` already has the preview server and the LVGL render program, so it can be the editor's canvas.
6. **A device-size canvas**, the same `--size` the CLI uses.

[Back to Top](#components)

## Known Gotchas

- **Ripples and transitions:** ignore them. Map `:active` to a pressed style, as the tool does today.
- **Elevation:** Material UI uses multi-layer shadows. Use the largest layer.
- **Fonts:** Roboto goes through `--font-map`. No new work.
- **Small screens:** Material UI at 320x240 is tight. Emit a diagnostic for touch targets under about 30 px.
- **Floating labels and animations:** a snapshot shows one state only.

[Back to Top](#components)

---

[Back to README](./README.md)
