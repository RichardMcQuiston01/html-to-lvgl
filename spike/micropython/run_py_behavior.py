"""
Drives the --format py output for a behavior (subject) UI on lv_micropython and
asserts the interaction really works, not just that the module imports.
Written for tests/golden-behavior/ui_disclosure.py (the generic disclosure
fixture), so the names below are that fixture's.

Usage: ./micropython run_py_behavior.py ui_disclosure ui_disclosure_create

It checks the pinned binding path end to end: lv.subject_t, the bind_flag_if_eq
binds (initial hidden state), and the event-callback stand-ins for
lv_obj_add_subject_toggle_event / lv_obj_add_subject_set_int_event, which the
pinned binding's vendored LVGL (v9.3-era) does not have.
"""
import sys
import lvgl as lv

HOR_RES = 320
VER_RES = 240


def setup_display():
    framebuffer = bytearray(HOR_RES * VER_RES * 4)

    def flush_cb(disp, area, px_map):
        disp.flush_ready()

    disp = lv.display_create(HOR_RES, VER_RES)
    disp.set_color_format(lv.COLOR_FORMAT.XRGB8888)
    disp.set_flush_cb(flush_cb)
    disp.set_buffers(framebuffer, None, len(framebuffer), lv.DISPLAY_RENDER_MODE.DIRECT)
    return framebuffer


def find_children(root):
    return [root.get_child(i) for i in range(root.get_child_count())]


def check(condition, message):
    if not condition:
        print("FAIL: " + message)
        raise SystemExit(1)
    print("ok: " + message)


def main():
    modname, symbol = sys.argv[1], sys.argv[2]
    keep = setup_display()
    mod = __import__(modname)
    page = getattr(mod, symbol)(None)
    lv.screen_load(page)
    lv.timer_handler()

    kids = find_children(page)
    # h1 p1 h2 p2 footer openbtn dlg, in document order.
    h1, p1, h2, p2, footer, openbtn, dlg = kids
    hidden = lambda o: o.has_flag(lv.obj.FLAG.HIDDEN)
    subjects = mod.subjects

    check(hidden(p1) and not hidden(p2) and hidden(dlg), "initial: p1 closed, p2 open, dialog closed")
    check(subjects["disclosure_p1_open"].get_int() == 0, "initial subject value from the declaration")

    h1.send_event(lv.EVENT.CLICKED, None)
    check(not hidden(p1) and subjects["disclosure_p1_open"].get_int() == 1, "toggle opens p1")
    h1.send_event(lv.EVENT.CLICKED, None)
    check(hidden(p1), "toggle closes p1 again")
    h2.send_event(lv.EVENT.CLICKED, None)
    check(hidden(p2), "toggle closes p2")

    openbtn.send_event(lv.EVENT.CLICKED, None)
    check(not hidden(dlg), "set(1) opens the dialog")
    closebtn = find_children(find_children(dlg)[0])[1]
    closebtn.send_event(lv.EVENT.CLICKED, None)
    check(hidden(dlg), "set(0) closes the dialog")

    # Application-side control through the module's subjects dict.
    subjects["disclosure_dlg_open"].set_int(1)
    check(not hidden(dlg), "set_int on the exported subject re-binds the flag")
    lv.timer_handler()
    print("behavior OK")


main()
