# Exchange adapters

Every provider sits behind one interface, `ExchangeAdapter` (`packages/shared/src/adapter.ts`):

`connect · disconnect · getCapabilities · getBalances · getEquity · getPositions · getOpenOrders · getOrderHistory · getFills · getMarketSnapshot · getOrderBook · getInstruments · validateOrder · previewOrder · submitOrder · cancelOrder · amendOrder · reconcileOrder · setLeverage · subscribeAccount · subscribeMarket`

An operation the provider does not support throws `UNSUPPORTED_OPERATION`. HELM never fakes one. Each adapter talks only through `GuardedHttp` (`packages/connectors/src/http.ts`):

- The environment guard runs a **preflight before clock sync and signing**. A production host makes zero network calls; this was found and fixed on a real Bybit run.
- 429 maps to `RATE_LIMITED`.
- A transport error or 5xx on submit maps to `ORDER_UNKNOWN`, which the engine reconciles and never retries.
- Secrets are redacted from errors and logs.

| Adapter | Environment / hosts | Notes from real runs |
|---|---|---|
| **Binance** (`binance/`) | Demo Trading: `demo-api.binance.com` (spot), `demo-fapi.binance.com` (USDⓈ-M) | HMAC signing checked against doc vectors. USDⓈ-M stops go through the **Algo Order API** (`/fapi/v1/algoOrder`) because the classic endpoint returns -4120. Spot sell-back deducts the base-asset fee. A fill acked with avgPrice 0 is re-read, falling back to the trade list. Key scope (`apiRestrictions`) is 404 on demo, so it is reported as uninspectable. Spot has STOP_LIMIT but no STOP_MARKET, so spot Trade-to-Protect is not offered on Binance |
| **Bybit** (`bybit/`) | Demo Trading: `api-demo.bybit.com` | V5 signing. Conditional stops use `triggerPrice`, `triggerDirection` (2 falling / 1 rising), `triggerBy=MarkPrice`, reduce-only on linear, and `orderFilter=StopOrder` on spot. Fills come from `/v5/execution/list`, which lags, so the engine re-reads. Set-leverage 110043 ("not modified") is treated as OK. Reduce-only with no position is rejected with 110017 |
| **OKX** (`okx/`) | Demo: `www.okx.com` with `x-simulated-trading: 1` on every authenticated request | Built and covered by mocked contract tests plus live public endpoints. **Logged-in demo is BLOCKED**: OKX is unavailable in the user's region (India) |
| **Coinbase** (`coinbase/`) | Advanced Trade **static sandbox** `api-sandbox.coinbase.com` (no auth) | Responses are canned. The connection is LIMITED, orders are marked `simulatedStatic` and labelled, and they are **never shown as fills** |
| **IBKR** (`ibkr/`) | Client Portal Gateway on loopback only, paper (DU…) accounts | Checks for a DU account. Reply prompts are shown to the user, never auto-confirmed. NOT RUN live (needs a paper login and a running gateway) |
| **Alpaca** (`alpaca/`) | Paper | Not in the track list, so off by default (`HELM_ENABLE_ALPACA=true`) |
| **HELM simulator** (`simulator/`) | `environment: simulated`, for Binance/OKX/Bybit | Live public order books, fills computed locally and stored in SimLedger. Labelled `SIMULATED by HELM` on every screen, and the state is honestly LIMITED. Spot stops are SELL orders covered by free balance (Bybit-like); perp stops must be reduce-only against an open position |

## Contract tests

`packages/connectors/src/__tests__/` contains one suite per adapter against a mock fetch. The fixtures are taken from documented responses. The suites cover signing, the guard (production host gives zero calls), instrument mapping, order and stop payloads, error mapping and ORDER_UNKNOWN. The real-run scripts in `scripts/live-*.ts` exercise the same adapters against the demo exchanges; see `TEST-REPORT.md`.

## Adding a provider

1. Add hosts to the guard (`packages/shared/src/env-guard.ts`) as demo/paper/sandbox only.
2. Implement `ExchangeAdapter` (extend `BaseAdapter` and leave unsupported calls throwing).
3. Return an honest `CapabilityManifest`.
4. Add a credential schema in `apps/api/src/registry.ts`.
5. Write contract tests, then a redacted real-run script.
