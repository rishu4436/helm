// Atlas-style deterministic renderer: Playwright screenshots of render(t) piped to ffmpeg. Usage: node render.mjs film.html <t0> <t1> <out.mp4> [step]
import { chromium } from '/workspace/helm/node_modules/.pnpm/node_modules/playwright-core/index.mjs';
import { spawn } from 'child_process'; import { resolve } from 'path';
const [,, scene, t0s, t1s, out, every] = process.argv; const fps = 30, t0 = Number(t0s), t1 = Number(t1s), step = Number(every ?? 1);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('PAGEERR', e.message)); page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()) });
await page.goto('file://' + resolve(scene)); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
const png = out.endsWith('/');
const ff = png ? null : spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps / step), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps / step), out], { stdio: ['pipe', 'inherit', 'inherit'] });
const N = Math.round((t1 - t0) * fps); let k = 0;
for (let i = 0; i < N; i += step) {
  const t = t0 + i / fps; await page.evaluate(t => render(t), t);
  const b = await page.screenshot({ type: 'jpeg', quality: 93, ...(png ? { path: `${out}${t.toFixed(2).padStart(7, '0')}.jpg` } : {}) });
  if (ff && !ff.stdin.write(b)) await new Promise(r => ff.stdin.once('drain', r));
  if (++k % 300 === 0) console.log('t', t.toFixed(1));
}
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
await browser.close(); console.log('done', out, k);
