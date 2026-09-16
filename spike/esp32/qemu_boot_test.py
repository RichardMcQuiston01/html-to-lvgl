#!/usr/bin/env python3
"""Boot an ESP32 MicroPython flash image under Espressif's QEMU-Xtensa fork,
paste a REPL test script into it, and assert it prints a pass marker.

Paces paste-mode input on the REPL's own line echo instead of a fixed sleep
(spike/esp32/README.md's "Known blockers" #4): a fixed delay is either too
slow (wastes time) or too fast (overruns the emulated UART and drops or
interleaves bytes) for whatever the actual machine happens to be. Waiting for
each line to echo back before sending the next is exactly as fast as the
emulated UART can go, on any machine, and fails loudly (a timeout) instead of
silently corrupting input if something does go wrong.

Usage:
  qemu_boot_test.py <qemu-system-xtensa> <flash_image.bin> <repl_script.py> \
    [--pass-marker TEXT] [--boot-timeout SECONDS] [--line-timeout SECONDS]
"""
import argparse
import sys

import pexpect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qemu_binary")
    parser.add_argument("flash_image")
    parser.add_argument("repl_script")
    parser.add_argument("--pass-marker", default="ESP32_QEMU_SPIKE_PASS")
    parser.add_argument("--boot-timeout", type=float, default=25)
    parser.add_argument("--line-timeout", type=float, default=5)
    parser.add_argument("--run-timeout", type=float, default=20)
    args = parser.parse_args()

    with open(args.repl_script) as f:
        lines = f.read().splitlines()

    qemu_args = [
        "-nographic",
        "-machine", "esp32",
        "-drive", f"file={args.flash_image},if=mtd,format=raw",
        "-monitor", "none",
        "-display", "none",
    ]
    child = pexpect.spawn(args.qemu_binary, qemu_args, timeout=args.boot_timeout, encoding="utf-8")
    child.logfile = sys.stdout

    try:
        # The ROM/second-stage bootloader banners land first; the REPL's own
        # prompt is the actual "ready for input" signal.
        child.expect(r">>> ", timeout=args.boot_timeout)

        child.sendcontrol("e")  # enter paste mode
        # "=== " is paste mode's per-line prompt: it prints one right away,
        # waiting for the first line, and another each time it has finished
        # reading a line and is ready for the next. Waiting for it to
        # reappear after each send — rather than matching the echoed line
        # content itself, which would need fragile regex-escaping for
        # arbitrary source lines (quotes, brackets, ...) — paces input at
        # exactly the rate the emulated UART can actually process it.
        child.expect("=== ", timeout=args.line_timeout)

        for line in lines:
            # A lone "\r" is Enter on this REPL; a trailing "\n" as well would
            # be read back as a second, empty pasted line.
            child.send(line + "\r")
            child.expect("=== ", timeout=args.line_timeout)

        child.sendcontrol("d")  # execute the pasted block
        child.expect(args.pass_marker, timeout=args.run_timeout)
        print(f"\n{args.pass_marker} — boot, LVGL init, and XML create all succeeded.")
    except pexpect.TIMEOUT:
        print("\n--- TIMEOUT: full serial output so far ---", file=sys.stderr)
        print(child.before, file=sys.stderr)
        sys.exit(1)
    finally:
        child.close(force=True)


if __name__ == "__main__":
    main()
