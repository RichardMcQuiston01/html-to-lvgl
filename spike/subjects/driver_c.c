/**
 * Scripted driver for GENERATED C/C++ (html2lvgl --format c / cpp) that uses
 * subjects. The counterpart of driver.c, which loads XML; this one links a
 * generated unit (entry point UI_CREATE_SYMBOL) and drives a virtual pointer
 * through LVGL's real hit-testing.
 *
 * usage: driver_c [component.xml ...]
 *                 [--name=<alias>=<child path> | --click=X,Y | --tap=X,Y |
 *                  --frames=N | --report=<alias or child path> | --snap=<file> |
 *                  --subject=<name> | --say=<text>] ...
 *
 * Positional XML files are library components, registered under their file
 * basename (for ui_acc_g.xml-style instances created with lv_xml_create).
 * --subject reads the value through lv_xml_get_subject, so it also proves the
 * generated code registered the subject. Generated C has no widget names, so
 * --report addresses widgets by a path of child indexes from the root, "2" or
 * "1.0" (the second child of the root's second child). --name=<alias>=<path>
 * gives a path the name the XML driver (driver.c) would report, so one scenario
 * script can drive both and assert the same "report <name>: ..." lines; the
 * XML driver ignores --name. --tap, --frames and --say behave as in driver.c;
 * --snap is accepted and ignored (this driver keeps no screenshots). Steps run
 * in order.
 *
 * Compiles unchanged as C or C++ (gcc / g++).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include "lvgl.h"

#ifndef UI_CREATE_SYMBOL
#error "define UI_CREATE_SYMBOL, e.g. -DUI_CREATE_SYMBOL=ui_disclosure_create"
#endif
#ifdef __cplusplus
extern "C"
#endif
lv_obj_t * UI_CREATE_SYMBOL(lv_obj_t * parent);

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

/* Referenced by LV_ASSERT_HANDLER in ../render/lv_conf.h. */
void harness_assert_failed(void)
{
    fprintf(stderr, "error: LVGL assertion failed\n");
    exit(2);
}

static void pump(int frames)
{
    for(int i = 0; i < frames; i++) { lv_tick_inc(16); lv_timer_handler(); }
}

static void click_at(int x, int y)
{
    ptr_x = x; ptr_y = y;
    ptr_down = true;  pump(4);
    ptr_down = false; pump(30);
}

#define MAX_ALIASES 32
static struct { const char * name; const char * path; } aliases[MAX_ALIASES];
static int alias_count;

/* Walk a path such as "1.0" down from the root; NULL if a child is missing. */
static lv_obj_t * find_by_path(lv_obj_t * root, const char * path)
{
    lv_obj_t * o = root;
    while(o && *path) {
        char * end;
        long idx = strtol(path, &end, 10);
        if(end == path) return NULL;
        o = lv_obj_get_child(o, (int32_t)idx);
        path = (*end == '.') ? end + 1 : end;
    }
    return o;
}

static char * read_file(const char * path)
{
    FILE * f = fopen(path, "rb");
    if(!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char * buf = (char *)malloc((size_t)len + 1);
    if(!buf || fread(buf, 1, (size_t)len, f) != (size_t)len) { fclose(f); free(buf); return NULL; }
    buf[len] = '\0';
    fclose(f);
    return buf;
}

int main(int argc, char ** argv)
{
    lv_init();
    lv_display_t * disp = lv_display_create(HOR_RES, VER_RES);
    lv_display_set_buffers(disp, framebuffer, NULL, sizeof(framebuffer), LV_DISPLAY_RENDER_MODE_DIRECT);
    lv_display_set_flush_cb(disp, flush_cb);

    lv_indev_t * indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, pointer_read_cb);

    for(int i = 1; i < argc; i++) {
        if(strncmp(argv[i], "--", 2) == 0) continue;
        char * xml = read_file(argv[i]);
        if(!xml) { fprintf(stderr, "cannot read %s\n", argv[i]); return 1; }
        const char * base = strrchr(argv[i], '/');
        char name[128];
        snprintf(name, sizeof(name), "%s", base ? base + 1 : argv[i]);
        char * dot = strchr(name, '.');
        if(dot) *dot = '\0';
        if(lv_xml_register_component_from_data(name, xml) != LV_RESULT_OK) {
            fprintf(stderr, "failed to register %s\n", argv[i]);
            return 1;
        }
        free(xml);
    }

    for(int i = 1; i < argc; i++) {
        if(strncmp(argv[i], "--name=", 7) != 0 || alias_count >= MAX_ALIASES) continue;
        char * eq = strchr(argv[i] + 7, '=');
        if(!eq) { fprintf(stderr, "expected --name=<alias>=<path>, got %s\n", argv[i]); return 1; }
        *eq = '\0';
        aliases[alias_count].name = argv[i] + 7;
        aliases[alias_count].path = eq + 1;
        alias_count++;
    }

    lv_obj_t * root = UI_CREATE_SYMBOL(lv_screen_active());
    if(!root) { fprintf(stderr, "create failed\n"); return 1; }
    pump(30);

    for(int i = 1; i < argc; i++) {
        const char * a = argv[i];
        if(strncmp(a, "--click=", 8) == 0) {
            int x = 0, y = 0;
            sscanf(a + 8, "%d,%d", &x, &y);
            click_at(x, y);
            printf("click %d,%d\n", x, y);
        }
        else if(strncmp(a, "--tap=", 6) == 0) {
            /* press + release without the settle time, to catch animations mid-flight */
            int x = 0, y = 0;
            sscanf(a + 6, "%d,%d", &x, &y);
            ptr_x = x; ptr_y = y;
            ptr_down = true;  pump(4);
            ptr_down = false; pump(1);
            printf("tap %d,%d\n", x, y);
        }
        else if(strncmp(a, "--frames=", 9) == 0) pump(atoi(a + 9));
        else if(strncmp(a, "--snap=", 7) == 0) printf("snap %s (ignored)\n", a + 7);
        else if(strncmp(a, "--say=", 6) == 0) printf("-- %s\n", a + 6);
        else if(strncmp(a, "--subject=", 10) == 0) {
            lv_subject_t * s = lv_xml_get_subject(NULL, a + 10);
            if(s) printf("subject %s = %d\n", a + 10, (int)lv_subject_get_int(s));
            else printf("subject %s = MISSING\n", a + 10);
        }
        else if(strncmp(a, "--report=", 9) == 0) {
            const char * label = a + 9;
            const char * path = label;
            for(int k = 0; k < alias_count; k++) if(strcmp(aliases[k].name, label) == 0) path = aliases[k].path;
            lv_obj_t * c = find_by_path(root, path);
            if(!c) { printf("report %s: NOT FOUND\n", label); continue; }
            lv_area_t area;
            lv_obj_get_coords(c, &area);
            printf("report %s: hidden=%d x=%d y=%d w=%d h=%d\n", label,
                   lv_obj_has_flag(c, LV_OBJ_FLAG_HIDDEN) ? 1 : 0,
                   (int)area.x1, (int)area.y1, (int)lv_area_get_width(&area), (int)lv_area_get_height(&area));
        }
    }
    return 0;
}
