#!/usr/bin/env bash
# Click-driven check of the GENERATED Material UI forms screens in real LVGL
# v9.4.0 (Phase 9 integration lane). Unlike the per-component checks, this
# drives several remapped components on one screen and proves they do not
# disturb each other:
#   - tests/golden/material_ui_forms.xml (examples/components/material-ui-forms.html):
#     an app bar over tabs whose panels hold a text field, a switch row and a
#     slider, with a bottom navigation pinned over the bottom edge. A click on a
#     switch or slider inside the open panel changes only that widget; a tap on
#     a tab brings its panel (and ITS switch and slider, which were hidden in
#     the page) into place; a tap on the bottom navigation moves only that bar.
#   - tests/golden-behavior/material-ui-forms-2.xml (material-ui-forms-2.html):
#     a card holding a select and a pagination, a snackbar over the page and a
#     bottom navigation. Opening the select does not close the snackbar, the
#     snackbar's UNDO closes only the snackbar, and the bottom navigation keeps
#     working with the snackbar above it.
#
# XML target only: the C, C++ and MicroPython of both fixtures are held to the
# same first frame by the golden renders in CI (as for run-form-widgets.sh).
#   DRIVER=path/to/driver ./run-material-forms.sh      (default ./build/driver)
set -euo pipefail
cd "$(dirname "$0")"

DRIVER="${DRIVER:-./build/driver}"
OUT=out
mkdir -p "$OUT"
LOG=$(mktemp)
G=$(mktemp -d)
trap 'rm -rf "$LOG" "$G"' EXIT
fail=0
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}
# nth_line <label> <expected regex>: the Nth "report" line after a "-- <say>" marker must match
after() {
  local marker=$1 pattern=$2 label=$3
  if awk -v m="-- $marker" '$0==m{f=1;next} /^-- /{f=0} f' "$LOG" | grep -Eq "$pattern"; then echo "  ok    $label"; else echo "  FAIL  $label  (after '$marker' expected /$pattern/)"; fail=1; fi
}
shot() { python3 bmp2png.py "$OUT/$1.bmp" "$OUT/$1.png" 2; rm -f "$OUT/$1.bmp"; }

echo "Forms 1: app bar, tabs (panel with text field, switch, slider), bottom navigation"
cp ../../tests/golden/material_ui_forms.xml "$G/forms.xml"
echo '<globals></globals>' > "$G/forms.globals.xml"
"$DRIVER" --globals="$G/forms.globals.xml" --screen=forms "$G/forms.xml" \
  --say=initial --report=set_panel_0 --report=set_panel_1 --report=switch_toggle --report=slider_control \
  --report=switch_toggle_2 --report=slider_control_2 --report=bottom_navigation_page_2 --snap=$OUT/forms_a_initial.bmp \
  --click=289,143 --say=switch-click --report=switch_toggle --report=slider_control --report=set_panel_0 \
  --click=100,186 --say=slider-click --report=slider_control --report=switch_toggle \
  --click=160,60 --say=display-tab --report=set_panel_0 --report=set_panel_1 --report=switch_toggle_2 --report=slider_control_2 --report=switch_toggle \
  --snap=$OUT/forms_b_display.bmp \
  --click=289,106 --say=display-switch --report=switch_toggle_2 --report=switch_toggle --report=slider_control_2 \
  --click=53,216 --say=bottom-home --report=bottom_navigation_page --report=bottom_navigation_page_2 --report=set_panel_1 \
  --snap=$OUT/forms_c_home.bmp > "$LOG"
