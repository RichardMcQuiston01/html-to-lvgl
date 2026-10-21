# Subjects spike: accordion, modal, drawer in pure LVGL XML

Phase 5 lane D. Question: can the Disclosure Primitive in `COMPONENTS.md`
(a trigger changes an LVGL **subject**, a target binds a flag to it) be emitted
as plain XML for an Accordion, a Modal and a Drawer? Everything below was
**run against real LVGL v9.4.0** (`git clone --depth 1 --branch v9.4.0`, built
with the same `lv_conf.h` as `spike/render`), not read from source.

## What was verified by running, and what was not

| Verified by running LVGL v9.4.0 | Not verified |
|---|---|
| All four scenarios below, with assertions in `run.sh` (geometry, `hidden` flag, subject values) | Anything on real hardware or with a real touch driver (a scripted pointer indev stands in) |
| Clicks go through LVGL's real hit-testing: a virtual pointer indev presses and releases at x,y, so z-order, `floating`, `clickable` and `hidden` all count | Scrolling a screen while an overlay is open |
| Screenshots in `out/` are real framebuffer dumps | The C/C++/MicroPython emitters (not part of this spike) |
| The CI job `validate-subjects-spike` was **not run** here: GitHub Actions cannot run in this sandbox. The same two commands it runs (`build.sh`, `run.sh`) were run locally and pass. The workflow was only checked by loading it with a YAML parser (job list parses; no `actionlint`). | |

## Run it

```bash
git clone --depth 1 --branch v9.4.0 https://github.com/lvgl/lvgl.git spike/render/lvgl   # or set LVGL_DIR
spike/subjects/build.sh        # builds ./build/driver (CMake, ~1 min)
spike/subjects/run.sh          # runs all scenarios, asserts, writes out/*.png
```

Files:

- `driver.c`: scripted driver. Registers `--globals=` as the `globals` component,
  registers every positional XML file under its basename, instantiates
  `--screen=<name>`, then runs steps in order: `--click=x,y` (press, release,
  30 frames), `--tap=x,y` (no settle), `--frames=n`, `--report=<widget name>`
  (prints every match: hidden flag and absolute geometry), `--subject=<name>` or
  `<component>/<name>`, `--snap=file.bmp`, `--say=text`.
- `xml/globals.xml`: every subject the samples need.
- `xml/q1_accordion.xml`, `q2_unique.xml` + `ui_acc_g.xml`, `q2_shared.xml` +
  `ui_acc_own.xml`, `q3_modal.xml`, `q4_drawer.xml`.
