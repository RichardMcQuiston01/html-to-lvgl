#!/usr/bin/env node
/**
 * Phase 0 spike — step 1: extraction.
 *
 * Renders an HTML page in headless Chromium at the target resolution and dumps
 * a UI tree (tag, geometry, computed-style subset, text, form attributes) as
 * JSON, plus a reference screenshot for later visual comparison.
 *
 * Usage: node extract.mjs samples/login.html out/login.json out/login_web.png
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , htmlPath, jsonOut, pngOut] = process.argv;
if (!htmlPath || !jsonOut) {
  console.error('usage: node extract.mjs <page.html> <out.json> [screenshot.png]');
  process.exit(1);
}

const WIDTH = 320;
const HEIGHT = 240;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Fall back to the pre-installed browser if the npm package pin differs.
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.goto(pathToFileURL(resolve(htmlPath)).href);
await page.waitForLoadState('networkidle');

const tree = await page.evaluate(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE']);

  function parseColor(str) {
    // "rgb(r, g, b)" | "rgba(r, g, b, a)" -> [r, g, b, a255] or null if fully transparent
    const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), Math.round(a * 255)];
  }

  function ownText(el) {
    // Direct text content only (not descendants'), collapsed.
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
        borderWidth: Math.round(parseFloat(cs.borderTopWidth) || 0),
        borderBottomColor: parseColor(cs.borderBottomColor),
        borderBottomWidth: Math.round(parseFloat(cs.borderBottomWidth) || 0),
        radius: Math.round(parseFloat(cs.borderTopLeftRadius) || 0),
        fontSize: Math.round(parseFloat(cs.fontSize) || 16),
        padLeft: Math.round(parseFloat(cs.paddingLeft) || 0),
        textAlign: cs.textAlign,
        opacity: parseFloat(cs.opacity),
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

    for (const child of el.children) {
      const c = walk(child);
      if (c) node.children.push(c);
    }
    return node;
  }

  return walk(document.body);
});

writeFileSync(jsonOut, JSON.stringify(tree, null, 2));
if (pngOut) await page.screenshot({ path: pngOut });
await browser.close();
console.log(`extracted ${htmlPath} -> ${jsonOut}${pngOut ? ' + ' + pngOut : ''}`);
