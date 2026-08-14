/**
 * Minimal LVGL configuration for the Phase 0 spike headless renderer.
 * Anything not defined here falls back to lv_conf_internal.h defaults.
 * Targets LVGL v9.4.0 (the last release with the in-tree lv_xml runtime).
 */
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH 32

/* The whole point of the spike: load UIs from XML at runtime */
#define LV_USE_XML 1
#define LV_USE_OBJ_NAME 1

/* Font sizes the HTML converter can map CSS font-size onto */
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_18 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_22 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_MONTSERRAT_36 1
#define LV_FONT_MONTSERRAT_40 1
#define LV_FONT_MONTSERRAT_48 1

#endif /* LV_CONF_H */
