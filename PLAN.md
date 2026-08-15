# Plan: MicroPython and C++ Output Targets

**Date:** August 2026
**Status:** C++ output shipped. MicroPython Phase 0 spike done — findings reshape the plan; Phase 1 (ship XML as-is + CI) not started.
**Question:** What would it take for `html2lvgl` to target LVGL from MicroPython and from C++, and is either already supported?

---

## Short answer

| Target | Supported today? | What it really takes |
|---|---|---|
| **C++** | **Yes — shipped.** `--format cpp` emits `.cpp`/`.hpp`; CI compiles and links every golden as C++17, including the font-linkage-trap case, against real LVGL v9.4.0. | Done. See §2.3. |
| **MicroPython** | **Validated in Phase 0; not shipped.** `lv_binding_micropython` auto-binds `lv_xml_*`; unmodified golden XML (both `<component>` and `<screen>` roots) renders correctly on `lv_micropython`'s unix port, and converted `.bin` fonts load via `lv_binfont_create`. No new emitter needed to ship this. | Docs + a CI job (build the unix port, render every golden XML). Small — see §3.4. |

Neither needs changes to extraction, conversion, layout, or the font pipeline. Both are **emitter-level** work: the existing element tree and the mapping tables in `src/emit-c.mjs` already encode the semantics; what changes is how they are spelled.

---

## 1. Where the current design helps

The pipeline is already split so that a new output format is additive:

```text
extract.mjs ─► convert.mjs ─► element tree ─┬─► emit-xml.mjs   (LVGL XML)
   (browser)     (mapping)                  └─► emit-c.mjs     (plain C)
                                                  ▲
                                     a new emitter attaches here
```

`convert.mjs` produces a backend-neutral tree of `{tag, attrs, children}`; `emit-c.mjs` turns that into C by consulting two tables — a per-widget attribute map (`text` → `lv_label_set_text`) and an enum map (`row_wrap` → `LV_FLEX_FLOW_ROW_WRAP`). **Those tables are the semantic work, and they are already written.** A MicroPython or C++ emitter re-spells the same table entries rather than re-deriving them.

---

## 2. C++ — findings

### 2.1 It already works, which is the main finding

Verified against LVGL v9.4.0:

- LVGL's public headers carry `extern "C"` guards, so every API the generated code calls is callable from C++.
- `tests/golden-c/ui_dashboard.c` **compiles clean as C++17** with no edits — no implicit `void*` conversions, no C-only constructs, no designated-initializer problems in the UI code.

So a user can already `#include` the generated header from C++ and call `ui_create()`. What's missing is that nothing says so, and nothing tests it.

### 2.2 The one real trap: asset linkage

Generated **font** files (and, later, image assets) must stay C-compiled, or be patched. `lv_font_conv` emits:

```c
const lv_font_t liberation_sans_400_11 = { ... };
```

In C that has external linkage. In C++, a `const` object at namespace scope has **internal** linkage, so the symbol becomes file-local and any `extern const lv_font_t ...;` reference fails to link. Verified:

```text
compiled as C    → nm: 0000000000000000 D liberation_sans_400_11   (global)
compiled as C++  → nm: 0000000000000000 d liberation_sans_400_11   (local)
                 → undefined reference to `liberation_sans_400_11'
