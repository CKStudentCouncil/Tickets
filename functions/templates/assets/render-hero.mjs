// Renders hero.html to hero.jpg with Playwright (not a project dependency:
// install it globally or next to this file; needs network for the font).
// Run from anywhere: node functions/templates/assets/render-hero.mjs

import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const source = new URL('./hero.html', import.meta.url);
const output = new URL('./hero.jpg', import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto(source.href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('.hero').screenshot({ path: output.pathname, type: 'jpeg', quality: 78 });
await browser.close();
