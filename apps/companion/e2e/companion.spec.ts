import { expect, test } from '@playwright/test'
import { API, asDemo, demoToken, settle, shot, watchErrors } from './helpers'

/**
 * HELM companion end-to-end. Safety: no test confirms an order on a demo exchange. The only confirm
 * is on a HELM SIMULATED account (fills computed locally, nothing sent to any exchange).
 */
const PAGES: Array<[string, string, RegExp]> = [
  ['/dashboard', 'dashboard', /Good to see you/], ['/portfolio', 'portfolio', /Holdings across/], ['/positions', 'positions', /Open positions/],
  ['/terminal', 'terminal', /Trade any connected/], ['/protect', 'protect', /Every entry can carry/], ['/recipes', 'recipes', /Recipes|routines/i],
  ['/voice', 'voice', /Voice Studio|Talk to HELM/i], ['/shield', 'shield', /Shield/], ['/pulse', 'pulse', /Pulse/], ['/markets', 'markets', /best price/],
  ['/vision', 'vision', /Vision/], ['/devices', 'devices', /Devices/], ['/history', 'history', /Every order/], ['/connect', 'exchanges', /Exchanges/],
  ['/capabilities', 'capabilities', /Capability/], ['/security', 'security', /Security/], ['/settings', 'settings', /Settings/], ['/diagnostics', 'diagnostics', /Diagnostics/],
]

test.describe('public', () => {
  test('landing renders and the labelled simulated demo walks voice → Which exchange? → confirm', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/')
    await expect(page.getByText('SIMULATED SAMPLE DATA').first()).toBeVisible()
    await shot(page, '01-landing')
    const g2 = page.getByTestId('landing-g2')
    await page.getByTestId('demo-say').fill('Buy 100 dollars of BTC')
    await page.getByTestId('demo-speak').click()
    await expect(g2).toContainText('HEARD'); await expect(g2).toContainText('PLACE_ORDER')
    await page.getByTestId('ring-tap').click()
    await expect(g2).toContainText('Which exchange?')
    await page.getByTestId('ring-down').click(); await page.getByTestId('ring-tap').click()
    await expect(g2).toContainText('TRADE IMPACT'); await expect(page.getByText('Chose Bybit (sample)')).toBeVisible()
    await page.getByTestId('ring-tap').click(); await expect(g2).toContainText('RISK CHECK')
    await page.getByTestId('ring-tap').click(); await expect(g2).toContainText('CONFIRM ORDER')
    await page.getByTestId('ring-tap').click() // Cancel is the default selection
    await expect(page.getByText('Cancelled — Cancel is the default selection')).toBeVisible()
    await page.getByTestId('demo-say').fill('Long 150 dollars of ETH on Binance with a 3% stop')
    await page.getByTestId('demo-speak').click()
    for (let i = 0; i < 3; i++) await page.getByTestId('ring-tap').click()
    await page.getByTestId('ring-down').click(); await page.getByTestId('ring-tap').click()
    await expect(g2).toContainText('RECEIPT'); await expect(g2).toContainText('SIMULATED')
    await shot(page, '02-landing-demo-receipt')
    await page.getByTestId('demo-say').fill('Withdraw all my bitcoin'); await page.getByTestId('demo-speak').click()
    await expect(g2).toContainText('UNKNOWN')
    expect(errs).toEqual([])
  })

  test('register, sign out, bad password, sign in', async ({ page }) => {
    const errs = watchErrors(page)
    const email = `e2e-${Date.now()}@helm.test`
    await page.goto('/login?mode=register')
    await shot(page, '03-register')
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill('correct horse battery staple')
    await page.getByRole('button', { name: /create|register|sign up/i }).last().click()
    await page.waitForURL(/\/(connect|dashboard)/)
    await settle(page)
    await page.getByRole('button', { name: 'Sign out' }).first().click()
    await page.waitForURL(/\/login/)
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill('wrong password here')
    await page.getByRole('button', { name: /sign in|log in/i }).last().click()
    await expect(page.getByRole('alert')).toBeVisible()
    await shot(page, '04-login-error')
    await page.getByLabel(/password/i).first().fill('correct horse battery staple')
    await page.getByRole('button', { name: /sign in|log in/i }).last().click()
    await page.waitForURL(/\/(connect|dashboard)/)
    expect(errs.filter(e => !/401|Failed to load resource/.test(e))).toEqual([])
  })

  test('unauthenticated app routes redirect to login', async ({ page }) => {
    await page.goto('/portfolio')
    await page.waitForURL(/\/login\?next=/)
  })
})

