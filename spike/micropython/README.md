# MicroPython Phase 0 spike

Answers the two open questions from `PLAN.md` §4 before committing to a
`src/emit-python.mjs` emitter: does `lv_binding_micropython` expose the
`lv_xml_*` API, and is `lv_binfont_create` reachable from MicroPython? Both
are **yes**, each behind a small, documented patch to the binding's vendored
LVGL checkout. This changes the plan: html2lvgl's existing `--format xml`
output loads on MicroPython **unmodified** — no Python emitter is needed for
the XML path.

## Results

1. **`lv_xml_create()` / `lv_xml_component_register_from_data()` etc. are
   auto-bound** once `LV_USE_XML` is turned on in the binding's `lv_conf.h`.
   `render_xml.py` in this directory registers `tests/golden/dashboard.xml`
   (a `<component>`-rooted page) completely unmodified and renders it
   headless — pixel-identical to the C harness's render of the same file.
   `tests/golden-nav/home.xml` (a `<screen>`-rooted page, used by the
   multi-screen nav goldens) also renders correctly: `render_xml.py` detects
   the root element the same way `spike/render/main.c` does and switches
   between `lv.xml_create(parent, name, None)` + `set_pos` for components and
   `lv.xml_create(None, name, None)` + `lv.screen_load(page)` for screens.
   See `patches/lv_binding_micropython-lv_conf.patch`.
2. **`lv_binfont_create()` is reachable**, and loads html2lvgl's real
   `lv_font_conv` `.bin` output. Verified end-to-end: converted
   `tests/fixtures/typography.json` with real fonts, loaded the `.bin` files
   via `lv.binfont_create()`, registered them into the XML scope, and
   rendered — the converted glyphs show up, not a Montserrat fallback.
3. Both required a **small patch to the pinned LVGL commit inside
   `lv_binding_micropython`** (not to html2lvgl or to LVGL itself) — see
   "Patches" below. Neither patch changes behavior; both just widen what the
   binding generator's auto-scan sees or expects.

## Why this changes the plan

`PLAN.md`'s Phase 1 assumed a dedicated `src/emit-python.mjs` translating the
element tree into `lv.*` Pythonic calls (`lv_obj_create(parent)` →
`lv.obj(parent)`, etc.) — mirroring `emit-c.mjs`'s tables. That mapping is
confirmed accurate (see `render_xml.py`'s hand-written comparison and the
inline mapping-table check below), but it's no longer the fastest path:
**shipping the existing `--format xml` output directly is a much smaller
lift** than a new emitter, since the widget/attribute/enum mapping work is
already done by `convert.mjs` and `emit-xml.mjs`. The remaining MicroPython
work becomes packaging and validation, not translation:

- A thin `--target micropython` mode of the existing XML path (or just
  docs), pointing users at `lv.xml_init()` + `lv.xml_component_register_from_data()`.
- Fonts: ship `.bin` files alongside the XML and load them with
  `lv.binfont_create()` at boot — no firmware rebuild needed, matching the
  "promising path" `PLAN.md` §3.3 flagged as unverified.
- CI: build `lv_micropython`'s unix port (cached, ~30s incremental) and run
  every golden XML through it the same way `validate-xml` already does for
  the C harness.

An idiomatic Pythonic emitter (`lv.obj(parent).set_width(...)`-style, one
statement per widget) is still a reasonable *future* addition for users who
don't want to ship XML — the mapping table below remains valid groundwork
for it — but it's no longer required to reach MicroPython at all.

## Mapping table verified

Hand-written against the real binding (not assumed), confirming `PLAN.md`
§3.2's proposed table exactly:

| C emitter | MicroPython (verified) |
|---|---|
| `lv_obj_create(parent)` | `lv.obj(parent)` |
| `lv_label_create(p)` | `lv.label(p)` |
| `lv_obj_set_width(o, v)` | `o.set_width(v)` |
| `lv_obj_set_style_bg_color(o, c, 0)` | `o.set_style_bg_color(c, 0)` |
| `lv_color_hex(0x…)` | `lv.color_hex(0x…)` |
| `LV_FLEX_FLOW_COLUMN` | `lv.FLEX_FLOW.COLUMN` |
| `LV_STATE_PRESSED` | `lv.STATE.PRESSED` |
| `&lv_font_montserrat_14` | `lv.font_montserrat_14` |

One binding quirk not in the original table: a function returning `void *`
(like `lv_xml_create`) comes back as an untyped `Blob` and needs an explicit
`lv.obj.__cast__(blob)` — the generated-code equivalent would need this for
every XML-returning call, which is exactly the kind of wrinkle this spike
exists to surface before committing to an emitter design.

