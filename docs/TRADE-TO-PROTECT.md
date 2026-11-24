# Trade-to-Protect

The aim is that no position goes unprotected without the user knowing, and that HELM never claims protection the exchange has not confirmed.

## 1. Protected entry

Add a stop distance to any entry ("…with a 3 percent stop", the ticket preset "+ 3% stop", or the Terminal field).

1. The preview shows `Stop 3% → ≈ price` (or "unsupported here", and then no stop is promised).
2. After the entry fills, the stop is **sized from the actual fill**: filled quantity, minus any base-asset fee, capped by free balance on spot. Its price comes from the actual average fill.
3. The stop is submitted **reduce-only** on perps (STOP_MARKET; Binance USDⓈ-M uses the Algo Order API). On spot it is a stop SELL backed by the holding (Bybit and the simulator).
4. HELM reads open orders back. The plan is **PROTECTED only if the venue lists the stop**. Otherwise it is UNPROTECTED and Pulse raises a severity-3 PROTECTION_FAILED alert.

ProtectionWorkflow (`packages/trading-core/src/protection.ts`): `PLANNED → ENTRY_SUBMITTED → ENTRY_PARTIAL / ENTRY_FILLED → PROTECTION_SUBMITTED → PROTECTED | UNPROTECTED`, plus `CANCELED` and `FAILED`. Cancelling the stop flips the plan to UNPROTECTED.

## 2. Recovery: protect a position that has no stop

Positions opened elsewhere, or without a stop, show up in the Exposure Compass as **unprotected**.

| Surface | Flow |
|---|---|
| Glasses | Home → **Protect positions** → pick the position → *Reduce-only stop 2 / 3 / 5 % from mark* → **PROTECT POSITION** impact (position, stop price, mark, entry, "If triggered: P&L vs entry ≈ …", "Places no new exposure") → Risk → **CONFIRM STOP** (Cancel is the default) → receipt |
| Companion | `/protect` → Unprotected positions → stop % → **Preview stop** → preview panel ("Protect BTC…", "Confirm reduce-only stop") → receipt |
| Voice | "Add a 3 percent stop to my BTC position" or "Show unprotected positions" opens Protect positions, narrowed by asset and account. A spoken distance with a single match goes straight to the preview, which still needs the confirm taps |

API: `POST /v1/protection/preview {accountId, instrumentId, stopOffsetPercent | stopPrice}`, then the normal `POST /v1/trade/confirm`.

| Check | Result |
|---|---|
| Not a perp, or no STOP_MARKET/reduce-only support | 400, refused |
| No position | 404 NO_POSITION |
| A venue-listed stop already covers it | 409 ALREADY_PROTECTED (no duplicate stops) |
| Explicit stop on the wrong side of the mark, or a distance outside 0–50 % | 400 |
| At confirm, the position changed size or the market already crossed the stop | 409 STALE, preview again |

The order is a reduce-only STOP_MARKET for the full |position|, on the opposite side. The plan has `source=recovery` and `entryOrderId=null`. It becomes PROTECTED only once listed.

## 3. Orphan cleanup

- **Perps:** a full reduce-only close cancels that position's reduce-only protective orders at the venue. The preview itemizes them (`willCancel`); the receipt, Pulse and audit record the result (`orphanCleanup`); the plan goes to CANCELED. A partial close keeps the stop.
- **Spot:** "sell all" first cancels the asset's resting spot stops, so the whole holding can be sold and nothing fires later. If any cancel fails, **nothing is sold** (PROTECTION_RELEASE_FAILED). After any other spot sale, stops the remaining holding can no longer cover are canceled, newest first. HELM never silently re-places a smaller stop; that would need a new confirmation.

## Evidence

| Run | Result |
|---|---|
| `evidence/protection-recovery/run-2026-11-24T10-37-33-009Z.json` (real Bybit Demo linear, Binance Demo USDⓈ-M, Bybit Demo spot SOL) | 25/25 PASS |
| `evidence/orphan-cleanup/run-2026-11-24T08-51-42-863Z.json` | 12/12 PASS |
| Simulator screens `evidence/g2-trade-flow/09–25` (entry + stop + close) and `31–47` (recovery) | PASS |
| Companion `evidence/companion/29-protect-recovery-preview.png`, `30-protect-recovery-receipt.png` | PASS |
| Unit and integration tests in `apps/api/src/engine.test.ts` ("Trade-to-Protect recovery", "spot stop cleanup") | PASS |
