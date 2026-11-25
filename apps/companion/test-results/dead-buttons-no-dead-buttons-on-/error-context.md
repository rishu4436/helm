# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dead-buttons.spec.ts >> no dead buttons on /
- Location: e2e/dead-buttons.spec.ts:21:3

# Error details

```
Error: dead buttons on /

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 4

- Array []
+ Array [
+   "Swipe ↑",
+   "Swipe ↓",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - banner [ref=f1e2]:
    - generic [ref=f1e3]:
      - link "HELM" [ref=f1e4] [cursor=pointer]:
        - /url: /
      - navigation [ref=f1e12]:
        - link "Interactive demo" [ref=f1e13] [cursor=pointer]:
          - /url: /#demo
        - link "How it works" [ref=f1e14] [cursor=pointer]:
          - /url: /#how
        - link "Safety" [ref=f1e15] [cursor=pointer]:
          - /url: /#safety
        - link "Exchanges" [ref=f1e16] [cursor=pointer]:
          - /url: /#exchanges
      - generic [ref=f1e17]:
        - generic "Signed requests are restricted to demo, paper and sandbox endpoints" [ref=f1e18]: Live trading off
        - link "Open dashboard" [ref=f1e19] [cursor=pointer]:
          - /url: /dashboard
  - main [ref=f1e20]:
    - generic [ref=f1e21]:
      - generic [ref=f1e23]:
        - generic [ref=f1e24]: FOR EVEN REALITIES G2
        - heading "Every exchange. One glance. Nothing executes unseen." [level=1] [ref=f1e32]: Every exchange.One glance.Nothing executes unseen.
        - paragraph [ref=f1e33]: HELM is a trading command center for your G2 glasses. It connects the exchange accounts you already have, shows the exposure that matters, and turns a spoken command into a previewed, risk-checked order you confirm with a deliberate tap.
        - generic [ref=f1e34]:
          - button "Try the demo" [ref=f1e36]
          - link "Interactive glasses demo" [ref=f1e37] [cursor=pointer]:
            - /url: "#demo"
          - link "Create a HELM account" [ref=f1e38] [cursor=pointer]:
            - /url: /login?mode=register
        - paragraph [ref=f1e39]: One click creates a guest session with simulated Binance, Bybit and OKX accounts — labelled SIMULATED, no API keys, nothing sent to any exchange.
        - paragraph [ref=f1e40]: Hackathon build · live trading is switched off · not financial advice.
      - generic [ref=f1e41]:
        - heading "INTERACTIVE DEMO" [level=2] [ref=f1e42]
        - paragraph [ref=f1e43]: Drive the glasses with a simulated R1 ring. The screens are HELM's real G2 layouts at 576×288; the numbers are simulated sample data.
        - generic [ref=f1e44]:
          - generic [ref=f1e45]:
            - generic [ref=f1e46]:
              - generic [ref=f1e47]: SIMULATED SAMPLE DATA
              - generic [ref=f1e48]: runs in your browser · nothing is sent
            - 'generic "G2 simulator: arrow keys swipe, Enter taps, Escape double-taps" [ref=f1e49]':
              - generic [ref=f1e52]:
                - paragraph [ref=f1e53]: HELM closed (double-tap on Home exits on the glasses).
                - button "Reopen" [ref=f1e54]
              - generic "G2 gestures" [ref=f1e55]:
                - button "Swipe ↑" [ref=f1e56]
                - button "Swipe ↓" [ref=f1e57]
                - button "Tap" [ref=f1e58]
                - button "Double-tap" [ref=f1e59]
                - generic [ref=f1e60]: "Keys: ↑ ↓ · Enter = tap · Esc = double-tap"
          - generic [ref=f1e61]:
            - generic [ref=f1e62]:
              - generic [ref=f1e63]: SAY SOMETHING (TYPED)
              - generic [ref=f1e64]:
                - textbox "Command" [ref=f1e65]: Withdraw all my bitcoin
                - button "Speak" [ref=f1e66]
              - generic [ref=f1e67]:
                - button "“Buy 100 dollars of BTC on Bybit”" [ref=f1e68]
                - button "“Protect my BTC long with a 3% stop”" [ref=f1e69]
                - button "“Show my ETH market”" [ref=f1e70]
                - button "“Withdraw all my bitcoin”" [ref=f1e71]
              - paragraph [ref=f1e72]: "HELM reads the command against what is on screen. It never guesses the exchange, asset or size: if one is missing, it asks. Withdrawals aren't a HELM command."
            - generic [ref=f1e73]:
              - generic [ref=f1e74]: HOW TO DRIVE IT
              - list [ref=f1e75]:
                - listitem [ref=f1e76]: • Swipe moves the highlight. Tap opens it. Double-tap goes back (or cancels).
                - listitem [ref=f1e77]: • On Confirm, Cancel is highlighted first. Swipe down to reach Confirm, then tap.
                - listitem [ref=f1e78]: "• Same gestures as the G2 temple touchpad and the R1 ring. Keyboard: ↑ ↓ Enter Esc."
              - paragraph [ref=f1e79]: "Path: home → heard"
      - generic [ref=f1e80]:
        - heading "HOW IT WORKS — EVERY ACTION, THE SAME SEVEN STEPS" [level=2] [ref=f1e81]
        - list [ref=f1e82]:
          - listitem [ref=f1e83]:
            - generic [ref=f1e84]: "01"
            - generic [ref=f1e85]: Observe
          - listitem [ref=f1e86]:
            - generic [ref=f1e87]: "02"
            - generic [ref=f1e88]: Understand
          - listitem [ref=f1e89]:
            - generic [ref=f1e90]: "03"
            - generic [ref=f1e91]: Prepare
          - listitem [ref=f1e92]:
            - generic [ref=f1e93]: "04"
            - generic [ref=f1e94]: Check risk
          - listitem [ref=f1e95]:
            - generic [ref=f1e96]: "05"
            - generic [ref=f1e97]: Confirm
          - listitem [ref=f1e98]:
            - generic [ref=f1e99]: "06"
            - generic [ref=f1e100]: Execute
          - listitem [ref=f1e101]:
            - generic [ref=f1e102]: "07"
            - generic [ref=f1e103]: Verify
        - generic [ref=f1e104]:
          - generic [ref=f1e105]:
            - generic [ref=f1e106]: Speak
            - paragraph [ref=f1e107]: Hold the ring and talk. Local speech-to-text (faster-whisper on the HELM server) and a deterministic parser — no LLM decides your trade.
          - generic [ref=f1e108]:
            - generic [ref=f1e109]: Review
            - paragraph [ref=f1e110]: Impact, fees, exposure change and Shield checks on the lens. A companion web app shows the same preview in full.
          - generic [ref=f1e111]:
            - generic [ref=f1e112]: Verify
            - paragraph [ref=f1e113]: Receipts show exchange-confirmed fills, protection state and any orphan stops HELM cleaned up.
      - generic [ref=f1e114]:
        - heading "SAFETY, BY CONSTRUCTION" [level=2] [ref=f1e115]
        - generic [ref=f1e116]:
          - generic [ref=f1e117]:
            - generic [ref=f1e118]: Demo, paper and sandbox only
            - paragraph [ref=f1e119]: Signed requests are hard-restricted to an allow-list of demo / paper / sandbox hosts. A production host is refused before any network call.
          - generic [ref=f1e120]:
            - generic [ref=f1e121]: Every order is previewed
            - paragraph [ref=f1e122]: Impact, fees, exposure change and Shield policy checks first. Each preview carries a single-use 45-second confirm token.
          - generic [ref=f1e123]:
            - generic [ref=f1e124]: Protection is never assumed
            - paragraph [ref=f1e125]: A stop shows as active only after the exchange lists it. If a stop can’t be placed, the receipt says so.
          - generic [ref=f1e126]:
            - generic [ref=f1e127]: No blind retries
            - paragraph [ref=f1e128]: If an exchange times out, HELM reconciles by client order id instead of resubmitting.
          - generic [ref=f1e129]:
            - generic [ref=f1e130]: “Which exchange?”
            - paragraph [ref=f1e131]: An ambiguous command never guesses a venue. “Close everything” is never broadcast — it becomes an itemized, reduce-only review.
          - generic [ref=f1e132]:
            - generic [ref=f1e133]: Funds never move
            - paragraph [ref=f1e134]: Trade-only keys. HELM never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permission.
      - generic [ref=f1e135]:
        - heading "EXCHANGES" [level=2] [ref=f1e136]
        - generic [ref=f1e137]:
          - generic [ref=f1e138]:
            - generic [ref=f1e139]:
              - generic [ref=f1e140]: Binance
              - generic [ref=f1e141]: DEMO
            - generic [ref=f1e142]: crypto spot · crypto derivatives
            - paragraph [ref=f1e143]: Live in the flagship demo (Spot + USDⓈ-M).
          - generic [ref=f1e144]:
            - generic [ref=f1e145]:
              - generic [ref=f1e146]: OKX
              - generic [ref=f1e147]: DEMO
            - generic [ref=f1e148]: crypto spot · crypto derivatives
            - paragraph [ref=f1e149]: Demo Trading key + secret + passphrase; x-simulated-trading on every request.
          - generic [ref=f1e150]:
            - generic [ref=f1e151]:
              - generic [ref=f1e152]: Bybit
              - generic [ref=f1e153]: DEMO
            - generic [ref=f1e154]: crypto spot · crypto derivatives
            - paragraph [ref=f1e155]: Live in the flagship demo (Unified).
          - generic [ref=f1e156]:
            - generic [ref=f1e157]:
              - generic [ref=f1e158]: Coinbase Advanced Trade
              - generic [ref=f1e159]: STATIC SANDBOX
            - generic [ref=f1e160]: crypto spot
            - paragraph [ref=f1e161]: Predefined mocked responses — never shown as fills.
          - generic [ref=f1e162]:
            - generic [ref=f1e163]:
              - generic [ref=f1e164]: Interactive Brokers
              - generic [ref=f1e165]: PAPER
            - generic [ref=f1e166]: stocks
            - paragraph [ref=f1e167]: Via local Client Portal Gateway.
          - generic [ref=f1e168]:
            - generic [ref=f1e169]:
              - generic [ref=f1e170]: Alpaca
              - generic [ref=f1e171]: DISABLED
            - generic [ref=f1e172]: stocks
            - paragraph [ref=f1e173]: Not in the track app list.
        - generic [ref=f1e174]:
          - button "Starting demo…" [disabled] [ref=f1e176]
          - link "Create a HELM account" [ref=f1e177] [cursor=pointer]:
            - /url: /login?mode=register
          - link "Sign in" [ref=f1e178] [cursor=pointer]:
            - /url: /login
  - contentinfo [ref=f1e179]: HELM hackathon build · demo, paper and sandbox environments only · not financial advice · funds never leave your exchange
  - alert [ref=f1e180]
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test'
  2  | import { asDemo, settle } from './helpers'
  3  | 
  4  | /**
  5  |  * Dead-button audit: on every page, click each visible, enabled, non-danger button and require an
  6  |  * observable effect (DOM mutation, navigation, or a network request). Danger buttons (confirm,
  7  |  * cancel order, disconnect, revoke, delete, sign out) are never clicked.
  8  |  */
  9  | const PAGES = ['/', '/dashboard', '/portfolio', '/positions', '/terminal', '/protect', '/recipes', '/voice', '/shield', '/pulse', '/markets', '/vision', '/devices', '/history', '/connect', '/capabilities', '/security', '/settings', '/diagnostics']
  10 | const SKIP = /sign out|confirm|disconnect|revoke|delete|cancel order|close position|^close all/i
  11 | 
  12 | async function tag(page: Page) {
  13 |   return page.evaluate(() => {
  14 |     const bs = Array.from(document.querySelectorAll('main button')) as HTMLButtonElement[]
  15 |     bs.forEach((b, i) => b.setAttribute('data-audit', String(i)))
  16 |     return bs.map((b, i) => ({ i, text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40), ok: !b.disabled && b.offsetParent !== null && b.getAttribute('data-danger') !== '1' && b.getAttribute('aria-pressed') !== 'true' && !(b.type === 'submit' && b.form) }))
  17 |   })
  18 | }
  19 | 
  20 | for (const path of PAGES) {
  21 |   test(`no dead buttons on ${path}`, async ({ page }) => {
  22 |     await asDemo(page)
  23 |     await page.goto(path); await settle(page, 2000)
  24 |     const buttons = (await tag(page)).filter(b => b.ok && !SKIP.test(b.text))
  25 |     const dead: string[] = []
  26 |     let reqs = 0, clicked = 0
  27 |     page.on('request', () => { reqs++ })
  28 |     for (const b of buttons.slice(0, 30)) {
  29 |       const loc = page.locator(`[data-audit="${b.i}"]`)
  30 |       if (!(await loc.count()) || !(await loc.isVisible()) || !(await loc.isEnabled())) continue
  31 |       await page.evaluate(() => { (window as unknown as { __m: number }).__m = 0; new MutationObserver(r => { (window as unknown as { __m: number }).__m += r.length }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }) })
  32 |       const url = page.url(); reqs = 0
  33 |       await loc.click({ timeout: 5000 }).catch(() => {}); clicked++
  34 |       await page.waitForTimeout(900)
  35 |       const m = await page.evaluate(() => (window as unknown as { __m?: number }).__m ?? 1).catch(() => 1)
  36 |       if (page.url() === url && m === 0 && reqs === 0) dead.push(b.text || `#${b.i}`)
  37 |       await page.keyboard.press('Escape')
  38 |       if (page.url() !== url) { await page.goto(path); await settle(page, 1500); await tag(page) }
  39 |     }
  40 |     test.info().annotations.push({ type: 'audit', description: `${path}: ${clicked} buttons clicked, ${buttons.length} eligible, dead: ${dead.length}` })
  41 |     console.log(`[audit] ${path}: clicked ${clicked}/${buttons.length} eligible; dead ${dead.length}`)
  42 |     const badLinks = await page.evaluate(() => Array.from(document.querySelectorAll('main a')).filter(a => { const h = a.getAttribute('href'); return !h || h === '#' }).map(a => (a as HTMLElement).innerText.slice(0, 40)))
  43 |     expect(badLinks, `links without a destination on ${path}`).toEqual([])
> 44 |     expect(dead, `dead buttons on ${path}`).toEqual([])
     |                                             ^ Error: dead buttons on /
  45 |   })
  46 | }
  47 | 
```