# MicroPython

[Back to README](./README.md)

| [XML on MicroPython](#xml-on-micropython) | [Python Output](#python-output) | [Which Format to Use](#which-format-to-use) | [How It Was Checked](#how-it-was-checked) |

## XML on MicroPython

The default XML output loads without changes on [`lv_micropython`](https://github.com/lvgl/lv_micropython). It uses [`lv_binding_micropython`](https://github.com/lvgl/lv_binding_micropython). You do not need a special flag.

```python
import lvgl as lv

lv.xml_init()
scope = lv.xml_component_get_scope("globals")
scope.register_font("montserrat_16", lv.font_montserrat_16)  # each built-in size the page uses

# Register every XML file before the one that uses it.
# A multi-page or React conversion writes one file per screen or component.
with open("out/dashboard.xml") as f:
    lv.xml_component_register_from_data("dashboard", f.read())

# Component output: create it inside a parent
page = lv.obj.__cast__(lv.xml_create(lv.screen_active(), "dashboard", None))

# Screen output (multi-page): create with no parent, then load it
page = lv.obj.__cast__(lv.xml_create(None, "dashboard", None))
lv.screen_load(page)
```

`lv.xml_create()` returns an untyped `Blob`. Cast it with `lv.obj.__cast__(...)` as shown.

For custom fonts, `--font-map` already writes a `.bin` file next to each `.c` file in `out/fonts/`. Copy `out/fonts/*.bin` next to your `.xml` files and register each one at start-up:

```python
# "A:" is the drive letter the unix port example mounts. Use your own drive.
font = lv.binfont_create("A:out/fonts/liberation_sans_700_28.bin")
scope.register_font("liberation_sans_700_28", font)  # same name as the .bin file
```

You must turn on `LV_USE_XML` in the binding's `lv_conf.h`. Two small patches to the binding's copy of LVGL were also needed at spike time. See [spike/micropython/README.md](spike/micropython/README.md) for the patches, a working script (`render_xml.py`), and the steps to repeat it. Check whether a newer `lv_binding_micropython` already has them.

[Back to Top](#micropython)

## Python Output

If you do not want `LV_USE_XML` or `.xml` files, use `--format py`. It writes the same UI as plain `lv.*` calls:

```python
import ui_dashboard

page = ui_dashboard.ui_create(None)
lv.screen_load(page)
```

For a multi-page conversion, each screen exports `ui_<screen>_create(parent)` from `ui_<screen>.py`. A navigation button imports its target screen inside the click handler. This avoids a circular import when two screens link to each other.

Python has no build-time link step for fonts and images. A page that uses them takes them as arguments:

```python
fonts = {"liberation_sans_700_28": lv.binfont_create("A:out/fonts/liberation_sans_700_28.bin")}
page = ui_typography.ui_create(None, fonts=fonts)  # only when the page uses a custom font
```

[Back to Top](#micropython)

## Which Format to Use

| | `--format xml` | `--format py` |
|---|---|---|
| Runtime needs | `LV_USE_XML` and the XML support code | Nothing extra |
| Many files | One `lv_xml_component_register_from_data()` call per file | One `import` per screen |
| Custom fonts and images | Registered by name | Passed in `fonts` and `images` dictionaries |
| Editing later | Plain-text markup | Plain-text Python |

[Back to Top](#micropython)

## How It Was Checked

The Python names were checked against a real generated binding, not guessed from the C names. Two places differ from a plain one-to-one translation:

- `lv_slider` and `lv_bar` only have `set_range(min, max)` in the pinned binding.
- `LV_ANIM_OFF` is the plain Python value `False`.

See the comment at the top of `src/emit-py.mjs` for details.

The `validate-micropython-xml` job in `.github/workflows/ci.yml` builds `lv_micropython` and calls each golden file's `ui_create()`. It also clicks through a real move between two screens. The `validate-esp32-micropython` job boots an ESP32 build in the QEMU emulator. QEMU has no display, so it proves the firmware starts and runs, not that the screen draws correctly. See [spike/esp32/README.md](spike/esp32/README.md).

[Back to Top](#micropython)

---

[Back to README](./README.md)
