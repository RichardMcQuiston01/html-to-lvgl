#!/usr/bin/env bash
# Click-driven check of the GENERATED tabs-in-an-app-bar output in real LVGL
# v9.4.0 (and the pinned MicroPython binding). Drives tests/golden-behavior/
# {tabs-appbar,tabs-appbar-mui} and the same fixtures' generated C, C++ and
# MicroPython, which the converter makes from examples/components/tabs-appbar.html
# (plain ARIA banner + a Material UI app bar, panels outside both) and
# packages/mui/examples/appbar-tabs.jsx (real Material UI, a fixed app bar with
# icon tabs). Proves, on the emitted output itself:
#   - the open tab comes from aria-selected / Mui-selected (subject value, the
#     CHECKED state of its button, the one panel that is not hidden),
#   - a tap on a tab button stores its index, moves CHECKED to it and swaps the
#     panel; the other panels stay hidden, in the same place,
#   - two tab sets on one page switch independently,
#   - tapping the open tab changes nothing,
#   - a fixed app bar stays where it is while its tabs switch the panels below it.
#
# One scenario, four targets, like run-tabs.sh. Pick the target with TARGET=xml
# (default), c, cpp or py.
#   xml      DRIVER (default ./build/driver)
#   c, cpp   LVGL_DIR (LVGL v9.4 source) and LIB_DIR (built liblvgl.a)
#   py       MP (the lv_micropython unix binary)
set -euo pipefail
cd "$(dirname "$0")"

G=../../tests/golden-behavior
. ./drive.sh
OUT=out
mkdir -p "$OUT"
LOG=$(mktemp)
fail=0

# The lines printed after one --say marker, up to the next marker.
after() { sed -n "/^-- $1\$/,/^-- /p" "$LOG"; }
expect() { # label marker pattern
  if after "$2" | grep -Eq "$3"; then echo "  ok    $1"; else echo "  FAIL  $1  (after '$2' expected /$3/)"; fail=1; fi
}
shot() { if [ "$TARGET" = xml ]; then python3 bmp2png.py "$OUT/$1.bmp" "$OUT/$1.png" 2; fi; rm -f "$OUT/$1.bmp"; }

echo "Tabs in an app bar ($TARGET): plain ARIA banner (Orders open) and Material UI app bar (Settings open)"
# Children of the root: 0 banner (0.1.x its tabs), 1 main (1.x panels), 2 the Material UI box
# (2.0.1.0.0.x tabs, 2.1..3 panels).
S1=tabs_appbar_appbar_tabs_selected
S2=tabs_appbar_appbar_tabs_2_selected
drive tabs-appbar \
  --name=wh_t1=0.1.0 --name=wh_t2=0.1.1 --name=wh_t3=0.1.2 \
  --name=wh_p1=1.0 --name=wh_p2=1.1 --name=wh_p3=1.2 \
  --name=mui_tab_0=2.0.1.0.0.0 --name=mui_tab_1=2.0.1.0.0.1 --name=mui_tab_2=2.0.1.0.0.2 \
  --name=mui_tabpanel_0=2.1 --name=mui_tabpanel_1=2.2 --name=mui_tabpanel_2=2.3 \
  --say=initial --subject=$S1 --subject=$S2 \
  --report=wh_t1 --report=wh_t2 --report=wh_t3 --report=wh_p1 --report=wh_p2 --report=wh_p3 \
  --report=mui_tab_0 --report=mui_tab_1 --report=mui_tab_2 --report=mui_tabpanel_0 --report=mui_tabpanel_1 --report=mui_tabpanel_2 \
  --snap=$OUT/appbar_tabs_a_initial.bmp \
  --click=270,47 --say=plain-returns --subject=$S1 --subject=$S2 \
  --report=wh_t2 --report=wh_t3 --report=wh_p2 --report=wh_p3 \
  --snap=$OUT/appbar_tabs_b_plain_returns.bmp \
  --click=50,47 --say=plain-stock --subject=$S1 \
  --report=wh_t1 --report=wh_t3 --report=wh_p1 --report=wh_p3 \
  --click=50,47 --say=plain-stock-again --subject=$S1 --report=wh_t1 --report=wh_p1 \
  --click=50,164 --say=mui-overview --subject=$S1 --subject=$S2 \
  --report=mui_tab_0 --report=mui_tab_1 --report=mui_tabpanel_0 --report=mui_tabpanel_1 \
  --snap=$OUT/appbar_tabs_c_mui_overview.bmp \
  --click=270,164 --say=mui-billing --subject=$S2 \
  --report=mui_tab_0 --report=mui_tab_2 --report=mui_tabpanel_0 --report=mui_tabpanel_2 \
  --snap=$OUT/appbar_tabs_d_mui_billing.bmp > "$LOG"
