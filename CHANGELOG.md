# CHANGELOG

## [0.1.1] - 2026-08-22

### Fixed

- `esbuild` and `lv_font_conv` were listed under `devDependencies`, so the published npm package never installed them. Since `src/cli.mjs` statically imports `extract-react.mjs`, which imports `esbuild` unconditionally, **every** conversion via a globally-installed `html2lvgl` failed at startup with `ERR_MODULE_NOT_FOUND` — not just React input or `--font-map`. Moved both to `dependencies`.

## [0.1.0] - 2026-08-20

First public npm release, and the initial feature set, built in phases (see `RESEARCH.md` and `PLAN.md` for the underlying feasibility research).

### Changed

- Prepared for the first public npm release: package renamed to the scoped `@richardmcquiston01/html-to-lvgl`, license switched to Apache-2.0 (`LICENSE` added), `repository`/`homepage`/`bugs`/`author` metadata added, `publishConfig.access: public` set, and `files` scoped to `src` for the published tarball.

### Added

- **Core pipeline (Phases 0–2):** headless-Chromium (Playwright) extraction of resolved layout/styles, mapped onto LVGL XML (`lv_xml` v9.4 runtime syntax). CSS flexbox → LVGL flex, CSS grid → LVGL grid, block/absolute layout via exact Chromium coordinates, two-stop `linear-gradient`, `box-shadow`, `:hover`/`:active` → pressed-state styles, scrollable overflow containers, and widget mapping for buttons, text, range/checkbox/text/password inputs, `select`, `progress`, `table`, and `img`. An optimizer pass collapses inert single-child wrapper divs.
- **React input (Phase 3):** `.jsx`/`.tsx` entry points bundled with esbuild and mounted in headless Chromium; repeated components are turned into reusable, parameterized LVGL XML components via React-fiber-tree walking. Plain HTML can opt into the same componentization with `data-lv-component`.
- **C and C++ output:** `--format c/cpp/both` emit self-contained `ui_<name>.c/.h` or `.cpp/.hpp` (no `lv_xml` runtime dependency), pixel-identical to the XML backend.
- **Multi-screen navigation:** passing multiple pages emits one `<screen>` per page (or one `ui_<screen>_create` per screen in C/C++) with `<a href>` links wired into navigation buttons via `screen_create_event`.
- **Custom fonts:** `--font-map` converts each distinct family/weight/size actually used on the page with `lv_font_conv`, subset to the characters that appear, with automatic `@font-face` discovery and a Montserrat fallback for anything unmapped.
- **Watch mode:** `--watch` rebuilds on save and serves a live side-by-side preview (Chromium reference, LVGL render, fidelity score, warnings) over SSE.
- **Annotation attributes:** `data-lv-widget`, `data-lv-name`, `data-lv-ignore`, `data-lv-component` for overriding the automatic mapping.
- **Fidelity scoring:** `scripts/fidelity.mjs` pixel-scores a conversion; current examples score 79–94%.
- **MicroPython feasibility spike** (`spike/micropython/`): validates that existing `--format xml` output loads unmodified; full MicroPython output support is tracked separately (see `PLAN.md`).
- CI: unit/golden-file tests, plus building the spike C/C++ render harness against real LVGL v9.4.0 to validate every golden XML, C, and C++ file end-to-end.
