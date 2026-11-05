/**
 * Headless renderer for html2lvgl's generated C/C++ output (--format c/cpp).
 *
 * Links against one generated ui_<name> unit (fixed symbol ui_create),
 * renders it on a virtual 320x240 display, and writes the framebuffer as
 * BMP — the C-output counterpart of main.c's XML path, used by CI to prove
 * the generated code compiles and runs against plain LVGL.
 *
 * Dual-mode on purpose: this file compiles unchanged with either a C or a
 * C++ compiler (gcc or g++), so the same harness proves both --format c and
 * --format cpp output link correctly — including against the C-compiled
 * font files that a C++ build must reference with correct ("C") linkage.
 *
 * Usage: render_c <out.bmp>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "lvgl.h"

/* Single-page output exports ui_create; each screen of a multi-screen UI
 * exports ui_<screen>_create, so the entry point is selectable at build time:
 *   gcc -DUI_CREATE_SYMBOL=ui_home_create ... */
#ifndef UI_CREATE_SYMBOL
#define UI_CREATE_SYMBOL ui_create
#endif

#ifdef __cplusplus
extern "C"
#endif
lv_obj_t * UI_CREATE_SYMBOL(lv_obj_t * parent);

#define HOR_RES 320
#define VER_RES 240

static uint8_t framebuffer[HOR_RES * VER_RES * 4];

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    LV_UNUSED(area);
    LV_UNUSED(px_map);
    lv_display_flush_ready(disp);
}

static int write_bmp(const char * path)
{
    FILE * f = fopen(path, "wb");
    if(!f) return -1;

    const int row_bytes = ((HOR_RES * 3 + 3) / 4) * 4;
    const uint32_t image_size = (uint32_t)(row_bytes * VER_RES);
    const uint32_t file_size = 54 + image_size;

    uint8_t header[54] = {0};
    header[0] = 'B'; header[1] = 'M';
    memcpy(header + 2, &file_size, 4);
    uint32_t offset = 54;         memcpy(header + 10, &offset, 4);
    uint32_t dib = 40;            memcpy(header + 14, &dib, 4);
    int32_t w = HOR_RES;          memcpy(header + 18, &w, 4);
    int32_t h = VER_RES;          memcpy(header + 22, &h, 4);
    uint16_t planes = 1;          memcpy(header + 26, &planes, 2);
    uint16_t bpp = 24;            memcpy(header + 28, &bpp, 2);
    memcpy(header + 34, &image_size, 4);
    if(fwrite(header, 1, 54, f) != 54) { fclose(f); return -1; }

    uint8_t * row = (uint8_t *)malloc((size_t)row_bytes);
    if(!row) { fclose(f); return -1; }
    memset(row, 0, (size_t)row_bytes);
    for(int y = VER_RES - 1; y >= 0; y--) {
        const uint8_t * src = &framebuffer[y * HOR_RES * 4];
        for(int x = 0; x < HOR_RES; x++) {
            row[x * 3 + 0] = src[x * 4 + 0];
            row[x * 3 + 1] = src[x * 4 + 1];
            row[x * 3 + 2] = src[x * 4 + 2];
        }
        if(fwrite(row, 1, (size_t)row_bytes, f) != (size_t)row_bytes) {
            free(row);
            fclose(f);
            return -1;
        }
    }
    free(row);
    return fclose(f) == 0 ? 0 : -1;
}

/* LVGL's built-in heap (LV_MEM_SIZE in lv_conf.h) is fixed. When it runs
 * out, lv_malloc() logs this line and returns NULL, and the caller then
 * dereferences it: a bare segfault. Exiting here, before that happens, tells
 * the user what to change. Only this message is acted on; LVGL's other log
 * output is dropped to keep the harness quiet. */
static char last_error[256];

static void log_cb(lv_log_level_t level, const char * buf)
{
    if(level >= LV_LOG_LEVEL_ERROR) {
        strncpy(last_error, buf, sizeof(last_error) - 1);
    }
    if(strstr(buf, "couldn't allocate memory") == NULL) return;
    fprintf(stderr,
            "error: LVGL ran out of memory (LV_MEM_SIZE is %d bytes): %s\n"
            "       The page has more widgets, styles or text than the harness heap holds.\n"
            "       Raise LV_MEM_SIZE in spike/render/lv_conf.h and rebuild, or split the page.\n",
            (int)LV_MEM_SIZE, buf);
    exit(2);
}

/* A failed load or create can also be a quiet out-of-memory (LVGL paths that
 * return NULL without logging). Report the heap level so the cause is clear. */
static void print_heap_hint(void)
{
    lv_mem_monitor_t mon;
    lv_mem_monitor(&mon);
    if(mon.used_pct >= 60 || mon.free_biggest_size < 1024) {
        fprintf(stderr,
                "       The LVGL heap is %d%% used (LV_MEM_SIZE is %d bytes), so this is probably out of memory.\n"
                "       Raise LV_MEM_SIZE in spike/render/lv_conf.h and rebuild, or split the page.\n",
                (int)mon.used_pct, (int)LV_MEM_SIZE);
    }
}

/* Called by LV_ASSERT_HANDLER: a failed allocation assert reaches here when
 * the heap ran out in a path that did not log first. */
void harness_assert_failed(void)
{
    fprintf(stderr,
            "error: LVGL assertion failed (most often the heap is full: LV_MEM_SIZE is %d bytes): %s\n"
            "       Raise LV_MEM_SIZE in spike/render/lv_conf.h and rebuild, or split the page.\n",
            (int)LV_MEM_SIZE, last_error[0] ? last_error : "no details logged");
    exit(2);
}

int main(int argc, char ** argv)
{
    if(argc < 2) {
        fprintf(stderr, "usage: %s <out.bmp>\n", argv[0]);
        return 1;
    }

    lv_log_register_print_cb(log_cb);
    lv_init();

    lv_display_t * disp = lv_display_create(HOR_RES, VER_RES);
    lv_display_set_buffers(disp, framebuffer, NULL, sizeof(framebuffer),
                           LV_DISPLAY_RENDER_MODE_DIRECT);
    lv_display_set_flush_cb(disp, flush_cb);

    lv_obj_t * page = UI_CREATE_SYMBOL(lv_screen_active());
    if(page == NULL) {
        fprintf(stderr, "ui_create failed\n");
        print_heap_hint();
        return 1;
    }
    lv_obj_set_pos(page, 0, 0);

    for(int i = 0; i < 30; i++) {
        lv_tick_inc(16);
        lv_timer_handler();
    }

    if(write_bmp(argv[1]) != 0) {
        fprintf(stderr, "cannot write %s\n", argv[1]);
        return 1;
    }
    printf("rendered generated C -> %s\n", argv[1]);
    return 0;
}
