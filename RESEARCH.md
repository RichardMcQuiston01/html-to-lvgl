# Feasibility Research: HTML → LVGL Converter

**Date:** August 2026
**Status:** Roadmap complete — Phases 0–4 delivered: the `html2lvgl` CLI converts HTML and React/JSX into LVGL XML or plain C, with flex/grid layout, real font metrics, componentized React output, multi-screen navigation, watch-mode preview, and CI validation against LVGL v9.4.0 (see [README](README.md)).
**Question:** How feasible is it to build a library or application that transforms plain HTML (or React-generated HTML) into LVGL code for devices like Arduino or ESP32?

> **Phase 0 spike result (August 2026):** the proposed pipeline was built end-to-end and works. Three sample device-UI pages were converted automatically — headless Chromium extraction → LVGL XML → rendered by the stock LVGL v9.4 `lv_xml` runtime on a virtual 320×240 display — at roughly 90% visual fidelity. Side-by-side screenshots, code, and findings are in [`spike/`](spike/README.md). One material update from the spike: the `lv_xml` runtime module has been **removed from LVGL's `master` branch** (XML tooling is consolidating into LVGL Pro, which compiles XML to C), so the project should pin **LVGL v9.4.0** — the last release with the in-tree runtime parser — and treat direct C emission (already planned for Phase 2) as a first-class output alongside XML.

---

## 1. Executive Summary

**Verdict: Feasible — and well-timed — as a build-time transpiler that converts a defined HTML/CSS subset into LVGL's declarative XML format (with optional C code generation).**

**Not feasible** as a general-purpose "browser for microcontrollers" that renders arbitrary web pages at runtime — MCU-class hardware (ESP32: ~520 KB SRAM) cannot host a real HTML/CSS/JS engine, and pages in the wild rely on features (JavaScript, web fonts, media queries, floats, complex cascade) that have no LVGL equivalent.

Three findings make the transpiler approach unusually practical right now:

1. **LVGL 9.3+ ships a declarative XML UI format** — officially described as "similar to HTML" — with a full ecosystem around it (LVGL Editor, CLI, Figma plugin, code generation to plain C). Emitting this XML instead of raw C removes most of the code-generation burden and makes output human-editable and diff-friendly.
2. **LVGL's layout engine is deliberately a subset of CSS.** Flex and Grid layouts are documented as subsets of CSS Flexbox and CSS Grid, and the style/coordinate system is explicitly CSS-inspired. A large share of real-world layout CSS therefore maps nearly 1:1.
3. **No such tool exists.** LVGL forum threads show users hand-converting HTML/CSS snippets or asking LLMs to do it. The closest tools go the *opposite* direction (GUI Guider exports LVGL projects *to* HTML) or start from Figma rather than HTML. This is an open gap with demonstrated demand.

Realistic fidelity expectation: **80–90% visual accuracy** for pages written within the supported subset — the same figure Builder.io reports for its mature html-to-figma pipeline, which is the strongest architectural precedent for this idea.

---

## 2. Problem Statement & Target Constraints

The README's goal: take HTML/React-based pages and produce LVGL UIs for Arduino/ESP32-class devices.

### Target hardware envelope (from LVGL's official requirements)

| Resource | LVGL minimum | Recommended | Typical ESP32 |
|---|---|---|---|
| CPU | 16 MHz+, 16/32/64-bit MCU | > 48 MHz | 240 MHz dual-core |
| Flash/ROM | > 64–128 KB for library | > 180 KB | 4–16 MB |
| Static RAM | ~2 KB + widgets | — | 520 KB SRAM (+PSRAM) |
| Heap / working RAM | > 32–48 KB | > 48 KB + frame buffers | — |
| Language | C99 or newer | — | C/C++ (ESP-IDF, Arduino) |

### What these constraints imply

- **All heavy lifting must happen on the developer's machine at build time.** Parsing HTML, resolving the CSS cascade, converting fonts and images — none of this can run on-device.
- **Assets need offline conversion.** LVGL cannot load TTF/WOFF fonts or PNG/JPEG from the web at render time on small targets; fonts go through `lv_font_conv` and images through `lv_img_conv` (or the LVGL Editor pipeline) into C arrays / binary formats.
- **The output must be static, deterministic UI code** — screens, widgets, styles — plus event-handler stubs that the firmware developer wires to real logic.

---

## 3. The LVGL Landscape (2026)

Understanding what already exists is essential to positioning this project.

### LVGL 9.x XML — the natural compile target

