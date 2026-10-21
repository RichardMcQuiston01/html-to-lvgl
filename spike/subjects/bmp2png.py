#!/usr/bin/env python3
"""Dependency-free 24-bit BMP -> PNG (the driver's BMPs), so CI needs no Chromium.

usage: bmp2png.py in.bmp out.png [scale]
"""
import struct
import sys
import zlib


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    scale = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    data = open(src, "rb").read()
    offset = struct.unpack_from("<I", data, 10)[0]
    width, height = struct.unpack_from("<ii", data, 18)
    row_bytes = ((width * 3 + 3) // 4) * 4
    rows = []
    for y in range(height - 1, -1, -1):  # BMP rows are bottom-up
        base = offset + y * row_bytes
        row = bytearray()
        for x in range(width):
            b, g, r = data[base + x * 3: base + x * 3 + 3]
            row += bytes((r, g, b)) * scale
        rows.extend([b"\x00" + bytes(row)] * scale)

    def chunk(tag: bytes, body: bytes) -> bytes:
        crc = zlib.crc32(tag + body) & 0xFFFFFFFF
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", crc)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width * scale, height * scale, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    open(dst, "wb").write(png)


if __name__ == "__main__":
    main()