## Reproducing

```sh
git clone https://github.com/lvgl/lv_micropython.git
cd lv_micropython
git submodule update --init --depth 1 user_modules/lv_binding_micropython \
  lib/micropython-lib lib/berkeley-db-1.xx lib/libffi lib/axtls lib/mbedtls
cd user_modules/lv_binding_micropython
git submodule update --init --depth 1 lvgl pycparser
cd ../..

# Apply this spike's two patches (see "Patches" below for what/why)
git apply /path/to/html-to-lvgl/spike/micropython/patches/lv_binding_micropython-lv_conf.patch \
  --directory=user_modules/lv_binding_micropython
git -C user_modules/lv_binding_micropython/lvgl apply \
  /path/to/html-to-lvgl/spike/micropython/patches/lvgl-binfont-and-xml-event-cb.patch

sudo apt-get install -y build-essential libreadline-dev libffi-dev git \
  pkg-config libsdl2-2.0-0 libsdl2-dev
make -C mpy-cross
make -C ports/unix submodules
make -C ports/unix VARIANT=lvgl -j"$(nproc)"

# Render a golden XML file headless (matches spike/render/main.c's output)
./ports/unix/build-lvgl/micropython /path/to/html-to-lvgl/spike/micropython/render_xml.py \
  /path/to/html-to-lvgl/tests/golden/dashboard.xml /tmp/out.bmp

# With converted fonts (matches spike/render/main.c's --font= args):
node /path/to/html-to-lvgl/scripts/convert-fixture.mjs \
  /path/to/html-to-lvgl/tests/fixtures/typography.json /tmp/fonts-demo \
  --font-map "Liberation Sans=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf" \
  --font-map "Liberation Sans:700=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
./ports/unix/build-lvgl/micropython /path/to/html-to-lvgl/spike/micropython/render_xml.py \
  /tmp/fonts-demo/typography.xml /tmp/out.bmp /tmp/fonts-demo/fonts
```

Pinned LVGL commit inside `lv_binding_micropython` at spike time was
`c033a98` (v9.3.0-era, June 2025) — one minor version behind this project's
pinned v9.4.0 for the C/XML/C++ paths. The two patches below are specific to
that commit; a newer binding commit may already include equivalent fixes
upstream, worth re-checking before Phase 1 work starts.

## Patches

### `patches/lv_binding_micropython-lv_conf.patch`

Three `lv_conf.h` flags the binding ships disabled by default:

- `LV_USE_XML` — off by default; turning it on is what exposes `lv_xml_*`
  to the binding generator at all.
- `LV_USE_DRAW_SW_COMPLEX_GRADIENTS` — `lv_xml_component.c`'s gradient
  parser (radial/conical) reads `lv_grad_dsc_t.params`, a field that only
  exists when this flag is on. Without it, `LV_USE_XML=1` alone fails to
  compile.
- `LV_USE_FS_POSIX` (letter `A`) — needed so `lv_binfont_create()` can open
  `.bin` files from the host filesystem; same convention `spike/render/main.c`
  already uses for the C harness.

### `patches/lvgl-binfont-and-xml-event-cb.patch`

Two structural fixes to the binding's vendored LVGL copy, applied inside
`user_modules/lv_binding_micropython/lvgl/`:

- **`lvgl_private.h`**: adds `#include "src/font/lv_binfont_loader.h"`.
  `lv_micropython`'s Makefile preprocesses only `lvgl_private.h` (not the
  public `lvgl.h`) and feeds *that* to the binding generator — a
  `micropython.mk` detail, not an `lv_conf.h` setting. `lv_binfont_loader.h`
  is a public header with no `_private.h` counterpart, so nothing pulls it
  into that preprocessed input and `lv_binfont_create` is silently absent
  from `dir(lv)` regardless of any config flag. Confirmed by tracing the
  actual preprocessor invocation and diffing its output with and without
  this include — every other public API in this spike (`lv_xml_*`) reaches
  the generator only because `lvgl_private.h` already happens to include
  `lv_xml_private.h`, which in turn includes the public `lv_xml.h`.
- **`lv_xml_component_private.h`**: adds a `void * user_data;` field to
  `struct _lv_xml_component_scope_t`. Without it, `LV_USE_XML=1` fails to
  compile: the binding's generic callback-registration codegen
  (`mp_lv_callback`) assumes any struct passed to a `*_cb_t`-consuming
  function has a `user_data` slot to stash the Python callable in, which is
  true for most LVGL structs but not this one. This only blocks
  `lv_xml_register_event_cb` (registering a C callback referenced by name
  from XML markup) — unrelated to loading or rendering XML.