Since v9.3, LVGL includes an **XML module** implementing a declarative UI description: components, screens, styles, layouts, constants, events, and even animations described in XML rather than C. Key properties:

- Officially characterized as HTML-like and designed to be readable, Git-mergeable, and reviewable in pull requests — *not* a proprietary binary project format.
- Can be **loaded at runtime** by the LVGL XML parser on capable devices, or **exported to plain C** (no extra runtime needed) via LVGL's tooling — covering both fast-iteration and small-flash use cases.
- Surrounded by first-party tooling: the **LVGL Editor** (live preview, validation, autocomplete), a **CLI** usable in CI, **Online Share** for previews, and a **Figma plugin** that converts designs to XML.

> **Implication:** an HTML→LVGL tool should emit **LVGL XML as its primary output**. It inherits validation, preview, and C export from LVGL's own toolchain, and stays decoupled from LVGL C API churn.

### CSS-like foundations already in LVGL

- **Flex layout** — documented subset of CSS Flexbox: rows/columns, wrapping, spacing, `flex-grow`, min/max constraints.
- **Grid layout** — documented subset of CSS Grid: 2D tracks, spanning, pixel/`CONTENT`/free-unit (`fr`-like) track sizing.
- **Styles** — LVGL's style system (padding, margin-like offsets, borders, radius, background, opacity, text properties, gradients) was modeled on CSS; the docs state the coordinate concept "was inspired by CSS."
- LVGL v8's release notes were literally titled "CSS-Inspired Layouts."

### Existing design-to-LVGL tools (none start from HTML)

| Tool | Input | Output | Relevance |
|---|---|---|---|
| **LVGL Editor / LVGL Pro** | XML (hand-written or Figma import) | XML → C | Defines the XML target format |
| **Figma plugin (LVGL Pro)** | Figma designs | LVGL XML | Precedent for "design artifact → XML" conversion |
| **SquareLine Studio** | Drag-and-drop designer | C code | Commercial; proprietary project format |
| **NXP GUI Guider** | Drag-and-drop designer | C code (+ HTML *export*) | Converts LVGL→HTML, i.e., the reverse direction |
| **EEZ Studio** | Visual designer | C code | Open source designer |
| **ESPHome LVGL component** | YAML | Runtime config | Proof that declarative → LVGL works for hobbyists |
| **lv_binding_js (lvgljs)** | JSX/React + JS | Runtime UI via QuickJS | Official React bindings — relevant to the React input path |

### Demonstrated demand, no supply

- LVGL forum: *"How to convert a beautiful HTML/CSS switch code in LVGL code"* — answered with "use an AI to translate it"; no tool exists.
- LVGL forum: *"Serialize, Converter and Layout LVGL UI from JSON or other raw content"* — community interest in declarative pipelines predates the XML module.
- GitHub issue lvgl/lvgl#6601 requests higher-level language wrappers.

---

## 4. Prior Art & Architectural Precedents

### Builder.io `html-to-figma` — the strongest precedent

Converts arbitrary live web pages into Figma design trees by walking the DOM in a real browser and reading **`getComputedStyle`** for every element, then mapping computed boxes/styles onto Figma's node model (including Auto Layout, Figma's flexbox analog). Reports **80–90% accuracy** on real pages. This validates the core architecture for HTML→"other UI tree" conversion and sets a realistic fidelity bar.

Two lessons transfer directly:

1. **Let a real browser engine resolve the hard parts.** Instead of re-implementing the CSS cascade, specificity, inheritance, and units, load the page in headless Chromium (Playwright/Puppeteer) and read back computed styles and layout boxes. Fidelity comes free; the converter's job reduces to *mapping*, not *rendering*.
2. **Map to the target's layout primitives, not absolute pixels, when possible.** html-to-figma's Auto Layout mode mirrors what we'd do mapping flex containers → LVGL flex containers; absolute-positioned fallback remains available for everything else.

### litehtml / microbrowser — the runtime path (and why to reject it)

**litehtml** is a lightweight C++ HTML/CSS2-3 layout engine with pluggable drawing callbacks; **microbrowser** experimented with litehtml on ESP32 with planned LVGL integration. It proves runtime HTML on MCU is *possible* for simple documents, but: no JavaScript, C++ runtime cost, RAM-hungry DOM per page, and the output is painted pixels — not LVGL widgets, so no theming, no widget behaviors, no LVGL event model. Useful as a fallback idea for document viewing, wrong architecture for building device UIs.

### lv_binding_js — the React path

