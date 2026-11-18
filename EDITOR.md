# Editor

[Back to README](./README.md)

| [Purpose and Non-Goals](#purpose-and-non-goals) | [Data Model](#data-model) | [Architecture](#architecture) | [Preview Engine](#preview-engine) | [Version 1 Scope](#version-1-scope) | [API Surface](#api-surface) | [Risks and Build Plan](#risks-and-build-plan) |

This is a design document. The editor is not built. The pieces under it (registry export, IR export and import, `--from-ir`) are built and tested. The preview API is in progress and is marked "planned" below. See [ROADMAP.md](./ROADMAP.md) Phase 11 and [COMPONENTS.md](./COMPONENTS.md) "Editor Constraints".

Status words used here: **exists** means the code is on the base branch and was read for this document. **planned** means another lane is building it. **gap** means nothing covers it yet. **unverified** means it was not checked, and the text says what would check it.

## Purpose and Non-Goals

The editor tweaks a converted screen visually and writes the result back as a sidecar or as IR. A user converts a page, opens it, nudges sizes and colors, fixes a label, removes a widget, and exports XML, C, C++ or MicroPython through the existing emitters.

| It is | It is not |
|---|---|
| A visual tweaker for one converted screen at device size | A general design tool, or a Figma clone |
| A property panel driven by the registry's `props` and `slots` | An HTML, CSS, React or Vue editor |
| A writer of `<page>.lvgl.json` or IR JSON | A parser of generated XML (COMPONENTS.md rule 4) |
| A front end for the existing emitters | A new emitter, or a new component authoring tool |
| Single user, local files | Multi-user, cloud, or accounts |

[Back to Top](#editor)

## Data Model

There are three artifacts.

| Artifact | File | Made by | Read by |
|---|---|---|---|
| Source | `page.html`, React, Vue | The user | `html2lvgl` (needs Chromium) |
| IR | `<page>.ir.json` (`--export-ir`) | `exportIr()` in `src/ir.mjs` | `importIr()`, `--from-ir`, the editor |
| Sidecar | `<page>.lvgl.json` | The user or the editor | `applySidecar()` in `src/overrides.mjs` |

### What the IR is

The IR is the post-convert `view` tree (`{ tag, attrs, meta?, children }`) plus `name`, `screenMode`, `subjects`, `timelines` and `assets`. `src/ir.mjs` explains why this stage and not the extraction tree: the extraction tree depends on Chromium measurements, and the `view` is exactly what every emitter reads. The schema is `tests/golden-editor/ir.schema.json`. Attribute values are plain LVGL attribute names and values. `attrs.name` is unique per page, enforced by `validateIr()`.

### What the sidecar can express

From `src/overrides.mjs`:

| Edit | Sidecar | IR |
|---|---|---|
| Set, change or add an attribute on a named node | Yes (`attrs`) | Yes |
| Remove an attribute | Yes (`null`) | Yes |
| Remove a node and its subtree | Yes (`remove: true`) | Yes |
| Change the `name` attribute | No (`name` cannot be overridden) | Yes |
| Add a node | Yes (`structure`, an `add` operation; sidecar version 2) | Yes |
| Move or reorder a node, or change its parent | Yes (`structure`, a `move` operation; sidecar version 2) | Yes |
| Change a node's `tag` | No | Yes |
| Edit `meta` (component, behavior) | No | Yes |
| Edit subjects, timelines, assets | No | Yes |
| Target a node with no `name` (tabview parts, behavior tags) | No | Yes, by path |

The sidecar is applied to the same `view` tree the IR holds, after `convert()` and before `componentize()`. So a sidecar edit and an IR edit of an attribute produce the same emitted output. The sidecar is the smaller language. Version 2 grew it by two operations, add and move, which is what lets the editor change a page's structure without leaving the HTML as the source of truth (see below). Renaming, changing a tag, `meta`, subjects, timelines and assets are still IR-only, and the editor does not offer them.

### Which one the editor edits

Both, with one rule each.

- **Write the sidecar, for everything the sidecar can say.** Attribute edits, removals, and (version 2) added widgets and moves go to `<page>.lvgl.json`. The user's HTML stays the source of truth, and the edits are replayed on every conversion.
- **IR only for what the sidecar cannot say.** Renaming a node, changing a tag, or editing behavior would need the IR as the new source of truth, with no merge against a fresh conversion (see below). The editor does not offer those edits. This replaces the earlier plan to switch a page to IR on its first structural edit: adding and moving turned out to fit the sidecar, which keeps edits alive across conversions.

### What survives a re-conversion of the source

Re-conversion runs the browser, then `convert()`, then the sidecar. The old IR file is not read.

| Edit | Survives? | Why |
|---|---|---|
| Sidecar entry for a name from `data-lv-name` or `id` | Yes | The author chose the name, so it is stable. |
| Sidecar entry for a class-derived name with a suffix (`card_2`) | Only by luck | The suffix shifts when siblings are added, removed or reordered, so the override can land on a different widget. `src/overrides.mjs` says this in its header. |
| Sidecar entry whose target no longer exists | No | `applyOverrides()` skips it and adds an `OVERRIDE_TARGET_UNKNOWN` diagnostic with the closest names. |
| A structure operation (add, move) whose widget or parent still exists | Yes, in effect | Operations are by name, so they replay on every conversion. An added widget is the editor's own and always comes back. |
| A move's place when siblings are added or removed in the HTML | Position can shift | A move records an index among the parent's children, so a new sibling in the HTML can shift where the widget lands by one. The name of the widget and of its new parent are what count; put `data-lv-name` on them. |
| A structure operation whose widget or parent no longer exists, or that would now break a rule (a cycle, a widget that cannot hold children, a taken name) | No | That one operation is skipped and `OVERRIDE_STRUCTURE_INVALID` says why; the rest still apply. |
| Any edit made to an exported IR file | No | A fresh conversion produces a new view. Nothing diffs or merges it with the old IR. |
| A renamed node in the IR | Breaks sidecars | The sidecar keys by `name`; after a rename every entry for the old name is `OVERRIDE_TARGET_UNKNOWN`. |

The rule the editor must follow:

1. **Never rename a node** (`name` is read-only in the property panel). Rename in the source with `data-lv-name`.
2. **Warn before writing a sidecar entry for an unstable name.** A name is stable only if the source has `data-lv-name` or `id`. The IR does not record where a name came from (`name` is just a string; **gap**, see the API table). Until it does, the editor can only guess from the suffix pattern `_<digits>`, and says so.
3. **Do not write `data-lv-name` back to the source** (no HTML round-trip). Show the exact attribute to add and the node it belongs to, and let the user add it.
4. **Structure operations are checked as they are made.** The editor applies them with the converter's own function (`src/overrides-structure.mjs`, imported, not copied), shows any operation the converter would skip as a warning at once, and never writes a move that its own plan refused.

[Back to Top](#editor)

## Architecture

```
 Browser SPA (Vite, TypeScript, Tailwind)
   tree panel | canvas (PNG + overlay) | property panel | palette
          |  JSON over HTTP, loopback only
          v
 Local server (Node, the preview API; no database)
   GET /registry   POST /render   POST /ir/validate        (planned)
   file read/write: <page>.ir.json, <page>.lvgl.json        (gap)
          |                          |
          v                          v
 Renderer interface            src/ir.mjs, src/overrides.mjs,
   RenderProgramRenderer         src/registry-export.mjs
   (spike/render/main.c)         (importIr, emitFromIr, applySidecar,
   WasmRenderer (later)           exportRegistry)
          |
          v
 Files on disk: page.html, page.ir.json, page.lvgl.json, generated XML/C/C++/Py
```

Parts:

| Part | Choice | Reason |
|---|---|---|
| SPA | TypeScript, Vite, TailwindCSS where it fits, Google TypeScript Style Guide | Project preferences. |
| Server | Node, `node:http`, JSON APIs, camelCase fields, descriptive error messages | `src/preview.mjs` already uses `node:http` with no dependency. |
| Persistence | Plain files. **No database, no Prisma in v1.** | Every artifact is already a file (IR, sidecar, source). A database would be a second copy that can disagree with the files the CLI reads. |
| Palette | `registry.json` from `--export-registry` (`src/registry-export.mjs`) | Same `props` and `slots` the converter uses. |
| Preview | The `Renderer` interface (below) | Lets the render program be replaced. |

If persistence ever appears (for example, a project list or saved layouts shared across machines), use Prisma, UUID primary keys and singular table names. None of that is needed for v1.

The server binds to `127.0.0.1` only, as `src/preview.mjs` does, because it serves generated files with no auth.

[Back to Top](#editor)

## Preview Engine

Decision, already made: the first version previews with the LVGL render program, behind a `Renderer` interface. A WebAssembly build is a later follow-up, started as a time-boxed spike.

### What exists

`src/preview.mjs` runs `execFile(renderBin, [xmlPath, bmpPath, ...fontArgs, ...componentPaths])` with a 30 second timeout and serves `/lvgl.bmp`, `/state` and `/events` (server-sent events). The default binary is `spike/build/render`, built from `spike/render/` with CMake; `html2lvgl --build-render` builds the same sources into a per-user cache for npm installs (FEATURES.md, Render program).

Facts read from `spike/render/main.c` and `spike/render/lv_conf.h`:

- The display size defaults to 320x240 and `--size=WxH` sets it (1 to 4096 in each dimension), so the editor's device-size canvas works. The framebuffer is allocated for the requested size.
- `--boxes=<file.json>` writes the final rectangle (after layout) of every named widget on the active screen, in tree order, with its depth and whether it is hidden. Verified on the dashboard golden: LVGL names every widget the IR names, with the same names, and the coordinates are stable after the last frame. It also names the component's own root wrapper (`dashboard_#`), which is not an IR node, so the render API drops names the IR does not contain.
- It loads XML with the XML runtime (`LV_USE_XML 1`), registers `montserrat_10` through `_32` built in, takes `--font=<name>=<path.bin>`, and loads component XML files from its arguments.
- It supports `--click=<widget-name>` and finds widgets by name (`find_by_name`).
- It writes one BMP, and prints nothing about widget positions.
- Each render is a new process.

### What planned means for the API

Lane C is building the render API on `feature/phase11-preview`. At the time of writing that branch was not on `origin`, and `src/render-api.mjs` did not exist, so this is the brief, not the code (**planned**, re-check before building the client):

| Planned endpoint | Job |
|---|---|
| `POST /render` | Body: an IR. Returns a PNG. |
| `GET /registry` | The registry export. |
| `POST /ir/validate` | `validateIr()` result: `{ ok, errors }`. |

The renderer sits behind a `Renderer` interface so a WebAssembly renderer can plug in. The exact method names and the error shape are **unverified** until `src/render-api.mjs` exists; the editor client should wrap them in one module so a change touches one file.

### Comparison

| Topic | Render program (v1) | LVGL WebAssembly (spike) |
|---|---|---|
| Latency per edit | A process start, XML load, font load, a few frames, then a BMP write and a PNG encode. **Unmeasured.** Measure with a 30-node page and 100 repeated renders. | No process start; one module instance can stay alive. Likely lower. **Unverified**, the spike measures it. |
| Static-site deployment | No. Needs a local Node server and a native binary. | Yes in principle: static `.wasm` and `.js`. **Unverified** until a build runs. |
| Fidelity to device | It is the same LVGL v9.4 code CI already renders for the goldens (see the fidelity score in watch mode). | Same LVGL source, but a different build target, compiler and config. Pixel parity is a hypothesis. |
| Build and maintenance | Exists. One CMake target. | A second toolchain (Emscripten), a second `lv_conf.h`, a second CI job. The LVGL docs (`docs/src/details/integration/pc/browser.rst` in the LVGL tree used here) name Emscripten and the `lv_web_emscripten` project as the route; that is a pointer, not a test. |
| Fonts and assets | Fonts are `.bin` files passed by path; images go through `LV_USE_FS_POSIX`. | There is no POSIX file system in a browser by default. Fonts and images would need Emscripten's virtual file system or memory loading. **Unverified**: confirm the XML runtime can load a font `.bin` and an image from memory. |
| XML runtime in the build | Yes, `LV_USE_XML 1` in `spike/render/lv_conf.h`. | **Unverified.** The XML runtime is plain C in LVGL v9.4, so it should compile, but nothing here has built it. A spike step compiles it and loads a golden page. |
| Offline use | Yes, once installed. | Yes, once the bundle is cached. |
| Security | Spawns a native process on user-supplied XML. Mitigated by loopback binding and a timeout. | Runs in the browser sandbox. Better isolation, but the server still writes files. |
| Hit-testing data | Not available today (see API Surface). | Direct access to `lv_obj_get_coords` is possible in principle. **Unverified.** |

### Recommendation

Ship v1 on the render program. It exists, it matches CI, and the editor can be built and tested before the spike finishes. Define the `Renderer` interface first so the client never knows which engine drew the pixels.

Run a WebAssembly spike afterwards, with a fixed time box (suggest two days), and stop it on these criteria:

| Criterion | Pass when |
|---|---|
| Fidelity | Pixel match against the render program on N golden pages (suggest N = all pages in `tests/golden-editor` and `tests/golden`). Pass = identical pixels, or a fidelity score (`scripts/fidelity.mjs`) at least as good as the render program's score against the web reference. |
| Frame time | A re-render after a one-attribute edit is under 100 ms on a mid-range laptop. (A target to adjust after the render program is measured.) |
| Bundle size | `.wasm` plus glue under 3 MB gzipped. (A budget to adjust after a first build.) |
| Assets | One custom font `.bin` and one PNG load from memory or the virtual file system. |
| XML runtime | The page XML plus a component XML load and render. |

If any criterion fails, record why and keep the render program. If all pass, add a `WasmRenderer` and keep the render program as the reference for the fidelity test.

[Back to Top](#editor)

## Version 1 Scope

### What it can do

| Capability | Built on | Status |
|---|---|---|
| Open a page's IR | `importIr()`, `--export-ir`, `validateIr()` in `src/ir.mjs` | exists |
| Show the live render at device size | `POST /render`, render program with a size argument | planned (API), gap (size) |
| Component palette from the registry | `--export-registry`, `tests/golden-editor/registry.json` | exists (read-only list; see limits) |
| Select a node in the tree panel | The IR tree, `attrs.name` | exists |
| Select a node by clicking the canvas | A pixel to node map | gap |
| Edit attributes with validation | Sidecar rules (`validateOverrides()`), IR rules (`validateIr()`) | exists |
| Edit `x`, `y`, `width`, `height` | These are plain attrs in the IR | exists, with limits below |
| Undo and redo | Client-side stack of sidecar or IR patches | gap (client) |
| Save | Write `<page>.lvgl.json` or `<page>.ir.json` | gap (file endpoint) |
| Export | `emitFromIr()` and `--from-ir` for XML, C, C++, Python | exists |
| Show diagnostics | `applySidecar()` diagnostics, `validateIr()` errors | exists |

**Move and resize.** The sample IR (`tests/golden-editor/ir_dashboard.json`) shows two situations. Nodes inside a flex container (`flex_flow: row` or `column`) carry `width` and `height` but no `x` or `y`; LVGL computes their position. Only nodes placed absolutely carry `x` and `y` (the `usage_label` and `bar` nodes). So v1 can resize any node that has `width` and `height`, and move only absolutely placed nodes. Moving a flex child means reordering it among its siblings, which is a structural IR edit. Free dragging of flex children is not supported.

**Palette limit.** The registry describes HTML recognizers: `build(node, ctx)` takes a Chromium-measured `UiNode` and returns a replacement `UiNode` (`src/recognize.mjs`). There is no function from `props` to an IR subtree. So v1's palette shows components, props and slots as documentation and as the property panel for nodes already marked `meta.component`; it cannot drop a new Card into the IR. Inserting plain widgets from the `widgets` list (a `lv_button`, a `lv_label`) is possible because those are single tags.

### What it cannot do

| Not in v1 | Reason |
|---|---|
| Round-trip back to HTML, React or Vue | The converter is one-way; this is the stated non-goal. |
| Author a new component | Components are code (`match`, `build`) in `src/components/` or plugins, not data. |
| Insert a registry component from the palette | No props-to-IR builder exists. Needs a new design (see Risks). |
| Multi-user editing | Local files only. |
| Edit fonts or images | Fonts are build artifacts of the original run (`src/ir.mjs`); `assets` lists names only. |
| Merge IR edits into a re-converted page | No merge exists. |
| Show hover or pressed states | The render program renders one state; `--click` only reaches navigation. |

[Back to Top](#editor)

## API Surface

| Piece | Where | CLI | Status |
|---|---|---|---|
| Registry export (palette and property panel data) | `src/registry-export.mjs`, `src/schemas/registry-export.schema.json`, `tests/golden-editor/registry.json` | `html2lvgl --export-registry [file\|-]` | exists |
| IR export | `exportIr()`, `stringifyIr()`, `writeIrFile()` in `src/ir.mjs` | `--export-ir <file\|dir\|->` | exists |
| IR import and validation | `importIr()`, `validateIr()`, `IrError`, `readIrFile()` | none | exists |
| IR schema | `tests/golden-editor/ir.schema.json` | none | exists |
| Emit from IR (no browser) | `emitFromIr()`, `runFromIr()` | `--from-ir <file.json>` (repeatable) | exists |
| Sidecar load, validate, apply | `loadOverrides()`, `validateOverrides()`, `applyOverrides()`, `applySidecar()`, `sidecarFor()`, `sidecarForIr()` | `--overrides`, auto-detected `<page>.lvgl.json` | exists |
| Watch-mode preview | `startPreview()` in `src/preview.mjs` | `--watch` | exists (source-driven, not IR-driven) |
| Render API: `POST /render` (IR to PNG), `GET /registry`, `POST /ir/validate`, `Renderer` interface | `src/render-api.mjs` | unknown | planned (lane C) |

### Gaps still needed

| Gap | Why the editor needs it | Proposed answer |
|---|---|---|
| Pixel to node map (hit-testing) | Click on the canvas must select a node. | **Done.** The render program's `--boxes` and the render API's `boxes` (below); `hitTest(boxes, x, y)` in `src/render-api.mjs` returns the deepest visible box under a point. |
| Render size argument | Canvas at the device size (`--size`). | **Done.** `--size=WxH` in the render program; `POST /render` accepts any `size` from 1 to 4096. A render program built before `--size` is detected (its picture has the wrong size) and answers `size_unsupported` with the rebuild command. |
| Read and write endpoints for `<page>.ir.json` and `<page>.lvgl.json` | Save and reopen. | **Sidecar half done** (`GET` and `PUT /sidecar/<name>`, started with `--workspace <dir>`): validated before writing, atomic, no sub-directories, no links followed. IR files are still opened with the browser's file picker; IR endpoints come with M4, when the editor first changes the IR. |
| Sidecar from an edit list | The editor holds edits; the sidecar is a diff against the converted view. | A pure function: `diffViewToSidecar(baseView, editedView)` returning a sidecar and a list of edits it cannot express. |
| Name provenance | Warn about unstable names. | Optionally add `meta.nameSource: "author" \| "derived"` to the IR; changes the schema, so it needs an `irVersion` decision. |
| Props to IR builder | Palette insert of components. | Open design question. |
| A tree path for nameless nodes | Tabview parts and behavior tags have no `name`. | Address by path from the nearest named ancestor, as `src/ir.mjs` suggests. |

### Hit-testing: what the IR carries and where it falls short

Verified against `tests/golden-editor/ir_dashboard.json` (screen 320x240):

- Every container has `width` and `height` in pixels. Absolute children have `x` and `y`. Flex children have no `x` or `y`.
- Labels often have neither (for example `label`, `value`, `label_2`), because their size comes from the text.
- Nothing stores the final rectangle that LVGL computes after flex layout, padding, gaps and alignment.

So a click position cannot be mapped to a node from the IR alone. A partial answer: walk `x`, `y`, `width` and `height` for absolutely placed nodes. It fails for everything in a flex container, which is most of a page.

The fix is a layout dump from the engine, now built (see the table above); the rest of this section is the reasoning that led to it.

The honest fix is a layout dump from the engine. After the final frame, the render program walks the widget tree and prints, for each named widget, `lv_obj_get_coords()` (absolute x1, y1, x2, y2). `find_by_name` already exists in `spike/render/main.c`, so the walk is a small addition. The render API returns the PNG and a `boxes` list `[{ name, x, y, width, height }]`. Hit-testing is then a client-side search for the deepest box containing the point. **Unverified:** that the XML runtime sets `name` on every widget (the harness already looks widgets up by name, which suggests yes for named ones) and that coordinates are stable after the last tick. A test on the golden pages would verify both.

[Back to Top](#editor)

## Risks and Build Plan

### Risks and open questions

| Item | Note |
|---|---|
| Hit-testing needs a harness change | Done in M0. A render program built before `--boxes` returns `boxes: null` and an info diagnostic; canvas selection is unavailable until `--build-render --rebuild`, and selection by tree still works. Boxes exist only for named widgets, so a click on an unnamed part (a tabview's internals) selects the nearest named ancestor. |
| Render latency is unmeasured | If one render takes over a second, live editing will feel slow. Mitigation: render on pause or on commit, not on every keystroke. |
| IR edits and re-conversion diverge | A user who edits the IR and later changes the HTML loses the edits. The editor must say so before the first structural edit. A real merge is a research item. |
| Unstable class-derived names | The sidecar can silently hit the wrong widget. Mitigated by warnings, not solved. |
| Palette cannot insert components | Registry `build()` works on browser-measured nodes. An IR builder per component is a large job. Open question: do v1 users need it, or is "edit what conversion produced" enough? |
| IR schema may need to change | Name provenance and any layout boxes would change `irVersion`. Decide before the editor stores IR files at scale. |
| Preview API shape unverified | Lane C code was not available. Re-read `src/render-api.mjs` before starting the client. |
| Fidelity versus the browser | The render may not match the original web page; the editor shows the LVGL result, which is what matters, but users may be surprised. |
| Security | The server runs a native binary on generated XML. Keep it on loopback with a timeout. |
| WebAssembly feasibility | Unverified end to end (fonts, XML runtime, size). The spike answers it. |
| Tailwind fit | Tailwind suits the panels. The canvas overlay is plain CSS. No conflict expected. |

### Build plan

| Milestone | Work | Exit criteria |
|---|---|---|
| M0: Contracts | Re-read lane C code. Write the TypeScript types for the registry export, IR and sidecar. Add `--size` and the `boxes` dump to the render harness. | Types generated from the JSON schemas; a test renders a golden page at 480x320 and returns boxes for every named widget. **Done.** The harness half is `--size`, `--boxes`, `boxes` in the render API and `hitTest`. The types are generated into `editor/src/generated/` from the three JSON Schemas (IR, registry export and a new sidecar schema, `src/schemas/sidecar.schema.json`, kept in step with `validateOverrides()` by a test), and a test fails when they are stale. |
| M1: Read-only viewer | Vite SPA, tree panel, canvas showing the render, diagnostics list. | Opens `ir_dashboard.json`, shows the tree and the render at 320x240. Selection by tree works. **Done** (`editor/`, see Running the editor). It also does what M3 lists for selection: a click on the canvas selects the widget, using the boxes. |
| M2: Property editing | Property panel from the registry and IR attrs, validation, sidecar writer, undo and redo, save endpoints. | Editing `width` of a named node writes a sidecar; `html2lvgl --overrides` on the source gives the same XML as the editor's export. **Done**, with one change from the plan: the panel is built from the node's own attributes, not from the registry. The registry describes the converter's components (their `data-lv-*` props), not the LVGL attributes of the nodes in an IR, so it cannot say what attributes a node may have; the panel offers the attribute names used in the page instead. Tested end to end: an edit written by the editor gives the same XML in `--from-ir` as in the editor's preview. |
| M3: Canvas | Click to select from boxes, selection overlay, resize handles, move for absolute nodes. | Clicking each named widget in the golden pages selects it. **Done.** Click-to-select came with M1. Dragging a widget moves it and eight handles resize it, for the widgets the layout allows (see Running the editor); the result is written to the sidecar as `x`, `y`, `width` and `height`, and the converter produces the same XML from the HTML page and from the IR with that sidecar. |
| M4: Structure | Reorder, delete, add plain widgets, IR save, "this page is now IR" marker. | `validateIr()` passes after each edit; `--from-ir` output equals the editor's export in all four formats. **Done, by another route than planned:** structure edits are sidecar operations (version 2: `structure` with `add` and `move`), so there is no IR switch, no "this page is now IR" marker and no IR save. The exit criterion is met the same way as for M2 and M3: the converter produces identical XML from the HTML page and from the IR with the saved sidecar, and every widget the editor can add is emitted by all four emitters. An IR save and IR file endpoints remain an optional extra for someone who designs in the editor and never has HTML. |
| M5: Spike | Time-boxed WebAssembly spike against the criteria above. | A written pass or fail report; decision recorded in this file. |

### Running the editor

The editor is a Vite, React and Tailwind single-page app in `editor/`, separate from the published package (it has its own `package.json` and lockfile and is not part of the npm workspaces). It needs the preview API and a render program:

```bash
html2lvgl --build-render            # once: builds the LVGL render program (git, cmake, a C compiler)
html2lvgl --preview-api --workspace .   # terminal 1: the preview API on 127.0.0.1:8787; --workspace is the directory the sidecars are saved in
cd editor && npm ci && npm run dev  # terminal 2: the editor, with /api proxied to the preview API
```

Set `HTML2LVGL_PREVIEW_URL` if the preview API runs elsewhere. The editor opens on the committed dashboard example. **Open IR file** loads one made with `html2lvgl page.html --export-ir ir.json`.

What it does today (M1 to M4): a tree of the widgets (collapsible; unnamed nodes are shown dimmed because a click on the canvas cannot reach them), the LVGL render at 1x to 4x, a click on the picture selects the deepest named widget under the pointer and a click on a tree row outlines it on the picture, a panel with the selected node's attributes and its final on-screen rectangle (which differs from the `width` attribute when layout resizes it), and a diagnostics panel that shows the preview API's problems (an invalid IR lists every one). 

Editing (M2): the attributes of the selected widget are editable. A change is typed to the attribute (a number stays a number, a boolean is a drop-down, a `*_color` attribute gets a colour picker and is written as `0xrrggbb`) and is committed on Enter or when the field loses focus, so one edit is one undo step. An invalid value is refused where it is typed. Reset (↺) goes back to the page's value, ✕ removes an attribute, and the form under the table adds one (the names used in the page are suggested). **Remove widget** takes a widget and everything inside it out of the generated UI, and **Restore widget** brings it back. Every edit shows in the render after a short pause, and the tree marks edited widgets (●) and strikes through removed ones. Undo and redo (buttons, Ctrl+Z, Ctrl+Shift+Z) keep up to 200 steps. The edits are the page's **sidecar**, not changes to the IR file: **Save** (Ctrl+S) writes `<ir name>.lvgl.json` in the workspace through the preview API, and opening the page again loads it. A page converted from HTML keeps the edits when the HTML changes, and `html2lvgl --from-ir <dir>/<name>.ir.json` picks the same file up by itself, so the generated XML, C, C++ and Python include the edits. **Revert** discards what changed since the last save, and opening another file, or closing the tab, with unsaved edits asks first. Without `--workspace` the editor still edits and previews; Save is off and says why.

Canvas editing (M3): the selected widget can be dragged on the picture to move it, and eight handles around it resize it. What is possible depends on how the page lays the widget out, because LVGL's flex layout places its children itself and ignores their `x` and `y`:

| The widget | Move | Resize |
|---|---|---|
| Child of a plain (absolutely positioned) parent | Yes: the drag writes `x` and `y` | Yes: eight handles; the west and north handles also change `x` and `y` so the opposite edge stays put |
| Child of a flex container | No: the canvas says it is placed by its parent's flex layout | Yes: the east, south and south-east handles |
| Child of a flex container with `flex_grow` | No | Not along the axis the layout stretches (width in a row, height in a column); the other axis, yes |
| Child of a grid, or aligned with `out_*`, or with a percentage `x` or `y` | No: the canvas says why | Yes, except for the grid case where the layout decides |
| The page itself | No | No |

A move adds the distance dragged to the widget's own `x` and `y`, so it works whatever the parent's padding is, and for a widget aligned to the right or bottom (`align="bottom_right"`) the offset grows the other way, which the drag follows. A resize starts from the size LVGL drew, so the widget follows the pointer even when the `width` attribute and the drawn size differ. While dragging, a dashed ghost shows where the widget will end up, with its position and size; the drag is one undo step (it changes `x` and `y` together); Escape abandons it, and a press that moves less than three pixels is a click. Arrow keys nudge the selected widget by one pixel, ten with Shift, for people who cannot drag. Anything the layout refuses shows a one-line reason under the picture instead of doing nothing.

Structure (M4): **Add** buttons above the tree add a plain widget (box, label, button, bar, slider, switch). It goes inside the selected widget if that can hold others, after it if not, or at the end of the page; a button comes with its label inside it. The new widget is selected, so you can name its text or colour straight away, and in a plain (non-flex) parent it starts at x 10, y 10 so it can be dragged. **Reorder and re-parent** by dragging a row in the tree (above or below another row to put it next to it, on the middle of a row to put it inside; a rose outline and a line under the tree say why a drop is not allowed), or with the **Up, Down, Out, In** buttons in the properties panel (Alt+Up and Alt+Down for the first two); a flex child can now be reordered even though the canvas cannot move it. **Delete** (the key, or Remove widget) takes an added widget back completely, with everything inside it and every edit that mentioned it, and marks an original widget removed. Added widgets are marked + in the tree and moved ones ⇅. All of it is undoable, and two moves in a row of the same widget count as one.

What is saved is version 2 of the sidecar: a `structure` list of operations applied in order, before the per-widget `nodes` overrides, so those can restyle an added widget. A sidecar without structure stays version 1, so older converters can still read it, and a version 2 file is refused by an older converter with a clear message instead of being half-applied. The format is in [FEATURES.md](FEATURES.md#sidecar-overrides).

Limits: only widgets with a name can be edited or moved (the sidecar addresses widgets by name; put `data-lv-name` on the element), nothing can be moved into or next to a widget whose parent has no name, only box-like widgets (the page, box, button) can hold children, renaming and changing a widget's type are not offered, and the add menu has plain widgets only: adding a recognized component (a Material UI card, say) needs a per-component builder, which is a separate piece of work. Dragging rows in the tree is tested in Chromium; whether Firefox starts a drag from a button inside a draggable row is untested, and the move buttons are the keyboard and fallback route. The browser does not keep the file chosen with Open IR file, so a reload returns to the example page: open the file again and its saved sidecar loads by name.

Commands in `editor/`: `npm run typecheck`, `npm test` (Vitest: hit-testing, tree, IR file checks, API client, and a check that the generated types are current), `npm run generate:types` (after changing a schema), `npm run build`, and `npm run e2e` (a headless-Chromium smoke test of the built editor against a real preview API and render program). CI runs all of them.

[Back to Top](#editor)

---

[Back to README](./README.md)
