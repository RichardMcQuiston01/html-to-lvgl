cmake_minimum_required(VERSION 3.13)
project(subjects_driver C)

# Same LVGL v9.4.0 checkout and lv_conf.h as spike/render.
set(LVGL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../render/lvgl" CACHE PATH "LVGL source directory (v9.4.0)")
set(LV_BUILD_CONF_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../render/lv_conf.h" CACHE PATH "" FORCE)
set(CONFIG_LV_BUILD_DEMOS OFF CACHE BOOL "" FORCE)
set(CONFIG_LV_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

add_subdirectory(${LVGL_DIR} lvgl)

add_executable(driver driver.c)
target_link_libraries(driver PRIVATE lvgl m)