Official LVGL project: React reconciler + QuickJS running on-device (Linux-class or larger targets today; ESP32 support is a community discussion, not a shipped feature). Relevant if the goal is "write React, run on device," but it ships a JS engine at runtime — heavy for ESP32 — and doesn't consume *HTML*; it consumes JSX components written against its own widget set.

---

## 5. Candidate Architectures

### Option A — Build-time transpiler (RECOMMENDED)

```
                    ┌───────────────────────────── developer machine ─────────────────────────────┐
 HTML/CSS  ──►  headless Chromium        IR (UI tree:            emitter          LVGL XML
 (or URL)       renders page,      ──►   boxes, computed   ──►   + asset     ──►  components/screens
                getComputedStyle         styles, text,           pipeline          │
                + DOM walk               images, roles)          (fonts,           ▼
                                                                 images)      LVGL Editor / CLI
                                                                              preview · validate · export C
```

- **Frontend:** Node.js/TypeScript CLI. Two parsing modes:
  - *Static mode:* `parse5`/`cheerio` + a CSS resolver for simple, well-formed input (fast, no browser needed).
  - *Rendered mode (default):* Playwright + headless Chromium; capture DOM tree, computed styles, and layout rects at a configured target resolution (e.g., 320×240, 480×320, 800×480).
- **Intermediate representation:** a normalized UI tree (node type, geometry, resolved style, text runs, image refs, semantic role) — keeps input parsing decoupled from output emission and enables future inputs (JSX) and outputs (C, MicroPython).
- **Backend:** emit LVGL XML components/screens; map flex/grid containers to LVGL flex/grid, everything else to absolutely positioned objects. Run assets through `lv_font_conv` / image conversion. Optionally invoke the LVGL CLI to validate and export C.
- **Why it wins:** zero on-device cost; leverages Chromium for CSS correctness and LVGL's own toolchain for validation/codegen; output is readable and editable rather than a black box.

### Option B — Runtime HTML engine on device (REJECTED for MCU targets)

Port litehtml (or similar) with an LVGL draw backend. Rejected: RAM/flash cost, no JS, paints pixels instead of creating widgets, loses LVGL's event/theme/widget model, and restricts targets to the high end. Revisit only for a "static document viewer" side-feature on Linux-class boards.

### Option C — React/JSX direct path (PHASE 3, complements A)

