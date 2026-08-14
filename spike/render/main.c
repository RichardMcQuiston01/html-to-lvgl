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

int main(int argc, char ** argv)
{
    if(argc < 3) {
        fprintf(stderr, "usage: %s <page.xml> <out.bmp>\n", argv[0]);
        return 1;
    }

    char * xml = read_file(argv[1]);
    if(!xml) {
        fprintf(stderr, "cannot read %s\n", argv[1]);
        return 1;
    }

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

    if(lv_xml_register_component_from_data("page", xml) != LV_RESULT_OK) {
        fprintf(stderr, "failed to register XML component from %s\n", argv[1]);
        return 1;
    }
    free(xml);

    lv_obj_t * page = lv_xml_create(lv_screen_active(), "page", NULL);
    if(page == NULL) {
        fprintf(stderr, "failed to instantiate XML component\n");
        return 1;
    }
    lv_obj_set_pos(page, 0, 0);

    /* Advance a few frames so layout + rendering settle */
    for(int i = 0; i < 30; i++) {
        lv_tick_inc(16);
        lv_timer_handler();
    }

    if(write_bmp(argv[2]) != 0) {
        fprintf(stderr, "cannot write %s\n", argv[2]);
        return 1;
    }
    printf("rendered %s -> %s\n", argv[1], argv[2]);
    return 0;
}