```

Three ways out, in preference order:

1. **Keep asset files as C.** They are generated, self-contained, and never need C++. Document "compile `fonts/*.c` with your C compiler" — zero code change.
2. **Emit a `.cpp` shim** per asset that wraps the include in `extern "C" { }`. Works if a project's build refuses to mix languages.
3. **Post-process** `lv_font_conv` output to prepend `extern`. Rejected — it means owning a patch against a third-party generator.

### 2.3 Proposed C++ work — delivered

| Step | Detail |
|---|---|
| `--format cpp` | Emits `ui_<name>.cpp` / `.hpp` from the same element tree as `--format c`. The `.hpp` declares `ui_create` inside `extern "C" { }`; font/image `extern` declarations say `extern "C"`. `--format` now also takes a comma-separated list (`xml,c,cpp`); `both` stays a back-compat alias for `xml,c`. |
| Namespace + naming | **Skipped `--cpp-namespace`.** Per-screen symbol names (`ui_<screen>_create`) already prevent collisions across screens without needing C++ namespacing, and adding one would be unused surface for a first cut. |
| Docs | README's "Output formats" section documents `--format cpp` and states the linkage rule plainly. |
| CI | New steps in the `validate-xml` job compile every `tests/golden-cpp/*.cpp` with `g++ -std=c++17` and link against LVGL, plus a dedicated step that converts a fixture with real `lv_font_conv` fonts under `--format cpp` and links the C++ unit against the C-compiled font `.o` files — this is exactly the case that would have caught the linkage trap. |

`spike/render/main_c.c` was made dual-mode (compiles unchanged under `gcc` or `g++`) rather than adding a parallel C++ harness, so the same file validates both `--format c` and `--format cpp` output — avoiding drift between two near-identical harnesses.

**Actual effort: about half a day**, in line with the estimate.

### 2.4 Optional: an idiomatic C++ wrapper

A separate, larger idea — emitting RAII/method-chaining C++ rather than C-style calls:

```cpp
auto root = lv::Obj(parent).size(320, 240).bg_color(0xf1f5f9);
auto label = lv::Label(root).text("Pump Station").font(montserrat_12);
```

This needs a hand-written support header defining the wrapper types, which becomes a library this project must maintain and version against LVGL. **Recommendation: don't**, unless users ask. The value over C-style calls inside a `.cpp` is aesthetic, and the maintenance is permanent.

---

## 3. MicroPython — findings

### 3.1 It is a genuinely different target

MicroPython support comes from [`lv_binding_micropython`](https://github.com/lvgl/lv_binding_micropython), usually consumed through [`lv_micropython`](https://github.com/lvgl/lv_micropython). Key properties:

- **The binding is auto-generated** by scanning LVGL's public C API at build time, so it tracks LVGL versions without hand-written glue.
- **The API is Pythonic, not a 1:1 C transliteration:** constructors take the parent (`lv.button(scr)`), setters become methods (`label.set_text("Button")`), and enums are grouped (`lv.ALIGN.CENTER`).
- **Memory is garbage-collected** by MicroPython. Screens (an `lv.obj` with no parent) are held by the display and are *not* collected — they need an explicit `screen.delete()`.
- **Callbacks accept any Python callable**, with user data handled by the binding.

### 3.2 What the emitter would look like

The same element tree, re-spelled:

```python
import lvgl as lv

def ui_create(parent):
    root = lv.obj(parent)
    root.set_width(320)
    root.set_height(240)
    root.set_style_bg_color(lv.color_hex(0xf1f5f9), 0)
    root.set_flex_flow(lv.FLEX_FLOW.COLUMN)

    topbar = lv.obj(root)
    ...
    label = lv.label(topbar)
    label.set_text("Pump Station")
    return root
```

Mechanical rules, mirroring `emit-c.mjs`:

| C emitter | MicroPython emitter |
|---|---|
| `lv_obj_create(parent)` | `lv.obj(parent)` |
| `lv_label_create(p)` / `lv_button_create(p)` | `lv.label(p)` / `lv.button(p)` |
| `lv_obj_set_width(o, v)` | `o.set_width(v)` |
| `lv_obj_set_style_bg_color(o, c, 0)` | `o.set_style_bg_color(c, 0)` |
| `lv_color_hex(0x…)` | `lv.color_hex(0x…)` |
| `LV_FLEX_FLOW_ROW_WRAP` | `lv.FLEX_FLOW.ROW_WRAP` |
| `LV_STATE_PRESSED` | `lv.STATE.PRESSED` |
| `&lv_font_montserrat_14` | `lv.font_montserrat_14` |

The enum rule (strip `LV_`, split prefix from value) is derived from the C enum names and should be **verified against a real generated binding** rather than assumed — see open questions.

### 3.3 The hard parts — mostly resolved by the Phase 0 spike

1. **Assets — resolved: `.bin` + `lv_binfont_create` works.** Verified end-to-end: loaded a real `lv_font_conv`-converted `.bin` file via `lv.binfont_create()` on `lv_micropython`'s unix port, registered it into the XML scope, and rendered — the converted glyphs show up, not a Montserrat fallback. No firmware rebuild needed. `lv_binfont_create` isn't bound by default though — see the spike's second patch below.
2. **Validation — resolved, and cheaper than expected.** The `lv_micropython` **unix port** with a direct-mode framebuffer (no SDL window needed, same trick as `spike/render/main.c`) renders headless and dumps a BMP. `spike/micropython/render_xml.py` does exactly this. A full build (mpy-cross + unix port) takes well under a minute once the binding submodules are cached.
3. **Memory conventions.** Unexplored by this spike (a static/emitted-code concern for Phase 1, not something Phase 0's manual scripts exercise) — still open for the eventual Pythonic emitter.
4. **XML on MicroPython — resolved: yes, and it's a bigger deal than anticipated.** `lv_xml_create()`, `lv_xml_component_register_from_data()`, `lv_xml_register_font()`, etc. are all auto-bound once `LV_USE_XML` is on. html2lvgl's existing `--format xml` output loads **completely unmodified** — verified by rendering `tests/golden/dashboard.xml` as-is and getting a pixel-identical result to the C harness. This removes the need for a dedicated emitter to reach MicroPython at all; see §3.4.

Full writeup, reproduction steps, and the two patches needed: `spike/micropython/README.md`.

### 3.4 Proposed MicroPython work — revised after the spike

The Phase 0 spike changed the shape of this work: shipping the existing `--format xml` output directly is far cheaper than writing and maintaining a Pythonic emitter, since `convert.mjs`/`emit-xml.mjs` already do the mapping work. Revised phases:

| Phase | Scope | Effort |
|---|---|---|
| 0 | ~~Spike~~ **Done.** See `spike/micropython/README.md`. Both open questions answered: XML loads unmodified; `.bin` fonts load via `lv_binfont_create`. Both need a small patch to the binding's vendored LVGL commit (documented, not upstream-blocking). | ~1 day (came in under the 2–3 day estimate) |
| 1 | Ship `--format xml` as the MicroPython path: docs on `lv.xml_init()` + `lv.xml_component_register_from_data()` usage, a `.bin`-fonts-alongside-XML convention for custom fonts. No new emitter code. | ~1–2 days |
| 2 | CI: cache `lv_micropython`'s unix port build (keyed on the binding commit), render every golden XML through it the same way `validate-xml` already does for the C harness. | ~1–2 days |
| 3 (optional, future) | An idiomatic `src/emit-python.mjs` (`--format py`, one `lv.*` statement per widget) for users who don't want to ship XML at runtime. The mapping table in §3.2 is verified accurate and remains valid groundwork; not required to reach MicroPython. | ~3–4 days, only if requested |

**Revised total to ship MicroPython support: roughly 2–4 days** (down from 8–12), because Phase 0 found the emitter phase (originally the biggest line item) isn't required for the XML path.

---

## 4. Open questions — mostly resolved by the Phase 0 spike

1. ~~Does `lv_binding_micropython` expose `lv_xml_*` when `LV_USE_XML` is enabled?~~ **Yes.** Confirmed by rendering unmodified `--format xml` golden output on `lv_micropython`'s unix port.
2. ~~Is `lv_binfont_create` reachable from MicroPython with a filesystem driver?~~ **Yes**, after one small patch — see `spike/micropython/patches/lvgl-binfont-and-xml-event-cb.patch`. `lv_micropython`'s Makefile preprocesses only `lvgl_private.h` (a `_private.h`-only umbrella) for the binding generator, and `lv_binfont_loader.h` has no `_private.h` counterpart pulling it in — a build-wiring gap, not an `lv_conf.h` setting.
3. Which MicroPython targets matter — the unix port (spiked), ESP32 (the realistic device), or both? **Still open** — unix proves the API and asset story; ESP32 validation (real flash/PSRAM constraints, no SDL) is separate future work.
4. Is the C++ interest "I want to call this from my C++ project" (already true, needs docs) or "I want idiomatic C++ output" (a wrapper library to maintain)? This changes the C++ work by an order of magnitude. **Resolved by proceeding with the documentation-and-linkage track** — see §2.3, shipped.

---

## 5. Recommendation — status

Both tracks from the original recommendation are done:

1. ~~C++ variant + asset-linkage docs + CI job.~~ **Shipped** — see §2.3.
2. ~~MicroPython Phase 0 spike, then re-estimate against what it finds.~~ **Done** — see §3.3/§3.4. The spike reshaped the plan: no emitter needed for the XML path, cutting the estimate from 8–12 days to 2–4.
3. Idiomatic C++ wrapper only if users ask for it. **Still not requested — not started, by design.**

Next candidate: MicroPython Phase 1 (§3.4) — ship the XML path with docs and a CI job, no new emitter.

---

## Sources

- [lv_binding_micropython](https://github.com/lvgl/lv_binding_micropython) — auto-generated binding, API style, GC and callback model
- [lv_micropython](https://github.com/lvgl/lv_micropython) — MicroPython + LVGL builds for embedded, unix and JS
- [LVGL MicroPython docs](https://docs.lvgl.io/9.1/integration/bindings/micropython.html)
- LVGL v9.4.0 source: `extern "C"` guards in public headers; `lv_binfont_create` in `src/font/lv_binfont_loader.h`
- Compilation and linkage findings in §2 verified locally against this repo's golden C output and generated fonts
- §3 findings verified locally by building `lv_micropython`'s unix port (binding commit `ac5d06c` against LVGL commit `c033a98`, June 2025) and rendering this repo's own golden XML and converted fonts through it — see `spike/micropython/README.md` for the full reproduction steps and patches