sed 's/^/    /' "$LOG"

expect "plain: the aria-selected tab (Orders) is the open one (subject 1)" initial "subject $S1 = 1"
expect "Material UI: the Mui-selected tab (Settings) is the open one (subject 1)" initial "subject $S2 = 1"
expect "plain: Orders button is CHECKED" initial 'report wh_t2: hidden=0 x=106 y=32 w=107 h=30 checked=1'
expect "plain: Stock button is not" initial 'report wh_t1: hidden=0 x=0 y=32 w=106 h=30 checked=0'
expect "plain: only the Orders panel is shown" initial 'report wh_p2: hidden=0 x=0 y=70 w=320 h=28'
expect "plain: the Stock panel is hidden" initial 'report wh_p1: hidden=1 '
expect "plain: the Returns panel is hidden" initial 'report wh_p3: hidden=1 '
expect "Material UI: Settings is CHECKED" initial 'report mui_tab_1: hidden=0 x=106 y=146 w=107 h=36 checked=1'
expect "Material UI: only the Settings panel is shown" initial 'report mui_tabpanel_1: hidden=0 x=0 y=182 w=320 h=30'

expect "plain: tapping Returns stores 2" plain-returns "subject $S1 = 2"
expect "plain: Returns becomes CHECKED" plain-returns 'report wh_t3: hidden=0 x=213 y=32 w=107 h=30 checked=1'
expect "plain: Orders is no longer CHECKED" plain-returns 'report wh_t2: hidden=0 x=106 y=32 w=107 h=30 checked=0'
expect "plain: the Returns panel appears at the same place" plain-returns 'report wh_p3: hidden=0 x=0 y=70 w=320 h=28'
expect "plain: the Orders panel goes away" plain-returns 'report wh_p2: hidden=1 '
expect "the Material UI tabs are not touched by a tap on the plain ones" plain-returns "subject $S2 = 1"

expect "plain: tapping the first tab (Stock) stores 0" plain-stock "subject $S1 = 0"
expect "plain: Stock is CHECKED and its panel shown" plain-stock 'report wh_p1: hidden=0 x=0 y=70 w=320 h=28'
expect "plain: Returns is no longer CHECKED" plain-stock 'report wh_t3: hidden=0 x=213 y=32 w=107 h=30 checked=0'
expect "plain: Returns panel hidden again" plain-stock 'report wh_p3: hidden=1 '
expect "plain: tapping the open tab changes nothing" plain-stock-again "subject $S1 = 0"
expect "plain: the open tab stays CHECKED after tapping it again" plain-stock-again 'report wh_t1: hidden=0 x=0 y=32 w=106 h=30 checked=1'

