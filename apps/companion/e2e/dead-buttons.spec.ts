import { expect, test, type Page } from '@playwright/test'
import { asDemo, settle } from './helpers'

/**
 * Dead-button audit: on every page, click each visible, enabled, non-danger button and require an
 * observable effect (DOM mutation, navigation, or a network request). Danger buttons (confirm,
 * cancel order, disconnect, revoke, delete, sign out) are never clicked.
 */
const PAGES = ['/', '/dashboard', '/portfolio', '/positions', '/terminal', '/protect', '/recipes', '/voice', '/shield', '/pulse', '/markets', '/vision', '/devices', '/history', '/connect', '/capabilities', '/security', '/settings', '/diagnostics']
const SKIP = /sign out|confirm|disconnect|revoke|delete|cancel order|close position|^close all/i

async function tag(page: Page) {
  return page.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('main button')) as HTMLButtonElement[]
    bs.forEach((b, i) => b.setAttribute('data-audit', String(i)))
    return bs.map((b, i) => ({ i, text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40), ok: !b.disabled && b.offsetParent !== null && b.getAttribute('data-danger') !== '1' && b.getAttribute('aria-pressed') !== 'true' && !(b.type === 'submit' && b.form) }))
  })
}

for (const path of PAGES) {
  test(`no dead buttons on ${path}`, async ({ page }) => {
    await asDemo(page)
    await page.goto(path); await settle(page, 2000)
    const buttons = (await tag(page)).filter(b => b.ok && !SKIP.test(b.text))
    const dead: string[] = []
    let reqs = 0, clicked = 0
    page.on('request', () => { reqs++ })
    for (const b of buttons.slice(0, 30)) {
      const loc = page.locator(`[data-audit="${b.i}"]`)
      if (!(await loc.count()) || !(await loc.isVisible()) || !(await loc.isEnabled())) continue
      await page.evaluate(() => { (window as unknown as { __m: number }).__m = 0; new MutationObserver(r => { (window as unknown as { __m: number }).__m += r.length }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }) })
      const url = page.url(); reqs = 0
      await loc.click({ timeout: 5000 }).catch(() => {}); clicked++
      await page.waitForTimeout(900)
      const m = await page.evaluate(() => (window as unknown as { __m?: number }).__m ?? 1).catch(() => 1)
      if (page.url() === url && m === 0 && reqs === 0) dead.push(b.text || `#${b.i}`)
      await page.keyboard.press('Escape')
      if (page.url() !== url) { await page.goto(path); await settle(page, 1500); await tag(page) }
    }
    test.info().annotations.push({ type: 'audit', description: `${path}: ${clicked} buttons clicked, ${buttons.length} eligible, dead: ${dead.length}` })
    console.log(`[audit] ${path}: clicked ${clicked}/${buttons.length} eligible; dead ${dead.length}`)
    const badLinks = await page.evaluate(() => Array.from(document.querySelectorAll('main a')).filter(a => { const h = a.getAttribute('href'); return !h || h === '#' }).map(a => (a as HTMLElement).innerText.slice(0, 40)))
    expect(badLinks, `links without a destination on ${path}`).toEqual([])
    expect(dead, `dead buttons on ${path}`).toEqual([])
  })
}
