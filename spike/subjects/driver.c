/**
 * Phase 5 lane D spike: scripted LVGL XML driver.
 *
 * Unlike spike/render (one render, optional synthetic CLICKED event), this
 * drives a virtual pointer input device, so clicks go through LVGL's real
 * hit-testing (z-order, floating, clickable, hidden). That is what the modal
 * "blocks clicks beneath" question needs.
 *
 * usage: driver --globals=globals.xml --screen=<name> [component.xml ...]
 *               [--click=X,Y | --snap=out.bmp | --report=<widget-name> |
 *                --subject=<name> | --say=<text>] ...
 *
 * Positional args are XML components, registered under their file basename.
 * The --click/--snap/--report/--subject/--say steps run in command-line order.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include "lvgl.h"

#define HOR_RES 320
#define VER_RES 240

static uint8_t framebuffer[HOR_RES * VER_RES * 4];
static int ptr_x, ptr_y;
static bool ptr_down;

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    LV_UNUSED(area); LV_UNUSED(px_map);
    lv_display_flush_ready(disp);
}

static void pointer_read_cb(lv_indev_t * indev, lv_indev_data_t * data)
{
    LV_UNUSED(indev);
    data->point.x = ptr_x;
    data->point.y = ptr_y;
    data->state = ptr_down ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

static char * read_file(const char * path)
{
    FILE * f = fopen(path, "rb");
    if(!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char * buf = malloc((size_t)len + 1);
    if(!buf || fread(buf, 1, (size_t)len, f) != (size_t)len) { fclose(f); free(buf); return NULL; }
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
    uint32_t offset = 54;  memcpy(header + 10, &offset, 4);
    uint32_t dib = 40;     memcpy(header + 14, &dib, 4);
    int32_t w = HOR_RES;   memcpy(header + 18, &w, 4);
    int32_t h = VER_RES;   memcpy(header + 22, &h, 4);
    uint16_t planes = 1;   memcpy(header + 26, &planes, 2);
    uint16_t bpp = 24;     memcpy(header + 28, &bpp, 2);
    memcpy(header + 34, &image_size, 4);
    fwrite(header, 1, 54, f);
    uint8_t * row = calloc(1, (size_t)row_bytes);
    for(int y = VER_RES - 1; y >= 0; y--) {
        const uint8_t * src = &framebuffer[y * HOR_RES * 4];
        for(int x = 0; x < HOR_RES; x++) {
            row[x * 3 + 0] = src[x * 4 + 0];
            row[x * 3 + 1] = src[x * 4 + 1];
            row[x * 3 + 2] = src[x * 4 + 2];
        }
        fwrite(row, 1, (size_t)row_bytes, f);
    }
    free(row);
    return fclose(f);
}

static bool is_screen_root(const char * xml)
{
    for(const char * p = xml; *p; p++) {
        if(*p != '<' || p[1] == '?' || p[1] == '!') continue;
        return strncmp(p + 1, "screen", 6) == 0 && (p[7] == '>' || p[7] == ' ' || p[7] == '\n');
    }
    return false;
}

static void base_name(const char * path, char * out, size_t n)
{
    const char * b = strrchr(path, '/');
    b = b ? b + 1 : path;
    size_t i;
    for(i = 0; i + 1 < n && b[i] && b[i] != '.'; i++) out[i] = b[i];
    out[i] = '\0';
}

/** Print every widget called `name` (names repeat across component instances). */
static int report_all(lv_obj_t * parent, const char * name)
{
    int found = 0;
    uint32_t count = lv_obj_get_child_count(parent);
    for(uint32_t i = 0; i < count; i++) {
        lv_obj_t * c = lv_obj_get_child(parent, i);
        const char * cn = lv_obj_get_name(c);
        if(cn && strcmp(cn, name) == 0) {
            lv_area_t a;
            lv_obj_get_coords(c, &a);
            printf("report %s: hidden=%d x=%d y=%d w=%d h=%d\n", name,
                   lv_obj_has_flag(c, LV_OBJ_FLAG_HIDDEN) ? 1 : 0,
                   (int)a.x1, (int)a.y1, (int)lv_area_get_width(&a), (int)lv_area_get_height(&a));
            found++;
        }
        found += report_all(c, name);
    }
    return found;
}

static void pump(int frames)
{
    for(int i = 0; i < frames; i++) { lv_tick_inc(16); lv_timer_handler(); }
}

static void click_at(int x, int y)
{
    ptr_x = x; ptr_y = y;
    ptr_down = true;  pump(4);
    ptr_down = false; pump(30);   /* 30 frames (~480 ms) also lets short anims finish */
}

