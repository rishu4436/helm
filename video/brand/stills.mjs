import { chromium } from '/workspace/helm/node_modules/.pnpm/node_modules/playwright-core/index.mjs'; import { resolve } from 'path';
const [,, scene, outdir, ...ts] = process.argv;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--force-color-profile=srgb', '--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } }); page.on('pageerror', e => console.error('PAGEERR', e.message));
await page.goto('file://' + resolve(scene)); await page.evaluate(() => document.fonts.ready);
for (const t of ts) { await page.evaluate(t => render(t), Number(t)); await page.screenshot({ path: `${outdir}/s${String(t).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 85 }) }
await browser.close()
