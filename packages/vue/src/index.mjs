/**
 * Vue single-file component plugin for html2lvgl (framework plugin).
 *
 * load():        compile the .vue entry (and any .vue it imports) with
 *                @vue/compiler-sfc, bundle with esbuild, mount it with
 *                createApp() in headless Chromium at the target resolution,
 *                wait for Vue to flush, then run the standard extraction.
 * components():  stamp data-lv-component on each component's root DOM node by
 *                walking the vnode tree, so a component used several times
 *                becomes one reusable LVGL XML component.
 * sourceOf():    file and line behind a CSS selector (a helper; the converter reads
 *                the data-lv-source attributes that load() stamps).
 *
 * The entry's default export is mounted as the root component.
 */
import esbuild from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { vueSfcPlugin } from './compile-sfc.mjs';

/** Must equal PLUGIN_API of the core this plugin was built for. */
const PLUGIN_API = 1;

/**
 * The core's browser helpers (launch, buildTree), from the core's documented
 * entry point `@richardmcquiston01/html-to-lvgl/extract` (added in 0.8.0).
 *
 * Development vs published resolution:
 *  - Published (and any normal install): the documented entry is imported
 *    from the peer dependency, so only the core's public exports are used.
 *  - Inside this repository's checkout: the sibling `src/extract.mjs` is used
 *    instead. The repository root is not a workspace member, so
 *    `node_modules` may hold an older registry copy of the core that lacks
 *    the entry; tests must run against the checkout's own code. The checkout
 *    is detected by a package.json named like the core two directories up
 *    from `packages/vue`, which a published install never has.
 */
async function loadCore() {
  const here = dirname(fileURLToPath(import.meta.url));
  const checkoutRoot = resolve(here, '../../..');
  if (isCoreCheckout(checkoutRoot)) return import(pathToFileURL(join(checkoutRoot, 'src/extract.mjs')).href);
  try {
    return await import(CORE_EXTRACT_ENTRY);
  } catch (err) {
    throw new Error(
      `could not load ${CORE_EXTRACT_ENTRY}: ${err instanceof Error ? err.message : String(err)}. ` +
      `This package needs @richardmcquiston01/html-to-lvgl ${CORE_PEER_RANGE} installed alongside it.`,
    );
  }
}

const CORE_NAME = '@richardmcquiston01/html-to-lvgl';
const CORE_EXTRACT_ENTRY = `${CORE_NAME}/extract`;
const CORE_PEER_RANGE = '>=0.8.0';

/** True when `dir` is the core's own checkout (development layout). */
function isCoreCheckout(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return pkg.name === CORE_NAME && existsSync(join(dir, 'src/extract.mjs'));
  } catch {
    return false;
  }
}

/**
 * node_modules folders to fall back on when `vue` is not installed next to
 * the .vue file (a component outside the project, a temp dir): the copy this
 * plugin itself resolves. The project's own Vue still wins when present.
 */
function fallbackNodePaths() {
  try {
    const pkg = createRequire(import.meta.url).resolve('vue/package.json');
    return [dirname(dirname(pkg))];
  } catch {
    return [];
  }
}

/**
 * Mount the entry and return a ready page. The handle owns the browser:
 * callers must call `handle.close()`.
 *
 * @param {string} vuePath
 * @param {import('../../../src/plugin.mjs').LoadOptions} options
 */
async function load(vuePath, { width = 320, height = 240, screenshotPath, frameworkData = false } = {}) {
  const abs = resolve(vuePath);
  const styles = [];
  let bundle;
  try {
    bundle = await esbuild.build({
      stdin: {
        contents: `
          import { createApp, nextTick } from 'vue';
          import App from ${JSON.stringify(abs)};
          window.__lvVueApp = createApp(App);
          window.__lvVueApp.mount('#root');
          window.__lvVueReady = nextTick().then(() => true);
        `,
        resolveDir: dirname(abs),
        sourcefile: `mount-${basename(abs)}`,
        loader: 'js',
      },
      bundle: true,
      write: false,
      outdir: dirname(abs),
      format: 'iife',
      plugins: [vueSfcPlugin({ styles })],
      nodePaths: fallbackNodePaths(),
      loader: { '.ts': 'ts', '.js': 'js' },
      // Development build of Vue: it records __vnode and __vueParentComponent
      // on DOM nodes, which components() and sourceOf() read.
      define: {
        'process.env.NODE_ENV': '"development"',
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      },
      logLevel: 'silent',
    });
  } catch (err) {
    throw new Error(formatBuildFailure(err, vuePath));
  }
  const jsOutput = bundle.outputFiles.find((f) => f.path.endsWith('.js'));
  if (!jsOutput) throw new Error(`esbuild produced no JavaScript output for ${vuePath}`);
  const cssOutput = bundle.outputFiles.find((f) => f.path.endsWith('.css'));

  const { buildTree, launch } = await loadCore();
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const runtimeErrors = [];
    page.on('pageerror', (e) => runtimeErrors.push(e.message));
    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
      `<body style="margin:0"><div id="root"></div></body></html>`
    );
    // Styles before the script so computed styles are final at extraction.
    const css = [...styles, ...(cssOutput ? [cssOutput.text] : [])].join('\n');
    if (css) await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: jsOutput.text });
    try {
      await page.waitForFunction(() => document.getElementById('root').children.length > 0, null, { timeout: 5000 });
    } catch {
      throw new Error(
        `${vuePath} mounted but rendered no elements` + (runtimeErrors.length ? `: ${runtimeErrors.join('; ')}` : ''),
      );
    }
    await page.evaluate(() => window.__lvVueReady);
    await page.evaluate(annotateVue, { frameworkData });
    const tree = await page.evaluate(buildTree);
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    return { tree, handle: { page, close: () => browser.close() } };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * One line per problem, each pointing into the .vue file when esbuild knows
 * where, so a syntax error reads like a compiler message rather than a stack.
 *
 * @param {any} err
 * @param {string} entry
 */
