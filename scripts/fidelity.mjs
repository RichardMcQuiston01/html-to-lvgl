#!/usr/bin/env node
/**
 * Fidelity score: pixel-compare a Chromium reference screenshot with an LVGL
 * render of the converted page. Decoding happens in Chromium via canvas, so
 * no native image dependencies are needed.
 *
 * The score is the share of pixels whose max per-channel difference is within
 * the tolerance. Antialiasing and font rasterization differ legitimately
 * between the two renderers, so the default tolerance is generous; the score
 * is for tracking fidelity *changes*, not absolute pixel equality.
 *
 * Usage: node scripts/fidelity.mjs <web.png> <lvgl.png|bmp> [tolerance]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [, , refPath, testPath, tolArg] = process.argv;
if (!refPath || !testPath) {
  console.error('usage: node scripts/fidelity.mjs <reference.png> <render.png|bmp> [tolerance=32]');
  process.exit(1);
}
const tolerance = Number(tolArg ?? 32);

const mime = (p) => (p.endsWith('.bmp') ? 'image/bmp' : 'image/png');
const dataUri = (p) => `data:${mime(p)};base64,${readFileSync(p).toString('base64')}`;

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage();

const result = await page.evaluate(
  async ([refUri, testUri, tol]) => {
    const load = (uri) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = uri;
      });
    const [ref, test] = await Promise.all([load(refUri), load(testUri)]);
    if (ref.width !== test.width || ref.height !== test.height) {
      return { error: `size mismatch: ${ref.width}x${ref.height} vs ${test.width}x${test.height}` };
    }
    const data = [ref, test].map((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    });
    let match = 0;
    const total = ref.width * ref.height;
    for (let i = 0; i < total * 4; i += 4) {
      const d = Math.max(
        Math.abs(data[0][i] - data[1][i]),
        Math.abs(data[0][i + 1] - data[1][i + 1]),
        Math.abs(data[0][i + 2] - data[1][i + 2])
      );
      if (d <= tol) match++;
    }
    return { match, total };
  },
  [dataUri(refPath), dataUri(testPath), tolerance]
);

await browser.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
const pct = ((result.match / result.total) * 100).toFixed(1);
console.log(`${pct}% of pixels within tolerance ${tolerance} (${result.match}/${result.total})`);
