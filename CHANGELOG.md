# CHANGELOG

## [Unreleased]

### Added

- **MicroPython (ESP32 spike):** `lv_micropython`'s ESP32 port builds against real ESP-IDF v5.2.2 with the same `lv_conf.h` patches already committed for the unix port, and the resulting firmware boots and runs the LVGL binding (`import lvgl`, `lv.xml_create()`, ...) under Espressif's own QEMU-Xtensa emulator — real Xtensa-architecture validation, not just the unix port's x86 build. Espressif's QEMU fork emulates the CPU/flash/UART but no display peripheral, so this proves boot-and-execute, not renders-correctly; real hardware is still needed for that. Not wired into CI — needed four workarounds specific to this environment's network policy (a blocked pip constraints file, a blocked component registry, plus two real environment-independent gotchas: flash images must be padded with `0xFF`, not `0x00`, and QEMU's emulated UART needs paced input). See `spike/esp32/README.md` for the full writeup and reproduction steps.
- **MicroPython (Phase 3):** a new `--format py` backend (`src/emit-py.mjs`) emits idiomatic `ui_<name>.py` — plain `lv.*` calls against `lv_binding_micropython`'s auto-generated API, no `lv_xml` runtime dependency. The mapping was verified against a real generated binding (built `lv_micropython`'s unix port at CI's pinned commit and introspected it directly) rather than assumed from the C emitter's macro names, which caught two real divergences: `lv_slider`/`lv_bar` have no separate min/max setters on the pinned binding's vendored LVGL, only `set_range(min, max)`, and `LV_ANIM_OFF` isn't an enum constant at all (`lv_anim_enable_t` is a plain `bool`). Custom fonts/images are passed as runtime `fonts`/`images` dict arguments to `ui_create()` since Python has no compile-time linkage to borrow from C's `extern` declarations; multi-screen navigation uses a lazy `import ui_<screen>` inside the click callback rather than a top-level import, avoiding a circular import between two screens that link to each other. The `validate-micropython-xml` CI job now also calls every golden's generated `ui_create()` directly (not just a syntax check), including a real click-driven cross-screen navigation test and a custom-font test through the real `lv_font_conv` pipeline. Also fixed: the pinned binding's `lv_conf.h` only enabled 3 of the 13 Montserrat sizes html2lvgl's font table uses, which the XML path silently tolerated (a missing font just doesn't render) but raw `lv.font_montserrat_N` attribute access can't — patched to enable all 13, incidentally also improving the existing XML CI job's font fidelity. See README's "Using with MicroPython" section and `src/emit-py.mjs`'s module doc comment for the full detail.

## [0.1.2] - 2026-09-15

Docs/CI-only release — nothing under `src/` changed, so the published package contents are identical to `0.1.1`.

### Added

- **MicroPython (Phase 1):** documented using `--format xml` output directly with `lv_micropython` / `lv_binding_micropython` — `lv.xml_init()` + `lv.xml_component_register_from_data()` usage, `<component>` vs `<screen>` root instantiation, and the `.bin`-fonts-alongside-XML convention for custom fonts (already the natural output of `--font-map`, no new CLI code). See README's "Using with MicroPython" section.
- **MicroPython (Phase 2):** a `validate-micropython-xml` CI job builds `lv_micropython`'s unix port and renders every golden XML through it, the same way `validate-xml` already does for the C harness. Found and documented two real, version-specific limitations in the pinned binding's vendored LVGL (v9.3.0-era) rather than working around them — see `spike/micropython/README.md`'s "Known limitations". `spike/micropython/render_xml.py` now mirrors `spike/render/main.c`'s CLI exactly (`--click=`, `--font=name=path`, dependency XML files as positional args) instead of a `[fonts-dir]` shortcut, and a third `lv_conf.h` flag (`LV_USE_OBJ_NAME`) was added to the binding config patch to support `--click`'s name-based widget lookup.

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