function formatBuildFailure(err, entry) {
  const errors = Array.isArray(err?.errors) ? err.errors : null;
  if (!errors?.length) return `could not build ${entry}: ${err instanceof Error ? err.message : String(err)}`;
  return errors.map((e) => {
    const loc = e.location;
    const where = loc?.file ? `${loc.file}${loc.line ? `:${loc.line}${loc.column !== undefined ? `:${loc.column + 1}` : ''}` : ''}: ` : '';
    return `${where}${e.text}`;
  }).join('\n');
}

/**
 * The `components` hook; idempotent. load() already runs it.
 * @param {{ handle: { page: import('playwright').Page } }} loaded
 */
async function components(loaded) {
  await loaded.handle.page.evaluate(annotateVue, { frameworkData: false });
}

/**
 * The `sourceOf` hook: the template element's file and line. The selector is
 * a CSS selector. Returns null when the element is unknown, and just the file
 * (no line) when the element did not come straight from a template.
 *
 * @param {{ handle: { page: import('playwright').Page } }} loaded
 * @param {string} selector
 */
async function sourceOf(loaded, selector) {
  return loaded.handle.page.evaluate((sel) => {
    let el = null;
    try { el = document.querySelector(sel); } catch { return null; }
    if (!el) return null;
    const file = el.__vueParentComponent && el.__vueParentComponent.type && el.__vueParentComponent.type.__file;
    if (!file) return null;
    const line = Number(el.getAttribute('data-lv-line'));
    return line ? { file, line } : { file };
  }, selector);
}

/** @type {import('../../../src/plugin.mjs').Plugin} */
const vuePlugin = {
  name: 'vue',
  pluginApi: PLUGIN_API,
  extensions: ['.vue'],
  load,
  components,
  sourceOf,
};

export default vuePlugin;

/**
 * Runs inside the page. Walks the vnode tree from the root and
 *  1. stamps data-lv-component on each named component's first host node;
 *  2. stamps data-lv-source="file:line" on template elements;
 *  3. with frameworkData, stamps data-lv-framework (JSON) naming the components
 *     whose first host node this is, innermost first.
 * Vue only keeps vnode and parent-component links on DOM nodes in its
 * development build, which load() bundles.
 *
 * @param {{ frameworkData: boolean }} options
 */
function annotateVue({ frameworkData }) {
  const container = document.getElementById('root');
  const rootVNode = container && container._vnode;
  if (!rootVNode) return;

  const ELEMENT = 1;
  const COMPONENT = 2 | 4; // functional | stateful
  const TELEPORT = 64;

  function nameOf(type) {
    if (!type) return '';
    if (typeof type === 'function') return type.displayName || type.name || '';
    return type.name || type.__name || '';
  }

  function propsOf(props) {
    const out = {};
    let count = 0;
    for (const k of Object.keys(props || {})) {
      if (k === 'children' || k === 'ref' || k === 'key' || k.startsWith('data-')) continue;
      const v = props[k];
      if (typeof v === 'string') out[k] = v.slice(0, 200);
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else continue;
      if (++count >= 20) break;
    }
    return out;
  }

  // token: the components still waiting for their first host element,
  // outermost first. A nested component takes the token over, so the
  // innermost owner of a shared root element wins, as in the React plugin.
  function visit(vnode, token) {
    if (!vnode || typeof vnode !== 'object') return;
    const flag = vnode.shapeFlag || 0;
    if (flag & COMPONENT) {
      const name = nameOf(vnode.type);
      let t = token;
      if (name) {
        const inherited = token && !token.used ? token.chain : [];
        if (token) token.used = true;
        t = { name, chain: inherited.concat({ name, props: propsOf(vnode.props) }), used: false };
      }
      if (vnode.component) visit(vnode.component.subTree, t);
      return;
    }
    if (flag & ELEMENT) {
      const el = vnode.el;
      if (token && !token.used && el && el.setAttribute) {
        el.setAttribute('data-lv-component', token.name);
        if (frameworkData) {
          const chain = token.chain.slice().reverse();
          el.setAttribute('data-lv-framework', JSON.stringify({
            componentName: chain[0].name,
            props: chain[0].props,
            chain,
          }));
        }
        token.used = true;
      }
      if (Array.isArray(vnode.children)) for (const child of vnode.children) visit(child, null);
      return;
    }
    if (vnode.suspense) { visit(vnode.suspense.activeBranch, token); return; }
    if (flag & TELEPORT || Array.isArray(vnode.children)) {
      // Fragment (or teleport): children in order; the first element child
      // takes the pending token.
      if (Array.isArray(vnode.children)) {
        const t = flag & TELEPORT ? null : token;
        for (const child of vnode.children) visit(child, t);
      }
    }
  }

  visit(rootVNode, null);

  for (const el of document.querySelectorAll('[data-lv-line]')) {
    const owner = el.__vueParentComponent;
    const file = owner && owner.type && owner.type.__file;
    if (file) el.setAttribute('data-lv-source', `${file}:${el.getAttribute('data-lv-line')}`);
  }
}
