"""
Runs html2lvgl's --format py output on lv_micropython via the
lv_binding_micropython auto-generated binding, calling the generated
ui_create()/ui_<screen>_create() function directly — no lv_xml runtime
involved, proving the emitted Python itself is correct, runnable
MicroPython rather than just plausible-looking text (see emit-py.mjs's
module doc comment for the real API differences this caught).

Usage: ./micropython run_py.py <module.py> <symbol> [--font=<name>=<path.bin>]

<symbol> is the function to call (ui_create for a single page, or
ui_<screen>_create for one screen of a multi-screen UI) — passed
explicitly rather than guessed, the same way spike/render/main_c.c takes
UI_CREATE_SYMBOL as a build define for the same reason: raw generated
code (C or Python) has no single uniform entry point the way lv_xml's
registry gives XML input.
"""
import sys
import lvgl as lv

HOR_RES = 320
VER_RES = 240


def main():
    if len(sys.argv) < 3:
        print("usage: run_py.py <module.py> <symbol> [--font=<name>=<path.bin>]")
        raise SystemExit(1)

    path = sys.argv[1]
    symbol = sys.argv[2]
    fonts = {}
    for arg in sys.argv[3:]:
        if arg.startswith('--font='):
            name, _, font_path = arg[len('--font='):].partition('=')
            font = lv.binfont_create("A:%s" % font_path)
            if font is None:
                print("cannot load font `%s` from %s" % (name, font_path))
                raise SystemExit(1)
            fonts[name] = font

    framebuffer = bytearray(HOR_RES * VER_RES * 4)

    def flush_cb(disp, area, px_map):
        disp.flush_ready()

    disp = lv.display_create(HOR_RES, VER_RES)
    disp.set_color_format(lv.COLOR_FORMAT.XRGB8888)
    disp.set_flush_cb(flush_cb)
    disp.set_buffers(framebuffer, None, len(framebuffer), lv.DISPLAY_RENDER_MODE.DIRECT)

    # sys.path already carries the golden-py directory (via MICROPYPATH),
    # same convention every CI step below uses.
    modname = path.rsplit('/', 1)[-1].rsplit('.', 1)[0]
    mod = __import__(modname)
    fn = getattr(mod, symbol)
    try:
        page = fn(None, fonts=fonts)
    except TypeError:
        # ui_create(parent) with no custom fonts referenced takes no
        # "fonts" kwarg at all — see emit-py.mjs's module doc comment.
        page = fn(None)

    lv.screen_load(page)
    for _ in range(30):
        lv.tick_inc(16)
        lv.timer_handler()
    print("rendered %s (%s)" % (path, symbol))


main()
