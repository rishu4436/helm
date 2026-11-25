# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: companion.spec.ts >> signed in as the demo user >> vision runs the real G2 app on live demo data, read-only
- Location: e2e/companion.spec.ts:185:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('vision-g2')
Expected substring: "Portfolio"
Received string:    "WELCOME TO HELM1/6swipe: move · tap: chooseYour exchanges. One glance.Try HELM (2 minutes)Connect an accountSkip introductionscreen: ob-welcome · live demo data · read-only mirror"
Timeout: 20000ms

Call log:
  - Expect "toContainText" getByTestId('vision-g2') with timeout 20000ms
  - waiting for getByTestId('vision-g2')
    44 × locator resolved to <figure class="inline-block" data-testid="vision-g2">…</figure>
       - unexpected value "WELCOME TO HELM1/6swipe: move · tap: chooseYour exchanges. One glance.Try HELM (2 minutes)Connect an accountSkip introductionscreen: ob-welcome · live demo data · read-only mirror"

```

```yaml
- 'figure "screen: ob-welcome · live demo data · read-only mirror"': "WELCOME TO HELM 1/6 swipe: move · tap: choose Your exchanges. One glance. Try HELM (2 minutes) Connect an account Skip introduction screen: ob-welcome · live demo data · read-only mirror"
```

# Test source

```ts
  89  | 
  90  |   test('terminal previews on Binance Demo without confirming, then confirms only on a SIMULATED account', async ({ page }) => {
  91  |     const errs = watchErrors(page)
  92  |     const t = await demoToken()
  93  |     const accts = (await (await fetch(`${API}/v1/accounts`, { headers: { authorization: `Bearer ${t}` } })).json()).accounts as Array<{ id: string; alias: string; environment: string; products: string[] }>
  94  |     const demo = accts.find(a => a.environment === 'demo' && a.alias.includes('Binance') && a.products.includes('spot'))!
  95  |     await page.goto(`/terminal?accountId=${demo.id}&asset=BTC&product=spot&side=BUY&notional=15`)
  96  |     await settle(page)
  97  |     await page.getByTestId('preview-btn').click()
  98  |     const pv = page.getByTestId('preview-card')
  99  |     await expect(pv).toContainText(/expires in \d+s/)
  100 |     await expect(page.getByTestId('confirm')).toBeDisabled() // needs "I reviewed" first
  101 |     await shot(page, '10-terminal-preview-demo')
  102 |     await page.getByTestId('discard').click()
  103 |     const sim = accts.find(a => a.environment === 'simulated' && a.products.includes('spot'))!
  104 |     await page.goto(`/terminal?accountId=${sim.id}&asset=BTC&product=spot&side=BUY&notional=15`)
  105 |     await settle(page)
  106 |     await page.getByTestId('preview-btn').click()
  107 |     await page.getByTestId('ack').check()
  108 |     await page.getByTestId('confirm').click()
  109 |     await expect(page.getByText(/SIMULATED/).first()).toBeVisible()
  110 |     await expect(page.getByText(/FILLED|ACCEPTED|REJECTED/).first()).toBeVisible()
  111 |     await shot(page, '11-terminal-receipt-simulated')
  112 |     expect(errs).toEqual([])
  113 |   })
  114 | 
  115 |   test('Trade-to-Protect recovery on a SIMULATED perp: unprotected → Preview stop → confirm → PROTECTED → reduce-only close', async ({ page }) => {
  116 |     const errs = watchErrors(page)
  117 |     const t = await demoToken()
  118 |     const h = { authorization: `Bearer ${t}`, 'content-type': 'application/json' }
  119 |     const post = async (url: string, body: unknown) => (await fetch(`${API}${url}`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json()
  120 |     const accts = (await (await fetch(`${API}/v1/accounts`, { headers: h })).json()).accounts as Array<{ id: string; alias: string; environment: string; products: string[] }>
  121 |     const sim = accts.find(a => a.environment === 'simulated' && a.products.includes('perp'))!
  122 |     const p = await post('/v1/trade/preview', { accountId: sim.id, asset: 'BTC', product: 'perp', side: 'BUY', notional: '200', leverage: '2' })
  123 |     const r = await post('/v1/trade/confirm', { proposalId: p.proposalId, confirmToken: p.confirmToken, idempotencyKey: `e2e-recov-${Date.now()}`, via: 'companion' })
  124 |     expect(r.receipt.status).toBe('FILLED')
  125 |     await page.goto('/protect')
  126 |     await settle(page)
  127 |     const row = page.getByTestId('unprotected').locator('li', { hasText: sim.alias })
  128 |     await expect(row).toContainText('UNPROTECTED')
  129 |     await row.getByTestId('recovery-dist').fill('4')
  130 |     await row.getByTestId('recovery-preview').click()
  131 |     const panel = page.getByTestId('recovery')
  132 |     await expect(panel).toContainText(/Protect BTC/)
  133 |     await expect(panel).toContainText('STOP_MARKET · reduce-only')
  134 |     await expect(page.getByTestId('confirm')).toHaveText('Confirm reduce-only stop')
  135 |     await expect(page.getByTestId('confirm')).toBeDisabled()
  136 |     await shot(page, '29-protect-recovery-preview')
  137 |     await page.getByTestId('ack').check()
  138 |     await page.getByTestId('confirm').click()
  139 |     await expect(page.getByTestId('recovery-receipt')).toContainText('PROTECTED')
  140 |     await shot(page, '30-protect-recovery-receipt')
  141 |     // flatten: reduce-only full close (cancels the recovery stop)
  142 |     const c = await post('/v1/trade/preview', { accountId: sim.id, asset: 'BTC', product: 'perp', side: 'SELL', fraction: '1', reduceOnly: true })
  143 |     expect(c.preview.willCancel.length).toBe(1)
  144 |     const cr = await post('/v1/trade/confirm', { proposalId: c.proposalId, confirmToken: c.confirmToken, idempotencyKey: `e2e-recov-close-${Date.now()}`, via: 'companion' })
  145 |     expect(cr.receipt.orphanCleanup[0].result).toBe('CANCELED')
  146 |     expect(errs).toEqual([])
  147 |   })
  148 | 
  149 |   test('voice sample (real WAV) → local STT → intent, no order placed', async ({ page }) => {
  150 |     const errs = watchErrors(page)
  151 |     await page.goto('/voice')
  152 |     await settle(page)
  153 |     await page.getByTestId('sample-buy-100-btc').click()
  154 |     const res = page.getByTestId('voice-result')
  155 |     await expect(res).toContainText('PLACE_ORDER', { timeout: 60_000 })
  156 |     await expect(page.getByTestId('g2-heard')).toContainText('HEARD')
  157 |     await expect(res).toContainText(/Which exchange\?/)
  158 |     await shot(page, '12-voice-which-exchange')
  159 |     await page.getByTestId('sample-withdraw').click()
  160 |     await expect(res).toContainText('UNKNOWN', { timeout: 60_000 })
  161 |     expect(errs).toEqual([])
  162 |   })
  163 | 
  164 |   test('shield scenario: crypto crash preset with stop-aware result', async ({ page }) => {
  165 |     const errs = watchErrors(page)
  166 |     await page.goto('/shield')
  167 |     await settle(page)
  168 |     await page.getByTestId('scenario').getByRole('button', { name: /crash/i }).first().click()
  169 |     await expect(page.getByTestId('scenario-result')).toContainText(/with stops/i)
  170 |     await shot(page, '13-shield-scenario')
  171 |     expect(errs).toEqual([])
  172 |   })
  173 | 
  174 |   test('recipes: pre-sleep runs checks + scenario; spot buy asks Which exchange?', async ({ page }) => {
  175 |     const errs = watchErrors(page)
  176 |     await page.goto('/recipes?run=builtin:pre-sleep')
  177 |     await expect(page.getByTestId('recipe-run')).toContainText('Nothing was submitted')
  178 |     await page.getByTestId('recipe-builtin:spot-buy').click()
  179 |     await page.getByTestId('run-recipe').click()
  180 |     await expect(page.getByTestId('recipe-run')).toContainText('Which exchange?')
  181 |     await shot(page, '14-recipes-which-exchange')
  182 |     expect(errs).toEqual([])
  183 |   })
  184 | 
  185 |   test('vision runs the real G2 app on live demo data, read-only', async ({ page }) => {
  186 |     await page.goto('/vision')
  187 |     const g2 = page.getByTestId('vision-g2')
  188 |     await expect(g2).toContainText('HELM')
> 189 |     await expect(g2).toContainText('Portfolio')
      |                      ^ Error: expect(locator).toContainText(expected) failed
  190 |     const idx = (await g2.locator('.absolute > .g2-text').allInnerTexts()).findIndex(r => /^Portfolio/.test(r.trim()))
  191 |     for (let i = 0; i < Math.max(0, idx); i++) await page.getByTestId('vision-down').click()
  192 |     await page.getByTestId('vision-tap').click()
  193 |     await expect(g2).toContainText('PORTFOLIO')
  194 |     await shot(page, '15-vision-portfolio')
  195 |     await page.getByTestId('vision-back').click()
  196 |     await expect(g2).not.toContainText('PORTFOLIO ·')
  197 |   })
  198 | })
  199 | 
```