expect "Material UI: tapping Overview stores 0" mui-overview "subject $S2 = 0"
expect "Material UI: Overview is CHECKED" mui-overview 'report mui_tab_0: hidden=0 x=0 y=146 w=106 h=36 checked=1'
expect "Material UI: Settings is no longer CHECKED" mui-overview 'report mui_tab_1: hidden=0 x=106 y=146 w=107 h=36 checked=0'
expect "Material UI: the Overview panel is shown where Settings was" mui-overview 'report mui_tabpanel_0: hidden=0 x=0 y=182 w=320 h=30'
expect "Material UI: the Settings panel is hidden" mui-overview 'report mui_tabpanel_1: hidden=1 '
expect "the plain tabs keep their own state" mui-overview "subject $S1 = 0"
expect "Material UI: tapping Billing (the last tab) stores 2" mui-billing "subject $S2 = 2"
expect "Material UI: Billing is CHECKED and Overview is not" mui-billing 'report mui_tab_2: hidden=0 x=213 y=146 w=107 h=36 checked=1'
expect "Material UI: the Billing panel is shown" mui-billing 'report mui_tabpanel_2: hidden=0 x=0 y=182 w=320 h=30'
shot appbar_tabs_a_initial; shot appbar_tabs_b_plain_returns; shot appbar_tabs_c_mui_overview; shot appbar_tabs_d_mui_billing

echo "Tabs in a fixed app bar ($TARGET): real Material UI, icon tabs, Nearby open"
# Children of the root: 0 page box (0.0 spacer toolbar, 0.1 spacer, 0.2..0.4 panels,
# 0.5 the fixed app bar, last because it is pinned; 0.5.1.0.0.x its tabs).
SM=tabs_appbar_mui_appbar_tabs_selected
drive tabs-appbar-mui \
  --name=appbar=0.5 --name=contacts_tab_0=0.5.1.0.0.0 --name=contacts_tab_1=0.5.1.0.0.1 --name=contacts_tab_2=0.5.1.0.0.2 \
  --name=contacts_panel_0=0.2 --name=contacts_panel_1=0.3 --name=contacts_panel_2=0.4 \
  --say=initial --subject=$SM --report=appbar --report=contacts_tab_0 --report=contacts_tab_1 --report=contacts_tab_2 --report=contacts_panel_0 --report=contacts_panel_1 --report=contacts_panel_2 \
  --snap=$OUT/appbar_tabs_e_fixed_initial.bmp \
  --click=50,84 --say=recents --subject=$SM --report=appbar --report=contacts_tab_0 --report=contacts_tab_2 --report=contacts_panel_0 --report=contacts_panel_2 \
  --snap=$OUT/appbar_tabs_f_fixed_recents.bmp \
  --click=160,84 --say=favorites --subject=$SM --report=appbar --report=contacts_tab_1 --report=contacts_tab_0 --report=contacts_panel_1 --report=contacts_panel_0 > "$LOG"
sed 's/^/    /' "$LOG"

expect "fixed: the Mui-selected tab (Nearby) is open at the start (subject 2)" initial "subject $SM = 2"
expect "fixed: Nearby is CHECKED" initial 'report contacts_tab_2: hidden=0 x=213 y=48 w=107 h=72 checked=1'
expect "fixed: only the Nearby panel is shown, below the bar" initial 'report contacts_panel_2: hidden=0 x=0 y=120 w=320 h=52'
expect "fixed: the app bar covers the top 120 px" initial 'report appbar: hidden=0 x=0 y=0 w=320 h=120'
expect "fixed: tapping Recents stores 0" recents "subject $SM = 0"
expect "fixed: Recents is CHECKED, Nearby is not" recents 'report contacts_tab_0: hidden=0 x=0 y=48 w=106 h=72 checked=1'
expect "fixed: the Recents panel appears at the Nearby panel's place" recents 'report contacts_panel_0: hidden=0 x=0 y=120 w=320 h=52'
expect "fixed: the Nearby panel is hidden" recents 'report contacts_panel_2: hidden=1 '
expect "fixed: the bar did not move" recents 'report appbar: hidden=0 x=0 y=0 w=320 h=120'
expect "fixed: tapping Favorites stores 1 and shows its panel" favorites 'report contacts_panel_1: hidden=0 x=0 y=120 w=320 h=52'
expect "fixed: the Recents panel is hidden again" favorites 'report contacts_panel_0: hidden=1 '
shot appbar_tabs_e_fixed_initial; shot appbar_tabs_f_fixed_recents

rm -f "$LOG"
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Generated tabs in an app bar pass against LVGL ($TARGET)"
