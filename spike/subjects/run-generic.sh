#!/usr/bin/env bash
# Click-driven check of the GENERATED subject XML in real LVGL v9.4.0.
#
# run.sh (next to this file) verifies hand-written patterns. This script drives
# the output of html2lvgl itself: tests/golden-behavior/disclosure.xml and its
# disclosure.globals.xml, made by the converter from tests/fixtures-behavior/
# disclosure.json with the test-only components in tests/helpers/. It proves
# the emitted subjects, toggle/set events and hidden binds work end to end:
# initial state, accordion reflow, an opener/closer dialog that blocks clicks
# beneath, and independent per-instance state.
#
#   DRIVER=path/to/driver ./run-generic.sh      (default: ./build/driver)
set -euo pipefail
cd "$(dirname "$0")"

DRIVER="${DRIVER:-./build/driver}"
G=../../tests/golden-behavior
OUT=out
mkdir -p "$OUT"
LOG=$(mktemp)
fail=0
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}

"$DRIVER" --globals=$G/disclosure.globals.xml --screen=disclosure $G/disclosure.xml \
  --say=initial --subject=disclosure_p1_open --subject=disclosure_p2_open --subject=disclosure_dlg_open \
  --report=p1 --report=p2 --report=footer --report=dlg --snap=$OUT/generic_a_initial.bmp \
  --click=100,188 --say=dialog-opened --subject=disclosure_dlg_open --report=dlg --snap=$OUT/generic_b_dialog.bmp \
  --click=100,16 --say=click-under-dialog --subject=disclosure_p1_open \
  --click=160,146 --say=dialog-closed --subject=disclosure_dlg_open --report=dlg \
  --click=100,16 --say=section-1-opened --subject=disclosure_p1_open --report=p1 --report=h2 --report=footer \
  --click=100,124 --say=section-2-closed --subject=disclosure_p2_open --report=p2 --report=footer \
  --snap=$OUT/generic_c_sections.bmp > "$LOG"
sed 's/^/    /' "$LOG"

check "section 1 starts closed (subject 0, body hidden)" "$LOG" 'subject disclosure_p1_open = 0'
check "section 2 starts open (subject 1)" "$LOG" 'subject disclosure_p2_open = 1'
check "dialog starts hidden at full size" "$LOG" 'report dlg: hidden=1 x=0 y=0 w=320 h=240'
check "footer sits at y=148 with one body open" "$LOG" 'report footer: hidden=0 x=0 y=148 '
check "opener sets the dialog subject to 1" "$LOG" 'subject disclosure_dlg_open = 1'
check "dialog visible after opening" "$LOG" 'report dlg: hidden=0 x=0 y=0 w=320 h=240'
# Order of p1_open readings: 0 (initial), 0 (click blocked by the dialog), 1 (opened)
seq=$(grep -E '^subject disclosure_p1_open' "$LOG" | awk '{print $4}' | paste -sd, -)
if [ "$seq" = "0,0,1" ]; then echo "  ok    dialog blocks the click on the header beneath ($seq)"
else echo "  FAIL  p1_open readings '$seq', expected 0,0,1"; fail=1; fi
check "close button sets the dialog subject back to 0" "$LOG" 'subject disclosure_dlg_open = 0'
check "opening section 1 pushes header 2 to y=108" "$LOG" 'report h2: hidden=0 x=0 y=108 '
check "footer moves to y=216" "$LOG" 'report footer: hidden=0 x=0 y=216 '
check "toggling section 2 closes it only" "$LOG" 'subject disclosure_p2_open = 0'
if sed -n '/section-2-closed/,$p' "$LOG" | grep -q 'report footer: hidden=0 x=0 y=148 '; then
  echo "  ok    footer pulled back to y=148"
else echo "  FAIL  footer not back at y=148"; fail=1; fi

for n in generic_a_initial generic_b_dialog generic_c_sections; do
  python3 bmp2png.py "$OUT/$n.bmp" "$OUT/$n.png" 2
  rm -f "$OUT/$n.bmp"
done
rm -f "$LOG"
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Generated subject XML passes against LVGL v9.4.0"
