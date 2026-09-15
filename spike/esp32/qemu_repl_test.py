"""
Reference script for the ESP32 QEMU spike: paste this into a booted
lv_micropython REPL (see README.md's "Reproducing" section for how to boot
one and feed it this file) to prove the LVGL binding actually initializes
and runs on real ESP32/Xtensa embedded constraints, not just the unix
port's x86 environment.

Unlike spike/micropython/render_xml.py, this can't prove anything visual —
Espressif's QEMU-Xtensa fork emulates the CPU, flash, and UART, but no
display/SPI peripheral, so there is no framebuffer to dump a BMP from. The
8x8 XRGB8888 buffer below exists only to satisfy lv_display_create()'s
non-null buffer requirement (any size does); nothing about it is inspected.
Each print is a checkpoint — reaching "ESP32_QEMU_SPIKE_PASS" is the
whole proof.
"""
import lvgl as lv
print("IMPORT_LVGL_OK")

fb = bytearray(8 * 8 * 4)


def flush_cb(disp, area, px_map):
    disp.flush_ready()


disp = lv.display_create(8, 8)
disp.set_color_format(lv.COLOR_FORMAT.XRGB8888)
disp.set_flush_cb(flush_cb)
disp.set_buffers(fb, None, len(fb), lv.DISPLAY_RENDER_MODE.DIRECT)
print("DISPLAY_CREATE_OK")

lv.xml_init()
print("XML_INIT_OK")

xml = '<component><view width="8" height="8"><lv_label text="hi"/></view></component>'
result = lv.xml_component_register_from_data("t", xml)
print("REGISTER_RESULT", result)

page = lv.xml_create(None, "t", None)
print("XML_CREATE_OK", page)
obj = lv.obj.__cast__(page)
obj.set_pos(0, 0)

for i in range(5):
    lv.tick_inc(16)
    lv.timer_handler()

print("ESP32_QEMU_SPIKE_PASS")
