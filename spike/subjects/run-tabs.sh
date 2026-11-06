#!/usr/bin/env bash
# Click-driven check of the GENERATED tabs and bottom navigation in real LVGL
# v9.4.0 (Phase 9 lane A). Drives tests/golden/{tabs,tabs_positions,
# bottom_navigation}.xml and the same fixtures' generated C, C++ and MicroPython
# (tests/golden-c|cpp|py/ui_<name>.*), which the converter makes from
# examples/components/{tabs,tabs-positions,bottom-navigation}.html. Proves:
#   - the open tab comes from aria-selected / aria-current / Mui-selected
#     (the page that is on screen is the one that said selected),
#   - a tap on a tab button switches the page (lv_tabview does it itself: no
#     subject or event of ours), for a bar on top, below and on the left,
#   - the bottom navigation switches its selected action the same way.
# A page's x is the evidence: the open page sits at its container's origin, the
# others a whole page width to either side.
#
# One scenario, four targets, like run-components.sh. Pick the target with
# TARGET=xml (default), c, cpp or py.
#   xml      DRIVER (default ./build/driver)
#   c, cpp   LVGL_DIR (LVGL v9.4 source) and LIB_DIR (built liblvgl.a)
#   py       MP (the lv_micropython unix binary)
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${TARGET:-xml}"
DRIVER="${DRIVER:-./build/driver}"
ROOT=$(cd ../.. && pwd)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
OUT=out
mkdir -p "$OUT"
fail=0
check() {
  if grep -Eq "$3" "$2"; then echo "  ok    $1"; else echo "  FAIL  $1  (expected /$3/)"; fail=1; fi
}

# drive <fixture name> <steps...>
drive() {
  local name=$1; shift
  case "$TARGET" in
    xml) "$DRIVER" --screen="$name" "$ROOT/tests/golden/$name.xml" "$@" ;;
    py) MICROPYPATH="$ROOT/tests/golden-py" "${MP:?set MP to the lv_micropython unix binary}" ../micropython/driver_py.py "ui_$name" ui_create "$@" ;;
    c|cpp)
      local bin="$TMP/${name}_$TARGET"
      local conf=(-DLV_CONF_PATH="\"$ROOT/spike/render/lv_conf.h\"" -I "${LVGL_DIR:?set LVGL_DIR}" -I "$ROOT/tests/golden-$TARGET")
      local libs=("${LIB_DIR:?set LIB_DIR}/liblvgl.a" "$LIB_DIR/liblvgl_thorvg.a" -lm -lpthread)
      if [ ! -x "$bin" ]; then
        if [ "$TARGET" = c ]; then
          gcc -O1 "${conf[@]}" -DUI_CREATE_SYMBOL=ui_create driver_c.c "$ROOT/tests/golden-c/ui_$name.c" "${libs[@]}" -o "$bin"
        else
          g++ -std=c++17 -O1 "${conf[@]}" -DUI_CREATE_SYMBOL=ui_create -x c++ driver_c.c -x none "$ROOT/tests/golden-cpp/ui_$name.cpp" "${libs[@]}" -o "$bin"
        fi
      fi
      "$bin" "$@" ;;
  esac
}
shot() { if [ "$TARGET" = xml ]; then python3 bmp2png.py "$OUT/$1.bmp" "$OUT/$1.png" 2; fi; rm -f "$OUT/$1.bmp"; }

LOG="$TMP/log"
# seq <alias> <expected comma list> <label> [x|y]: the x (or y) readings of one page, in order
seq_check() {
  local got axis=${4:-x}
  got=$(grep -E "^report $1: " "$LOG" | sed -E "s/.* $axis=(-?[0-9]+) .*/\\1/" | paste -sd, -)
  if [ "$got" = "$2" ]; then echo "  ok    $3 ($got)"; else echo "  FAIL  $3: '$got', expected '$2'"; fail=1; fi
}

echo "Tabs ($TARGET): plain ARIA (tab 2 selected) and Material UI (tab 2 selected), bar on top"
# Children of the root: 0 plain tabview, 1 Material UI tabview; tabview children: 0 bar, 1 pages.
drive tabs \
  --name=plain_p1=0.1.0 --name=plain_p2=0.1.1 --name=plain_p3=0.1.2 \
  --name=mui_tabpanel_0=1.1.0 --name=mui_tabpanel_1=1.1.1 --name=mui_tabpanel_2=1.1.2 \
  --say=initial --report=plain_p1 --report=plain_p2 --report=plain_p3 --report=mui_tabpanel_0 --report=mui_tabpanel_1 --report=mui_tabpanel_2 \
  --snap=$OUT/tabs_a_initial.bmp \
  --click=260,24 --say=plain-reviews --report=plain_p3 --report=plain_p2 \
  --snap=$OUT/tabs_b_plain_reviews.bmp \
  --click=60,24 --say=plain-overview --report=plain_p1 \
  --click=250,116 --say=mui-alerts --report=mui_tabpanel_2 --report=mui_tabpanel_1 \
  --click=60,116 --say=mui-profile --report=mui_tabpanel_0 \
  --snap=$OUT/tabs_c_mui_profile.bmp > "$LOG"