sed 's/^/    /' "$LOG"
check "the open tab (General) is the panel on screen, the others a page width away" "$LOG" 'report set_panel_0: hidden=0 x=0 y=79'
check "the hidden Display panel was converted: its page sits one width to the right" "$LOG" 'report set_panel_1: hidden=0 x=320 '
check "aria-checked: the switch starts on" "$LOG" 'report switch_toggle: hidden=0 x=269 y=133 w=40 h=20 checked=1'
check "aria-valuenow: the slider starts at 40" "$LOG" 'report slider_control: hidden=0 x=14 y=184 w=292 h=4 checked=0 value=40'
check "the switch in the hidden panel starts off, its slider at 75" "$LOG" 'report slider_control_2: hidden=0 x=334 .* value=75'
check "aria-current: the bottom navigation starts on Settings (page 2 on screen)" "$LOG" 'report bottom_navigation_page_2: hidden=0 x=0 '
after switch-click 'report switch_toggle: .* checked=0' "a click on the switch turns it off"
after switch-click 'report slider_control: .* value=40' "...and leaves the slider alone"
after switch-click 'report set_panel_0: hidden=0 x=0 ' "...and does not turn the tab page"
after slider-click 'report slider_control: .* value=(2[0-9]|3[0-9])' "a click on the slider moves it (about 30)"
after slider-click 'report switch_toggle: .* checked=0' "...and leaves the switch as it was"
after display-tab 'report set_panel_1: hidden=0 x=0 ' "a tap on the Display tab brings its panel to the origin"
after display-tab 'report set_panel_0: hidden=0 x=-320 ' "...and moves the General panel out"
after display-tab 'report switch_toggle_2: hidden=0 x=269 ' "the switch that was hidden in the page is now in place"
after display-switch 'report switch_toggle_2: .* checked=1' "its click turns it on"
after display-switch 'report switch_toggle: .* checked=0' "...and does not touch the General switch"
after display-switch 'report slider_control_2: .* value=75' "...nor the Display slider"
after bottom-home 'report bottom_navigation_page: hidden=0 x=0 ' "a tap on Home in the bottom navigation moves only that bar to Home"
after bottom-home 'report set_panel_1: hidden=0 x=0 ' "...and the open tab panel stays where it was"
shot forms_a_initial; shot forms_b_display; shot forms_c_home

echo "Forms 2: card with a select and a pagination, snackbar over the page, bottom navigation"
cp ../../tests/golden-behavior/material-ui-forms-2.xml ../../tests/golden-behavior/material-ui-forms-2.globals.xml "$G/"
S=material_ui_forms_2_body_div_5_open
"$DRIVER" --globals="$G/material-ui-forms-2.globals.xml" --screen=material-ui-forms-2 "$G/material-ui-forms-2.xml" \
  --say=initial --subject=$S --report=snackbar --report=dropdown --report=bottom_navigation_page_2 --snap=$OUT/forms2_a_initial.bmp \
  --click=160,101 --say=select-open --subject=$S --report=snackbar --snap=$OUT/forms2_b_select_open.bmp \
  --click=160,101 --say=select-closed --subject=$S \
  --click=290,172 --say=undo --subject=$S --report=snackbar --snap=$OUT/forms2_c_snackbar_closed.bmp \
  --click=270,216 --say=bottom-orders --report=bottom_navigation_page_3 --report=bottom_navigation_page_2 \
  --click=53,216 --say=bottom-home --report=bottom_navigation_page --report=snackbar > "$LOG"
sed 's/^/    /' "$LOG"
check "the snackbar starts open (subject 1) at the bottom, above the bottom navigation" "$LOG" 'report snackbar: hidden=0 x=8 y=157 w=304 h=31'
check "the select is an lv_dropdown inside the card" "$LOG" 'report dropdown: hidden=0 x=24 y=84 w=272 h=34'
check "aria-current: the bottom navigation starts on Cart (page 2)" "$LOG" 'report bottom_navigation_page_2: hidden=0 x=0 '
after select-open 'subject .* = 1' "opening the select leaves the snackbar open"
after select-closed 'subject .* = 1' "closing it again does too"
after undo 'subject .* = 0' "UNDO sets the snackbar subject to 0"
after undo 'report snackbar: hidden=1' "...and hides only the snackbar"
after bottom-orders 'report bottom_navigation_page_3: hidden=0 x=0 ' "the bottom navigation switches to Orders"
after bottom-home 'report bottom_navigation_page: hidden=0 x=0 ' "...and to Home"
shot forms2_a_initial; shot forms2_b_select_open; shot forms2_c_snackbar_closed

if [ "$fail" = 0 ]; then echo "Material UI forms: all checks passed"; else echo "FAILED"; exit 1; fi
