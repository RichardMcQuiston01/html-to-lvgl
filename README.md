# HTML to LVGL

- Author: [Richard McQuiston](mailto:richard.mcquiston@gmail.com)
- Website: https://richardmcquiston.com/

## Table of Contents

| [Overview](#overview) | [Getting Started](#getting-started) | [More Information](#more-information) | [Buy Me a Coffee](#buy-me-a-coffee) | [License](#license) | [Copyright](#copyright) |

## Overview

HTML to LVGL turns a plain HTML page, or a React page, into code for the [LVGL](https://lvgl.io) graphics library. You can use the result on small devices such as an Arduino or an ESP32.

The tool opens your page in a headless Chromium browser at the size of your display. It reads the layout and styles from the browser. Then it writes LVGL XML (version 9.4), plain C, C++, or MicroPython.

See [ROADMAP.md](ROADMAP.md) for project status and [CHANGELOG.md](CHANGELOG.md) for released versions.

[Back to Top](#table-of-contents)

## Getting Started

### Prerequisites

- Node.js 20 or newer.
- Nothing else. Playwright downloads its own copy of Chromium when you install.

### Installation

To run the examples or work on the code, clone the repository:

```sh
git clone https://github.com/RichardMcQuiston01/html-to-lvgl.git
cd html-to-lvgl
npm install
```

To use the tool in your own project, install it from npm:

```sh
npm install -g @richardmcquiston01/html-to-lvgl
```

### Usage

Convert a page for a 320x240 display:

```sh
node src/cli.mjs examples/dashboard.html --size 320x240 -o out/
```

If you installed from npm, run `html2lvgl` in place of `node src/cli.mjs`.

This writes `out/dashboard.xml`. Load it with the LVGL 9.4 XML runtime:

```c
lv_xml_init();
/* register the montserrat fonts the page uses, then: */
lv_xml_register_component_from_data("dashboard", xml_string);
lv_xml_create(lv_screen_active(), "dashboard", NULL);
```

Use `--help` to list every option.

### Examples

```sh
# Write plain C as well as XML. This works on any LVGL 9.x.
node src/cli.mjs examples/monitor.html -o out/ --format both

# Write C++ for a project that only builds C++
node src/cli.mjs examples/monitor.html -o out/ --format cpp

# Convert a React component into reusable LVGL XML components
node src/cli.mjs examples/react/panel.jsx -o out/

# Save the browser screenshot and the extracted UI tree
node src/cli.mjs examples/dashboard.html -o out/ --screenshot --debug

# Rebuild on every save and show a live preview
node src/cli.mjs examples/dashboard.html -o out/ --watch

# Convert two pages into two linked screens
node src/cli.mjs examples/nav/home.html examples/nav/settings.html -o out/
```

[Back to Top](#table-of-contents)

## More Information

- [FEATURES.md](FEATURES.md) lists what HTML and CSS the tool converts. It also covers navigation, fonts, watch mode, annotation attributes, React input, and output formats.
- [MICROPYTHON.md](MICROPYTHON.md) shows how to run the output on MicroPython.
- [DEVELOPMENT.md](DEVELOPMENT.md) describes the project layout, tests, and how to release.
- [ROADMAP.md](ROADMAP.md) shows what is done, what is planned, and what is blocked.
- [COMPONENTS.md](COMPONENTS.md) is the design for converting complex components such as Accordion, Drawer, and Modal.
- [spike/README.md](spike/README.md) is the first proof of concept, with screenshots.

[Back to Top](#table-of-contents)

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via PayPal**](https://www.paypal.com/ncp/payment/BGTZ6GYWUTPYG), or scan:

<a href="https://www.paypal.com/ncp/payment/BGTZ6GYWUTPYG"><img src="./donate.png" alt="Donate via PayPal" width="180"></a>

[Back to Top](#table-of-contents)

## License

Apache 2. See the [LICENSE](LICENSE) file.

[Back to Top](#table-of-contents)

## Copyright

(c)2026 Richard McQuiston. All rights reserved.

[Back to Top](#table-of-contents)
