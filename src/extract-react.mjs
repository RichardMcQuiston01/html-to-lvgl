/**
 * React input pipeline: bundle a .jsx/.tsx component entry with esbuild
 * (react + react-dom from local node_modules), mount it in headless Chromium
 * at the target resolution, stamp each component's root DOM node with
 * data-lv-component by walking the React fiber tree, then run the standard
 * extraction. Downstream, the componentizer turns those boundaries into
 * reusable LVGL XML components.
 *
 * The entry module's default export is mounted as <App />.
 */
import esbuild from 'esbuild';
import { resolve, dirname, basename } from 'node:path';
import { buildTree, launch } from './extract.mjs';

export async function extractReactPage(jsxPath, { width = 320, height = 240, screenshotPath } = {}) {
  const abs = resolve(jsxPath);
  const bundle = await esbuild.build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { createElement } from 'react';
        import App from ${JSON.stringify(abs)};
        const root = createRoot(document.getElementById('root'));
        root.render(createElement(App));
      `,
      resolveDir: dirname(abs),
      sourcefile: `mount-${basename(abs)}`,
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    // A stdin entry has no output path of its own; esbuild needs one to
    // place a CSS asset bundled in from a component's `import './x.css'`
    // (nothing is actually written to disk since write is false).
    outdir: dirname(abs),
    format: 'iife',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.ts': 'tsx', '.tsx': 'tsx' },
    logLevel: 'silent',
  });

  // outputFiles' order isn't a stable contract (esbuild only documents that
  // it contains every emitted file — JS, any bundled CSS, source maps, ...),
  // so pick the JS entry by extension instead of assuming index 0.
  const jsOutput = bundle.outputFiles.find((f) => f.path.endsWith('.js'));
  if (!jsOutput) throw new Error(`esbuild produced no JavaScript output for ${jsxPath}`);
  const cssOutput = bundle.outputFiles.find((f) => f.path.endsWith('.css'));

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
      `<body style="margin:0"><div id="root"></div></body></html>`
    );
    // CSS before the script, so imported styles are already applied by the
    // time React mounts and extraction reads computed styles.
    if (cssOutput) await page.addStyleTag({ content: cssOutput.text });
    await page.addScriptTag({ content: jsOutput.text });
    await page.waitForFunction(() => document.getElementById('root').children.length > 0);
    await page.evaluate(annotateComponents);
    const tree = await page.evaluate(buildTree);
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    return tree;
  } finally {
    await browser.close();
  }
}

/**
 * Runs inside the page: walk the React fiber tree from the root container
 * and stamp each function component's first host DOM node with
 * data-lv-component. A token per component instance ensures exactly one
 * stamp even when the component renders fragments.
 */
function annotateComponents() {
  const container = document.getElementById('root');
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
  if (!key) return;

  // The container stores a possibly-stale alternate; the committed tree
  // hangs off the FiberRootNode's `current`.
  let rootFiber = container[key];
  if (rootFiber.stateNode && rootFiber.stateNode.current) rootFiber = rootFiber.stateNode.current;

  function visit(fiber, token) {
    if (!fiber) return;
    let t = token;
    if (typeof fiber.type === 'function' && fiber.type.name) {
      t = { name: fiber.type.name, used: false };
    }
    if (typeof fiber.type === 'string' && fiber.stateNode && fiber.stateNode.setAttribute) {
      if (t && !t.used) {
        fiber.stateNode.setAttribute('data-lv-component', t.name);
        t.used = true;
      }
      visit(fiber.child, null); // new host context; nested components restamp
    } else {
      visit(fiber.child, t);
    }
    visit(fiber.sibling, token);
  }

  visit(rootFiber.child, null);
}
