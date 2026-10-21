#!/usr/bin/env bash
# Run the four subject-pattern scenarios against real LVGL v9.4.0 and assert
# the results. Writes screenshots to out/*.png. Exits non-zero on any failure.
#
#   DRIVER=path/to/driver ./run.sh      (default: ./build/driver, see build.sh)
set -euo pipefail
cd "$(dirname "$0")"

DRIVER="${DRIVER:-./build/driver}"
G=xml/globals.xml
OUT=out
mkdir -p "$OUT"
LOG=$(mktemp)
fail=0

# check <description> <log-file> <regex>   (regex must match a line of the log)
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}

shot() { # shot <name>: bmp -> png (3x), drop the bmp
  python3 bmp2png.py "$OUT/$1.bmp" "$OUT/$1.png" 2
  rm -f "$OUT/$1.bmp"
}

echo "Q1 accordion: toggle header hides/shows body, siblings reflow"
"$DRIVER" --globals=$G --screen=q1_accordion xml/q1_accordion.xml \
  --say=initial --report=body1 --report=hdr2 --report=body2 --report=footer \
  --snap=$OUT/q1_a_initial.bmp \
  --click=100,16 --say=after-open-1 --subject=acc1_open --report=hdr2 --report=footer \
  --snap=$OUT/q1_b_open1.bmp \
  --click=100,108 --say=after-close-2 --report=body2 --report=footer \
  --snap=$OUT/q1_c_close2.bmp > "$LOG"
cat "$LOG" | sed 's/^/    /'
check "body1 starts hidden (bind applied at creation)" "$LOG" 'report body1: hidden=1'
check "footer at y=124 with section 1 closed, 2 open" "$LOG" 'report footer: hidden=0 x=0 y=124 '
check "header click flips subject to 1" "$LOG" 'subject acc1_open = 1'
check "hdr2 pushed down to y=92 once body1 opens" "$LOG" 'report hdr2: hidden=0 x=0 y=92 '
check "footer pushed to y=184" "$LOG" 'report footer: hidden=0 x=0 y=184 '
check "body2 hidden after closing section 2" "$LOG" 'report body2: hidden=1'
if sed -n '/after-close-2/,$p' "$LOG" | grep -q 'report footer: hidden=0 x=0 y=124 '; then
  echo "  ok    footer pulled back up to y=124"
else echo "  FAIL  footer not back at y=124"; fail=1; fi
for n in q1_a_initial q1_b_open1 q1_c_close2; do shot $n; done

echo "Q2a one generated subject per instance (globals.xml), prop substitution"
"$DRIVER" --globals=$G --screen=q2_unique xml/ui_acc_g.xml xml/q2_unique.xml \
  --say=initial --report=body --report=footer --snap=$OUT/q2_unique_0.bmp \
  --click=100,15 --say=after-click-A --subject=inst_a_open --subject=inst_b_open --report=body --report=footer \
  --snap=$OUT/q2_unique_1.bmp \
  --click=100,95 --say=after-click-B-header --subject=inst_a_open --subject=inst_b_open --report=footer \
  --snap=$OUT/q2_unique_2.bmp > "$LOG"
sed 's/^/    /' "$LOG"
check "A closed, B open initially: footer y=110" "$LOG" 'report footer: hidden=0 x=0 y=110 '
check "clicking A opens only A (B untouched, still 1)" "$LOG" 'subject inst_a_open = 1'
check "footer y=160 with both open" "$LOG" 'report footer: hidden=0 x=0 y=160 '
check "clicking B header closes only B (A stays 1, B 0)" "$LOG" 'subject inst_b_open = 0'
for n in q2_unique_0 q2_unique_1 q2_unique_2; do shot $n; done

echo "Q2b component-owned <subjects>: shared by every instance (caveat)"
"$DRIVER" --globals=$G --screen=q2_shared xml/ui_acc_own.xml xml/q2_shared.xml \
  --say=initial --report=body --snap=$OUT/q2_shared_0.bmp \
  --click=100,15 --say=after-click-A --subject=ui_acc_own/own_open --subject=own_open --report=body \
  --snap=$OUT/q2_shared_1.bmp > "$LOG"
