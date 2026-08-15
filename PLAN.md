# Plan: MicroPython and C++ Output Targets

**Date:** August 2026
**Status:** Proposal — not started
**Question:** What would it take for `html2lvgl` to target LVGL from MicroPython and from C++, and is either already supported?

---

## Short answer

| Target | Supported today? | What it really takes |
|---|---|---|
| **C++** | **Effectively yes, undocumented.** The generated C compiles as C++17 unmodified. | A thin `--format cpp` variant, one asset-linkage rule, docs, and CI proof. Small. |
| **MicroPython** | **No.** MicroPython uses a separate auto-generated binding with a different API shape. | A new emitter plus a `lv_micropython` build for validation. Medium, and the validation harness is most of the cost. |

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

### 2.3 Proposed C++ work

| Step | Detail |
|---|---|
| `--format cpp` | Emit `ui_<name>.cpp` / `.hpp` from the same element tree. The `.hpp` declares `ui_create` inside `extern "C"` (or a namespace, see below); asset externs are emitted inside `extern "C" { }`. |
| Namespace + naming | Wrap generated symbols in a configurable namespace (`--cpp-namespace ui`) so several screens can coexist without the `ui_<screen>_create` prefixing the C target needs. |
| Docs | State plainly that the C output is C++-consumable today, and that asset `.c` files stay C. |
| CI | Add a job compiling every golden as C++17 and linking against C-compiled fonts — this is what would have caught the linkage trap. |

**Effort: ~1–2 days.** Mostly a variant of an existing emitter plus a CI job.

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

### 3.3 The hard parts

1. **Assets.** Converted fonts are the open question. Firmware-compiled `.c` fonts require rebuilding `lv_micropython`, which defeats the point of shipping Python. The `.bin` we already emit plus `lv_binfont_create` is the promising path (it needs a filesystem driver and binding exposure — to verify). If neither works, MicroPython output is limited to built-in fonts, which should be stated up front rather than discovered later.
2. **Validation.** Every other target in this repo is proven by rendering it. The equivalent is the `lv_micropython` **unix port** with a dummy/SDL display, running the generated script and dumping a framebuffer — the same trick as `spike/render`. Building it in CI is the single biggest cost; it wants a cache keyed on the binding commit.
3. **Memory conventions.** The generated script must keep references to anything LVGL holds pointers into, and callers must know screens need `delete()`. This is a docs-and-codegen-convention problem, not a hard blocker.
4. **XML on MicroPython.** If the binding exposes the `lv_xml_*` functions, the existing XML output may load directly on MicroPython with no new emitter at all — a much cheaper path. Unverified, and worth checking *first* because it could change the plan's shape.

### 3.4 Proposed MicroPython work

| Phase | Scope | Effort |
|---|---|---|
| 0 | Spike: build `lv_micropython` unix port, hand-write the dashboard example as a Python script, render it headless. Answers the asset and XML questions before committing to an emitter. | ~2–3 days |
| 1 | `src/emit-python.mjs` + `--format py`, reusing the widget/enum tables; golden `.py` files. | ~3–4 days |
| 2 | Font story per the Phase 0 answer (`binfont` from `.bin`, or documented built-ins-only). | ~1–2 days |
| 3 | CI: cached `lv_micropython` build; run every golden script headless and compare framebuffers. | ~2–3 days |

**Total: roughly 8–12 days**, with Phase 0 the decision point — it is cheap and could shrink or reshape everything after it.

---

## 4. Open questions to resolve before starting

1. Does `lv_binding_micropython` expose `lv_xml_*` when `LV_USE_XML` is enabled? If yes, evaluate shipping XML to MicroPython before writing an emitter.
2. Is `lv_binfont_create` reachable from MicroPython with a filesystem driver, so converted fonts work without rebuilding firmware?
3. Which MicroPython targets matter — the unix port (easy to test), ESP32 (the realistic device), or both?
4. Is the C++ interest "I want to call this from my C++ project" (already true, needs docs) or "I want idiomatic C++ output" (a wrapper library to maintain)? This changes the C++ work by an order of magnitude.

---

## 5. Recommendation

**Do the C++ track now; gate MicroPython behind its Phase 0 spike.**

C++ is a day or two and mostly converts an accidental capability into a supported, tested one — the linkage trap in §2.2 is exactly the kind of thing users would otherwise hit alone. MicroPython is worth doing, but its cost is dominated by the validation harness, and one unanswered question (XML support in the binding) could remove most of the emitter work. Spend the spike before the estimate.

Suggested order:

1. C++ variant + asset-linkage docs + CI job.
2. MicroPython Phase 0 spike, then re-estimate against what it finds.
3. Idiomatic C++ wrapper only if users ask for it.

---

## Sources

- [lv_binding_micropython](https://github.com/lvgl/lv_binding_micropython) — auto-generated binding, API style, GC and callback model
- [lv_micropython](https://github.com/lvgl/lv_micropython) — MicroPython + LVGL builds for embedded, unix and JS
- [LVGL MicroPython docs](https://docs.lvgl.io/9.1/integration/bindings/micropython.html)
- LVGL v9.4.0 source: `extern "C"` guards in public headers; `lv_binfont_create` in `src/font/lv_binfont_loader.h`
- Compilation and linkage findings in §2 verified locally against this repo's golden C output and generated fonts
