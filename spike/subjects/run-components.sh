#!/usr/bin/env bash
# Click-driven check of the GENERATED Modal and Drawer XML in real LVGL v9.4.0
# (Phase 8 lane E). Drives tests/golden-behavior/{modal,drawer,drawer-edges}.xml
# and their .globals.xml, which the converter makes from the extracted pages
# examples/components/{modal,drawer,drawer-edges}.html with the real Modal and
# Drawer components (src/components/modal.mjs, drawer.mjs). Proves: the initial
# (closed) state, the opener, the closers, that an open overlay blocks clicks
# beneath it, backdrop tap to close, the slide animation for all four edges.
#
#   DRIVER=path/to/driver ./run-components.sh      (default: ./build/driver)
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
# seq <log> <subject> <expected comma list>: the readings of a subject, in order
seq_check() {
  local got
  got=$(grep -E "^subject $2 " "$1" | awk '{print $4}' | paste -sd, -)
  if [ "$got" = "$3" ]; then echo "  ok    $4 ($got)"; else echo "  FAIL  $4: '$got', expected '$3'"; fail=1; fi
}
shot() { python3 bmp2png.py "$OUT/$1.bmp" "$OUT/$1.png" 2; rm -f "$OUT/$1.bmp"; }

echo "Modal: plain alertdialog (open on load) and Material UI dialog (closed on load)"
P=modal_scrim_open
M=modal_body_div_4_open
"$DRIVER" --globals=$G/modal.globals.xml --screen=modal $G/modal.xml \
  --say=initial --subject=$P --subject=$M --report=scrim --report=dialog_overlay --snap=$OUT/modal_a_plain_open.bmp \
  --click=135,78 --say=opener-under-overlay --subject=$M \
  --click=10,225 --say=backdrop-tap-on-alertdialog --subject=$P \
  --click=100,100 --say=tap-on-dialog-text --subject=$P \
  --click=168,147 --say=cancel --subject=$P --report=scrim \
  --click=135,78 --say=open-mui --subject=$M --report=dialog_overlay --snap=$OUT/modal_b_mui_open.bmp \
  --click=160,100 --say=tap-mui-text --subject=$M \
  --click=10,225 --say=backdrop-tap --subject=$M --report=dialog_overlay \
  --click=135,78 --subject=$M --click=251,159 --say=agree --subject=$M \
  --click=40,78 --say=reopen-plain --subject=$P --report=scrim > "$LOG"
sed 's/^/    /' "$LOG"
check "plain dialog starts open (subject 1), overlay full screen, last child" "$LOG" 'report scrim: hidden=0 x=0 y=0 w=320 h=240'
check "MUI dialog starts hidden at full size (extractor measured it open)" "$LOG" 'report dialog_overlay: hidden=1 x=0 y=0 w=320 h=240'
seq_check "$LOG" $P "1,1,1,0,1" "plain: open, blocks nothing it should not, alertdialog ignores backdrop and text taps, Cancel closes, opener reopens"
seq_check "$LOG" $M "0,0,1,1,0,1,0" "MUI: opener under the open overlay is blocked, opens after Cancel, text tap keeps it, backdrop tap closes, reopen, Agree closes"
check "overlay hidden after Cancel" "$LOG" 'report scrim: hidden=1'
check "MUI overlay shown when open" "$LOG" 'report dialog_overlay: hidden=0 x=0 y=0 w=320 h=240'
shot modal_a_plain_open; shot modal_b_mui_open

