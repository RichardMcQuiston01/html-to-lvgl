# Development

[Back to README](./README.md)

| [Project Layout](#project-layout) | [Testing](#testing) | [Releasing](#releasing) |

## Project Layout

- `src/` holds the `html2lvgl` command. The main files are:
  - `extract.mjs` and `extract-react.mjs` read the page in Playwright.
  - `convert.mjs` maps elements to widgets.
  - `componentize.mjs` and `optimize.mjs` reuse and trim the widget tree.
  - `emit-xml.mjs`, `emit-c.mjs`, and `emit-py.mjs` write the output.
  - `fonts.mjs` and `fonts-build.mjs` handle fonts.
  - `preview.mjs` runs watch mode.
- `examples/` holds sample pages, including `react/panel.jsx` and `annotations.html`.
- `tests/` holds golden-file tests. The fixtures are saved extraction snapshots, so most tests need no browser.
- `spike/` holds the proof of concept and the render program that CI uses. `spike/micropython/` and `spike/esp32/` hold the MicroPython work.
- `scripts/` holds the font-width generator, the fidelity scorer, and `convert-fixture.mjs`, which converts a saved fixture without a browser.

[Back to Top](#development)

## Testing

```sh
npm test                 # unit and golden-file tests
npm run golden:update    # refresh golden files after an intended change
```

Some tests start a real Chromium. The CI workflow installs it with `npx playwright install --with-deps chromium`.

CI also builds the render program against LVGL v9.4.0. Every golden XML file loads in the stock `lv_xml` runtime. Every golden C and C++ file is compiled and linked against real LVGL.

This project pins LVGL v9.4.0. It is the last release with the `lv_xml` runtime inside the main tree.

[Back to Top](#development)

## Releasing

1. Move the `CHANGELOG.md` entries from `[Unreleased]` to a new version heading with today's date.
2. Set the same version in `package.json` and `package-lock.json`.
3. Open a pull request and wait for CI to pass.
4. Merge, then push the result to the `release` branch.

A push to `release` runs `.github/workflows/publish.yml`. It runs the tests and then `npm publish`. The workflow needs an `NPM_TOKEN` secret.

[Back to Top](#development)

---

[Back to README](./README.md)
