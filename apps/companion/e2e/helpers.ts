import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

export const API = 'http://localhost:4000'
export const EVIDENCE = new URL('../../../evidence/companion/', import.meta.url).pathname

/** Reads HELM_DEMO_PASSWORD from the gitignored .env. Never logged. */
function demoPassword(): string {
  const line = readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n').find(l => l.startsWith('HELM_DEMO_PASSWORD='))
  if (!line) throw new Error('HELM_DEMO_PASSWORD missing from .env')
  return line.slice('HELM_DEMO_PASSWORD='.length).trim()
}
let cached: string | null = null
export async function demoToken(): Promise<string> {
  if (cached) return cached
  const r = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@helm.local', password: demoPassword() }) })
  if (!r.ok) throw new Error(`demo login failed: ${r.status}`)
  cached = (await r.json()).token as string
  return cached
}
export async function asDemo(page: Page) {
  const t = await demoToken()
  await page.addInitScript(tok => sessionStorage.setItem('helm.session', tok), t)
}
/** Collects console errors / page errors (ignores the Next dev-overlay HMR noise). */
export function watchErrors(page: Page) {
  const errs: string[] = []
  page.on('console', m => { if (m.type() === 'error' && !/Download the React DevTools|webpack-hmr|Fast Refresh/.test(m.text())) errs.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)))
  return errs
}
export async function settle(page: Page, ms = 1500) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(ms)
}
export const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE}${name}.png`, fullPage: true })
