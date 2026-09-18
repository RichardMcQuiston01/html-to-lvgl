# MicroPython Phase 0 spike, Phase 2 CI validation, and the Phase 3 emitter

Answers the two open questions that had to be settled before committing to a
`src/emit-python.mjs` emitter: does `lv_binding_micropython` expose the
`lv_xml_*` API, and is `lv_binfont_create` reachable from MicroPython? Both
are **yes**, each behind a small, documented patch to the binding's vendored
LVGL checkout. This changes the plan: html2lvgl's existing `--format xml`
output loads on MicroPython **unmodified** — no Python emitter is needed to
*reach* MicroPython at all.

Phase 1 (README docs, no code) and Phase 2 (this file's "Known limitations"
section, plus a `validate-micropython-xml` CI job in `.github/workflows/ci.yml`
that runs `render_xml.py` against every golden the same way `validate-xml`
does for the C harness) are both done. Phase 3 (the idiomatic `--format py`
emitter, `src/emit-py.mjs`, for users who'd rather not carry `LV_USE_XML`)
is also done — see "The Phase 3 emitter" below.

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

The original plan's Phase 1 assumed a dedicated `src/emit-python.mjs` translating the
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
  a promising path identified up front but left unverified until now.
- CI: build `lv_micropython`'s unix port (cached, ~30s incremental) and run
  every golden XML through it the same way `validate-xml` already does for
  the C harness.

An idiomatic Pythonic emitter (`lv.obj(parent).set_width(...)`-style, one
statement per widget) was still a reasonable *future* addition for users who
don't want to ship XML — the mapping table below was valid groundwork for it
— but it wasn't required to reach MicroPython at all. It shipped later as
Phase 3; see "The Phase 3 emitter" below.

## Mapping table verified

Hand-written against the real binding at spike time (not assumed), confirming
the table proposed up front exactly:

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
exists to surface before committing to an emitter design. (`--format py`'s
generated code never hits this: it calls widget constructors like `lv.obj()`
directly rather than going through `lv_xml_create`'s untyped return.)

## The Phase 3 emitter

`src/emit-py.mjs` (`--format py`) turned this hand-written table into a real
emitter, re-verified against a real generated binding rather than trusted as
committed above — built `lv_micropython`'s unix port at the CI-pinned commit
and introspected it directly (`dir(lv.<GROUP>)` for every enum group, plus a
full smoke-render of every widget type and a real cross-module navigation
test). That re-verification, not just the mapping table above, is what
caught two real gaps before shipping:

- **`lv_slider`/`lv_bar` have no separate `set_min_value`/`set_max_value`**
  on this binding's vendored LVGL — only `set_range(min, max)`. The separate
  setters are a v9.4.0-only addition (confirmed by grepping the vendored
  LVGL's headers: `lv_slider_set_range`/`lv_bar_set_range` exist, the
  per-bound setters don't); `emit-c.mjs` only gets away with calling them
  because the C harness compiles against a real v9.4.0 checkout, not this
  binding's v9.3.0-era one. `emit-py.mjs` always emits a single
  `set_range(min, max)` call instead.
- **`LV_ANIM_OFF`/`LV_ANIM_ON` aren't enum constants at all** —
  `lv_anim_enable_t` is `typedef bool` in this LVGL version, so the binding
  takes a plain Python bool. `emit-py.mjs` passes `False` where a naive
  translation of the C macro name would guess at a nonexistent
  `lv.ANIM.OFF`.

Also found along the way: flag constants (`scrollable`/`hidden`/`ignore_layout`)
live under the widget class's nested `FLAG` enum (`lv.obj.FLAG.HIDDEN`), not
a top-level `lv.OBJ_FLAG.HIDDEN` — there is no such top-level name in the
binding at all.

Two design choices worth calling out:

- **Custom fonts/images become runtime dict arguments.** C's `extern`
  declaration borrows a compile-time link step to resolve a font/image by
  name; Python has no equivalent, so `ui_create(parent, fonts=None)` /
  `ui_create(parent, images=None)` take them as dicts the caller populates
  (e.g. via `lv.binfont_create(...)`) and the generated code indexes by the
  same key `--font-map` already produces. Verified end-to-end with a real
  `--no-compress` `lv_font_conv` `.bin` (that flag matters: a *compressed*
  conversion crashed the renderer on this pinned binding, a decoder gap
  unrelated to the emitter's own output — the project's real font pipeline
  in `fonts-build.mjs` already always converts with `--no-compress`, so this
  only bit an ad hoc test conversion during verification, never real usage).
- **Multi-screen navigation imports lazily.** The generated click callback
  does `import ui_<screen>` *inside* the callback body, not at module load —
  both because two screens that link to each other would otherwise form a
  circular top-level import, and because the cost is only paid on an actual
  navigation. Verified with two real on-disk modules and a real simulated
  click (`spike/micropython/run_py_nav.py`), checking `lv.screen_active()`
  changed by object identity rather than by name — generated code never
  calls `lv_obj_set_name()` (same omission `emit-c.mjs` already makes; `name`
  only picks the source-level Python variable), so `find_by_name()`-style
  lookups don't apply to raw emitter output the way they do to XML.

Interestingly, the `monitor.xml` segfault documented below (an upstream
`lv_grid.c` bug on this binding's vendored LVGL) does **not** reproduce
through `--format py`'s direct imperative call sequence — run repeatedly
with no crash, not just assumed safe because it's a different code path.
The XML runtime's `lv_xml_create()` must build/attach the tree in a
different order than the emitter's straight-line widget-then-attributes
calls, avoiding whatever specific order triggers the corruption. CI's
Python-emitter validation doesn't exclude `monitor.py` because of this.

`spike/micropython/run_py.py` and `run_py_nav.py` are the reference
harnesses `.github/workflows/ci.yml` uses to call every golden's
`ui_create()`/`ui_<screen>_create()` directly — a real execution, not a
syntax check — mirroring `render_xml.py`'s role for the XML path.

## Reproducing

```sh
git clone https://github.com/lvgl/lv_micropython.git
cd lv_micropython
git checkout 44aa2b153dd3aa1ba183d05bd867fe3ffe2a1d75   # pinned, see below
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

# With dependency XML files (multi-screen siblings, componentized React
# output) and a click to exercise navigation — same argument convention as
# spike/render/main.c:
./ports/unix/build-lvgl/micropython /path/to/html-to-lvgl/spike/micropython/render_xml.py \
  /path/to/html-to-lvgl/tests/golden-nav/home.xml /tmp/out.bmp \
  /path/to/html-to-lvgl/tests/golden-nav/settings.xml --click=to_settings

# With converted fonts (matches spike/render/main.c's --font=<name>=<path> args):
node /path/to/html-to-lvgl/scripts/convert-fixture.mjs \
  /path/to/html-to-lvgl/tests/fixtures/typography.json /tmp/fonts-demo \
  --font-map "Liberation Sans=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf" \
  --font-map "Liberation Sans:700=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
./ports/unix/build-lvgl/micropython /path/to/html-to-lvgl/spike/micropython/render_xml.py \
  /tmp/fonts-demo/typography.xml /tmp/out.bmp \
  --font=liberation_sans_700_28=/tmp/fonts-demo/fonts/liberation_sans_700_28.bin
```

Pinned LVGL commit inside `lv_binding_micropython` at spike time was
`c033a98` (v9.3.0-era, June 2025) — one minor version behind this project's
pinned v9.4.0 for the C/XML/C++ paths. `lv_micropython`'s own tracked pointer
for the `user_modules/lv_binding_micropython` submodule moves on nearly every
commit ("chore: update micropython binding"), but as of Phase 2 (September
2026) that submodule's own vendored `lvgl` commit is still `c033a98` —
unchanged since the Phase 0 spike. The three patches below are specific to
that commit; re-check whether a newer binding commit has finally picked up
`lvgl` v9.4.0 before re-pinning `LV_MICROPYTHON_COMMIT` in
`.github/workflows/ci.yml`.

## Patches

### `patches/lv_binding_micropython-lv_conf.patch`

`lv_conf.h` flags the binding ships disabled (or too narrow) by default:

- `LV_USE_XML` — off by default; turning it on is what exposes `lv_xml_*`
  to the binding generator at all.
- `LV_USE_DRAW_SW_COMPLEX_GRADIENTS` — `lv_xml_component.c`'s gradient
  parser (radial/conical) reads `lv_grad_dsc_t.params`, a field that only
  exists when this flag is on. Without it, `LV_USE_XML=1` alone fails to
  compile.
- `LV_USE_FS_POSIX` (letter `A`) — needed so `lv_binfont_create()` can open
  `.bin` files from the host filesystem; same convention `spike/render/main.c`
  already uses for the C harness.
- `LV_USE_OBJ_NAME` (found in Phase 2) — `lv_obj_get_name()`/`lv_obj_set_name()`
  are compiled out entirely behind this flag, not just unbound: without it,
  `render_xml.py`'s `--click=<name>` support (name-based widget lookup,
  mirroring `spike/render/main.c`'s `find_by_name`) fails with `AttributeError:
  'obj' object has no attribute 'get_name'` even though `name="..."` widget
  attributes parse and apply fine either way.
- `LV_FONT_MONTSERRAT_{10,12,18,20,22,28,32,36,40,48}` (found in Phase 3) —
  the binding's default `lv_conf.h` only enables sizes 14/16/24, a small
  subset of the 13 sizes (10 through 48) html2lvgl's own font table can
  reference. The XML path silently tolerated the gap (an unregistered font
  name just doesn't render, rather than erroring), so it went unnoticed
  through Phase 2 — but `--format py`'s generated code does a direct
  `lv.font_montserrat_N` attribute access, which raises a hard
  `AttributeError` for any size the binding wasn't built with. Enabling the
  full set here matches `spike/render/lv_conf.h`'s C harness config exactly,
  and incidentally improves the XML path's own font fidelity too.

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

## Known limitations (found during Phase 2 CI validation)

Two real gaps, both traced to the pinned `lvgl` commit inside
`lv_binding_micropython` (`c033a98`, v9.3.0-era) lagging behind this
project's own v9.4.0 pin for the C/XML/C++ paths — not bugs in html2lvgl's
output, and not something a patch here should paper over. `.github/workflows/ci.yml`'s
`validate-micropython-xml` job renders every other golden and documents
both exclusions inline; re-run this repro against a newer binding commit
periodically to see if either is now moot.

1. **`tests/golden/monitor.xml` segfaults** — an `lv_table` as a child of a
   `style_layout="grid"` container crashes in `lv_grid.c`'s `grid_align()`
   with garbage arguments (`track_num` in the billions, a non-pointer
   `pos_array`), consistent with heap corruption rather than a null check
   gap. Isolated by testing the same table markup **without** a grid parent
   (renders fine) — so it's specifically the grid+table interaction that's
   broken on this LVGL commit. `validate-xml`'s C harness already renders
   this exact file successfully against the project's pinned v9.4.0, so
   this is an upstream layout bug fixed sometime between v9.3 and v9.4, not
   an html2lvgl output problem. Get a backtrace with
   `gdb -batch -ex run -ex bt --args ./ports/unix/build-lvgl/micropython render_xml.py tests/golden/monitor.xml /tmp/out.bmp`
   (needs a `DEBUG=1` rebuild for symbols) to re-verify against a newer
   commit.
2. **`<screen_create_event screen="...">` (multi-screen navigation) is a
   no-op** — `render_xml.py`'s `--click=<name>` support works (the target
   widget is found and clicked), but nothing happens: `grep -rn
   screen_create_event` inside the vendored `lvgl` checkout returns nothing.
   This LVGL XML construct was added after v9.3; it's real and works
   against v9.4.0 (`validate-xml`'s C harness exercises it with the same
   `--click=to_settings` assertion successfully). Every golden's individual
   screens still instantiate and render correctly through
   `lv_xml_component_register_from_data()` — only the click-driven
   navigation itself can't be exercised on this binding commit.