sed 's/^/    /' "$LOG"
check "subject lives in the component scope, not globals" "$LOG" 'subject own_open: NOT FOUND'
check "one subject for both instances" "$LOG" 'subject ui_acc_own/own_open = 1'
# after clicking only instance A, BOTH bodies are visible (no hidden=1 after the marker)
if sed -n '/after-click-A/,$p' "$LOG" | grep -q 'hidden=1'; then
  echo "  FAIL  clicking A should have opened B too"; fail=1
else echo "  ok    clicking A opened B as well (shared state)"; fi
for n in q2_shared_0 q2_shared_1; do shot $n; done

echo "Q3 modal: floating overlay, last child, blocks clicks beneath"
"$DRIVER" --globals=$G --screen=q3_modal xml/q3_modal.xml \
  --say=closed --report=overlay --snap=$OUT/q3_a_closed.bmp \
  --click=20,68 --say=underneath-click-while-closed --subject=under_clicks \
  --click=100,20 --say=opened --subject=modal_open --report=overlay --snap=$OUT/q3_b_open.bmp \
  --click=20,68 --say=underneath-click-outside-dialog --subject=under_clicks \
  --click=100,68 --say=underneath-click-through-dialog-area --subject=under_clicks \
  --click=160,152 --say=close-pressed --subject=modal_open --snap=$OUT/q3_c_closed_again.bmp \
  --click=20,68 --say=underneath-click-after-close --subject=under_clicks > "$LOG"
sed 's/^/    /' "$LOG"
check "overlay hidden while subject is 0" "$LOG" 'report overlay: hidden=1'
check "open button sets modal_open=1" "$LOG" 'subject modal_open = 1'
check "overlay visible and full screen" "$LOG" 'report overlay: hidden=0 x=0 y=0 w=320 h=240'
check "close button resets modal_open=0" "$LOG" 'subject modal_open = 0'
# under_clicks sequence must be 1 (closed click), 1, 1 (blocked), 2 (after close)
seq=$(grep -E '^subject under_clicks' "$LOG" | awk '{print $4}' | paste -sd, -)
if [ "$seq" = "1,1,1,2" ]; then echo "  ok    underneath button blocked while open (counts: $seq)"
else echo "  FAIL  under_clicks sequence '$seq', expected 1,1,1,2"; fail=1; fi
for n in q3_a_closed q3_b_open q3_c_closed_again; do shot $n; done

echo "Q4 drawer: floating panel slid by <animations> + play_timeline_event"
"$DRIVER" --globals=$G --screen=q4_drawer xml/q4_drawer.xml \
  --say=closed --report=panel --report=scrim --snap=$OUT/q4_a_closed.bmp \
  --tap=100,20 --frames=2 --say=slide-start --report=panel \
  --frames=6 --say=slide-mid --report=panel --snap=$OUT/q4_b_mid_slide.bmp \
  --frames=30 --say=slide-done --report=panel --report=scrim --snap=$OUT/q4_c_open.bmp \
  --click=100,212 --say=close-button --subject=drawer_open --report=panel --report=scrim \
  --snap=$OUT/q4_d_closed.bmp > "$LOG"
sed 's/^/    /' "$LOG"
check "panel parked off-screen at x=-200 when closed" "$LOG" 'report panel: hidden=0 x=-200 '
check "timeline slides the panel (intermediate x strictly between -200 and 0)" "$LOG" 'report panel: hidden=0 x=-([1-9]|[1-9][0-9]|1[0-9][0-9]) '
check "panel ends at x=0" "$LOG" 'report panel: hidden=0 x=0 y=0 w=200 h=240'
check "scrim shown while open" "$LOG" 'report scrim: hidden=0'
check "close button sets drawer_open=0" "$LOG" 'subject drawer_open = 0'
for n in q4_a_closed q4_b_mid_slide q4_c_open q4_d_closed; do shot $n; done

rm -f "$LOG"
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "All subject-pattern checks passed against LVGL v9.4.0"
