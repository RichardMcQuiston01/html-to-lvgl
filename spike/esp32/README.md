# ESP32 MicroPython spike — build + boot under QEMU-Xtensa

Answers `PLAN.md` §4 open question 3 (unix port, spiked; ESP32, the
realistic device target, "separate future work"): does `lv_micropython`'s
ESP32 port actually build against real ESP-IDF, and does the resulting
firmware actually boot and run the LVGL binding on real ESP32/Xtensa
constraints — not just the unix port's x86 environment?

**Both yes**, with four real, documented workarounds — none of them clean
enough to call this CI-ready yet. See "Known blockers and workarounds"
below before reproducing.

## Results

1. **Builds.** `lv_micropython`'s `ports/esp32` (board `ESP32_GENERIC`)
   compiles cleanly against ESP-IDF v5.2.2 with the *same*
   `lv_binding_micropython/lv_conf.h` patches already committed for the
   unix port (`spike/micropython/patches/lv_binding_micropython-lv_conf.patch`,
   `lvgl-binfont-and-xml-event-cb.patch`) — no ESP32-specific LVGL config
   changes needed. Output: a 2.96 MB `micropython.bin`, comfortably inside
   the board's 3 MB app partition (6% free).
2. **Boots under Espressif's own QEMU-Xtensa fork.** A merged flash image
   (bootloader + partition table + app) boots through the real ESP32 ROM
   bootloader, the second-stage bootloader, and reaches a live MicroPython
   REPL — `MicroPython v1.20.0-2527.g44aa2b153.dirty on 2026-09-15; Generic
   ESP32 module with ESP32`.
3. **The LVGL binding actually runs.** Pasted `qemu_repl_test.py` into that
   REPL: `import lvgl`, `lv.display_create()`, `lv.xml_init()`,
   `lv.xml_component_register_from_data()`, and `lv.xml_create()` all
   succeeded, and a `tick_inc`/`timer_handler` loop ran without crashing —
   proof the binding initializes and the XML runtime actually creates
   widgets on real Xtensa hardware constraints (different pointer width,
   different heap allocator, no SDL), not just the unix port's x86 build.

## What this does *not* prove

Espressif's QEMU-Xtensa fork emulates the ESP32 CPU, flash, and UART — not
a display or SPI peripheral. There is no framebuffer to dump a BMP from the
way `spike/render/main.c` and `spike/micropython/render_xml.py` do for the
unix port and its C harness. This spike proves **boot-and-execute**, not
**renders correctly** — that still needs real hardware (or a display
peripheral QEMU-Xtensa doesn't have). `idf.py qemu` (a newer ESP-IDF
convenience wrapper around this exact flow) isn't available in v5.2.2
either — it was added in a later ESP-IDF release — so the flash-image-merge
and manual `qemu-system-xtensa` invocation below is the real recipe for
this pinned version, not a shortcut taken for convenience.

## Known blockers and workarounds

This environment's network policy blocks `dl.espressif.com` and
`components.espressif.com`, which real ESP-IDF tooling expects for two
different things. Both have real, verified fixes — GitHub is not blocked,
and Espressif's own toolchain, QEMU, and even the `mdns` component
`main.c` needs are *also* published as GitHub release assets / a GitHub
monorepo, just not the primary path `install.sh` and the component
manager try first.

1. **The pip "constraints" file** (`espidf.constraints.v5.2.txt`, pinning
   exact versions of `idf-component-manager`, `schema`, etc. for this
   ESP-IDF release) lives only on `dl.espressif.com`. Workaround:
   `IDF_PYTHON_CHECK_CONSTRAINTS=no` before `install.sh` and `export.sh` —
   but that means pip resolves the *latest* compatible versions instead of
   the tested pins, which are not actually compatible with ESP-IDF
   v5.2.2's build system:
   - `idf-component-manager`'s newest CLI protocol (`--interface_version`
     3+) isn't one v5.2.2's `cmake/build.cmake` knows how to call —
     downgrade to `idf-component-manager==1.5.2` (the latest release
     before the interface changed, contemporaneous with this ESP-IDF
     branch).
   - That version's own dependency on `schema` isn't pinned tightly
     enough either — the newest `schema` (0.7.8) changed its `re.sub`
     usage in a way that crashes `idf_component_tools`' JSON-schema
     generation at import time. Downgrade to `schema==0.7.5`.
