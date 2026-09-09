"""
Renders html2lvgl's --format xml output on lv_micropython via the
lv_binding_micropython auto-generated binding, unmodified — no separate
emitter needed for the MicroPython path (see PLAN.md §3.4).

Mirrors spike/render/main.c's argument handling and behavior exactly, so
the same golden files and the same CI assertions (e.g. the post-click
"active screen is `...`" line) work against both harnesses:
registers Montserrat fonts under the XML "globals" scope, registers any
dependency XML files (multi-screen siblings, componentized React output)
under their own basename, registers the page, instantiates it, optionally
clicks a named widget, ticks a few frames, and dumps the framebuffer as a
24-bit BMP.

Usage: ./micropython render_xml.py <page.xml> <out.bmp> [--click=<widget-name>]
                                    [--font=<name>=<path.bin>] [component.xml ...]
"""
import sys
import lvgl as lv

HOR_RES = 320
VER_RES = 240


def is_screen_root(xml):
    """True when the document's root element is <screen> rather than
    <component>. Skips declarations (<?...?>), comments (<!--...-->) and
    doctype-style markup (<!...>) in full — including any '<' they contain
    — rather than main.c's char-by-char scan, which mishandles a literal
    '<' inside a comment body. MicroPython's `re` module doesn't reliably
    support DOTALL/non-greedy, so this is a plain hand-rolled scanner."""
    i = 0
    n = len(xml)
    while i < n:
        if xml[i] != '<':
            i += 1
            continue
        if xml[i:i + 4] == '<!--':
            end = xml.find('-->', i + 4)
            i = (end + 3) if end != -1 else n
            continue
        if xml[i:i + 2] == '<?' or xml[i:i + 1] == '<!':
            end = xml.find('>', i + 1)
            i = (end + 1) if end != -1 else n
            continue
        # Root element start: read the tag name (up to whitespace, '/', '>')
        j = i + 1
        while j < n and xml[j] not in ' \t\r\n/>':
            j += 1
        return xml[i + 1:j] == 'screen'
    return False


def component_name_from_path(path):
    """'path/to/stat_card.xml' -> 'stat_card'"""
    base = path.rsplit('/', 1)[-1]
    return base.rsplit('.', 1)[0]


def find_by_name(parent, name):
    """Depth-first search for a widget by its `name` attribute, same as
    main.c's find_by_name — used to resolve --click=<name>."""
    count = parent.get_child_count()
    for i in range(count):
        child = parent.get_child(i)
        if child.get_name() == name:
            return child
        found = find_by_name(child, name)
        if found is not None:
            return found
    return None