Instead of rendering React to HTML and converting the HTML, consume the JSX/component tree directly and emit LVGL XML components (LVGL XML has components, params, and events that map well to React's mental model). Alternative: target `lv_binding_js` for Linux-class devices. Recommended as a later phase because Option A already handles React apps via their rendered HTML.

---

## 6. Mapping: HTML/CSS → LVGL

### Elements → widgets (representative, not exhaustive)

| HTML | LVGL widget / construct |
|---|---|
| `div`, `section`, `main`, `header`, `footer` | `lv_obj` container (flex/grid/absolute) |
| `p`, `span`, `h1`–`h6`, text nodes | `lv_label` (+ font/style per computed text style) |
| `button`, `input type=button/submit` | `lv_button` + child `lv_label` |
| `input type=text/password/number`, `textarea` | `lv_textarea` (+ keyboard wiring stub) |
| `input type=checkbox` | `lv_checkbox` |
| `input type=radio` | `lv_checkbox`/`lv_button` group with radio behavior |
| `input type=range` | `lv_slider` |
| `input type=checkbox` styled as toggle | `lv_switch` (heuristic / opt-in annotation) |
| `select` | `lv_dropdown` |
| `img` | `lv_image` (asset converted offline) |
| `ul`/`ol`/`li`, repeated card patterns | `lv_list` or flex column of items |
| `table` | `lv_table` (simple) or grid container |
| `progress`, `meter` | `lv_bar`, `lv_arc`/`lv_scale` |
| `a` | `lv_label`/`lv_button` + screen-navigation event stub |
| `canvas`, `svg`, `video`, `iframe`, `script` | **Unsupported** (SVG: possible rasterize-at-build-time fallback) |

### CSS properties → LVGL styles (high-confidence subset)

| CSS | LVGL |
|---|---|
| `display:flex`, `flex-direction`, `wrap`, `justify-content`, `align-items`, `gap`, `flex-grow` | LVGL Flex (documented CSS subset) |
| `display:grid`, track sizes incl. `fr`, spans | LVGL Grid (`fr` ↔ free units, `auto` ↔ `CONTENT`) |
| `width`/`height` (px, %, `auto`) | size, `lv_pct()`, `LV_SIZE_CONTENT` |
| `padding`, `margin` | `pad_*`, `margin_*` style props |
| `background-color`, linear gradients | `bg_color`, `bg_grad` |
| `border`, `border-radius` | `border_*`, `radius` |
| `color`, `font-size`, `font-weight`, `text-align`, `letter-spacing`, `line-height` | text styles + generated fonts (each family/size/weight = one converted font) |
| `opacity` | `opa` |
| `box-shadow` | `shadow_*` |
| `overflow:scroll/auto` | LVGL scrollable containers (native) |
| `position:absolute` + offsets | absolute positioning (LVGL default coords) |
| `:hover`/`:active`/`:disabled`/`:focus` | `LV_STATE_PRESSED` / `DISABLED` / `FOCUSED` style states |

### No clean mapping (document as limitations)

- **JavaScript behavior** — only event *stubs* are generated (`onclick` → named LVGL event callback to implement in firmware).
- Floats, CSS `position:sticky`, media queries (mitigation: convert at fixed target resolution; optionally one output per breakpoint), CSS animations/transitions (partial: LVGL has animations, map opt-in), web fonts at runtime (must be pre-converted; each size/weight is a separate bitmap font — enforce a font budget), forms/network, complex selectors (irrelevant in rendered mode — Chromium resolves them; the converter only sees computed styles).

---

## 7. Hard Problems & Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Unbounded input expectations ("convert any website") | High | Position as *subset converter* for UIs authored for devices; document supported subset; lint/warn on unsupported features |
| Text metrics differ (browser vs LVGL fonts) → wrapping/overflow drift | Medium | Prefer flex/`SIZE_CONTENT` over hardcoded boxes; padding tolerances; preview via LVGL Editor/simulator |
| Font/asset bloat (every family×size×weight becomes a bitmap font) | Medium | Font budget warnings; size quantization (map 13/14/15px → 14px); subset glyph ranges from actual page text |
| LVGL XML format still evolving (9.3 → 9.6+) | Medium | Target a pinned LVGL version; validate output with the LVGL CLI in CI |
| Deeply nested DOM (frameworks emit wrapper soup) → widget-count/RAM blowup on device | Medium | IR optimization pass: collapse single-child wrappers, drop zero-impact nodes |
| Interactivity gap disappoints users (UI looks right, does nothing) | Medium | Generate clear event-stub scaffolding + example wiring; make this loud in docs |
| Fidelity plateau (~80–90%) | Low | Same as html-to-figma; ship a side-by-side screenshot diff (Chromium vs LVGL simulator) to quantify |

---

## 8. Proposed Roadmap (MVP-first)

**Phase 0 — Spike (validate the core loop).** Hand-pick 3 sample pages (a settings panel, a thermostat card, a login form). Manually run: Playwright DOM+computed-style dump → tiny script → LVGL XML → preview in LVGL Editor/simulator. Success = recognizable UI on a 320×240 simulator. *This de-risks everything else.*

**Phase 1 — MVP CLI (`html2lvgl input.html --size 320x240 -o ui/`).** Rendered-mode pipeline (Playwright), IR, XML emitter. Scope: containers with flex + absolute positioning, labels, buttons, images, sliders, checkboxes, switches; core style subset (colors, borders, radius, padding, fonts via `lv_font_conv`, images via converter). Golden-file tests + LVGL CLI validation in CI.

**Phase 2 — Fidelity & breadth.** Grid layout, gradients/shadows, style-state mapping (`:hover`→pressed), scrollable regions, `lv_table`/`lv_list`, wrapper-collapse optimizer, screenshot-diff scoring, multi-screen support (`<a href>` → screen navigation), optional direct C emission.

**Phase 3 — React path.** Consume JSX/component sources directly → LVGL XML components with params/events (preserving component boundaries instead of flattened HTML); evaluate `lv_binding_js` interop for Linux-class targets.

**Phase 4 — Developer experience.** Watch mode with LVGL simulator preview; annotation attributes in source HTML (e.g., `data-lvgl-widget="switch"`, `data-lvgl-ignore`); web playground (LVGL compiles to WASM — paste HTML, see LVGL render side-by-side).

### Effort estimate (single experienced developer)

| Phase | Estimate |
|---|---|
| 0 — Spike | ~1 week |
| 1 — MVP | 4–6 weeks |
| 2 — Fidelity | 6–8 weeks |
| 3 — React | 4–6 weeks |
| 4 — DX | ongoing |

### Recommended stack

TypeScript + Node.js CLI; Playwright (headless Chromium) for rendered mode; `parse5` for static mode; `lv_font_conv` (official, npm) and LVGL image conversion for assets; LVGL Editor/CLI for validation, preview, and XML→C export. **Licensing is clean:** LVGL core is MIT, `lv_font_conv` is MIT, litehtml (if ever used) is BSD — compatible with this project's MIT license.

---

## 9. Verdict

| Approach | Feasibility |
|---|---|
| Build-time transpiler: HTML/CSS subset → LVGL XML (→ C via LVGL tooling) | **High — recommended** |
| Same, emitting raw C directly without the XML layer | Medium (more codegen surface to maintain; keep as secondary output) |
| React/JSX → LVGL components | Medium-high (Phase 3; natural extension) |
| Runtime HTML engine on ESP32/Arduino | Low — rejected |
| Pixel-perfect conversion of arbitrary websites | Not achievable; target 80–90% on the supported subset |

The project is worth building. The unique enabler is LVGL's own XML pivot: for the first time there is an official, documented, HTML-like declarative target with first-party preview/validation/codegen tooling, which reduces this project's scope from "write a CSS engine and a C code generator" to "map computed web layout onto LVGL's CSS-subset primitives and emit XML." The main open risk is expectation management around the supported subset and interactivity stubs — a documentation and positioning problem, not a technical one.

---

## 10. Sources

### LVGL official
- [LVGL requirements](https://lvgl.io/docs/open/introduction/requirements) · [lvgl.io](https://lvgl.io/) · [lvgl/lvgl on GitHub](https://github.com/lvgl/lvgl)
- [XML / Declarative UI introduction (9.3 docs)](https://lvgl.io/docs/open/9.3/details/auxiliary-modules/xml/intro) · [XML overview (master docs)](https://docs.lvgl.io/master/xml/xml/overview.html) · [LVGL Pro and XML](https://lvgl.io/docs/open/xml) · [lvgl/lvgl_pro](https://github.com/lvgl/lvgl_pro)
- [UI Editor announcement](https://lvgl.io/blog/announcement-ui-editor) · [v8 "CSS-Inspired Layouts" release post](https://lvgl.io/blog/release-v8)
- [Flex layout docs](https://docs.lvgl.io/master/common-widget-features/layouts/flex.html) · [Grid layout docs](https://docs.lvgl.io/8.3/layouts/grid.html) · [Positions, sizes, and layouts](https://docs.lvgl.io/8.3/overview/coords.html)
- [lv_binding_js (React bindings)](https://github.com/lvgl/lv_binding_js) · [JavaScript integration docs](https://docs.lvgl.io/master/integration/bindings/javascript.html)
- [lv_img_conv](https://github.com/lvgl/lv_img_conv)

### Community / demand signals
- [Forum: How to convert HTML/CSS switch code to LVGL](https://forum.lvgl.io/t/how-to-convert-a-beautiful-html-css-switch-code-in-lvgl-code/22390)
- [Forum: Serialize/convert LVGL UI from JSON or raw content](https://forum.lvgl.io/t/serialize-converter-and-layout-lvgl-ui-from-json-or-other-raw-content/16294)
- [Forum: WebAssembly / HTML integration](https://forum.lvgl.io/t/webassembly-html-integration/8822)
- [Issue #6601: High-level language wrapper for LVGL](https://github.com/lvgl/lvgl/issues/6601)
- [Forum: GUI Guider 1.8.0 (LVGL→HTML export)](https://forum.lvgl.io/t/gui-guider-1-8-0-is-out-now/17615)
- [Forum: Embedded devices running lv_binding_js](https://forum.lvgl.io/t/embedded-devices-running-lv-binding-js-lvgljs/18997)

### Precedents & building blocks
- [Builder.io: Convert HTML to Design in Figma](https://www.builder.io/blog/html-to-design) · [BuilderIO/figma-html](https://github.com/BuilderIO/figma-html)
- [litehtml](https://github.com/litehtml/litehtml) · [litehtml.com](http://www.litehtml.com/)
- [microbrowser (litehtml on ESP32)](https://github.com/leopck/microbrowser)
- [ESPHome LVGL component](https://esphome.io/components/lvgl/layouts/)
- [Elecrow: Everything you should know about LVGL](https://www.elecrow.com/blog/everything-you-should-know-about-lvgl.html)
- [Espressif IoT Solution: LVGL GUI](https://espressif-docs.readthedocs-hosted.com/projects/espressif-esp-iot-solution/en/latest/gui/lvgl_gui.html)