int main(int argc, char ** argv)
{
    const char * globals_path = NULL;
    const char * screen_name = NULL;
    for(int i = 1; i < argc; i++) {
        if(strncmp(argv[i], "--globals=", 10) == 0) globals_path = argv[i] + 10;
        else if(strncmp(argv[i], "--screen=", 9) == 0) screen_name = argv[i] + 9;
    }
    if(!screen_name) { fprintf(stderr, "need --screen=<name>\n"); return 1; }

    lv_init();
    lv_display_t * disp = lv_display_create(HOR_RES, VER_RES);
    lv_display_set_buffers(disp, framebuffer, NULL, sizeof(framebuffer), LV_DISPLAY_RENDER_MODE_DIRECT);
    lv_display_set_flush_cb(disp, flush_cb);

    lv_indev_t * indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, pointer_read_cb);

    lv_xml_init();
    lv_xml_register_font(NULL, "montserrat_12", &lv_font_montserrat_12);
    lv_xml_register_font(NULL, "montserrat_14", &lv_font_montserrat_14);

    if(globals_path) {
        char * g = read_file(globals_path);
        if(!g) { fprintf(stderr, "cannot read %s\n", globals_path); return 1; }
        if(lv_xml_register_component_from_data("globals", g) != LV_RESULT_OK) {
            fprintf(stderr, "failed to register globals from %s\n", globals_path);
            return 1;
        }
        free(g);
    }

    bool screen_root = false;
    for(int i = 1; i < argc; i++) {
        if(strncmp(argv[i], "--", 2) == 0) continue;
        char * x = read_file(argv[i]);
        if(!x) { fprintf(stderr, "cannot read %s\n", argv[i]); return 1; }
        char name[128];
        base_name(argv[i], name, sizeof(name));
        if(lv_xml_register_component_from_data(name, x) != LV_RESULT_OK) {
            fprintf(stderr, "failed to register %s\n", argv[i]);
            return 1;
        }
        if(strcmp(name, screen_name) == 0) screen_root = is_screen_root(x);
        free(x);
    }

    lv_obj_t * page;
    if(screen_root) {
        page = lv_xml_create(NULL, screen_name, NULL);
        if(page) lv_screen_load(page);
    }
    else {
        page = lv_xml_create(lv_screen_active(), screen_name, NULL);
        if(page) lv_obj_set_pos(page, 0, 0);
    }
    if(!page) { fprintf(stderr, "failed to instantiate %s\n", screen_name); return 1; }
    pump(30);

    for(int i = 1; i < argc; i++) {
        const char * a = argv[i];
        if(strncmp(a, "--click=", 8) == 0) {
            int x, y;
            if(sscanf(a + 8, "%d,%d", &x, &y) != 2) { fprintf(stderr, "bad %s\n", a); return 1; }
            click_at(x, y);
            printf("click %d,%d\n", x, y);
        }
        else if(strncmp(a, "--tap=", 6) == 0) {
            /* press + release without the 30-frame settle, to catch animations mid-flight */
            int x, y;
            if(sscanf(a + 6, "%d,%d", &x, &y) != 2) { fprintf(stderr, "bad %s\n", a); return 1; }
            ptr_x = x; ptr_y = y;
            ptr_down = true;  pump(4);
            ptr_down = false; pump(1);
            printf("tap %d,%d\n", x, y);
        }
        else if(strncmp(a, "--frames=", 9) == 0) {
            pump(atoi(a + 9));   /* 16 ms per frame */
        }
        else if(strncmp(a, "--snap=", 7) == 0) {
            if(write_bmp(a + 7) != 0) { fprintf(stderr, "cannot write %s\n", a + 7); return 1; }
            printf("snap %s\n", a + 7);
        }
        else if(strncmp(a, "--report=", 9) == 0) {
            if(report_all(lv_screen_active(), a + 9) == 0) printf("report %s: NOT FOUND\n", a + 9);
        }
        else if(strncmp(a, "--subject=", 10) == 0) {
            /* "scope/name" looks the subject up in a component's own scope */
            const char * slash = strchr(a + 10, '/');
            lv_subject_t * s;
            if(slash) {
                char scope_name[128];
                lv_strlcpy(scope_name, a + 10, sizeof(scope_name));
                scope_name[slash - (a + 10)] = '\0';
                s = lv_xml_get_subject(lv_xml_component_get_scope(scope_name), slash + 1);
            }
            else s = lv_xml_get_subject(NULL, a + 10);
            if(!s) printf("subject %s: NOT FOUND\n", a + 10);
            else printf("subject %s = %d\n", a + 10, (int)lv_subject_get_int(s));
        }
        else if(strncmp(a, "--say=", 6) == 0) {
            printf("-- %s\n", a + 6);
        }
    }
    return 0;
}