2. **The component registry** (`components-file.espressif.com`,
   Espressif's npm-equivalent for managed ESP-IDF components) is where
   `idf_component.yml` manifests resolve dependencies like `espressif/mdns`
   from. Workaround: `IDF_COMPONENT_MANAGER=0` disables managed-dependency
   resolution entirely — but `ports/esp32/modsocket.c` and
   `network_wlan.c` unconditionally `#include "mdns.h"`, and nothing in
   the port's own `esp32_common.cmake` lists `mdns` as a component
   requirement (normally the component manager injects it automatically
   once resolved). Fix: vendor the `mdns` component's source directly from
   its real upstream — [`espressif/esp-protocols`](https://github.com/espressif/esp-protocols)
   (tag `mdns-v1.1.0`, matching the port's `idf_component.yml` version
   constraint) — reachable via git even though the registry lookup isn't,
   point `EXTRA_COMPONENT_DIRS` at *just* that component (not the whole
   `esp-protocols/components/` directory — sibling components like `asio`
   have their own uninitialized git submodules that would otherwise break
   the cmake configure), and patch `esp32_common.cmake` to list it in
   `IDF_COMPONENTS` — see `patches/lv_micropython-esp32-require-mdns.patch`,
   verified to apply cleanly to a fresh checkout of the pinned commit.
3. **Flash image padding.** A naive `truncate -s 4M` to pad the merged
   `bootloader.bin` + `partition-table.bin` + `micropython.bin` image up to
   the configured 4 MB flash size pads with `0x00`. Real (and emulated)
   NOR flash reads as `0xFF` when erased/blank; MicroPython's VFS mount
   code can tell the difference, and treats an all-zero region as
   genuinely corrupted rather than blank-and-needing-format — it printed
   "The filesystem appears to be corrupted" in an infinite retry loop and
   never reached a REPL. Fix: `esptool --pad-to-size 4MB` (not a manual
   `truncate`) when merging, which pads with the correct `0xFF` value.
4. **Serial pacing.** Bulk-piping REPL paste-mode input into QEMU's
   emulated UART via a plain `cat` overruns it — bytes get dropped or
   interleaved mid-line. Feeding the script one line at a time with a
   short (~150ms) delay between lines fixed it; see "Reproducing" below.

None of this is fragile because ESP32 support itself is fragile — it's
fragile because this sandbox's network policy forces four manual
workarounds around infrastructure (a pip constraints mirror, a component
registry) that a normal developer machine or a real CI runner with
unrestricted network access wouldn't need at all. On unrestricted network
access, steps 1–2 disappear entirely (`install.sh` and the component
manager just work); 3–4 are real, environment-independent gotchas worth
keeping regardless.

## Reproducing

```sh
# 1. ESP-IDF v5.2.2 (this is what lv_micropython's tools/ci.sh pins)
git clone --depth 1 --branch v5.2.2 https://github.com/espressif/esp-idf.git
cd esp-idf
git submodule update --init --recursive --filter=tree:0
export IDF_PYTHON_CHECK_CONSTRAINTS=no   # see "Known blockers" #1
./install.sh esp32
source ./export.sh
# see "Known blockers" #1 — only needed if install.sh resolved the newest,
# not-actually-compatible idf-component-manager/schema:
pip install "idf-component-manager==1.5.2" "schema==0.7.5"
cd ..

# 2. lv_micropython at the same pinned commit CI's validate-micropython-xml
#    job uses, with the same patches already in this repo
git clone https://github.com/lvgl/lv_micropython.git
cd lv_micropython
git checkout 44aa2b153dd3aa1ba183d05bd867fe3ffe2a1d75
git submodule update --init --depth 1 user_modules/lv_binding_micropython \
  lib/micropython-lib lib/berkeley-db-1.xx lib/libffi lib/axtls lib/mbedtls
cd user_modules/lv_binding_micropython
git submodule update --init --depth 1 lvgl pycparser
cd ../..
git apply /path/to/html-to-lvgl/spike/micropython/patches/lv_binding_micropython-lv_conf.patch \
  --directory=user_modules/lv_binding_micropython
git -C user_modules/lv_binding_micropython/lvgl apply \
  /path/to/html-to-lvgl/spike/micropython/patches/lvgl-binfont-and-xml-event-cb.patch
git apply /path/to/html-to-lvgl/spike/esp32/patches/lv_micropython-esp32-require-mdns.patch

# 3. Vendor mdns locally (see "Known blockers" #2) and build
git clone --depth 1 --branch mdns-v1.1.0 https://github.com/espressif/esp-protocols.git /tmp/esp-protocols
mkdir /tmp/extra_components
ln -s /tmp/esp-protocols/components/mdns /tmp/extra_components/mdns

make -C mpy-cross
cd ports/esp32
export IDF_COMPONENT_MANAGER=0
idf.py -D MICROPY_BOARD=ESP32_GENERIC \
  -D MICROPY_BOARD_DIR="$(pwd)/boards/ESP32_GENERIC" \
  -D EXTRA_COMPONENT_DIRS=/tmp/extra_components \
  -B build-ESP32_GENERIC build

# 4. Merge to a flash image with correct 0xFF padding (see "Known blockers" #3)
python -m esptool --chip esp32 merge_bin -o /tmp/flash_image.bin \
  --flash_mode dio --flash_size 4MB --flash_freq 40m --pad-to-size 4MB \
  0x1000 build-ESP32_GENERIC/bootloader/bootloader.bin \
  0x8000 build-ESP32_GENERIC/partition_table/partition-table.bin \
  0x10000 build-ESP32_GENERIC/micropython.bin

# 5. Get Espressif's prebuilt QEMU-Xtensa (matches ESP-IDF v5.2.2's tools.json pin)
curl -sSL "https://github.com/espressif/qemu/releases/download/esp-develop-8.2.0-20240122/qemu-xtensa-softmmu-esp_develop_8.2.0_20240122-x86_64-linux-gnu.tar.xz" \
  -o /tmp/qemu.tar.xz
tar xf /tmp/qemu.tar.xz -C /tmp
QEMU=/tmp/qemu/bin/qemu-system-xtensa

# 6. Boot it and confirm a REPL comes up
timeout 25 "$QEMU" -nographic -machine esp32 -drive file=/tmp/flash_image.bin,if=mtd,format=raw \
  -serial file:/tmp/serial.log -monitor none
cat /tmp/serial.log   # ends with "MicroPython v1.20.0-... Type "help()" ... >>>"

# 7. Paste in the LVGL test (see "Known blockers" #4 — plain `cat` overruns
#    the emulated UART, so this paces one line at a time)
{
  sleep 3; printf '\x05'; sleep 0.3
  while IFS= read -r line; do printf '%s\n' "$line"; sleep 0.15; done < /path/to/html-to-lvgl/spike/esp32/qemu_repl_test.py
  sleep 0.3; printf '\x04'; sleep 6
} | timeout 30 "$QEMU" -nographic -machine esp32 -drive file=/tmp/flash_image.bin,if=mtd,format=raw \
    -serial stdio -monitor none -display none
# ends with "ESP32_QEMU_SPIKE_PASS"
```

## Patches

### `patches/lv_micropython-esp32-require-mdns.patch`

One line: adds `mdns` to `ports/esp32/esp32_common.cmake`'s `IDF_COMPONENTS`
list. Verified to apply cleanly to a fresh checkout of the pinned commit.
Only needed because this environment's network policy forces
`IDF_COMPONENT_MANAGER=0` (see "Known blockers" #2) — on unrestricted
network access, the component manager resolves and links `mdns`
automatically from its `idf_component.yml` declaration and this patch is a
no-op (`mdns` would already be present).

## Next steps

Not wired into CI — the four workarounds above are manual, environment-
specific, and (for #1–#2) exist only because of this sandbox's network
policy, not because ESP32 support itself is unstable. Before considering a
`validate-micropython-esp32` CI job:

- Confirm whether GitHub Actions runners hit the same `dl.espressif.com` /
  `components.espressif.com` restrictions this sandbox does (likely not —
  those are org-specific policy here) — if not, steps 1–2 of "Known
  blockers" simply don't apply and `install.sh`/the component manager work
  unmodified.
- Decide whether boot-and-execute validation (this spike) is worth the ~2
  minute ESP-IDF+QEMU setup cost in CI, given it can't catch rendering
  regressions the way `validate-xml`/`validate-micropython-xml` do for the
  unix port — it would catch a different class of bug (embedded-memory/
  architecture-specific crashes), which is real but narrower value.
- If pursued, automate step 7's paced REPL feed properly (a `pexpect`-style
  driver, not a hand-tuned sleep loop) — brittleness there is a real risk
  for an unattended job.
