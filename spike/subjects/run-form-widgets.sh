#!/usr/bin/env bash
# Click-driven check of the GENERATED Switch, Slider and Progress XML in real
# LVGL v9.4.0 (Phase 9 lane C). Drives tests/golden/{switch,slider,progress}.xml,
# which the converter makes from examples/components/{switch,slider,progress}.html
# with the native-widget remaps (src/components/switch.mjs, slider.mjs,
# progress.mjs). Proves that the first frame shows the ARIA state (aria-checked,
# aria-valuenow, the range input's value), that a click really toggles a switch
# and moves a slider, and that a progress ring is not clickable.
#
# XML only: the report lines the generated C, C++ and MicroPython would need
# (checked=, value=) exist only in driver.c; those three formats are held to the
# same first frame by the golden renders (CI renders every golden and the C and
# C++ images are byte-identical to the XML one).
#
#   DRIVER=path/to/driver ./run-form-widgets.sh      (default ./build/driver)
set -euo pipefail
cd "$(dirname "$0")"

# drive.sh expects <screen>.xml and <screen>.globals.xml in $G; these goldens
# need no globals, so an empty one is written next to a copy of each page.
G=$(mktemp -d)
trap 'rm -rf "$G"' EXIT
for n in switch slider progress; do
  cp "../../tests/golden/$n.xml" "$G/$n.xml"
  echo '<globals></globals>' > "$G/$n.globals.xml"
done
. ./drive.sh
LOG=$(mktemp)
trap 'rm -rf "$G" "$LOG" "$DRIVE_TMP"' EXIT
fail=0
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}

echo "Switch: aria-checked decides the first frame, a click toggles"
drive switch \
  --say=initial --report=switch --report=switch_2 --report=switch_toggle --report=switch_toggle_2 \
  --click=285,51 --say=plain-on-turns-off --report=switch \
  --click=285,91 --say=plain-off-turns-on --report=switch_2 \
  --click=29,161 --say=mui-on-turns-off --report=switch_toggle \
  --click=29,209 --say=mui-off-turns-on --report=switch_toggle_2 \
  --click=285,51 --say=plain-on-again --report=switch > "$LOG"
sed 's/^/    /' "$LOG"
check "plain on: checked=1 at first" "$LOG" 'report switch: hidden=0 x=264 y=39 w=44 h=24 checked=1'
check "plain off: checked=0 at first" "$LOG" 'report switch_2: hidden=0 x=264 y=79 w=44 h=24 checked=0'
check "Material UI Switch with Mui-checked starts checked, 40x20 inside its 58x38 root" "$LOG" 'report switch_toggle: hidden=0 x=9 y=151 w=40 h=20 checked=1'
check "Material UI Switch without it starts unchecked" "$LOG" 'report switch_toggle_2: hidden=0 x=9 y=199 w=40 h=20 checked=0'
awk '/^-- plain-on-turns-off/{getline; print}' "$LOG" | grep -q 'checked=0' && echo "  ok    a click turns a checked switch off" || { echo "  FAIL  a click turns a checked switch off"; fail=1; }
awk '/^-- plain-off-turns-on/{getline; print}' "$LOG" | grep -q 'checked=1' && echo "  ok    a click turns an unchecked switch on" || { echo "  FAIL  a click turns an unchecked switch on"; fail=1; }
awk '/^-- mui-on-turns-off/{getline; print}' "$LOG" | grep -q 'checked=0' && echo "  ok    the Material UI toggle turns off on a click" || { echo "  FAIL  the Material UI toggle turns off on a click"; fail=1; }
awk '/^-- mui-off-turns-on/{getline; print}' "$LOG" | grep -q 'checked=1' && echo "  ok    the Material UI toggle turns on on a click" || { echo "  FAIL  the Material UI toggle turns on on a click"; fail=1; }
awk '/^-- plain-on-again/{getline; print}' "$LOG" | grep -q 'checked=1' && echo "  ok    and back on again" || { echo "  FAIL  and back on again"; fail=1; }

echo "Slider: aria-valuenow is the first value, a click moves it"
drive slider \
  --say=initial --report=slider --report=slider_control --report=slider_control_2 \
  --click=80,71 --say=plain-click --report=slider \
  --click=100,153 --say=mui-click --report=slider_control > "$LOG"
sed 's/^/    /' "$LOG"
check "role=slider aria-valuenow=65 starts at 65, rail 280 wide" "$LOG" 'report slider: hidden=0 x=20 y=68 w=280 h=6 checked=0 value=65'
check "Material UI value 40 (its range input) starts at 40, rail 4 px thick" "$LOG" 'report slider_control: hidden=0 x=20 y=151 w=280 h=4 checked=0 value=40'
check "range slider shows its end thumb as the value" "$LOG" 'report slider_control_2: hidden=0 x=20 y=207 w=280 h=4 checked=0 value=70'
check "a click at x=80 of a rail from 20 to 300 sets about 21" "$LOG" 'report slider: .* value=2[01]$'
check "a click at x=100 sets about 29" "$LOG" 'report slider_control: .* value=(28|29)$'

echo "Progress: aria-valuenow is the value, a ring is not clickable"
drive progress \
  --say=initial --report=progress --report=progress_2 --report=progress_3 --report=progress_4 \
  --click=36,156 --say=ring-click --report=progress_3 > "$LOG"
sed 's/^/    /' "$LOG"
check "plain progressbar 70 of 100 is a bar at 70" "$LOG" 'report progress: hidden=0 x=16 y=58 w=288 h=8 checked=0 value=70'
check "Material UI LinearProgress aria-valuenow=60 is a bar at 60" "$LOG" 'report progress_2: hidden=0 x=16 y=124 w=288 h=4 checked=0 value=60'
check "CircularProgress aria-valuenow=75 is a 40x40 arc at 75" "$LOG" 'report progress_3: hidden=0 x=16 y=136 w=40 h=40 checked=0 value=75'
check "indeterminate CircularProgress is drawn as a static 40 percent arc" "$LOG" 'report progress_4: hidden=0 x=264 y=136 w=40 h=40 checked=0 value=40'
awk '/^-- ring-click/{getline; print}' "$LOG" | grep -q 'value=75$' && echo "  ok    clicking a ring does not change it" || { echo "  FAIL  clicking a ring does not change it"; fail=1; }

exit $fail
