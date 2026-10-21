# Roadmap

## Status

All originally planned phases (0–4) are complete: `html2lvgl` converts plain HTML and React/JSX into LVGL XML, plain C, or C++, with flex/grid layout, real font metrics, componentized React output, multi-screen navigation, watch-mode preview, and CI validation against LVGL v9.4.0.

## Delivered phases

**Phase 0 — Spike (proof of concept).** Validated the core extract → convert → XML loop against three sample pages, rendered on a real LVGL v9.4 simulator at ~90% visual fidelity. See [`spike/README.md`](spike/README.md) for the writeup and side-by-side screenshots.

**Phase 1 — MVP CLI.** The rendered-mode pipeline (Playwright extraction), the element-tree IR, and the XML emitter. Containers with flex + absolute positioning, labels, buttons, images, sliders, checkboxes, switches; core style subset (colors, borders, radius, padding, fonts via `lv_font_conv`, images via converter). Golden-file tests and CI validation against real LVGL.

**Phase 2 — Fidelity & breadth.** Grid layout, gradients/shadows, style-state mapping (`:hover`/`:active` → pressed styles), scrollable regions, `lv_table`, the wrapper-collapse optimizer, screenshot-diff fidelity scoring, multi-screen navigation (`<a href>` → `screen_create_event`), and direct C emission (`--format c`).

**Phase 3 — React input.** `.jsx`/`.tsx` entry points bundled with esbuild and mounted in headless Chromium; component boundaries are identified by walking the React fiber tree and turned into reusable, parameterized LVGL XML components. Plain HTML can opt into the same mechanism by hand with `data-lv-component`.

**Phase 4 — Developer experience.** Watch mode with a live side-by-side preview server (`--watch`), annotation attributes (`data-lv-widget`, `data-lv-name`, `data-lv-ignore`, `data-lv-component`) for overriding the automatic mapping, and a C++ output backend (`--format cpp`) with a documented asset-linkage story.

Since the original five phases, the project also shipped its **first public npm release** (`@richardmcquiston01/html-to-lvgl`) and MicroPython support (below).

**MicroPython (Phases 0–3, unix port).** The Phase 0 spike proved LVGL's existing `--format xml` output loads **unmodified** on `lv_micropython`'s unix port — no new emitter needed to reach MicroPython at all. README's "Using with MicroPython" section documents `lv.xml_init()` + `lv.xml_component_register_from_data()` usage and the `.bin`-fonts-alongside-XML convention (already the natural output of `--font-map`, no new CLI code). A `validate-micropython-xml` CI job renders every golden XML through the unix port the same way `validate-xml` already does for the C harness, catching two real, documented limitations along the way — both traced to the pinned binding's vendored LVGL still being v9.3.0-era, not to html2lvgl's output. Phase 3 added a `--format py` backend for users who'd rather not carry `LV_USE_XML`: idiomatic `lv.*` calls, verified against a real generated binding (which caught two real API divergences a naive C-to-Python translation would have missed) rather than trusted as designed — see [`spike/micropython/README.md`](spike/micropython/README.md) for the full writeup.

**MicroPython (ESP32 spike, now CI-wired).** `lv_micropython`'s ESP32 port builds against real ESP-IDF with the same `lv_conf.h` patches as the unix port, and the resulting firmware boots and runs the LVGL binding (`import lvgl`, `lv.xml_create()`, ...) under Espressif's own QEMU-Xtensa emulator — real Xtensa-architecture validation, not just x86. QEMU-Xtensa has no display peripheral, so this proves boot-and-execute, not renders-correctly. The `validate-esp32-micropython` CI job now runs this on every PR: GitHub Actions' runners turned out to have unrestricted network access (confirmed by the job's own first real run), so the spike's four workarounds are kept not as network-block fallbacks but as a deliberate, more hermetic build (explicit version pins, a vendored `mdns` component, correct flash padding, and a `pexpect`-based driver replacing the spike's hand-tuned sleep loop) — see [`spike/esp32/README.md`](spike/esp32/README.md) for the full writeup.

## What's next

The next work is **component support**: converting complex web components (Accordion, App Bar, Drawer, Breadcrumbs, Card, Modal, and others) to LVGL. The design is in [COMPONENTS.md](COMPONENTS.md). Phases 5 to 10 below build it in order.

