/**
 * URL input mode: convert a page that is served rather than a file on disk
 * (a built or running Angular / Next / Nuxt app, a local dev server).
 *
 * The browser navigates to the URL, waits until the page is ready, then the
 * same buildTree() extractor the file flow uses runs inside it, so every
 * recognizer and component sees an identical tree. Only what differs for a
 * served page lives here: the navigation itself, error reporting, link and
 * asset resolution against the URL instead of a directory.
 *
 * Network behaviour: html2lvgl itself only contacts the URL(s) you give it
 * (plus the page's own images and fonts, which it downloads next to the
 * output). Everything else the page loads (scripts, APIs, analytics, CDN
 * fonts) is requested by the browser exactly as it would be for a visitor.
 * `blockExternal` aborts every request to another origin so a conversion is
 * reproducible and works offline against a local server. No credentials are
 * accepted or stored: URLs carrying user:password@ are refused, and no
 * cookies or headers are added.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { launch, buildTree } from './extract.mjs';

export const DEFAULT_TIMEOUT_MS = 30000;
// Upper bound for one downloaded image/font, so a wrong src can't fill the disk.
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** A user-facing failure: message names the URL and the fix, no stack trace. */
export class UrlInputError extends Error {}

/** True when an input argument is a URL rather than a file path. */
export const isUrlInput = (input) => /^[a-z][a-z0-9+.-]*:\/\//i.test(input);

/**
 * Parse and vet an input URL. Only http(s) and file are accepted; credentials
 * in the URL are refused rather than silently sent.
 * @param {string} input
 * @returns {URL}
 */
export function parseInputUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new UrlInputError(`"${input}" is not a valid URL. Use a full address such as http://localhost:4200/ or file:///path/page.html.`);
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
    throw new UrlInputError(`unsupported URL scheme "${url.protocol}" in ${input}. Only http://, https:// and file:// are accepted.`);
  }
  if (url.username || url.password) {
    throw new UrlInputError(`${input} contains credentials. html2lvgl does not accept or store credentials; serve the page without them (for example a local dev server) and drop "user:password@".`);
  }
  return url;
}

/**
 * Screen name for a URL, shaped like the file flow's basename-without-
 * extension: /app/settings.html -> settings, /app/ -> index.
 * @param {string} input
 */
