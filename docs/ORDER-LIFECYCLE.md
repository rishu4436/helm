# Order lifecycle

State machine: `packages/trading-core/src/lifecycle.ts`. The order is persisted with an `OrderEvent` row for every transition, and transitions not in the table throw.

```
DRAFT → VALIDATED → AWAITING_CONFIRMATION → CONFIRMED → SUBMITTING → ACCEPTED → PARTIALLY_FILLED → FILLED
                                     ↘ EXPIRED / CANCELED      ↘ REJECTED   ↘ UNKNOWN → RECONCILING → (provider truth)
```

| From | Allowed to |
|---|---|
| DRAFT | VALIDATED, REJECTED, EXPIRED |
| VALIDATED | AWAITING_CONFIRMATION, REJECTED, EXPIRED |
| AWAITING_CONFIRMATION | CONFIRMED (**only by the user**), EXPIRED, CANCELED |
| CONFIRMED | SUBMITTING, EXPIRED, REJECTED |
| SUBMITTING | ACCEPTED, PARTIALLY_FILLED, FILLED, REJECTED, UNKNOWN, CANCELED, EXPIRED |
| ACCEPTED / PARTIALLY_FILLED | PARTIALLY_FILLED, FILLED, CANCELED, EXPIRED, RECONCILING, UNKNOWN |
| UNKNOWN | RECONCILING only (never back to SUBMITTING) |
| RECONCILING | whatever the provider reports, or UNKNOWN again |
| FILLED, CANCELED, REJECTED, EXPIRED | terminal |

## Preview → confirm contract

1. **Preview** (`POST /v1/trade/preview`). A `TradeProposal` is created with a random confirm token, **stored only as a hash** and valid for **45 s**, single use. It is bound to the exact request (account, instrument, side, size, type, leverage, reduce-only, stop). A Shield BLOCK gets no token (`canConfirm: false`).
2. **Confirm** (`POST /v1/trade/confirm {proposalId, confirmToken, idempotencyKey, via}`):
   - The same idempotency key replays the stored result and never makes a second order. A used token returns 409 and an expired one 410.
   - The token is consumed atomically, so two racing confirms produce one order.
   - Connection health is rechecked. A price move of more than 50 bps since the preview gives `STALE`, and the user must preview again.
   - Shield is re-run on fresh data; BLOCK gives 422.
   - Recovery stops are rechecked: the position must have the same size and the market must not already be through the stop, else STALE.
   - The Order and its first events are written, and an `ExecutionAttempt` is recorded **before** the network call.
3. **Submit.** The client order id is HELM-generated, so reconciliation can find the order even when the response was lost.
4. **Outcome unknown.** A timeout, transport error or 5xx gives `ORDER_UNKNOWN` → status UNKNOWN → RECONCILING. HELM queries the venue by client order id and adopts what it finds. **It never resubmits.** The companion says "outcome unknown — check History" and disables the confirm button; the glasses show the same.
5. **Fills** come only from the provider (order read-back plus trade/execution lists, with a short re-read because venues lag). The receipt marks `fillTruth` as provider-reported. Coinbase static sandbox orders are `simulatedStatic` and never shown as fills. HELM simulator orders are labelled SIMULATED.
6. **Pulse and audit.** Every submit, fill, rejection, protection change and cleanup emits a Pulse event and an audit entry.

## Cancels and closes

- `POST /v1/orders/:id/cancel` cancels one order; there is no bulk cancel.
- A close is a reduce-only order with its own preview. A full close lists in the preview the protective orders it will cancel (`willCancel`), and the receipt shows what was actually canceled (`orphanCleanup`).
- Emergency review (`GET /v1/emergency`) is an itemized list (cancel each order, close each position), never a broadcast.
