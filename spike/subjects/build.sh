#!/usr/bin/env bash
# Build the scripted driver against an LVGL v9.4.0 checkout.
#   LVGL_DIR   defaults to ../render/lvgl (git clone --depth 1 --branch v9.4.0 https://github.com/lvgl/lvgl.git)
#   BUILD_DIR  defaults to ./build
set -euo pipefail
cd "$(dirname "$0")"
LVGL_DIR="${LVGL_DIR:-$PWD/../render/lvgl}"
BUILD_DIR="${BUILD_DIR:-$PWD/build}"
cmake -S . -B "$BUILD_DIR" -DLVGL_DIR="$LVGL_DIR" -DCMAKE_BUILD_TYPE=Release > /dev/null
cmake --build "$BUILD_DIR" -j"$(nproc)"
