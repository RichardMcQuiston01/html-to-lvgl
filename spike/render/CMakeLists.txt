cmake_minimum_required(VERSION 3.13)
project(spike_render C)

# Path to an LVGL v9.4.0 checkout (the last release with the in-tree lv_xml
# runtime). Override with -DLVGL_DIR=/path/to/lvgl.
set(LVGL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/lvgl" CACHE PATH "LVGL source directory (v9.4.0)")

set(LV_BUILD_CONF_PATH "${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h" CACHE PATH "" FORCE)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

add_subdirectory(${LVGL_DIR} lvgl)

add_executable(render main.c)
target_link_libraries(render PRIVATE lvgl m)