test.describe('signed in as the demo user', () => {
  test.beforeEach(async ({ page }) => { await asDemo(page) })

  for (const [path, name, title] of PAGES) {
    test(`page ${path} loads without errors`, async ({ page }) => {
      const errs = watchErrors(page)
      await page.goto(path)
      await expect(page.locator('h1').first()).toHaveText(title)
      await settle(page, 2500)
      await expect(page.getByText(/Application error|Unhandled Runtime Error/)).toHaveCount(0)
      await shot(page, `page-${name}`)
      expect(errs).toEqual([])
    })
  }

  test('terminal previews on Binance Demo without confirming, then confirms only on a SIMULATED account', async ({ page }) => {
    const errs = watchErrors(page)
    const t = await demoToken()
    const accts = (await (await fetch(`${API}/v1/accounts`, { headers: { authorization: `Bearer ${t}` } })).json()).accounts as Array<{ id: string; alias: string; environment: string; products: string[] }>
    const demo = accts.find(a => a.environment === 'demo' && a.alias.includes('Binance') && a.products.includes('spot'))!
    await page.goto(`/terminal?accountId=${demo.id}&asset=BTC&product=spot&side=BUY&notional=15`)
    await settle(page)
    await page.getByTestId('preview-btn').click()
    const pv = page.getByTestId('preview-card')
    await expect(pv).toContainText(/expires in \d+s/)
    await expect(page.getByTestId('confirm')).toBeDisabled() // needs "I reviewed" first
    await shot(page, '10-terminal-preview-demo')
    await page.getByTestId('discard').click()
    const sim = accts.find(a => a.environment === 'simulated' && a.products.includes('spot'))!
    await page.goto(`/terminal?accountId=${sim.id}&asset=BTC&product=spot&side=BUY&notional=15`)
    await settle(page)
    await page.getByTestId('preview-btn').click()
    await page.getByTestId('ack').check()
    await page.getByTestId('confirm').click()
    await expect(page.getByText(/SIMULATED/).first()).toBeVisible()
    await expect(page.getByText(/FILLED|ACCEPTED|REJECTED/).first()).toBeVisible()
    await shot(page, '11-terminal-receipt-simulated')
    expect(errs).toEqual([])
  })

  test('voice sample (real WAV) → local STT → intent, no order placed', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/voice')
    await settle(page)
    await page.getByTestId('sample-buy-100-btc').click()
    const res = page.getByTestId('voice-result')
    await expect(res).toContainText('PLACE_ORDER', { timeout: 60_000 })
    await expect(page.getByTestId('g2-heard')).toContainText('HEARD')
    await expect(res).toContainText(/Which exchange\?/)
    await shot(page, '12-voice-which-exchange')
    await page.getByTestId('sample-withdraw').click()
    await expect(res).toContainText('UNKNOWN', { timeout: 60_000 })
    expect(errs).toEqual([])
  })

  test('shield scenario: crypto crash preset with stop-aware result', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/shield')
    await settle(page)
    await page.getByTestId('scenario').getByRole('button', { name: /crash/i }).first().click()
    await expect(page.getByTestId('scenario-result')).toContainText(/with stops/i)
    await shot(page, '13-shield-scenario')
    expect(errs).toEqual([])
  })

  test('recipes: pre-sleep runs checks + scenario; spot buy asks Which exchange?', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/recipes?run=builtin:pre-sleep')
    await expect(page.getByTestId('recipe-run')).toContainText('Nothing was submitted')
    await page.getByTestId('recipe-builtin:spot-buy').click()
    await page.getByTestId('run-recipe').click()
    await expect(page.getByTestId('recipe-run')).toContainText('Which exchange?')
    await shot(page, '14-recipes-which-exchange')
    expect(errs).toEqual([])
  })

  test('vision mirrors live screens with ring navigation', async ({ page }) => {
    await page.goto('/vision')
    const g2 = page.getByTestId('vision-g2')
    await expect(g2).toContainText('HELM')
    await page.getByTestId('vision-tap').click() // Overview
    await expect(g2).toContainText('ALL EXCHANGES')
    await page.getByTestId('vision-back').click()
    for (let i = 0; i < 6; i++) await page.getByTestId('vision-down').click()
    await page.getByTestId('vision-tap').click()
    await expect(g2).toContainText('EXPOSURE COMPASS')
    await shot(page, '15-vision-compass')
  })
})