echo "Drawer: left sheet (plain, ARIA) and right panel (Material UI), both closed on load"
L=drawer_body_div_3_open
R=drawer_body_div_4_open
"$DRIVER" --globals=$G/drawer.globals.xml --screen=drawer $G/drawer.xml \
  --say=closed --subject=$L --subject=$R --report=nav_sheet --report=filters --report=scrim --report=drawer_scrim --snap=$OUT/drawer_a_closed.bmp \
  --tap=30,78 --frames=2 --say=slide-start --report=nav_sheet \
  --frames=6 --say=slide-mid --report=nav_sheet --snap=$OUT/drawer_b_mid_slide.bmp \
  --frames=40 --say=left-open --subject=$L --report=nav_sheet --report=scrim --snap=$OUT/drawer_c_left_open.bmp \
  --click=100,207 --say=left-close-button --subject=$L --report=nav_sheet \
  --click=30,78 --subject=$L --click=270,120 --say=left-scrim-tap --subject=$L --report=nav_sheet --report=scrim \
  --click=100,78 --say=right-open --subject=$R --report=filters --snap=$OUT/drawer_d_right_open.bmp \
  --click=30,78 --say=click-under-scrim --subject=$L \
  --click=220,207 --say=right-apply --subject=$R --report=filters > "$LOG"
sed 's/^/    /' "$LOG"
check "left panel parked off-screen at x=-216 (width + shadow reach)" "$LOG" 'report nav_sheet: hidden=0 x=-216 y=0 w=200 h=240'
check "right panel parked at x=361 (screen edge + shadow reach)" "$LOG" 'report filters: hidden=0 x=361 y=0 w=200 h=240'
check "scrims hidden while closed" "$LOG" 'report scrim: hidden=1'
check "the panel slides: an x strictly between parked and open" "$LOG" 'report nav_sheet: hidden=0 x=-([1-9]|[1-9][0-9]|1[0-9][0-9]|20[0-9]|21[0-5]) '
check "left panel ends at x=0, scrim shown" "$LOG" 'report nav_sheet: hidden=0 x=0 y=0 w=200 h=240'
seq_check "$LOG" $L "0,1,0,1,0,0" "left: opens, Close button closes, reopens, scrim tap closes, and the Menu button under the right drawer's scrim stays blocked"
seq_check "$LOG" $R "0,1,0" "right: opens, Apply closes"
check "right panel at x=120 when open" "$LOG" 'report filters: hidden=0 x=120 y=0 w=200 h=240'
check "right panel parked again after Apply" "$LOG" 'report filters: hidden=0 x=361 '
check "scrim tap slides the left panel out again" "$LOG" 'report nav_sheet: hidden=0 x=-216 '
for n in drawer_a_closed drawer_b_mid_slide drawer_c_left_open drawer_d_right_open; do shot $n; done

echo "Drawer: top and bottom edges (translate_y)"
T=drawer_edges_body_div_2_open
B=drawer_edges_body_div_3_open
"$DRIVER" --globals=$G/drawer-edges.globals.xml --screen=drawer-edges $G/drawer-edges.xml \
  --say=closed --report=top_sheet --report=bottom_sheet \
  --click=40,52 --say=top-open --subject=$T --report=top_sheet --snap=$OUT/drawer_e_top_open.bmp \
  --click=290,220 --say=top-scrim-tap --subject=$T --report=top_sheet \
  --click=90,52 --say=bottom-open --subject=$B --report=bottom_sheet --snap=$OUT/drawer_f_bottom_open.bmp \
  --click=40,40 --say=bottom-scrim-tap --subject=$B --report=bottom_sheet > "$LOG"
sed 's/^/    /' "$LOG"
check "top sheet parked above the screen" "$LOG" 'report top_sheet: hidden=0 x=0 y=-126 w=320 h=110'
check "bottom sheet parked below the screen" "$LOG" 'report bottom_sheet: hidden=0 x=0 y=256 w=320 h=110'
check "top sheet slides to y=0" "$LOG" 'report top_sheet: hidden=0 x=0 y=0 w=320 h=110'
check "bottom sheet slides to y=130" "$LOG" 'report bottom_sheet: hidden=0 x=0 y=130 w=320 h=110'
seq_check "$LOG" $T "1,0" "top: opens, scrim tap closes"
seq_check "$LOG" $B "1,0" "bottom: opens, scrim tap closes"
shot drawer_e_top_open; shot drawer_f_bottom_open

rm -f "$LOG"
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Generated Modal and Drawer XML pass against LVGL v9.4.0"
