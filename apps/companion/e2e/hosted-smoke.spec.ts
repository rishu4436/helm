import { expect, test } from '@playwright/test'
import { settle, watchErrors } from './helpers'

/**
 * Production / hosted smoke. Enable with:
 *   HELM_HOSTED_SMOKE=1 HELM_COMPANION_URL=https://… HELM_API=https://… pnpm exec playwright test e2e/hosted-smoke.spec.ts
 * Never confirms an order on a real demo exchange — only on HELM-simulated accounts.
 */
const hosted = process.env.HELM_HOSTED_SMOKE === '1'
const API = process.env.HELM_API ?? ''

test.describe('hosted smoke', () => {
  test.skip(!hosted, 'set HELM_HOSTED_SMOKE=1 to run against a hosted URL')

  test('landing interactive demo walks to a labelled simulated receipt', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/')
    await expect(page.getByText('SIMULATED SAMPLE DATA').first()).toBeVisible()
    const g2 = page.getByTestId('landing-g2')
    await page.getByTestId('demo-say').fill('Long 150 dollars of ETH on Binance with a 3% stop')
    await page.getByTestId('demo-speak').click()
    for (let i = 0; i < 3; i++) await page.getByTestId('ring-tap').click()
    await page.getByTestId('ring-down').click()
    await page.getByTestId('ring-tap').click()
    await expect(g2).toContainText('RECEIPT')
    await expect(g2).toContainText('SIMULATED')
    expect(errs).toEqual([])
  })

  test('register a new account', async ({ page }) => {
    const errs = watchErrors(page)
    const email = `judge-${Date.now()}@helm.test`
    await page.goto('/login?mode=register')
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).first().fill('correct horse battery staple')
    await page.getByRole('button', { name: /create|register|sign up/i }).last().click()
    await page.waitForURL(/\/(connect|dashboard)/, { timeout: 60_000 })
    expect(errs.filter(e => !/401|Failed to load resource|net::ERR/.test(e))).toEqual([])
  })

  test('try-demo: guest session, preview, simulated confirm and receipt', async ({ page }) => {
    const errs = watchErrors(page)
    await page.goto('/')
    await page.getByTestId('try-demo').first().click()
    await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
    await expect(page.getByTestId('guest-banner')).toBeVisible()
    await expect(page.getByText(/SIMULATED/).first()).toBeVisible()
    await settle(page, 2000)
    const token = await page.evaluate(() => sessionStorage.getItem('helm.session'))
    expect(token).toBeTruthy()
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    expect(API, 'HELM_API must be set for the hosted try-demo flow').toBeTruthy()
    const accts = (await (await fetch(`${API}/v1/accounts`, { headers })).json()).accounts as Array<{ id: string; provider: string; environment: string }>
    const sim = accts.find(a => a.environment === 'simulated' && a.provider === 'binance')
    expect(sim, 'try-demo should provision a simulated Binance account').toBeTruthy()
    await page.goto(`/terminal?accountId=${sim!.id}&asset=BTC&product=spot&side=BUY&notional=15`)
    await settle(page, 2500)
    await page.getByTestId('preview-btn').click()
    await expect(page.getByTestId('preview-card')).toContainText(/SIMULATED|expires in/i)
    await page.getByTestId('ack').check()
    await page.getByTestId('confirm').click()
    await expect(page.getByText(/SIMULATED/).first()).toBeVisible()
    await expect(page.getByText(/FILLED|ACCEPTED|REJECTED/).first()).toBeVisible()
    expect(errs.filter(e => !/401|Failed to load resource|net::ERR/.test(e))).toEqual([])
  })
})
