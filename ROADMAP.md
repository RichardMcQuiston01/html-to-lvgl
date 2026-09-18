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

Nothing currently active. The one previously listed item — **ESP32 real hardware validation** — is blocked: the QEMU-based CI job proves boot-and-execute on every PR, but a rendered/visual proof needs real hardware (or a display-peripheral-capable emulator), neither of which is available in this project's development environment. Revisit if that access becomes available.

## Further reading

- [spike/README.md](spike/README.md) — the Phase 0 proof-of-concept, with side-by-side screenshots
- [spike/micropython/README.md](spike/micropython/README.md) — the MicroPython feasibility spike and the `--format py` emitter's verification
- [spike/esp32/README.md](spike/esp32/README.md) — the ESP32 QEMU-Xtensa boot spike, now CI-wired
- [CHANGELOG.md](CHANGELOG.md) — released versions
