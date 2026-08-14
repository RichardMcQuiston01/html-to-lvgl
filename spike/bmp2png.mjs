#!/usr/bin/env node
/** Convert a BMP to PNG using Chromium (no native image deps needed). */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [, , bmpIn, pngOut] = process.argv;
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
const dataUri = 'data:image/bmp;base64,' + readFileSync(bmpIn).toString('base64');
await page.setContent(`<body style="margin:0"><img src="${dataUri}" style="display:block"></body>`);
await page.locator('img').screenshot({ path: pngOut });
await browser.close();
console.log(`${bmpIn} -> ${pngOut}`);
