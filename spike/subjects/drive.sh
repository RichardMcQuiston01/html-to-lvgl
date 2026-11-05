# Sourced by run-accordion.sh and run-components.sh (Phase 8 lane F).
#
# One scenario, four targets: the same click script and the same assertions run
# against the converter's XML output (the scripted XML driver) and against its
# generated C, C++ (driver_c.c linked with ui_<screen>.c / .cpp) and MicroPython
# (../micropython/driver_py.py importing ui_<screen>.py). Pick the target with
# TARGET=xml (default), c, cpp or py. The caller sets G (golden dir).
#
#   xml      needs DRIVER (default ./build/driver)
#   c, cpp   need LVGL_DIR (LVGL v9.4 source) and LIB_DIR (built liblvgl.a)
#   py       needs MP (the lv_micropython unix binary)
#
# drive <screen> <driver steps...>
#   --name=<alias>=<child path> steps name a widget for the C driver, which has
#   no widget names; the XML driver ignores them. A step list therefore reads
#   the same for every target and prints the same "report <alias>: ..." lines.
TARGET="${TARGET:-xml}"
DRIVER="${DRIVER:-./build/driver}"
DRIVE_TMP="$(mktemp -d)"
trap 'rm -rf "$DRIVE_TMP"' EXIT

drive() {
  local screen=$1; shift
  if [ "$TARGET" = xml ]; then
    "$DRIVER" --globals="$G/$screen.globals.xml" --screen="$screen" "$G/$screen.xml" "$@"
    return
  fi
  local unit=ui_${screen//-/_}
  if [ "$TARGET" = py ]; then
    MICROPYPATH="$G" "${MP:?set MP to the lv_micropython unix binary}" ../micropython/driver_py.py "$unit" "${unit}_create" "$@"
    return
  fi
  local bin="$DRIVE_TMP/${unit}_$TARGET"
  if [ ! -x "$bin" ]; then
    local root; root=$(cd "$G/../.." && pwd)
    local conf=(-DLV_CONF_PATH="\"$root/spike/render/lv_conf.h\"" -I "${LVGL_DIR:?set LVGL_DIR}" -I "$G")
    local libs=("${LIB_DIR:?set LIB_DIR}/liblvgl.a" "$LIB_DIR/liblvgl_thorvg.a" -lm -lpthread)
    if [ "$TARGET" = c ]; then
      gcc -O1 "${conf[@]}" -DUI_CREATE_SYMBOL="${unit}_create" driver_c.c "$G/$unit.c" "${libs[@]}" -o "$bin"
    else
      g++ -std=c++17 -O1 "${conf[@]}" -DUI_CREATE_SYMBOL="${unit}_create" -x c++ driver_c.c -x none "$G/$unit.cpp" "${libs[@]}" -o "$bin"
    fi
  fi
  "$bin" "$@"
}
