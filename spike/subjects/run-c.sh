#!/usr/bin/env bash
# Click-driven check of the GENERATED C and C++ behavior output in real LVGL.
#
# run-generic.sh drives the XML golden; this drives tests/golden-behavior/
# ui_disclosure.{c,cpp} (same fixture) and ui_acc_instances.{c,cpp} (two
# lv_xml_create instances of spike/subjects/xml/ui_acc_g.xml), compiled against
# an already-built LVGL (the validate-xml job's build/lvgl/lib).
#
# Phase 8 lane F adds the shipped components: ui_accordion, ui_modal, ui_drawer
# and ui_drawer_edges in C and C++ run the SAME scenarios and assertions as the
# XML ones (run-accordion.sh, run-components.sh with TARGET=c|cpp, via driver_c.c
# and drive.sh), so XML, C and C++ are held to one behavior. The Drawer slide
# there is lv_anim_timeline_t + lv_obj_add_play_timeline_event.
#
#   LVGL_DIR=path/to/lvgl LIB_DIR=path/to/build/lvgl/lib ./run-c.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
LVGL_DIR="${LVGL_DIR:?set LVGL_DIR}"
LIB_DIR="${LIB_DIR:?set LIB_DIR}"
G=$ROOT/tests/golden-behavior
CONF=(-DLV_CONF_PATH="\"$ROOT/spike/render/lv_conf.h\"" -I "$LVGL_DIR" -I "$G")
LIBS=("$LIB_DIR/liblvgl.a" "$LIB_DIR/liblvgl_thorvg.a" -lm -lpthread)
TMP=$(mktemp -d)
fail=0
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}

for lang in c cpp; do
  if [ "$lang" = c ]; then CC=(gcc -O1); else CC=(g++ -std=c++17 -O1); fi
  echo "== $lang"

  "${CC[@]}" "${CONF[@]}" -DUI_CREATE_SYMBOL=ui_disclosure_create -x "$([ $lang = c ] && echo c || echo c++)" driver_c.c \
    -x none "$G/ui_disclosure.$lang" "${LIBS[@]}" -o "$TMP/disclosure_$lang"
  LOG=$TMP/disclosure_$lang.log
  # Child indexes of the root: 0 h1, 1 p1, 2 h2, 3 p2, 4 footer, 5 openbtn, 6 dlg
  "$TMP/disclosure_$lang" \
    --say=initial --subject=disclosure_p1_open --subject=disclosure_p2_open --subject=disclosure_dlg_open \
    --report=1 --report=4 --report=6 \
    --click=100,188 --say=dialog-opened --subject=disclosure_dlg_open --report=6 \
    --click=100,16 --say=click-under-dialog --subject=disclosure_p1_open \
    --click=160,146 --say=dialog-closed --subject=disclosure_dlg_open --report=6 \
    --click=100,16 --say=section-1-opened --subject=disclosure_p1_open --report=1 --report=2 --report=4 \
    --click=100,124 --say=section-2-closed --subject=disclosure_p2_open --report=3 --report=4 > "$LOG"
  check "section 1 starts closed (subject 0)" "$LOG" 'subject disclosure_p1_open = 0'
  check "section 2 starts open (subject 1)" "$LOG" 'subject disclosure_p2_open = 1'
  check "body 1 starts hidden" "$LOG" 'report 1: hidden=1'
  check "dialog starts hidden" "$LOG" 'report 6: hidden=1'
  check "footer at y=148 with one body open" "$LOG" 'report 4: hidden=0 x=0 y=148 '
  check "opener sets the dialog subject to 1 and shows it" "$LOG" 'subject disclosure_dlg_open = 1'
  check "dialog visible after opening" "$LOG" 'report 6: hidden=0 x=0 y=0 w=320 h=240'
  seq=$(grep -E '^subject disclosure_p1_open' "$LOG" | awk '{print $4}' | paste -sd, -)
  if [ "$seq" = "0,0,1" ]; then echo "  ok    dialog blocks the click on the header beneath ($seq)"
  else echo "  FAIL  p1_open readings '$seq', expected 0,0,1"; fail=1; fi
  check "close button sets the dialog subject back to 0" "$LOG" 'subject disclosure_dlg_open = 0'
  check "opening section 1 pushes header 2 to y=108" "$LOG" 'report 2: hidden=0 x=0 y=108 '
  check "footer moves to y=216" "$LOG" 'report 4: hidden=0 x=0 y=216 '
  check "toggling section 2 closes it only" "$LOG" 'subject disclosure_p2_open = 0'

  "${CC[@]}" "${CONF[@]}" -DUI_CREATE_SYMBOL=ui_acc_instances_create -x "$([ $lang = c ] && echo c || echo c++)" driver_c.c \
    -x none "$G/ui_acc_instances.$lang" "${LIBS[@]}" -o "$TMP/inst_$lang"
  LOG=$TMP/inst_$lang.log
  # Children of the root: 0 and 1 are the two ui_acc_g instances, 2 the footer
  "$TMP/inst_$lang" "$ROOT/spike/subjects/xml/ui_acc_g.xml" \
    --say=initial --subject=acc_instances_acca_open --subject=acc_instances_accb_open --report=0 --report=1 \
    --click=100,100 --say=b-opened --subject=acc_instances_acca_open --subject=acc_instances_accb_open --report=1 \
    --click=100,15 --say=a-closed --subject=acc_instances_acca_open --subject=acc_instances_accb_open > "$LOG"
  check "instance A starts open, B closed (subjects resolved by name)" "$LOG" 'subject acc_instances_acca_open = 1'
  check "instance B starts closed" "$LOG" 'subject acc_instances_accb_open = 0'
  # Heights are not asserted past this: convert() passes the measured height
  # to the instance, so the component does not reflow when collapsed.
  check "instance geometry comes from the passed width/height" "$LOG" 'report 0: hidden=0 x=0 y=0 w=320 h=80'
  check "clicking B's header opens only B" "$LOG" 'subject acc_instances_accb_open = 1'
  if sed -n '/b-opened/,/a-closed/p' "$LOG" | grep -q 'subject acc_instances_acca_open = 1'; then
    echo "  ok    A unchanged when B toggles"; else echo "  FAIL  A changed when B toggled"; fail=1; fi
done

rm -rf "$TMP"
# Same scenarios as the XML run, on the generated C and C++ (see header).
export LVGL_DIR LIB_DIR
for lang in c cpp; do
  echo "== accordion, modal, drawer ($lang)"
  TARGET=$lang ./run-accordion.sh | grep -E '^  (ok|FAIL)|^(Accordion passes|FAILED)' || fail=1
  TARGET=$lang ./run-components.sh | grep -E '^  (ok|FAIL)|^(Generated Modal|FAILED)' || fail=1
  TARGET=$lang ./run-tabs.sh | grep -E '^  (ok|FAIL)|^(Generated tabs|FAILED)' || fail=1
done
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Generated C and C++ behavior output passes against LVGL"
