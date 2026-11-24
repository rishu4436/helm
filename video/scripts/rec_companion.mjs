// Playwright screen recording of the HELM companion (real app, demo user). Usage: node rec_companion.mjs <segment> <outdir>
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
const [seg, out] = process.argv.slice(2); mkdirSync(out, { recursive: true })
const env = Object.fromEntries(readFileSync('/workspace/helm/.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const { token } = await (await fetch('http://localhost:4000/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@helm.local', password: env.HELM_DEMO_PASSWORD }) })).json()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: 1440, height: 810 } } })
await ctx.addInitScript(t => {
  sessionStorage.setItem('helm.session', t)
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div'); c.id = '__cur'
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:18px;height:18px;border-radius:50%;background:rgba(245,165,36,.85);box-shadow:0 0 0 3px rgba(245,165,36,.25);z-index:99999;pointer-events:none;transform:translate(-50%,-50%);transition:transform .12s'
    document.body.appendChild(c)
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)' }, true)
    addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%)' }, true)
  })
}, token)
const page = await ctx.newPage(); page.setDefaultTimeout(30000)
const T0 = Date.now(); const ev = []; const mark = v => { ev.push({ t: Date.now() - T0, v }); console.log(Date.now() - T0, v) }
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
const wait = ms => page.waitForTimeout(ms)
const glide = async (sel, ms = 700) => { const bb = await page.locator(sel).first().boundingBox(); if (bb) await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: Math.round(ms / 16) }) }
const scrollTo = async (y, ms = 1500) => { await page.evaluate(([y, ms]) => new Promise(r => { const s = scrollY, t0 = performance.now(); const f = n => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; scrollTo(0, s + (y - s) * e); k < 1 ? requestAnimationFrame(f) : r() }; requestAnimationFrame(f) }), [y, ms]) }
const go = async p => { await page.goto(`http://localhost:3000${p}`, { waitUntil: 'load' }); await page.waitForLoadState('networkidle').catch(() => {}); await page.locator('.animate-pulse').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}) }
await page.mouse.move(720, 400)
if (seg === 'a') {
  await go('/connect'); await wait(800); mark('connect-ready')
  await glide('text=Binance >> nth=0'); await wait(1500); mark('hover-binance')
  await glide('text=Bybit >> nth=0'); await wait(1500); mark('hover-bybit')
  await glide('text=Unavailable in your region'); await wait(2500); mark('hover-okx')
  await scrollTo(330, 1800); mark('scrolled-connected'); await wait(800)
  await glide('button:has-text("Re-check") >> nth=0'); await wait(400); mark('recheck-click'); await page.locator('button:has-text("Re-check")').first().click(); await wait(3000); mark('recheck-done')
  await glide('button:has-text("Re-check") >> nth=2'); await wait(2500); await scrollTo(0, 1200); await wait(1000); mark('connect-end')
  await go('/shield'); await wait(1200); mark('shield-ready')
  await glide('text=Largest exchange'); await wait(3000); mark('hover-largest')
  await scrollTo(560, 1600); mark('scroll-scenarios'); await wait(600)
  await glide('button:has-text("Crypto crash")'); await wait(300); await page.locator('button:has-text("Crypto crash")').click(); mark('crash-click'); await wait(1500)
  const run = page.locator('button:has-text("Run scenario")'); if (await run.count()) { await glide('button:has-text("Run scenario")'); await run.click(); mark('run-click') }
  await wait(2500); { const y = await page.evaluate(() => { const el = [...document.querySelectorAll('*')].find(e => e.textContent?.trim() === 'With venue-listed stops'); return el ? el.getBoundingClientRect().top + scrollY - 260 : 900 }); await scrollTo(y, 1500) } mark('scroll-results'); await glide('text=With venue-listed stops'); await wait(3000); mark('shield-end')
  await go('/protect'); await wait(1200); mark('protect-ready'); await scrollTo(330, 1500)
  await glide('text=PROTECTED >> nth=1'); await wait(4000); mark('protect-end')
} else if (seg === 'b') {
  await go('/protect'); await wait(1200); mark('protect2-ready'); await scrollTo(330, 1500)
  await glide('tbody tr >> nth=0'); await wait(4500); mark('protect2-end')
}
await wait(800)
await ctx.close(); await b.close()
const vid = readdirSync(out).find(f => f.startsWith('page@') && f.endsWith('.webm')); if (vid) renameSync(`${out}/${vid}`, `${out}/${seg}.webm`)
writeFileSync(`${out}/${seg}-events.json`, JSON.stringify({ events: ev, errors: errs }, null, 1)); console.log('errors', errs)
