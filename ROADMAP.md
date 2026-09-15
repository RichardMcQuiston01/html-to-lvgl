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

**MicroPython (Phases 0–3).** The Phase 0 spike proved LVGL's existing `--format xml` output loads **unmodified** on `lv_micropython`'s unix port — no new emitter needed to reach MicroPython at all. README's "Using with MicroPython" section documents `lv.xml_init()` + `lv.xml_component_register_from_data()` usage and the `.bin`-fonts-alongside-XML convention (already the natural output of `--font-map`, no new CLI code). A `validate-micropython-xml` CI job renders every golden XML through the unix port the same way `validate-xml` already does for the C harness, catching two real, documented limitations along the way — both traced to the pinned binding's vendored LVGL still being v9.3.0-era, not to html2lvgl's output. Phase 3 added a `--format py` backend for users who'd rather not carry `LV_USE_XML`: idiomatic `lv.*` calls, verified against a real generated binding (which caught two real API divergences a naive C-to-Python translation would have missed) rather than trusted as designed — see [`spike/micropython/README.md`](spike/micropython/README.md) for the full writeup.

## What's next

- **ESP32 MicroPython validation (optional, future).** The unix port proves the API and asset story; ESP32 (the realistic device target — real flash/PSRAM constraints, no SDL) is separate, unstarted future work.
- **npm trusted publishing.** Migrate `.github/workflows/publish.yml` from a long-lived `NPM_TOKEN` secret to npm's OIDC-based trusted publishing.

## Further reading

- [RESEARCH.md](RESEARCH.md) — the original feasibility study: problem statement, prior art, architecture options, and the HTML/CSS → LVGL mapping tables that shaped this project
- [PLAN.md](PLAN.md) — the C++ output design notes and the MicroPython feasibility research
- [spike/README.md](spike/README.md) — the Phase 0 proof-of-concept, with side-by-side screenshots
- [CHANGELOG.md](CHANGELOG.md) — released versions