export function urlScreenName(input) {
  const last = new URL(input).pathname.split('/').pop() ?? '';
  return (last.replace(/\.[a-z]+$/i, '') || 'index').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

/** Same-origin test; every file: URL counts as the same origin as another. */
function sameOrigin(a, b) {
  return a.protocol === 'file:' ? b.protocol === 'file:' : a.origin === b.origin;
}

/**
 * Turn a Playwright navigation failure into a sentence that names the URL
 * and says what to do.
 * @param {unknown} err
 * @param {string} url
 * @param {number} timeoutMs
 */
export function describeNavigationError(err, url, timeoutMs) {
  const raw = err instanceof Error ? err.message : String(err);
  const code = raw.match(/net::(ERR_[A-Z_]+)/)?.[1];
  if (err instanceof Error && err.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(raw)) {
    return `timed out after ${timeoutMs} ms loading ${url}. Check the server is responding, or raise --timeout.`;
  }
  switch (code) {
    case 'ERR_NAME_NOT_RESOLVED':
      return `could not resolve the host of ${url} (DNS lookup failed). Check the spelling of the address and your network connection.`;
    case 'ERR_CONNECTION_REFUSED':
      return `connection refused by ${url}. Start the server (for example the dev server or a static file server) and check the port.`;
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT':
      return `connection to ${url} timed out. Check the host is reachable, or raise --timeout.`;
    case 'ERR_TOO_MANY_REDIRECTS':
      return `${url} redirects in a loop (too many redirects). Open it in a browser to see where it goes and pass the final address.`;
    case 'ERR_BLOCKED_BY_CLIENT':
    case 'ERR_BLOCKED_BY_RESPONSE':
      return `the browser blocked loading ${url}. If the page refuses to be framed or loaded by automation, serve a build that allows it.`;
    case 'ERR_CERT_AUTHORITY_INVALID':
    case 'ERR_CERT_COMMON_NAME_INVALID':
    case 'ERR_CERT_DATE_INVALID':
    case 'ERR_SSL_PROTOCOL_ERROR':
      return `TLS certificate problem for ${url} (${code}). Use http:// for a local server or a certificate the browser trusts.`;
    case 'ERR_UNSAFE_PORT':
      return `the browser refuses to connect to the port in ${url} (it is on Chromium's restricted-port list). Serve the page on another port.`;
    case 'ERR_FILE_NOT_FOUND':
      return `file not found: ${url}. Check the path.`;
    default:
      return `could not load ${url}${code ? ` (${code})` : `: ${raw.split('\n')[0]}`}.`;
  }
}

/**
 * Rewrite link targets (<a href> and data-lv-link) into URL paths so the
 * converter's by-name screen resolution works for absolute and root-relative
 * links: "/settings" and "../settings.html" both resolve to screen
 * "settings"; "/" and "/docs/" to "index" and "docs/index". Links to another
 * origin are left absolute (so they never match a screen).
 * @param {object} node
 * @param {URL} base
 */
export function normalizeLinks(node, base) {
  const fix = (href) => {
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return href;
    let target;
    try { target = new URL(href, base); } catch { return href; }
    if (!sameOrigin(target, base)) return target.href;
    return target.pathname.endsWith('/') ? `${target.pathname}index` : target.pathname;
  };
  if (node.link) node.link = fix(node.link);
  if (node.attrs?.href) node.attrs.href = fix(node.attrs.href);
  for (const child of node.children ?? []) normalizeLinks(child, base);
}

/**
 * Navigate to a URL and extract the UI tree.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {string} [options.screenshotPath]
 * @param {string} [options.waitFor]       CSS selector that must be visible
 * @param {number} [options.waitMs]        extra fixed delay after readiness
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.blockExternal] abort cross-origin requests
 * @returns {Promise<any>} the UI tree (also carries fontFaces, like extractPage)
 */
export async function extractUrl(input, { width = 320, height = 240, screenshotPath, waitFor, waitMs = 0, timeoutMs = DEFAULT_TIMEOUT_MS, blockExternal = false } = {}) {
  const url = parseInputUrl(input);
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: false });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    if (blockExternal) {
      await page.route('**/*', (route) => {
        let target;
        try { target = new URL(route.request().url()); } catch { return route.abort(); }
        const inline = ['data:', 'blob:', 'about:'].includes(target.protocol);
        return inline || sameOrigin(target, url) ? route.continue() : route.abort();
      });
    }

    let response;
    try {
      response = await page.goto(url.href, { waitUntil: 'load', timeout: timeoutMs });
    } catch (err) {
      throw new UrlInputError(describeNavigationError(err, url.href, timeoutMs));
    }
    if (response && response.status() >= 400) {
      throw new UrlInputError(`${url.href} answered HTTP ${response.status()} ${response.statusText()}. Check the path, and that the server is serving the built app.`);
    }
    const finalUrl = new URL(page.url());
    if (!sameOrigin(finalUrl, url)) {
      throw new UrlInputError(`${url.href} redirected to a different origin (${finalUrl.href}). Pass the final address instead.`);
    }

    // Readiness: an explicit selector, else network idle. A page that polls
    // forever never idles; that is not an error, but say how to be exact.
    if (waitFor) {
      try {
        await page.waitForSelector(waitFor, { state: 'visible', timeout: timeoutMs });
      } catch (err) {
        throw new UrlInputError(`--wait-for "${waitFor}" never became visible on ${url.href} within ${timeoutMs} ms. Check the selector, or raise --timeout.`);
      }
    }
    try {
      await page.waitForLoadState('networkidle', { timeout: waitFor ? Math.min(timeoutMs, 2000) : timeoutMs });
    } catch {
      if (!waitFor) console.warn(`warning: ${url.href} never reached network idle within ${timeoutMs} ms; converting what has rendered. Use --wait-for <selector> to wait for specific content.`);
    }
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    if (waitMs > 0) await page.waitForTimeout(waitMs);

    const tree = await page.evaluate(buildTree);
    if (tree) normalizeLinks(tree, finalUrl);
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    return tree;
  } finally {
    await browser.close();
  }
}

/**
 * Download one asset (image or font file) a served page references, into dir,
 * keeping its basename as the file flow does. Returns the saved path, or null
 * when it was skipped (inline data:, other origin under blockExternal, HTTP
 * error, too large) with the reason.
 * @returns {Promise<{ path: string | null, reason?: string }>}
 */
export async function downloadAsset(src, pageUrl, dir, { blockExternal = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!src || src.startsWith('data:')) return { path: null, reason: 'inline' };
  let target;
  try { target = new URL(src, pageUrl); } catch { return { path: null, reason: `invalid URL "${src}"` }; }
  if (!['http:', 'https:', 'file:'].includes(target.protocol)) return { path: null, reason: `unsupported scheme ${target.protocol}` };
  const base = new URL(pageUrl);
  if (blockExternal && !sameOrigin(target, base)) return { path: null, reason: 'other origin (--block-external)' };
  try {
    let bytes;
    if (target.protocol === 'file:') {
      bytes = readFileSync(fileURLToPath(target)); // fetch() does not speak file:
    } else {
      const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { path: null, reason: `HTTP ${res.status}` };
      bytes = Buffer.from(await res.arrayBuffer());
    }
    if (bytes.length > MAX_ASSET_BYTES) return { path: null, reason: 'larger than 25 MB' };
    mkdirSync(dir, { recursive: true });
    const file = join(dir, basename(target.pathname) || 'asset');
    writeFileSync(file, bytes);
    return { path: file };
  } catch (err) {
    return { path: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Make a served page's @font-face sources usable by the font builder, which
 * only reads local files: download each to dir and point the face at it.
 * Faces that cannot be fetched keep their URL (the builder then reports the
 * family as unresolved, as it does for any remote font).
 * @param {{ fontFaces?: Array<{ url: string }> }} tree
 */
export async function localizeFontFaces(tree, pageUrl, dir, options = {}) {
  for (const face of tree?.fontFaces ?? []) {
    const r = await downloadAsset(face.url, pageUrl, dir, options);
    if (r.path) face.url = r.path;
  }
}
