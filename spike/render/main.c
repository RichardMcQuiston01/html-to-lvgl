/**
 * Phase 0 spike — step 3: headless LVGL renderer.
 *
 * Loads an LVGL XML component file (produced by convert.mjs), instantiates it
 * on a virtual 320x240 display, renders a few frames in memory, and writes the
 * framebuffer out as a 24-bit BMP for visual comparison with the Chromium
 * screenshot of the source HTML page.
 *
 * Usage: render <page.xml> <out.bmp>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include "lvgl.h"

#define HOR_RES 320
#define VER_RES 240

/* ARGB8888 framebuffer; in LVGL's memory layout each pixel is B,G,R,A */
static uint8_t framebuffer[HOR_RES * VER_RES * 4];

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    /* RENDER_MODE_DIRECT: LVGL renders straight into `framebuffer` */
    LV_UNUSED(area);
    LV_UNUSED(px_map);
    lv_display_flush_ready(disp);
}

static char * read_file(const char * path)
{
    FILE * f = fopen(path, "rb");
    if(!f) return NULL;
    if(fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long len = ftell(f);
    if(len < 0) { fclose(f); return NULL; }
    if(fseek(f, 0, SEEK_SET) != 0) { fclose(f); return NULL; }
    char * buf = malloc((size_t)len + 1);
    if(!buf) { fclose(f); return NULL; }
    if(fread(buf, 1, (size_t)len, f) != (size_t)len) { fclose(f); free(buf); return NULL; }
    buf[len] = '\0';
    fclose(f);
    return buf;
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

    uint8_t * row = malloc((size_t)row_bytes);
    if(!row) { fclose(f); return -1; }
    memset(row, 0, (size_t)row_bytes);
    for(int y = VER_RES - 1; y >= 0; y--) {   /* BMP rows are bottom-up */
        const uint8_t * src = &framebuffer[y * HOR_RES * 4];
        for(int x = 0; x < HOR_RES; x++) {
            row[x * 3 + 0] = src[x * 4 + 0];  /* B */
            row[x * 3 + 1] = src[x * 4 + 1];  /* G */
            row[x * 3 + 2] = src[x * 4 + 2];  /* R */
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

/** True when the document's root element is <screen> rather than <component>. */
static bool is_screen_root(const char * xml)
{
    for(const char * p = xml; *p; p++) {
        if(*p != '<') continue;
        if(p[1] == '?' || p[1] == '!') continue;   /* declaration or comment */
        return strncmp(p + 1, "screen", 6) == 0 && (p[7] == '>' || p[7] == ' ' || p[7] == '\n');
    }
    return false;
}

/** "path/to/stat_card.xml" -> "stat_card" (caller-owned buffer) */
static void component_name_from_path(const char * path, char * out, size_t out_size)
{
    const char * base = strrchr(path, '/');
    base = base ? base + 1 : path;
    size_t i;
    for(i = 0; i + 1 < out_size && base[i] != '\0' && base[i] != '.'; i++) out[i] = base[i];
    out[i] = '\0';
}

/** Depth-first search for a widget by its `name` attribute. */
static lv_obj_t * find_by_name(lv_obj_t * parent, const char * name)
{
    uint32_t count = lv_obj_get_child_count(parent);
    for(uint32_t i = 0; i < count; i++) {
        lv_obj_t * child = lv_obj_get_child(parent, i);
        const char * child_name = lv_obj_get_name(child);
        if(child_name && strcmp(child_name, name) == 0) return child;
        lv_obj_t * found = find_by_name(child, name);
        if(found) return found;
    }
    return NULL;
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
    if(argc < 3) {
        fprintf(stderr,
                "usage: %s <page.xml> <out.bmp> [--click=<widget-name>]\n"
                "          [--font=<name>=<path.bin>] [component.xml ...]\n",
                argv[0]);
        return 1;
    }

    /* --click=<name> sends LV_EVENT_CLICKED to that widget before capturing,
     * which is how screen navigation gets exercised without an input device. */
    const char * click_name = NULL;
    for(int i = 3; i < argc; i++) {
        if(strncmp(argv[i], "--click=", 8) == 0) click_name = argv[i] + 8;
    }

    char * xml = read_file(argv[1]);
    if(!xml) {
        fprintf(stderr, "cannot read %s\n", argv[1]);
        return 1;
    }

    lv_log_register_print_cb(log_cb);
    lv_init();

    lv_display_t * disp = lv_display_create(HOR_RES, VER_RES);
    lv_display_set_buffers(disp, framebuffer, NULL, sizeof(framebuffer),
                           LV_DISPLAY_RENDER_MODE_DIRECT);
    lv_display_set_flush_cb(disp, flush_cb);

    lv_xml_init();

    /* Fonts the converter's nearest-size mapping can reference by name */
    lv_xml_register_font(NULL, "montserrat_10", &lv_font_montserrat_10);
    lv_xml_register_font(NULL, "montserrat_12", &lv_font_montserrat_12);
    lv_xml_register_font(NULL, "montserrat_14", &lv_font_montserrat_14);
    lv_xml_register_font(NULL, "montserrat_16", &lv_font_montserrat_16);
    lv_xml_register_font(NULL, "montserrat_18", &lv_font_montserrat_18);
    lv_xml_register_font(NULL, "montserrat_20", &lv_font_montserrat_20);
    lv_xml_register_font(NULL, "montserrat_22", &lv_font_montserrat_22);
    lv_xml_register_font(NULL, "montserrat_24", &lv_font_montserrat_24);
    lv_xml_register_font(NULL, "montserrat_28", &lv_font_montserrat_28);
    lv_xml_register_font(NULL, "montserrat_32", &lv_font_montserrat_32);
    lv_xml_register_font(NULL, "montserrat_36", &lv_font_montserrat_36);
    lv_xml_register_font(NULL, "montserrat_40", &lv_font_montserrat_40);
    lv_xml_register_font(NULL, "montserrat_48", &lv_font_montserrat_48);

    /* Converted fonts, loaded from disk. The POSIX driver is mounted on 'A',
     * so an absolute path becomes "A:/abs/path.bin". Registered directly from
     * argv (no intermediate buffer), so any number of --font= args works. */
    for(int i = 3; i < argc; i++) {
        if(strncmp(argv[i], "--font=", 7) != 0) continue;
        char spec[512];
        lv_strlcpy(spec, argv[i] + 7, sizeof(spec));
        char * eq = strchr(spec, '=');
        if(eq == NULL) {
            fprintf(stderr, "expected --font=<name>=<path.bin>, got `%s`\n", argv[i] + 7);
            return 1;
        }
        *eq = '\0';

        char fs_path[512];
        snprintf(fs_path, sizeof(fs_path), "A:%s", eq + 1);
        lv_font_t * font = lv_binfont_create(fs_path);
        if(font == NULL) {
            fprintf(stderr, "cannot load font `%s` from %s\n", spec, eq + 1);
            return 1;
        }
        lv_xml_register_font(NULL, spec, font);
    }

    /* Register dependency components first (e.g. the componentizer's output) */
    for(int i = 3; i < argc; i++) {
        if(strncmp(argv[i], "--", 2) == 0) continue;
        char * comp_xml = read_file(argv[i]);
        if(!comp_xml) {
            fprintf(stderr, "cannot read %s\n", argv[i]);
            return 1;
        }
        char comp_name[128];
        component_name_from_path(argv[i], comp_name, sizeof(comp_name));
        if(lv_xml_register_component_from_data(comp_name, comp_xml) != LV_RESULT_OK) {
            fprintf(stderr, "failed to register XML component %s from %s\n", comp_name, argv[i]);
            print_heap_hint();
            return 1;
        }
        free(comp_xml);
    }

    /* Register under the file's own basename so sibling screens referenced by
     * <screen_create_event screen="..."/> resolve by name. */
    char page_name[128];
    component_name_from_path(argv[1], page_name, sizeof(page_name));
    if(lv_xml_register_component_from_data(page_name, xml) != LV_RESULT_OK) {
        fprintf(stderr, "failed to register XML component from %s\n", argv[1]);
        print_heap_hint();
        return 1;
    }
    const bool screen_root = is_screen_root(xml);
    free(xml);

    lv_obj_t * page;
    if(screen_root) {
        /* Screens are their own root object and must be loaded, not parented */
        page = lv_xml_create(NULL, page_name, NULL);
        if(page) lv_screen_load(page);
    }
    else {
        page = lv_xml_create(lv_screen_active(), page_name, NULL);
        if(page) lv_obj_set_pos(page, 0, 0);
    }
    if(page == NULL) {
        fprintf(stderr, "failed to instantiate XML component\n");
        print_heap_hint();
        return 1;
    }

    /* Advance a few frames so layout + rendering settle */
    for(int i = 0; i < 30; i++) {
        lv_tick_inc(16);
        lv_timer_handler();
    }

    if(click_name) {
        lv_obj_t * target = find_by_name(lv_screen_active(), click_name);
        if(target == NULL) {
            fprintf(stderr, "no widget named `%s` to click\n", click_name);
            return 1;
        }
        lv_obj_send_event(target, LV_EVENT_CLICKED, NULL);
        for(int i = 0; i < 30; i++) {
            lv_tick_inc(16);
            lv_timer_handler();
        }
        printf("clicked `%s` -> active screen is `%s`\n",
               click_name, lv_obj_get_name(lv_screen_active()));
    }

    if(write_bmp(argv[2]) != 0) {
        fprintf(stderr, "cannot write %s\n", argv[2]);
        return 1;
    }
    printf("rendered %s -> %s\n", argv[1], argv[2]);
    return 0;
}
