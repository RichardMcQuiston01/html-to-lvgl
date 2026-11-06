# packages

npm workspaces (`"workspaces": ["packages/*"]` in the root `package.json`).
Each subdirectory with its own `package.json` is a separately published plugin
package, for example `@richardmcquiston01/html-to-lvgl-mui` or `-vue`. The repo
root stays the published `@richardmcquiston01/html-to-lvgl`; its
`"files": ["src"]` keeps this directory out of the root tarball.

A plugin package depends on the core only through `peerDependencies`, and its
tests live in a top-level `tests/<package>.test.mjs` so the root `npm test`
runs them. This README is not a package (no `package.json`), so npm ignores it.
