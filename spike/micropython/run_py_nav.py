"""
Exercises real cross-module navigation between two --format py goldens
(the same nav_home/nav_settings pair spike/micropython/render_xml.py and
spike/render/main_c.c validate for XML/C) by simulating a click on the
generated screen and checking that lv.screen_active() actually changed —
proving the lazily-imported nav callback's `import ui_<screen>` really
resolves against a sibling module on disk, not just that it looks right
as text. See emit-py.mjs's module doc comment for why the import is
lazy (inside the callback) rather than a top-level import.

Object identity, not get_name(), is what proves navigation happened:
generated code never calls set_name() (see emit-py.mjs — name is only
used to pick the source-level Python variable, mirroring emit-c.mjs's
identical treatment), so lv.screen_active() is compared by identity
against the screen this script created directly instead.

Usage: ./micropython run_py_nav.py <home.py> <home_symbol> \
                                    <nav-child-path, e.g. 2,0>
"""
import sys
import lvgl as lv

HOR_RES = 320
VER_RES = 240


def main():
    if len(sys.argv) != 4:
        print("usage: run_py_nav.py <home.py> <home_symbol> <nav-child-path>")
        raise SystemExit(1)

    path, symbol, child_path = sys.argv[1], sys.argv[2], sys.argv[3]
    framebuffer = bytearray(HOR_RES * VER_RES * 4)

    def flush_cb(disp, area, px_map):
        disp.flush_ready()

    disp = lv.display_create(HOR_RES, VER_RES)
    disp.set_color_format(lv.COLOR_FORMAT.XRGB8888)
    disp.set_flush_cb(flush_cb)
    disp.set_buffers(framebuffer, None, len(framebuffer), lv.DISPLAY_RENDER_MODE.DIRECT)

    modname = path.rsplit('/', 1)[-1].rsplit('.', 1)[0]
    mod = __import__(modname)
    home = getattr(mod, symbol)(None)
    lv.screen_load(home)
    for _ in range(30):
        lv.tick_inc(16)
        lv.timer_handler()

    target = home
    for i in child_path.split(','):
        target = target.get_child(int(i))

    before = lv.screen_active()
    target.send_event(lv.EVENT.CLICKED, None)
    for _ in range(30):
        lv.tick_inc(16)
        lv.timer_handler()
    after = lv.screen_active()

    if after == before:
        print("FAILED: active screen did not change after click")
        raise SystemExit(1)
    print("navigated away from %s -> active screen changed" % path)


main()
