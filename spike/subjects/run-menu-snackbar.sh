#!/usr/bin/env bash
# Click-driven check of the GENERATED Menu and Snackbar output in real LVGL
# v9.4.0 (Phase 9 lane B). Drives tests/golden-behavior/{menu,snackbar}.xml and
# their .globals.xml, which the converter makes from the extracted pages
# examples/components/{menu,snackbar}.html with the real Menu and Snackbar
# definitions (src/components/menu.mjs, snackbar.mjs). Proves: the closed
# initial state, the opener, choosing an item, the press-outside close, that an
# open menu blocks the page beneath it, the Snackbar's action and close
# buttons, and an opener that shows a hidden toast.
#
# The same scenarios also run against the generated C, C++ and MicroPython with
# identical assertions (drive.sh): TARGET=xml (default), c, cpp or py.
#
#   DRIVER=path/to/driver ./run-menu-snackbar.sh
#   TARGET=c|cpp LVGL_DIR=.. LIB_DIR=.. ./run-menu-snackbar.sh
#   TARGET=py MP=path/to/micropython ./run-menu-snackbar.sh
set -euo pipefail
cd "$(dirname "$0")"

G=../../tests/golden-behavior
. ./drive.sh
OUT=out
mkdir -p "$OUT"
LOG=$(mktemp)
fail=0
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}
# seq_check <log> <subject> <expected comma list> <label>: the readings of a subject, in order
seq_check() {
  local got
  got=$(grep -E "^subject $2 " "$1" | awk '{print $4}' | paste -sd, -)
  if [ "$got" = "$3" ]; then echo "  ok    $4 ($got)"; else echo "  FAIL  $4: '$got', expected '$3'"; fail=1; fi
}
shot() { if [ "$TARGET" = xml ]; then python3 bmp2png.py "$OUT/$1.bmp" "$OUT/$1.png" 2; fi; rm -f "$OUT/$1.bmp"; }

echo "Menu: plain ARIA menu (hidden, named by aria-controls) and Material UI menu (kept mounted, named by aria-labelledby)"
P=menu_actions_menu_open
M=menu_body_div_4_open
# Children of the root: 0 label, 1 note, 2 row, 3 menu (plain layer), 4 menu_2 (MUI layer).
# The alias is the widget's XML name, which is what the XML driver reports.
drive menu --name=menu=3 --name=menu_2=4 \
  --say=closed --subject=$P --subject=$M --report=menu --report=menu_2 --snap=$OUT/menu_a_closed.bmp \
  --click=40,70 --say=open-plain --subject=$P --report=menu --snap=$OUT/menu_b_plain_open.bmp \
  --click=130,70 --say=opener-under-open-menu --subject=$M --subject=$P \
  --click=40,70 --subject=$P --click=60,135 --say=item-duplicate --subject=$P \
  --click=40,70 --subject=$P --click=290,225 --say=press-outside --subject=$P \
  --click=130,70 --say=open-mui --subject=$M --report=menu_2 --snap=$OUT/menu_c_mui_open.bmp \
  --click=200,188 --say=item-logout --subject=$M \
  --click=130,70 --subject=$M --click=20,225 --say=mui-press-outside --subject=$M > "$LOG"
sed 's/^/    /' "$LOG"
check "both menus start closed (layers hidden, full screen)" "$LOG" 'report menu: hidden=1 x=0 y=0 w=320 h=240'
check "the plain layer is shown at full size when open" "$LOG" 'report menu: hidden=0 x=0 y=0 w=320 h=240'
check "the Material UI layer is shown at full size when open" "$LOG" 'report menu_2: hidden=0 x=0 y=0 w=320 h=240'
seq_check "$LOG" $P "0,1,0,1,0,1,0" "plain: opens; a press on the MUI opener beneath it only closes it; reopens, Duplicate closes; reopens, press outside closes"
seq_check "$LOG" $M "0,0,1,0,1,0" "MUI: closed and not opened by the blocked press, opens, Logout closes, reopens, press outside closes"
shot menu_a_closed; shot menu_b_plain_open; shot menu_c_mui_open

echo "Snackbar: Material UI bar (open on load, UNDO and close dismiss it) and a plain role=status toast (hidden, shown by a button)"
T=snackbar_toast_open
S=snackbar_body_div_4_open
# Children of the root: 0 label, 1 note, 2 show_toast, 3 snackbar (toast), 4 snackbar_2 (MUI bar)
drive snackbar --name=snackbar=3 --name=snackbar_2=4 \
  --say=initial --subject=$T --subject=$S --report=snackbar --report=snackbar_2 --snap=$OUT/snackbar_a_initial.bmp \
  --click=40,75 --say=show-toast --subject=$T --report=snackbar --snap=$OUT/snackbar_b_toast_open.bmp \
  --click=263,153 --say=dismiss-toast --subject=$T --report=snackbar \
  --click=247,209 --say=undo --subject=$S --report=snackbar_2 \
  --click=40,75 --say=toast-again --subject=$T > "$LOG"
sed 's/^/    /' "$LOG"
check "the toast starts hidden, the bar starts shown" "$LOG" 'report snackbar: hidden=1'
check "the bar sits at the bottom of the screen" "$LOG" 'report snackbar_2: hidden=0 x=8 y=188 w=304 h=44'
check "the toast is shown after the button" "$LOG" 'report snackbar: hidden=0 x=12 y=132 w=296 h=43'
seq_check "$LOG" $T "0,1,0,1" "toast: hidden, button shows it, Dismiss hides it, button shows it again"
seq_check "$LOG" $S "1,0" "bar: open on load, UNDO dismisses it"
check "the bar is hidden after UNDO" "$LOG" 'report snackbar_2: hidden=1'
shot snackbar_a_initial; shot snackbar_b_toast_open
drive snackbar --name=bar=4 --say=initial --subject=$S --click=288,209 --say=close-icon --subject=$S --report=snackbar_2 > "$LOG"
seq_check "$LOG" $S "1,0" "bar: the close icon dismisses it"

rm -f "$LOG"
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Generated Menu and Snackbar pass against LVGL ($TARGET)"
