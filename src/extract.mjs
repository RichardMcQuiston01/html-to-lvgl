/**
 * Rendered-mode extraction: load an HTML page in headless Chromium at the
 * target resolution and dump a UI tree — tag, layout geometry, a computed
 * style subset (including flex container/item properties), text, and form
 * attributes. Everything downstream (IR, emitter) is pure and testable
 * without a browser; this module is the only one that needs one.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export async function extractPage(htmlPath, { width = 320, height = 240, screenshotPath } = {}) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(pathToFileURL(resolve(htmlPath)).href);
    await page.waitForLoadState('networkidle');
    const tree = await page.evaluate(buildTree);
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    return tree;
  } finally {
    await browser.close();
  }
}

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Fall back to a system-provided browser when the npm pin has no download
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

/** Runs inside the page. Must be self-contained (no imports). */
function buildTree() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT']);

  function parseColor(str) {
    const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), Math.round(a * 255)];
  }

  const px = (v) => Math.round(parseFloat(v) || 0);

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function walk(el) {
    if (SKIP.has(el.tagName)) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;

    const node = {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: (typeof el.className === 'string' && el.className.split(/\s+/)[0]) || null,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: ownText(el) || null,
      attrs: {},
      styles: {
        bgColor: parseColor(cs.backgroundColor),
        color: parseColor(cs.color),
        borderColor: parseColor(cs.borderTopColor),
        borderWidth: px(cs.borderTopWidth),
        borderBottomColor: parseColor(cs.borderBottomColor),
        borderBottomWidth: px(cs.borderBottomWidth),
        radius: px(cs.borderTopLeftRadius),
        fontSize: px(cs.fontSize) || 16,
        textAlign: cs.textAlign,
        opacity: parseFloat(cs.opacity),
        padLeft: px(cs.paddingLeft),
        padRight: px(cs.paddingRight),
        padTop: px(cs.paddingTop),
        padBottom: px(cs.paddingBottom),
      },
      layout: {
        display: cs.display,
        flexDirection: cs.flexDirection,
        flexWrap: cs.flexWrap,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        rowGap: px(cs.rowGap),
        columnGap: px(cs.columnGap),
        flexGrow: parseFloat(cs.flexGrow) || 0,
        marginLeft: px(cs.marginLeft),
        marginRight: px(cs.marginRight),
        marginTop: px(cs.marginTop),
        marginBottom: px(cs.marginBottom),
        position: cs.position,
      },
      children: [],
    };

    if (el.tagName === 'INPUT') {
      node.attrs.type = el.type;
      node.attrs.value = el.value;
      node.attrs.placeholder = el.placeholder || null;
      node.attrs.checked = el.checked;
      node.attrs.min = el.min || null;
      node.attrs.max = el.max || null;
    }
    if (el.tagName === 'SELECT') {
      node.attrs.options = [...el.options].map((o) => o.textContent.trim());
      node.attrs.selectedIndex = el.selectedIndex;
    }
    if (el.tagName === 'IMG') {
      node.attrs.src = el.getAttribute('src');
    }
    if (el.tagName === 'PROGRESS') {
      node.attrs.value = el.value;
      node.attrs.max = el.max;
    }

    for (const child of el.children) {
      const c = walk(child);
      if (c) node.children.push(c);
    }
    return node;
  }

  return walk(document.body);
}
