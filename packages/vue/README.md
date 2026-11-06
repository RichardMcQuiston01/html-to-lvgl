# @richardmcquiston01/html-to-lvgl-vue

Vue single-file component (`.vue`) input for [html2lvgl](../../README.md). A framework plugin: it compiles and mounts your component in headless Chromium at the target resolution, then html2lvgl converts the rendered result to LVGL XML, C, C++ or MicroPython.

## Install

```sh
npm install --save-dev @richardmcquiston01/html-to-lvgl @richardmcquiston01/html-to-lvgl-vue vue @vue/compiler-sfc esbuild
```

`vue`, `@vue/compiler-sfc` and `esbuild` are peer dependencies: your own Vue version compiles your templates. The core must be **0.8.0 or newer** (it provides the plugin recognizer wiring, framework data and source locations this plugin uses); npm warns when an older core is installed.

## Use

```sh
html2lvgl src/App.vue --plugin @richardmcquiston01/html-to-lvgl-vue --size 320x240 -o out
```

Or select it by extension from `html2lvgl.config.mjs` next to the input (then `html2lvgl App.vue` is enough):

```js
import vue from '@richardmcquiston01/html-to-lvgl-vue';
export default { plugins: [vue] };
```

The entry file's default export is mounted as the root component with `createApp(App).mount('#root')`; imported `.vue` files, `.ts`/`.js` modules and CSS are bundled.

## What it does

- Compiles `<template>`, `<script>`, `<script setup>` (JavaScript or TypeScript) and `<style>` / `<style scoped>` (plain CSS).
- Waits for Vue's first flush, then extracts exactly as for plain HTML.
- **Components:** each named component's root DOM node is marked, so a component used several times (a `v-for` of `StatCard`) becomes one reusable LVGL XML component with its props.
- **Source mapping:** diagnostics in `TODO.txt` point at the `.vue` file and template line (`src/App.vue:18`).
- **Framework data:** when a library plugin asks for it, nodes carry the Vue component chain (name and primitive props).
- Errors (SFC syntax error, unsupported block) stop the run with `file:line:column: reason`, not a stack trace.

See `examples/` (`App.vue` and `StatCard.vue`): props, `v-for`, `v-if`, scoped styles, TypeScript, and a reused component.

## Limits

- A snapshot of the initial render: no interaction, transitions, or async data that is not resolved on first flush.
- Not supported (reported as an error): `<style lang="scss|less|stylus">`, `<style module>`, `src=` on blocks, `<template lang="pug">`. Precompile or write plain CSS. `v-bind()` in CSS is not evaluated.
- `defineProps<ImportedType>()` cannot resolve types from other files; use a local interface or runtime props.
- Vue Router, Pinia or other plugins are not installed: the root component is mounted alone. Wrap such dependencies in your entry or give components default state.
- Component names and source lines rely on Vue's development build, which the plugin always bundles. A component without a name takes its file name.
- Diagnostics raised during recognition (before the converter has the full tree) may name the selector but not the file.
- The plugin takes `buildTree` and `launch` from the core's documented entry point `@richardmcquiston01/html-to-lvgl/extract`. Inside this repository's checkout (detected by a `package.json` named like the core two directories above `packages/vue`) it loads the sibling `src/extract.mjs` instead, so tests run against the checkout rather than an older registry copy; a published install never has that layout and always uses the documented entry.
- Source lines reach `TODO.txt` through `data-lv-source="file:line"` attributes the plugin stamps before extraction. `sourceOf(page, selector)` is a lookup helper only (the selector is CSS); the converter does not call it.