The earlier **ESP32 real hardware validation** item stays blocked. The QEMU job proves boot-and-execute on every PR, but a rendered proof needs real hardware, which this project's development environment does not have. Revisit if that access becomes available.

### How the work is split across agents

Each phase has **lanes**. A lane is a set of files that one agent can change without touching another lane's files, so lanes in the same phase run in parallel, each on its own branch or worktree. Steps inside a lane run in order.

Rules for every phase:

- **Interface first.** The first lane of a phase (marked *serial*) lands the shared types and function signatures. The parallel lanes start only after it merges.
- **One owner per file.** If two lanes need the same file, one of them waits, or the shared change moves into the serial lane.
- **Golden tests are the contract.** A lane merges only when `npm test` and the CI jobs pass. Changes to existing golden output need an explanation in the PR.
- **Verify against real LVGL.** Anything that emits XML or C is checked by the existing `validate-xml` and C harness jobs, not only by string comparison.
- **A review agent** reads each phase's combined diff before the phase closes. It looks for gaps between lanes, not style.

### Phase 5 — Diagnostics and plugin seam

Goal: a place to report problems, and a clean boundary for framework code. Nothing else depends on anything newer than this phase.

| Lane | Work | Files | Parallel with |
|---|---|---|---|
| A (serial) | Define the diagnostic type and a collector that replaces `ctx.warnings`. Define the plugin interface (`load`, `components`, `sourceOf`, `recognizers`, `pluginApi`) as types and docs only. | `src/diagnostics.mjs`, `src/plugin.mjs` | none, runs first |
| B | Migrate every existing warning to a coded diagnostic. Write `TODO.txt` and `diagnostics.json`. Shrink console output to a summary. | `src/convert.mjs`, `src/cli.mjs`, `src/componentize.mjs` | C, D |
| C | Move the React path behind the plugin interface with no output change. Add `--plugin` and `html2lvgl.config.mjs` discovery. | `src/extract-react.mjs`, `src/cli.mjs` (discovery only), `src/plugin.mjs` | B, D |
| D | Spike: the tag names are confirmed from the 9.4.0 source (see [COMPONENTS.md](COMPONENTS.md#behavior-with-lvgl-subjects)). Subject scopes are settled in the source (see COMPONENTS.md). The top layer is settled: XML cannot reach `lv_layer_top()`, so Modal and Drawer default to a floating full-screen overlay inside the screen. Still open: does the unique-name-per-instance approach work at runtime, and does the floating overlay draw and block input correctly in a real render. Write results and a minimal working XML sample to `spike/subjects/`, and run it in CI against a real build. | `spike/subjects/`, `.github/workflows/ci.yml` | B, C |

Done when: all goldens are unchanged, `TODO.txt` exists for a page with a font fallback, React still converts through the plugin seam, and the spike's findings are written down.

### Phase 6 — Extraction and registry

Goal: the converter can see ARIA state and hidden content, and can match a component from a registry.

| Lane | Work | Files | Parallel with |
|---|---|---|---|
| A (serial) | Define the registry entry shape (`name`, `match`, `props`, `slots`, `build`) and the recognition pass that runs before `convert`. Add stable node names. | `src/recognize.mjs`, `src/convert.mjs` (hook only) | none, runs first |
| B | Extractor: capture `role`, `aria-*`, `id`, `class`, `data-testid`. Keep hidden subtrees with `hidden: true`. | `src/extract.mjs`, `tests/extract.test.mjs` | C, D |
| C | Icon placeholder: detect SVG, icon fonts, and ligatures. Emit the named, fixed-size placeholder and its diagnostic. | `src/recognize-icons.mjs`, goldens | B, D |
| D | `aria-controls` / `aria-expanded` linker: pair each trigger with its target by `id`. Pure function with fixture trees. | `src/link-aria.mjs`, `tests/link-aria.test.mjs` | B, C |
| E | Sidecar overrides (`page.lvgl.json`), keyed by node name, applied after conversion. | `src/overrides.mjs` | B, C, D |

Done when: a fixture page with an inline icon produces a placeholder and a `TODO.txt` entry, and the linker pairs triggers and targets on fixture trees.

### Phase 7 — Static components

Goal: components with no state, which prove the registry. Lanes are independent because each adds its own registry entries, examples, and goldens.

| Lane | Work |
|---|---|
| A | Card, Paper, Divider, Chip, Avatar, Badge, Alert. Elevation to shadow. Round avatars. |
| B | App Bar and Toolbar (pinned top row). |
| C | Breadcrumbs (flex row, `data-lv-link` navigation, separators). |
| D | Touch-target size diagnostic, and a Material UI example page that uses every Phase 7 component, for end-to-end tests. |

Each lane adds `src/components/<name>.mjs`, `examples/components/<name>.html`, and a golden. The only shared file is the registry index, which the serial step of Phase 6 already prepared for one-line additions. Done when each example converts, renders in the LVGL simulator, and scores a fidelity result recorded in the PR.

### Phase 8 — Stateful components

Goal: components that open and close. Depends on the Phase 5 subject spike.

| Lane | Work | Parallel with |
|---|---|---|
| A (serial) | Disclosure primitive: subject creation, trigger and target binding, and the shared library XML components. XML emitter output for toggle and flag binding. | none, runs first |
| B | C and C++ emitter output for the same behavior, with a small generated helper. | C, D, E |
| C | MicroPython emitter output for the same behavior. Check against the pinned binding. | B, D, E |
| D | Accordion. | B, C, E |
| E | Modal and Drawer (top layer, backdrop, slide animation, dismissal). | B, C, D |

Done when: Accordion, Modal, and Drawer have the same golden behavior in XML, C, C++, and Python, and a click-driven CI test opens and closes each one.

### Phase 9 — Native widget remaps

Goal: ARIA detection for components that already have an LVGL widget. Lanes are independent.

| Lane | Work |
|---|---|
| A | Tabs to `lv_tabview`. Bottom navigation. |
| B | Menu and Select. Snackbar. |
| C | Text field, Switch, Slider, linear and circular progress. |
| D | Date picker to `lv_calendar`. Stepper and Pagination composites. |

Done when: each remap has an example, a golden, and a CI render. Anything that cannot be matched with confidence reports `UNSUPPORTED_WIDGET` instead of guessing.

### Phase 10 — Library and framework plugins

Goal: prove the plugin seam with a second framework and a first library. Published as separate packages.

| Lane | Work | Parallel with |
|---|---|---|
| A | `html-to-lvgl-mui`: Material UI class names and fiber names as extra recognizers on top of ARIA. | B, C |
| B | `html-to-lvgl-vue`: `load`, `components`, `sourceOf` for Vue single-file components. This checks the plugin interface against a second framework. Fix the interface in core first if it does not fit. | A, C |
| C | URL mode: convert a built or running app by URL. Opens the way for Angular and server-rendered frameworks. | A, B |
| D (after B) | Publishing: workspace layout, per-package versioning and the tag-based publish workflow. | none |

Angular is deferred until URL mode exists.

### Phase 11 — Editor groundwork

Goal: not the editor itself. The pieces it needs, ready and tested.

| Lane | Work |
|---|---|
| A | Registry export: dump every component's `props` and `slots` as JSON. |
| B | IR export and import as stable JSON, with a round-trip test. |
| C | Preview server API: render a given IR and return the image, based on `src/preview.mjs`. |
| D | Design doc for the editor UI: scope, tech choice (Vite, per the project preferences), and what the first version can do. |

Open question for this phase: whether the editor runs against the LVGL render program, as watch mode does, or against an LVGL WebAssembly build.

### Cross-cutting, every phase

- Update [FEATURES.md](FEATURES.md) and [CHANGELOG.md](CHANGELOG.md) in the same PR as the feature.
- New examples go under `examples/` and new goldens under `tests/`.
- A minor version bump per phase that changes `src/` behavior.

## Further reading

- [spike/README.md](spike/README.md) — the Phase 0 proof-of-concept, with side-by-side screenshots
- [spike/micropython/README.md](spike/micropython/README.md) — the MicroPython feasibility spike and the `--format py` emitter's verification
- [spike/esp32/README.md](spike/esp32/README.md) — the ESP32 QEMU-Xtensa boot spike, now CI-wired
- [COMPONENTS.md](COMPONENTS.md) — design for complex component support, plugins, and the editor
- [CHANGELOG.md](CHANGELOG.md) — released versions