sed 's/^/    /' "$LOG"
check "plain: the aria-selected tab (Specs) is the page on screen at the panel's own origin" "$LOG" 'report plain_p2: hidden=0 x=9 y=40 w=302 h=48'
check "plain: the other pages sit a page width to either side" "$LOG" 'report plain_p1: hidden=0 x=-293 '
check "Material UI: the Mui-selected tab (Billing) is on screen at x=8" "$LOG" 'report mui_tabpanel_1: hidden=0 x=8 y=136 w=304 h=44'
seq_check plain_p3 "311,9" "plain: tapping Reviews brings its page in"
seq_check plain_p2 "9,-293" "plain: and sends Specs away"
seq_check plain_p1 "-293,9" "plain: tapping Overview brings page 1 back"
seq_check mui_tabpanel_2 "312,8" "Material UI: tapping Alerts brings its page in"
seq_check mui_tabpanel_0 "-296,8" "Material UI: tapping Profile brings page 0 in"
shot tabs_a_initial; shot tabs_b_plain_reviews; shot tabs_c_mui_profile

echo "Tabs ($TARGET): bar below the pages and bar on the left (aria-orientation)"
# Children of the root: 0 label, 1 bottom tabview, 2 label, 3 left tabview.
drive tabs_positions \
  --name=b_p1=1.1.0 --name=b_p2=1.1.1 --name=s_p0=3.1.0 --name=s_p1=3.1.1 --name=s_p2=3.1.2 \
  --say=initial --report=b_p1 --report=b_p2 --report=s_p0 --report=s_p1 --report=s_p2 \
  --click=250,89 --say=bar-below-saved --report=b_p2 \
  --snap=$OUT/tabs_d_bar_below.bmp \
  --click=40,213 --say=left-bar-display --report=s_p2 \
  --snap=$OUT/tabs_e_bar_left.bmp \
  --click=40,150 --say=left-bar-wifi --report=s_p0 > "$LOG"
sed 's/^/    /' "$LOG"
check "bar below: the first tab's page is on screen (it said aria-selected)" "$LOG" 'report b_p1: hidden=0 x=9 y=[0-9]+ w=302 '
seq_check b_p2 "311,9" "bar below: tapping Saved brings its page in"
# The XML driver registers only two Montserrat sizes, so text heights (and with them every y below a
# label) differ from the C, C++ and MicroPython runs. Compare y values with each other, not with numbers.
nth() { grep -E "^report $1: " "$LOG" | sed -E "s/.* y=(-?[0-9]+) .*/\\1/" | sed -n "${2}p"; }
open_y=$(nth s_p1 1)
if [ "$(nth s_p2 2)" = "$open_y" ] && [ "$(nth s_p0 2)" = "$open_y" ]; then
  echo "  ok    bar on the left: the open page (Sound at first, then Display, then Wi-Fi) is always at the same y ($open_y)"
else echo "  FAIL  bar on the left: open page y values differ: $open_y, $(nth s_p2 2), $(nth s_p0 2)"; fail=1; fi
if [ "$(nth s_p0 1)" -lt "$open_y" ] && [ "$(nth s_p2 1)" -gt "$open_y" ]; then
  echo "  ok    bar on the left: pages stack vertically, Wi-Fi above the open page and Display below it"
else echo "  FAIL  bar on the left: closed pages are not above/below the open one"; fail=1; fi
check "bar on the left: the pages sit right of the 96px bar (x=104)" "$LOG" 'report s_p1: hidden=0 x=104 '
shot tabs_d_bar_below; shot tabs_e_bar_left

echo "Bottom navigation ($TARGET): the selected action moves when another is tapped"
# Children of the root: 0 plain phone, 1 Material UI phone; phone children: 0 label, 1 tabview.
drive bottom_navigation \
  --name=plain_nav_page=0.1.1.0 --name=plain_nav_page_2=0.1.1.1 --name=plain_nav_page_3=0.1.1.2 \
  --name=mui_nav_page=1.1.1.0 --name=mui_nav_page_2=1.1.1.1 --name=mui_nav_page_3=1.1.1.2 \
  --say=initial --report=plain_nav_page --report=plain_nav_page_2 --report=mui_nav_page_2 --report=mui_nav_page_3 \
  --snap=$OUT/bottom_a_initial.bmp \
  --click=60,87 --say=plain-home --report=plain_nav_page --report=plain_nav_page_2 \
  --click=260,87 --say=plain-settings --report=plain_nav_page_3 \
  --snap=$OUT/bottom_b_plain_settings.bmp \
  --click=250,210 --say=mui-nearby --report=mui_nav_page_3 --report=mui_nav_page_2 \
  --click=60,210 --say=mui-recents --report=mui_nav_page \
  --snap=$OUT/bottom_c_mui_recents.bmp > "$LOG"
sed 's/^/    /' "$LOG"
check "plain: aria-current picks Stats (page 2) as the open action, at the origin" "$LOG" 'report plain_nav_page_2: hidden=0 x=9 '
check "Material UI: Mui-selected picks Favorites (page 2) as the open action" "$LOG" 'report mui_nav_page_2: hidden=0 x=9 '
seq_check plain_nav_page "-293,9" "plain: tapping Home brings page 1 to the origin"
seq_check plain_nav_page_2 "9,311" "plain: and sends Stats away"
seq_check plain_nav_page_3 "9" "plain: tapping Settings brings page 3 to the origin"
seq_check mui_nav_page_3 "311,9" "Material UI: tapping Nearby brings page 3 to the origin"
seq_check mui_nav_page_2 "9,-293" "Material UI: and sends Favorites away"
seq_check mui_nav_page "9" "Material UI: tapping Recents brings page 1 back"
shot bottom_a_initial; shot bottom_b_plain_settings; shot bottom_c_mui_recents

if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Generated tabs and bottom navigation pass against LVGL ($TARGET)"
