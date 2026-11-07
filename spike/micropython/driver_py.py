"""
Scripted driver for the GENERATED MicroPython (html2lvgl --format py) of a
behavior UI. The Python counterpart of spike/subjects/driver_c.c and the XML
driver: same steps, same output lines, so the scenario scripts run-accordion.sh
and run-components.sh (TARGET=py, through spike/subjects/drive.sh) hold the
Python output to the very assertions the XML, C and C++ output pass. Clicks go
through a real pointer input device and LVGL's hit-testing, not send_event().

Usage: micropython driver_py.py <module> <create function> [steps ...]

Steps, run in order (a step that is not one of these is ignored, like the
other drivers do with each other's options):
  --name=<alias>=<child path>   name a widget ("1.0" = second child of the root's
                                 second child; the generated Python has no widget names)
  --click=X,Y                    press, release, 30 frames of settle time
  --tap=X,Y                      press, release, 1 frame (catches an animation mid-flight)
  --frames=N                     run N frames of 16 ms
  --report=<alias or path>       print "report <label>: hidden=0 x=.. y=.. w=.. h=.. checked=0"
  --subject=<name>               print the value from the module's `subjects` dict
  --say=<text>                   print "-- text"
  --snap=<file>                  accepted and ignored

Run with MICROPYPATH set to the directory of the generated module.
"""
import sys
import lvgl as lv

HOR_RES = 320
VER_RES = 240

pointer = {"x": 0, "y": 0, "down": False}


def setup_display():
    framebuffer = bytearray(HOR_RES * VER_RES * 4)

    def flush_cb(disp, area, px_map):
        disp.flush_ready()

    disp = lv.display_create(HOR_RES, VER_RES)
    disp.set_color_format(lv.COLOR_FORMAT.XRGB8888)
    disp.set_flush_cb(flush_cb)
    disp.set_buffers(framebuffer, None, len(framebuffer), lv.DISPLAY_RENDER_MODE.DIRECT)

    def read_cb(indev, data):
        data.point.x = pointer["x"]
        data.point.y = pointer["y"]
        data.state = lv.INDEV_STATE.PRESSED if pointer["down"] else lv.INDEV_STATE.RELEASED

    indev = lv.indev_create()
    indev.set_type(lv.INDEV_TYPE.POINTER)
    indev.set_read_cb(read_cb)
    return framebuffer, indev  # both must stay referenced


def pump(frames):
    for _ in range(frames):
        lv.tick_inc(16)
        lv.timer_handler()


def press(x, y, settle):
    pointer["x"], pointer["y"], pointer["down"] = x, y, True
    pump(4)
    pointer["down"] = False
    pump(settle)


def find_by_path(root, path):
    obj = root
    for index in path.split("."):
        if obj is None or not index.isdigit() or int(index) >= obj.get_child_count():
            return None
        obj = obj.get_child(int(index))
    return obj


def main():
    modname, symbol = sys.argv[1], sys.argv[2]
    steps = sys.argv[3:]
    keep = setup_display()
    mod = __import__(modname)
    root = getattr(mod, symbol)(None)
    lv.screen_load(root)
    pump(30)

    aliases = {}
    for step in steps:
        if step.startswith("--name="):
            alias, _, path = step[7:].partition("=")
            aliases[alias] = path

    for step in steps:
        if step.startswith("--click="):
            x, y = step[8:].split(",")
            press(int(x), int(y), 30)
            print("click %s,%s" % (x, y))
        elif step.startswith("--tap="):
            x, y = step[6:].split(",")
            press(int(x), int(y), 1)
            print("tap %s,%s" % (x, y))
        elif step.startswith("--frames="):
            pump(int(step[9:]))
        elif step.startswith("--say="):
            print("-- " + step[6:])
        elif step.startswith("--snap="):
            print("snap %s (ignored)" % step[7:])
        elif step.startswith("--subject="):
            name = step[10:]
            subject = mod.subjects.get(name)
            print("subject %s = %s" % (name, "MISSING" if subject is None else subject.get_int()))
        elif step.startswith("--report="):
            label = step[9:]
            obj = find_by_path(root, aliases.get(label, label))
            if obj is None:
                print("report %s: NOT FOUND" % label)
                continue
            area = lv.area_t()
            obj.get_coords(area)
            # checked=0|1 is appended, as in the XML driver, so a tab button's open state can be asserted too.
            print("report %s: hidden=%d x=%d y=%d w=%d h=%d checked=%d" % (
                label, 1 if obj.has_flag(lv.obj.FLAG.HIDDEN) else 0,
                area.x1, area.y1, area.x2 - area.x1 + 1, area.y2 - area.y1 + 1,
                1 if obj.has_state(lv.STATE.CHECKED) else 0))


main()
