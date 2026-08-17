#!/usr/bin/env bash
# Phase 0 spike — full pipeline for all sample pages.
#
# Prerequisites:
#   1. npm install                       (in this directory; installs Playwright)
#   2. git clone --depth 1 --branch v9.4.0 https://github.com/lvgl/lvgl.git render/lvgl
#   3. cmake -S render -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j
#
# Then: ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

RENDER="${RENDER:-./build/render}"

for page in thermostat login settings; do
  node extract.mjs "samples/$page.html" "out/$page.json" "out/${page}_web.png"
  node convert.mjs "out/$page.json" "out/$page.xml"
  "$RENDER" "out/$page.xml" "out/${page}_lvgl.bmp"
  node bmp2png.mjs "out/${page}_lvgl.bmp" "out/${page}_lvgl.png"
  rm "out/${page}_lvgl.bmp"
done

echo "Done. Compare out/<page>_web.png (Chromium) with out/<page>_lvgl.png (LVGL)."