def write_bmp(path, buf, w, h):
    row_bytes = ((w * 3 + 3) // 4) * 4
    image_size = row_bytes * h
    file_size = 54 + image_size

    header = bytearray(54)
    header[0:2] = b'BM'
    header[2:6] = file_size.to_bytes(4, 'little')
    header[10:14] = (54).to_bytes(4, 'little')
    header[14:18] = (40).to_bytes(4, 'little')
    header[18:22] = w.to_bytes(4, 'little')
    header[22:26] = h.to_bytes(4, 'little')
    header[26:28] = (1).to_bytes(2, 'little')
    header[28:30] = (24).to_bytes(2, 'little')
    header[34:38] = image_size.to_bytes(4, 'little')

    with open(path, 'wb') as f:
        f.write(header)
        row = bytearray(row_bytes)
        # framebuffer is XRGB8888 -> bytes are B,G,R,X per pixel; BMP rows
        # are bottom-up, same convention as spike/render/main.c
        for y in range(h - 1, -1, -1):
            src_off = y * w * 4
            for x in range(w):
                p = src_off + x * 4
                row[x * 3 + 0] = buf[p + 0]
                row[x * 3 + 1] = buf[p + 1]
                row[x * 3 + 2] = buf[p + 2]
            f.write(row)


def main():
    if len(sys.argv) < 3:
        print("usage: render_xml.py <page.xml> <out.bmp> [--click=<widget-name>]")
        print("          [--font=<name>=<path.bin>] [component.xml ...]")
        raise SystemExit(1)

    click_name = None
    font_specs = []
    dep_paths = []
    for arg in sys.argv[3:]:
        if arg.startswith('--click='):
            click_name = arg[len('--click='):]
        elif arg.startswith('--font='):
            font_specs.append(arg[len('--font='):])
        elif not arg.startswith('--'):
            dep_paths.append(arg)

    # lv_init() runs automatically on `import lvgl` in this binding.
    framebuffer = bytearray(HOR_RES * VER_RES * 4)

    def flush_cb(disp, area, px_map):
        disp.flush_ready()

    disp = lv.display_create(HOR_RES, VER_RES)
    disp.set_color_format(lv.COLOR_FORMAT.XRGB8888)
    disp.set_flush_cb(flush_cb)
    disp.set_buffers(framebuffer, None, len(framebuffer), lv.DISPLAY_RENDER_MODE.DIRECT)

    lv.xml_init()
    scope = lv.xml_component_get_scope("globals")

    # Same Montserrat sizes spike/render/main.c registers for name resolution
    for size in (10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48):
        font = getattr(lv, "font_montserrat_%d" % size, None)
        if font is not None:
            scope.register_font("montserrat_%d" % size, font)

    # Converted (lv_font_conv) fonts: same --font=<name>=<path.bin> convention
    # as the C harness, proving lv_binfont_create is reachable and usable
    # from MicroPython, not just the C API. The POSIX driver is mounted on
    # 'A', so an absolute path becomes "A:/abs/path.bin".
    for spec in font_specs:
        name, _, path = spec.partition('=')
        if not path:
            print("expected --font=<name>=<path.bin>, got `%s`" % spec)
            raise SystemExit(1)
        font = lv.binfont_create("A:%s" % path)
        if font is None:
            print("cannot load font `%s` from %s" % (name, path))
            raise SystemExit(1)
        scope.register_font(name, font)

    # Register dependency components first (e.g. the componentizer's output,
    # or sibling screens referenced by <screen_create_event screen="..."/>)
    for dep_path in dep_paths:
        with open(dep_path, 'r') as f:
            dep_xml = f.read()
        dep_name = component_name_from_path(dep_path)
        result = lv.xml_component_register_from_data(dep_name, dep_xml)
        if result != lv.RESULT.OK:
            print("failed to register XML component %s from %s" % (dep_name, dep_path))
            raise SystemExit(1)

    with open(sys.argv[1], 'r') as f:
        xml = f.read()

    name = component_name_from_path(sys.argv[1])
    result = lv.xml_component_register_from_data(name, xml)
    print("register_from_data(%s) -> %s" % (name, result))
    if result != lv.RESULT.OK:
        print("FAILED to register component")
        raise SystemExit(1)

    screen_root = is_screen_root(xml)
    if screen_root:
        # Screens are their own root object and must be loaded, not
        # parented — same distinction spike/render/main.c makes.
        blob = lv.xml_create(None, name, None)
    else:
        blob = lv.xml_create(lv.screen_active(), name, None)
    if blob is None:
        print("FAILED to instantiate component")
        raise SystemExit(1)
    # lv_xml_create returns void*; the binding can't know it's an lv_obj_t,
    # so it comes back as an untyped Blob and needs an explicit cast.
    page = lv.obj.__cast__(blob)
    if screen_root:
        lv.screen_load(page)
    else:
        page.set_pos(0, 0)

    for _ in range(30):
        lv.tick_inc(16)
        lv.timer_handler()

    if click_name is not None:
        target = find_by_name(lv.screen_active(), click_name)
        if target is None:
            print("no widget named `%s` to click" % click_name)
            raise SystemExit(1)
        target.send_event(lv.EVENT.CLICKED, None)
        for _ in range(30):
            lv.tick_inc(16)
            lv.timer_handler()
        print("clicked `%s` -> active screen is `%s`" % (click_name, lv.screen_active().get_name()))

    write_bmp(sys.argv[2], framebuffer, HOR_RES, VER_RES)
    print("rendered %s -> %s" % (sys.argv[1], sys.argv[2]))


main()
