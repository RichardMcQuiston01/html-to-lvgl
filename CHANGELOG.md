# CHANGELOG

## [Unreleased]

### Added

- **Design doc:** `COMPONENTS.md` describes ARIA-first recognition of complex components (Accordion, Drawer, Modal, and others), the component registry, `TODO.txt` diagnostics, framework and library plugins, and constraints for a future drag-and-drop editor. `ROADMAP.md` now plans Phases 5 to 11 as parallel agent lanes.

- **Plugin discovery:** `--plugin <package-or-path>` (repeatable) and `html2lvgl.config.mjs` (`export default { plugins: [...] }`, next to the input or in the working directory) load input plugins, chosen by file extension. Every plugin is validated; an invalid one prints all its errors and is skipped. React input now runs through a built-in plugin (`src/plugins/react.mjs`) with identical output; `src/extract-react.mjs` is a thin wrapper.

### Changed

- **Publishing now runs on a version tag, not on a push to `release`:** `publish.yml` triggers when a tag like `0.3.0` or `v0.3.0` is pushed. It refuses to publish unless the tagged commit is on `main` and the tag matches the `package.json` version.

## [0.3.0] - 2026-10-20

`src/` gained a new annotation attribute (`data-lv-link`), so this is a minor bump.

### Added

- **`data-lv-link` annotation attribute:** extends multi-screen navigation (previously `<a href>`-only) to any element — a `<button>`, a clickable card `<div>`, anything that isn't semantically an anchor. `data-lv-link="settings.html"` resolves against the set of pages being converted together exactly like `<a href>` already does (same file-matching, same hash/query stripping), reusing the same `emitLink()` path so the generated `lv_button` + `screen_create_event` is identical regardless of which attribute triggered it. An explicit `data-lv-link` overrides a conflicting `href` on the same element; a target that doesn't match any converted page warns and falls back to the element's normal (non-navigating) widget mapping, rather than silently doing nothing. The optimizer's wrapper-collapse pass now also preserves `data-lv-link` the same way it already preserves `data-lv-widget`/`data-lv-name`, so the annotation can't be stripped off an otherwise-inert wrapper before `convert.mjs` sees it. `examples/nav/settings.html`'s "Back to Home" link is now a `<button data-lv-link="home.html">` instead of an `<a href>`, demonstrating the new attribute alongside `examples/nav/home.html`'s existing plain link — verified end-to-end with a real conversion and a real `--click=to_home` navigation test against LVGL v9.4.0.

### Changed

- Added a `funding` entry to `package.json`, so `npm fund` and the npm page show the donate link.
- Rewrote `README.md` and split its long sections into `FEATURES.md`, `MICROPYTHON.md`, and `DEVELOPMENT.md`.
- Synced the stale version in `package-lock.json` (it still said `0.1.1`).

## [0.2.0] - 2026-09-18

`src/` gained a genuinely new capability since `0.1.2` (`--format py`), so this is a real minor bump, not a republish.

### Added

- **MicroPython (ESP32 spike, now CI-wired):** `lv_micropython`'s ESP32 port builds against real ESP-IDF v5.2.2 with the same `lv_conf.h` patches already committed for the unix port, and the resulting firmware boots and runs the LVGL binding (`import lvgl`, `lv.xml_create()`, ...) under Espressif's own QEMU-Xtensa emulator — real Xtensa-architecture validation, not just the unix port's x86 build. Espressif's QEMU fork emulates the CPU/flash/UART but no display peripheral, so this proves boot-and-execute, not renders-correctly; real hardware is still needed for that. A new `validate-esp32-micropython` CI job runs this on every PR. GitHub Actions' runners turned out to have unrestricted network access (confirmed by the job's own first real run failing for unrelated reasons, not a network block), so the spike's four workarounds are kept as a deliberate, more hermetic build rather than removed: explicit version pins instead of trusting a constraints file, a vendored `mdns` component instead of the managed-component registry, `0xFF`-padded flash images (not `0x00`), and a new `spike/esp32/qemu_boot_test.py` — a `pexpect`-based driver that paces paste-mode input on the REPL's own line echo, replacing the spike's hand-tuned sleep loop. Getting the job green on real CI (as opposed to the sandbox it was developed in) surfaced three more real gaps the manual spike run never hit: the ESP32 board build needs the same full submodule set (`berkeley-db`, `micropython-lib`, ...) the unix port's job does, not just the LVGL binding submodule; `actions/cache` saves on job failure too, which can seed a cache key with an incomplete checkout if not guarded against; and this QEMU build links `libSDL2` even with `-display none`. See `spike/esp32/README.md` for the full writeup and reproduction steps.
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
