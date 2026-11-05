#!/usr/bin/env bash
# Click-driven check of the Accordion component in real LVGL v9.4.0.
#
# Drives tests/golden-behavior/accordion.xml and accordion.globals.xml, made by
# the shipped accordion definition (src/components/accordion.mjs) from
# tests/fixtures-behavior/accordion.json (examples/components/accordion.html:
# two plain ARIA items, one collapsed and one open, then two Material UI items,
# one collapsed and one open). It proves, on the emitted XML itself:
#   - the initial state follows aria-expanded (subject 0 or 1),
#   - a header click opens a collapsed body and everything below it moves down,
#   - a second click closes it and everything moves back,
#   - items toggle independently (not exclusive), in both styles.
#
#   DRIVER=path/to/driver ./run-accordion.sh      (default: ./build/driver)
set -euo pipefail
cd "$(dirname "$0")"

DRIVER="${DRIVER:-./build/driver}"
G=../../tests/golden-behavior
OUT=out
mkdir -p "$OUT"
LOG=$(mktemp)
fail=0

# Header hit points (x,y), from the page at rest: plain 1 header y 9..35,
# plain 2 header y 41..67, Material UI 1 header y 100..134, Material UI 2 header y 140..174 (164..198 once item 1 is open).
"$DRIVER" --globals=$G/accordion.globals.xml --screen=accordion $G/accordion.xml \
  --say=initial --subject=accordion_plain_p1_open --subject=accordion_plain_p2_open \
  --subject=accordion_mui1_content_open --subject=accordion_mui2_content_open \
  --report=accordion --report=accordion_2 --report=accordion_group --report=accordion_3 --report=accordion_4 \
  --snap=$OUT/accordion_a_initial.bmp \
  --click=100,20 --say=plain-1-opened --subject=accordion_plain_p1_open --subject=accordion_plain_p2_open \
  --report=accordion --report=accordion_2 --report=accordion_group --report=accordion_3 \
  --snap=$OUT/accordion_b_plain1_open.bmp \
  --click=100,20 --say=plain-1-closed --subject=accordion_plain_p1_open \
  --report=accordion --report=accordion_2 --report=accordion_group \
  --click=100,54 --say=plain-2-closed --subject=accordion_plain_p1_open --subject=accordion_plain_p2_open \
  --report=accordion_2 --report=accordion_group \
  --click=100,54 --say=plain-2-reopened --subject=accordion_plain_p2_open --report=accordion_group \
  --click=100,116 --say=mui-1-opened --subject=accordion_mui1_content_open --subject=accordion_mui2_content_open \
  --report=accordion_3 --report=accordion_4 \
  --snap=$OUT/accordion_c_mui1_open.bmp \
  --click=100,180 --say=mui-2-closed --subject=accordion_mui1_content_open --subject=accordion_mui2_content_open \
  --report=accordion_3 --report=accordion_4 \
  --click=100,116 --say=mui-1-closed --subject=accordion_mui1_content_open --report=accordion_3 \
  --snap=$OUT/accordion_d_mui_closed.bmp > "$LOG"
sed 's/^/    /' "$LOG"

# The lines printed after one --say marker, up to the next marker.
after() { sed -n "/^-- $1\$/,/^-- /p" "$LOG"; }
expect() { # label marker pattern
  if after "$2" | grep -Eq "$3"; then echo "  ok    $1"; else echo "  FAIL  $1  (after '$2' expected /$3/)"; fail=1; fi
}

expect "plain item 1 starts collapsed (aria-expanded=false -> 0)" initial 'subject accordion_plain_p1_open = 0'
expect "plain item 2 starts open (aria-expanded=true -> 1)" initial 'subject accordion_plain_p2_open = 1'
expect "Material UI item 1 starts collapsed" initial 'subject accordion_mui1_content_open = 0'
expect "Material UI item 2 starts open" initial 'subject accordion_mui2_content_open = 1'
expect "collapsed plain item is header height (28)" initial 'report accordion: hidden=0 x=8 y=8 w=304 h=28'
expect "open plain item sits below it (52)" initial 'report accordion_2: hidden=0 x=8 y=40 w=304 h=52'
expect "Material UI group starts below both plain items" initial 'report accordion_group: hidden=0 x=8 y=100 w=304 h=98'
expect "Material UI collapsed item is its header (34)" initial 'report accordion_3: hidden=0 x=8 y=100 w=304 h=34'
expect "Material UI open item is header plus body (58)" initial 'report accordion_4: hidden=0 x=8 y=140 w=304 h=58'

expect "header click opens the collapsed plain item" plain-1-opened 'subject accordion_plain_p1_open = 1'
expect "opening one item leaves the other alone (not exclusive)" plain-1-opened 'subject accordion_plain_p2_open = 1'
expect "the opened item grows to 52" plain-1-opened 'report accordion: hidden=0 x=8 y=8 w=304 h=52'
expect "the item below moves down 24" plain-1-opened 'report accordion_2: hidden=0 x=8 y=64 w=304 h=52'
expect "everything below (Material UI group) moves down 24" plain-1-opened 'report accordion_group: hidden=0 x=8 y=124 w=304 h=98'

expect "second click closes it" plain-1-closed 'subject accordion_plain_p1_open = 0'
expect "item shrinks back" plain-1-closed 'report accordion: hidden=0 x=8 y=8 w=304 h=28'
expect "the item below moves back up" plain-1-closed 'report accordion_2: hidden=0 x=8 y=40 w=304 h=52'
expect "Material UI group moves back" plain-1-closed 'report accordion_group: hidden=0 x=8 y=100 w=304 h=98'

expect "plain item 2 closes on its own" plain-2-closed 'subject accordion_plain_p2_open = 0'
expect "closing it leaves item 1 collapsed" plain-2-closed 'subject accordion_plain_p1_open = 0'
expect "item 2 shrinks to its header" plain-2-closed 'report accordion_2: hidden=0 x=8 y=40 w=304 h=28'
expect "the group moves up 24" plain-2-closed 'report accordion_group: hidden=0 x=8 y=76 w=304 h=98'
expect "reopening restores the layout" plain-2-reopened 'report accordion_group: hidden=0 x=8 y=100 w=304 h=98'

expect "Material UI header click opens its item" mui-1-opened 'subject accordion_mui1_content_open = 1'
expect "the Material UI item grows to 58" mui-1-opened 'report accordion_3: hidden=0 x=8 y=100 w=304 h=58'
expect "the next Material UI item moves down 24" mui-1-opened 'report accordion_4: hidden=0 x=8 y=164 w=304 h=58'
expect "Material UI items are independent: item 2 closes" mui-2-closed 'subject accordion_mui2_content_open = 0'
expect "closing item 2 does not touch item 1" mui-2-closed 'subject accordion_mui1_content_open = 1'
expect "item 2 shrinks to its header" mui-2-closed 'report accordion_4: hidden=0 x=8 y=164 w=304 h=34'
expect "item 1 closes again" mui-1-closed 'subject accordion_mui1_content_open = 0'
expect "item 1 is its header again" mui-1-closed 'report accordion_3: hidden=0 x=8 y=100 w=304 h=34'

for n in accordion_a_initial accordion_b_plain1_open accordion_c_mui1_open accordion_d_mui_closed; do
  python3 bmp2png.py "$OUT/$n.bmp" "$OUT/$n.png" 2
  rm -f "$OUT/$n.bmp"
done
rm -f "$LOG"
if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "Accordion passes against LVGL v9.4.0"