- `bmp2png.py`: dependency-free BMP to PNG (the existing `spike/bmp2png.mjs`
  needs Chromium, which CI's validate-xml job does not install).

## Q1. Accordion: works

`xml/q1_accordion.xml`. Header is an `lv_button` with a toggle event, the body
carries a bind, both inside a column flex container:

```xml
<globals><subjects><int name="acc1_open" value="0"/></subjects></globals>

<lv_button name="hdr1" width="320" height="32">
  <subject_toggle_event subject="acc1_open"/>
</lv_button>
<lv_obj name="body1" width="320" height="60">
  <bind_flag_if_eq subject="acc1_open" flag="hidden" ref_value="0"/>
</lv_obj>
<lv_label name="footer" text="..."/>
```

Result:

- The initial subject value is applied at creation: `acc1_open=0` starts the
  body hidden, `acc2_open=1` starts it open.
- Clicking the header flips the subject and shows or hides the body.
- Siblings reflow: with section 1 closed and 2 open the footer sits at y=124;
  opening section 1 moves header 2 from y=32 to y=92 and the footer to y=184;
  closing section 2 brings the footer back to y=124.
- Spellings that worked: `<subject_toggle_event subject="..."/>` (no `trigger`
  needed, defaults to clicked), `<bind_flag_if_eq subject flag="hidden" ref_value="0"/>`,
  `<int name value/>` inside `<subjects>` in `<globals>`.
- Gotcha: a hidden widget keeps its stale coordinates (`hidden=1 x=0 y=0` in the
  report). Do not read geometry from hidden widgets.

Screenshots: `out/q1_a_initial.png`, `q1_b_open1.png`, `q1_c_close2.png`.

## Q2. Per-instance state

### Unique generated subject per instance in `globals.xml`: works

`xml/ui_acc_g.xml` takes the subject **name as a string prop** and uses it in
both the toggle and the bind:

```xml
<component>
  <api>
    <prop name="title" type="string" default="Title"/>
    <prop name="subj"  type="string" default="inst_a_open"/>
  </api>
  <view width="320" height="content" flex_flow="column" ...>
    <lv_button name="hdr"> <lv_label text="$title"/> <subject_toggle_event subject="$subj"/> </lv_button>
    <lv_obj name="body"> <bind_flag_if_eq subject="$subj" flag="hidden" ref_value="0"/> </lv_obj>
  </view>
</component>

<ui_acc_g title="A" subj="inst_a_open"/>
<ui_acc_g title="B" subj="inst_b_open"/>
```

`$prop` substitution works inside the `subject=` attribute of the event and bind
tags. Verified: A starts closed, B starts open (footer y=110); clicking A's
header opens only A (footer y=160, B unaffected); clicking B's header sets
`inst_b_open=0` and leaves `inst_a_open=1`. So the converter can emit a
`<subject_name>` per instance in a generated `globals.xml` and pass it as a prop,
which is better than baking names into the component file.

### Component declares its own `<subjects>`: shared by all instances (caveat confirmed)

`xml/ui_acc_own.xml` declares `<subjects><int name="own_open" value="0"/></subjects>`
and uses `own_open` directly. Two instances (`xml/q2_shared.xml`):

- Both start closed. Clicking **only instance A's** header opens **both** bodies
  (both `hidden=0`, footer y=160). One subject for the whole component.
- The subject is registered in the **component's scope**, not in globals:
  `lv_xml_get_subject(NULL, "own_open")` is NOT FOUND;
  `lv_xml_get_subject(lv_xml_component_get_scope("ui_acc_own"), "own_open")`
  finds it with value 1.
- `<subjects>` inside a component is parsed and works, so it is fine only for
  state meant to be shared across every instance.

Aside: `height="content"` on the component `<view>` is what makes a variable
height component reflow its parent; a fixed height (first attempt) does not.

Screenshots: `out/q2_unique_*.png`, `out/q2_shared_*.png`.

## Q3. Modal as a floating overlay: works, blocks input beneath

`xml/q3_modal.xml`. The overlay is the **last child** of the screen view:

```xml
<lv_obj name="overlay" floating="true" x="0" y="0" width="320" height="240"
        style_bg_color="0x000000" style_bg_opa="50%" style_border_width="0" style_radius="0" style_pad_all="0">
  <bind_flag_if_eq subject="modal_open" flag="hidden" ref_value="0"/>
  <lv_obj name="dialog" width="240" height="120" align="center" ...>
    <lv_button name="close_btn" ...>
      <subject_set_int_event subject="modal_open" value="0"/>
    </lv_button>
  </lv_obj>
</lv_obj>
<!-- opener: <subject_set_int_event subject="modal_open" value="1"/> -->
```

Result (screen view is a column flex container with 8 px row gap):

- Closed: `overlay hidden=1`; a click on the underlying button counts
  (`under_clicks=1`).
- Opener sets `modal_open=1`; overlay is `hidden=0` at 0,0 320x240 even though
  the parent is a flex column, so `floating="true"` really does take it out of
  the layout. It draws on top of the earlier siblings, with a 50 percent dim
  and the dialog centered (see `out/q3_b_open.png`).
- **Blocks clicks beneath:** with the modal open, a click on the visible part
  of the underlying button (outside the dialog) and a click on empty dialog area
  both leave `under_clicks` unchanged. Sequence of `under_clicks` readings:
  1, 1, 1, then 2 after close. The overlay needs no extra attribute: a plain
  `lv_obj` is clickable by default, which is what swallows the input.
- Close button sets `modal_open=0`; overlay hidden again and the underlying
  button works again.
- Not tried: click-on-backdrop to close (would be a `subject_set_int_event` on
  the overlay itself, but the dialog is a child so taps on it would bubble
  unless the dialog is made non-bubbling; needs its own test).

## Q4. Drawer: show/hide works, slide animation works too

`xml/q4_drawer.xml`. Show/hide alone works exactly like the modal (a floating
edge-anchored panel plus a bind). Beyond that, `<animations>` **does** work and
a slide-in is practical, with one design constraint.

```xml
<screen>
  <animations>
    <timeline name="drawer_in">
      <animation prop="translate_x" target="panel" start="-200" end="0" duration="250"/>
    </timeline>
    <timeline name="drawer_out">
      <animation prop="translate_x" target="panel" start="0" end="-200" duration="250"/>
    </timeline>
  </animations>
  <view ...>
    <lv_button name="open_btn">
      <subject_set_int_event subject="drawer_open" value="1"/>
      <play_timeline_event target="self" timeline="drawer_in"/>
    </lv_button>
    <lv_obj name="scrim" floating="true" ...>        <!-- dim backdrop, tap to close -->
      <bind_flag_if_eq subject="drawer_open" flag="hidden" ref_value="0"/>
      <subject_set_int_event subject="drawer_open" value="0"/>
      <play_timeline_event target="self" timeline="drawer_out"/>
    </lv_obj>
    <lv_obj name="panel" floating="true" x="0" y="0" width="200" height="240" style_translate_x="-200" ...>
      ... close button: subject_set_int_event value=0 + play_timeline_event drawer_out
    </lv_obj>
  </view>
</screen>
```

Measured: panel parked at x=-200 while closed; after the open tap its x reads
-200, -162, -47, then 0 over about 250 ms (a real eased slide, see
`out/q4_b_mid_slide.png`); the close button and the scrim tap both reverse it
and reset the subject.

Constraints and findings:

- `<animations>` is valid inside `<screen>`; `target="self"` in
  `<play_timeline_event>` resolves to the screen, and the `<animation target="panel">`
  name resolves to the named child. `translate_x` is an integer style prop, so it
  is animatable (colors are not, per the docs).
- **Park the panel with `style_translate_x="-200"`; do not hide it with the
  subject bind.** If the panel itself had a `hidden` bind, closing would blank it
  instantly and the slide-out would be invisible. Only the scrim uses the bind
  (it vanishes immediately on close while the panel finishes sliding out, which
  is acceptable).
- Two events on one widget (set subject, play timeline) both fire in document
  order; that worked without an explicit `trigger` (defaults to clicked).
- Not tried: right/top/bottom edges (same pattern with `translate_x` positive,
  `translate_y`), a fade on the scrim through `opa`, a state where the drawer
  starts open (`style_translate_x="0"` plus subject default 1 should do it).
- If the animation is not wanted, the pure show/hide variant (bind on the panel,
  no timelines) is the simplest output and needs no `<animations>`.

## Contradictions and refinements for COMPONENTS.md

Nothing the doc states about tags or spellings was wrong. Items for the
coordinator to consider (not edited here):

1. **Modal section vs the Disclosure section.** "Modal > Emit" says the
   container goes on `lv_layer_top()`, but the Disclosure section (correctly, per
   this spike) says the default is an in-screen floating overlay and the top
   layer is opt-in. The Modal bullet should say in-screen floating overlay first.
   Likewise the Disclosure table row for Drawer says "container on
   `lv_layer_top()` with a slide animation"; an in-screen floating panel with a
   `translate_x` timeline does the slide in XML.
2. **Per-instance state is simpler than described.** The doc suggests unique
   generated names but not how to wire them into one shared component. Verified:
   a `string` prop used as `subject="$subj"` works in both `subject_toggle_event`
   and `bind_flag_if_*`, so a single `ui_accordion` component can serve every
   instance with a generated subject name passed as a prop.
3. **Component `<subjects>` are not visible to `lv_xml_get_subject(NULL, ...)`**
   (globals), only through the component scope. Worth noting for the C emitters.
4. **`height="content"`** on a library component's root is needed for it to
   reflow siblings when the body hides (a fixed height pins the layout).
5. **Drawer panel must not be bound to hidden** if a slide-out animation is
   wanted (park it with `style_translate_x`). Add to the Drawer notes.
