// Dev helper: screenshot companion pages as the demo user. Usage: node e2e/shot.mjs /dashboard /portfolio ...
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
const env = Object.fromEntries(readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const r = await fetch('http://localhost:4000/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@helm.local', password: env.HELM_DEMO_PASSWORD }), signal: AbortSignal.timeout(15000) })
const { token } = await r.json()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(t => sessionStorage.setItem('helm.session', t), token)
const page = await ctx.newPage()
page.setDefaultTimeout(30000)
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
page.on('pageerror', e => errs.push(String(e).slice(0, 300)))
mkdirSync('/tmp/shots', { recursive: true })
for (const p of process.argv.slice(2)) {
  await page.goto(`http://localhost:3000${p}`, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(4000)
  const f = `/tmp/shots/${p.replace(/[^a-z0-9]/gi, '_') || 'root'}.png`
  await page.screenshot({ path: f, fullPage: true })
  console.log(f)
}
console.log('errors:', JSON.stringify(errs.slice(0, 10)))
await b.close()
