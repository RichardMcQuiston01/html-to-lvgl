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
4. Merge the pull request into `main`.
5. Create a tag on the merge commit, such as `0.3.0` (or `v0.3.0`), and push it.

Pushing a version tag runs `.github/workflows/publish.yml`. The workflow stops if the tag's commit is not on `main`, or if the tag does not match the version in `package.json`. Then it runs the tests and `npm publish`. The workflow needs an `NPM_TOKEN` secret.

### Plugin packages

`packages/vue` (`@richardmcquiston01/html-to-lvgl-vue`) and `packages/mui` (`@richardmcquiston01/html-to-lvgl-mui`) are versioned and published on their own. Each tag publishes exactly one package:

| Package | Tag | Version file | Workflow |
| --- | --- | --- | --- |
| core | `0.8.0` or `v0.8.0` | `package.json` | `publish.yml` |
| Vue | `vue-v0.1.0` | `packages/vue/package.json` | `publish-packages.yml` |
| Material UI | `mui-v0.1.0` | `packages/mui/package.json` | `publish-packages.yml` |

The core's workflow was left as it was and the plugins got a workflow of their own, so a mistake in the new one cannot change how the core is published. The tag patterns do not overlap; `tests/publish-workflow.test.mjs` checks that.

Order: **core first, then the plugins.** The plugins require core `>=0.8.0` (`peerDependencies`), because they use features missing from 0.7.0. `scripts/check-publish.mjs` runs in the workflow and stops a plugin when the core on npm (`latest`) does not satisfy that range, when the range admits a core older than the plugin needs (`CORE_FLOOR` in the script), or when a scoped package lacks `publishConfig.access: "public"`. When a plugin starts to use a newer core feature, raise its peer range and `CORE_FLOOR` together.

To release a plugin:

1. Record the change in the root `CHANGELOG.md` (plugin packages have no changelog of their own), then set the new version in its `package.json` and in `package-lock.json`.
2. Open a pull request, wait for CI, and merge it into `main`.
3. Tag the merge commit `vue-vX.Y.Z` or `mui-vX.Y.Z` and push the tag.

The workflow stops if the tag's commit is not on `main`, or if the version after `vue-v` / `mui-v` differs from that package's `package.json`. Then it installs a test typeface, runs `npm ci`, installs Chromium, runs `npm test`, and runs `npm publish -w <package> --access public`. Provenance is not enabled for the core or the plugins.

Before the first publish of each new package:

- Check that the `NPM_TOKEN` secret can publish the two new package names. A token limited to one package, or a granular token that does not cover `@richardmcquiston01/html-to-lvgl-vue` and `@richardmcquiston01/html-to-lvgl-mui`, is refused by npm at the very end of a run. Widen it (or create a token that covers the whole `@richardmcquiston01` scope) before tagging.
- The first publish of a scoped package must be public: the workflow passes `--access public`, and each `package.json` sets `publishConfig.access`.
- Run a dry run first. In GitHub, open Actions, choose "Publish plugin packages to npm", click "Run workflow", pick the package (`vue`, `mui` or `core`) and leave "Dry run" ticked. It runs every check and the full test suite, then `npm publish --dry-run`. A manual run never publishes and never sees the token. The plugin checks fail until the core 0.8.0 is on npm, which is the intended order.
- `npm test` includes `tests/publish-layout.test.mjs`, which packs the core and both plugins and converts the Vue and Material UI examples from the unpacked tarballs. Locally, `npm pack --dry-run` in each package directory lists what would be published.

The repository's `.npmrc` sets `legacy-peer-deps=true`: the plugins peer-depend on core `>=0.8.0`, which is this repository, and without it `npm ci` would look for that version on npm and fail until it is published. It affects installs in this checkout only, not users of the packages.

Inside this repository the plugins import the core by relative path; once published they use the core's documented entry points (`@richardmcquiston01/html-to-lvgl/extract`, `/plugin`, `/recognize`). The `exports` map in the core's `package.json` lists these plus `./src/*`, so existing deep imports keep working.

[Back to Top](#development)

---

[Back to README](./README.md)
