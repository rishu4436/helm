# Risk engine (HELM Shield)

`packages/risk-engine`. Deterministic, server-side and versioned. The glasses and the companion only display its verdict; they cannot override it. **BLOCK beats WARN beats ALLOW.** A BLOCK means no confirmation token is issued, and Shield runs again at confirm on fresh data.

## Policy (`DEFAULT_POLICY`, editable via `GET/PUT /v1/shield/policy`; every change bumps `policyVersion`)

| Field | Default | Rule id | Verdict |
|---|---|---|---|
| `maxSpotOrderUsd` | 1 000 | `max_spot_order` | BLOCK |
| `maxFuturesOrderUsd` | 2 000 | `max_futures_order` | BLOCK |
| `maxLeverage` | 5× | `max_leverage` | BLOCK |
| `maxTotalNotionalUsd` | 25 000 (derivatives) | `max_total_notional` | BLOCK |
| `maxAssetExposureUsd` | 15 000 per asset | `max_asset_exposure` | BLOCK |
| `maxExchangeExposurePct` | 80 % | `exchange_concentration` | WARN |
| `maxMarginUtilizationPct` | 50 % | `margin_utilization` | BLOCK |
| `minReserveUsd` | 100 | `min_reserve` / `buying_power` | BLOCK (WARN if the venue does not report buying power) |
| `maxSlippageBps` | 50 | `max_slippage` | BLOCK (WARN for risk-reducing orders) |
| `maxOpenOrders` | 20 | `max_open_orders` | BLOCK |
| `sessionBudgetUsd` | off | `session_budget` | BLOCK |
| `allowedInstruments` / `blockedInstruments` | [] | `allowed_instruments` / `blocked_instrument` | BLOCK |
| (always) | — | `valuation`: order value could not be estimated from live data | BLOCK |
| `nearLiquidationPct` | 10 % | Compass "near liquidation" | info |

**Risk-reducing orders** are reduce-only closes and protective stops, including Trade-to-Protect recovery stops (`reducesRisk: true`). They skip the size and exposure BLOCKs, because they can only shrink a position, and slippage becomes a WARN. Instrument lists and valuation still apply.

The demo accounts come pre-funded (Bybit Demo holds about 1 BTC, roughly $60k), so the default per-asset cap would BLOCK every buy. The demo user's policy raises only the exposure caps; per-order caps are unchanged. This is documented in PROGRESS (bug 5, 14:15 entry).

## Trade impact (`tradeImpact`)

Every preview shows the asset exposure before and after, the position before and after, spread, estimated slippage (book walk), fee (provider preview, or a labelled taker assumption), required margin, remaining buying power, and the liquidation estimate where the venue gives one. Nothing is invented: a value that cannot be computed shows "—" with a note.

## Exposure Compass (`GET /v1/shield/compass`)

- Largest directional exposure across all venues, and the largest single venue share.
- **Unprotected** perp positions: no venue-listed reduce-only stop covers them. These feed Trade-to-Protect recovery.
- Positions near liquidation and margin warnings.
- An "asset rose" (share of gross exposure, with direction per asset).

## Scenarios (`POST /v1/shield/scenarios`, presets at `/v1/shield/scenario/presets`)

A multi-asset shock (for example "crypto crash −15 %") is applied to every position and holding. A perp loss is **capped at a venue-listed reduce-only stop**; unlisted plans do not count. The result is shown per account and asset. This is a stress test, not a forecast.
