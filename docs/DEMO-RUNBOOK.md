# Demo runbook

A live demo (or recording session) that takes about 15 minutes to prepare. Demo accounts only.

## 0. Before you start

- [ ] `bash scripts/dev-up.sh` (or `--restart-api` after a code change) prints 200 for :8178, :4000 and :3000.
- [ ] Companion prod build is fresh: `pnpm --filter @helm/companion build`, then kill the old `next-server` **by PID** and start `npx next start -p 3000`.
- [ ] `npx tsx scripts/check-flat.ts` shows 0 positions and 0 open orders on Binance Demo Spot, Binance Demo USDⓈ-M and Bybit Demo Unified.
- [ ] Glasses dev server on :5173 (`pnpm dev:glasses`); simulator: `cd apps/glasses && npx evenhub-simulator --no-glow --automation-port 9898 http://localhost:5173`.
- [ ] Optional voice through the simulator mic: `pactl set-default-source speakers.monitor` **before** launching the simulator, then `paplay -d speakers tests/fixtures/voice/buy-100-btc.wav` while LISTENING. Afterwards run `pactl set-default-source mic`.
- [ ] Nothing else is open on the demo accounts. Close other trading tabs.

## 1. Glance (glasses)

Tap the splash → Home → **Overview** (all exchanges, DEMO vs SIM split) → **Positions & holdings** → **Watchlist** → BTC venue compare.

## 2. Trade with protection (real Bybit Demo order)

Venue compare → tap → **Which exchange?** → Bybit Demo · Unified → *LONG $150 BTC perp 2× + 3 % stop* → **Trade Impact** → tap → **Risk check** → tap → **Confirm** (point out that Cancel is selected) → swipe down → tap → Receipt: **FILLED · Protection: PROTECTED · stop …**.

Show Pulse ("BTC stop … live at venue"), the Compass (Unprotected: 0) and Emergency review (itemized; HELM never broadcasts "close all").

## 3. Protect a position opened without a stop (real Binance Demo)

`npx tsx scripts/open-unprotected-demo.ts` opens $150 BTC long on Binance Demo USDⓈ-M without a stop. This stands in for "opened on the exchange app".

Glasses: Home → **Protect positions** (1 open) → tap → 3 % → **PROTECT POSITION** (stop price, mark, entry, P&L if triggered, "places no new exposure") → Risk → **CONFIRM STOP** → Receipt: ACCEPTED resting stop, **PROTECTED**. Protect positions now says "Every position has a venue-listed stop". Optionally show `/protect` in the companion (plan source: Recovery).

## 4. Voice

Home → **Voice command** → say or play "Buy 100 dollars of BTC" → HEARD (transcript and STT label) → **Which exchange?** → pick Binance · SIM for a labelled SIMULATED receipt, or a demo account for a real demo order. Then say "Withdraw all my bitcoin" → refused.

## 5. Close out (reduce-only only)

Glasses: Trade → each venue → *CLOSE BTC perp (reduce-only)* → the impact says "Then cancels 1 stop(s)…" → confirm → receipt "Position flat · 1/1 orphan stop(s) canceled".

## 6. After the demo

```bash
npx tsx scripts/demo-cleanup.ts      # cancels any HELM resting orders → remaining: []
npx tsx scripts/check-flat.ts        # must show positions=0 openOrders=0 on every demo account
```

If something is still open, close it **reduce-only** through HELM (Emergency review → each item). Never use a broadcast close.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Companion shows old UI or 0 buttons | A stale `next-server` is running; kill it by PID and restart after the build |
| API 500 "entryOrderId … null" | A stale API process is running an old Prisma client: `bash scripts/dev-up.sh --restart-api` |
| Glasses stuck on a screen after a tap | Look for `rebuildPageContainer failed` in the simulator console (`curl localhost:9898/api/console`); the app should now show DISPLAY ERROR. A list item ≥64 bytes was the cause once |
| A preview takes about 10 s | Bybit/Binance demo latency; taps are ignored until it returns |
| PREVIEW EXPIRED | Over 45 s since the preview, and nothing was sent. Preview again |
