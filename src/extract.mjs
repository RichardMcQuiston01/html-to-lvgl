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

export async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Fall back to a system-provided browser when the npm pin has no download
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

/** Runs inside the page. Must be self-contained (no imports). */
export function buildTree() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT']);

  function parseColor(str) {
    const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), Math.round(a * 255)];
  }

  const px = (v) => Math.round(parseFloat(v) || 0);

  /** Two-stop linear-gradient -> {from, to, dir}; anything fancier is null. */
  function parseGradient(backgroundImage) {
    const m = backgroundImage && backgroundImage.match(/^linear-gradient\(([^)]*(?:\([^)]*\)[^)]*)*)\)$/);
    if (!m) return null;
    const body = m[1];
    const colors = [...body.matchAll(/rgba?\([\d.,\s]+\)/g)].map((c) => parseColor(c[0]));
    if (colors.length !== 2 || !colors[0] || !colors[1]) return null;
    let dir = 'ver'; // CSS default: top -> bottom
    const d = body.match(/^(to\s+[a-z\s]+|-?[\d.]+deg)\s*,/);
    if (d) {
      const spec = d[1].trim();
      if (spec === 'to right' || spec === 'to left' || spec === '90deg' || spec === '270deg' || spec === '-90deg') dir = 'hor';
      else if (spec !== 'to bottom' && spec !== 'to top' && spec !== '180deg' && spec !== '0deg') return null;
      if (spec === 'to left' || spec === 'to top' || spec === '0deg' || spec === '270deg' || spec === '-90deg') colors.reverse();
    }
    return { from: colors[0], to: colors[1], dir };
  }

  /** First box-shadow -> {color, x, y, blur, spread}; "none" -> null. */
  function parseShadow(boxShadow) {
    if (!boxShadow || boxShadow === 'none') return null;
    const m = boxShadow.match(/(rgba?\([\d.,\s]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/);
    if (!m) return null;
    const color = parseColor(m[1]);
    if (!color) return null;
    return { color, x: Math.round(+m[2]), y: Math.round(+m[3]), blur: Math.round(+m[4]), spread: Math.round(+m[5] || 0) };
  }

  /**
   * Map :hover/:active declarations from same-origin stylesheets onto the
   * elements they match. LVGL has no hover on touch targets, so both map to
   * the pressed state.
   */
  const pressedStyles = new Map(); // element -> {bgColor?, color?}
  function collectPressedRules() {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!rule.selectorText || !/:(hover|active)/.test(rule.selectorText)) continue;
        const base = rule.selectorText.replace(/:(hover|active)/g, '').trim();
        let els;
        try { els = base ? document.querySelectorAll(base) : []; } catch { continue; }
        for (const el of els) {
          const entry = pressedStyles.get(el) ?? {};
          const bg = parseColor(rule.style.backgroundColor);
          const fg = parseColor(rule.style.color);
          if (bg) entry.bgColor = bg;
          if (fg) entry.color = fg;
          if (Object.keys(entry).length) pressedStyles.set(el, entry);
        }
      }
    }
  }
  collectPressedRules();

  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function walk(el) {
    if (SKIP.has(el.tagName)) return null;
    if (el.hasAttribute('data-lv-ignore')) return null; // author opt-out
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;

    const node = {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: (typeof el.className === 'string' && el.className.split(/\s+/)[0]) || null,
      // Component boundary: stamped by the React fiber walk, or set manually
      // in plain HTML via data-lv-component="Name"
      component: el.getAttribute('data-lv-component') || null,
      // Author overrides: force a widget mapping / an explicit widget name
      widget: el.getAttribute('data-lv-widget') || null,
      lvName: el.getAttribute('data-lv-name') || null,
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
        gradient: parseGradient(cs.backgroundImage),
        shadow: parseShadow(cs.boxShadow),
        scrollable: cs.overflowY === 'auto' || cs.overflowY === 'scroll',
        pressed: pressedStyles.get(el) ?? null,
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
        // Computed grid templates resolve to px track lists ("60px 100px")
        gridColumns: cs.display === 'grid' ? cs.gridTemplateColumns.split(' ').map((v) => px(v)) : null,
        gridRows: cs.display === 'grid' ? cs.gridTemplateRows.split(' ').map((v) => px(v)) : null,
        gridColumnStart: cs.gridColumnStart,
        gridColumnEnd: cs.gridColumnEnd,
        gridRowStart: cs.gridRowStart,
        gridRowEnd: cs.gridRowEnd,
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
    if (el.tagName === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')];
      node.attrs.cells = rows.map((tr) =>
        [...tr.querySelectorAll('th, td')].map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())
      );
      const firstRow = rows[0]?.querySelectorAll('th, td') ?? [];
      node.attrs.columnWidths = [...firstRow].map((c) => Math.round(c.getBoundingClientRect().width));
      node.children = []; // handled as a single lv_table; don't recurse
      return node;
    }

    for (const child of el.children) {
      const c = walk(child);
      if (c) node.children.push(c);
    }
    return node;
  }

  return walk(document.body);
}
