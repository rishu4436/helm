# Architecture

HELM has three surfaces and one backend. The G2 glasses and the companion website are both thin clients. Every decision that matters (risk, confirmation, order state, protection) happens on the HELM API, and exchange keys never leave it.

```
 Even G2 glasses ──BLE──> phone (Even app WebView) ──HTTPS──┐
   apps/glasses: Even Hub plugin (SDK 0.0.16, .ehpk)        │
                                                            ▼
 Companion website ──HTTPS──> HELM API (apps/api, Fastify 5) ──> Postgres (Prisma)
   apps/companion: Next.js 15                │
                                             ├─> STT sidecar (services/stt, faster-whisper, 127.0.0.1:8178)
                                             └─> GuardedHttp ──> demo / paper / sandbox hosts only
                                                   Binance Demo · Bybit Demo · OKX Demo · Coinbase static sandbox · IBKR paper gateway
```

## Packages

| Package | Responsibility |
|---|---|
| `packages/shared` | Domain models and Zod schemas (`TradeIntent`, `OrderRequest`…), Decimal money maths (no floats), canonical instrument ids (`bybit:perp:BTC-USDT:USDT`), capability manifests, typed `HelmError` codes, connection-health derivation, the **environment guard** |
| `packages/connectors` | `GuardedHttp` and one adapter per provider behind a single `ExchangeAdapter` interface, plus the HELM simulator venue |
| `packages/trading-core` | Order lifecycle state machine, ProtectionWorkflow state machine, single-use confirmation tokens |
| `packages/risk-engine` | HELM Shield: deterministic `assess()`, `tradeImpact()`, Exposure Compass, scenario stress tests |
| `packages/portfolio` | Cross-account aggregation into one portfolio (USD valuation, exposures per asset and per venue) |
| `packages/pulse` | Event model for the Pulse feed (fills, protection, failures, closes) |
| `packages/voice-engine` | Deterministic parser (text → `TradeIntent`), account resolution ("Which exchange?"), STT providers |
| `packages/security` | AES-256-GCM credential vault (AAD = `user:connection`), pairing codes, hashed opaque tokens, key fingerprints |
| `apps/api` | Auth, pairing, connections, trade engine (`src/engine/trade.ts`), Shield, Pulse, voice, recipes, audit, diagnostics |
| `apps/glasses` | G2 screens as pure functions → `ScreenSpec` → `Renderer` (validates SDK limits, then flicker-free upgrades or rebuilds) |
| `apps/companion` | Website: connect accounts, terminal, positions, Trade-to-Protect, Shield, Pulse, Voice Studio, Vision (live G2 mirror), security, diagnostics |
| `services/stt` | Local open-source speech-to-text sidecar (faster-whisper `base.en`, float32) |

## Request path for a trade

1. **Intent.** A ring tap on a ticket preset, a companion form, or speech (G2 mic PCM → STT → parser) produces a `TradeIntent`. If more than one account fits, HELM asks "Which exchange?".
2. **Preview** (`POST /v1/trade/preview` or `/v1/protection/preview`). The API validates the instrument, estimates the order (book walk plus a labelled fee assumption), reads buying power, runs Shield, computes impact and a Trade-to-Protect plan. It returns a 45 s single-use confirmation token (stored hashed). A BLOCK verdict gets no token.
3. **Confirm** (`POST /v1/trade/confirm`, with an idempotency key). The API consumes the token atomically, rechecks health, price and risk, and **persists the order before submitting**.
4. **Submit and reconcile.** A timeout becomes UNKNOWN → RECONCILING and is resolved against the exchange. It is **never resubmitted**. Fills only ever come from the provider.
5. **Protect.** For entries with a stop distance, the stop is sized from the actual fill and placed reduce-only. It counts as PROTECTED only once the venue lists it.
6. **Receipt and Pulse.** The receipt shows provider truth: fills, fees, protection state, and any orphan cleanup.

## Data model (Prisma, `prisma/schema.prisma`)

- **Accounts:** User, Session, DevicePairing, Device. ExchangeConnection → ExchangeCredentialReference (sealed) → TradingAccount → AccountCapability, ProviderHealth.
- **Orders:** TradeProposal (hashed token) → OrderConfirmation → Order → OrderEvent, Fill, ExecutionAttempt.
- **Protection and policy:** ProtectionPlan (`source` = entry | recovery), RiskPolicy (versioned).
- **Activity:** PulseEvent, AuditEvent, VoiceCommand, Recipe (versioned), and the SimLedger tables for the simulator venue.

## Glasses rendering

Screens are pure functions in `apps/glasses/src/screens/` that return a `ScreenSpec` (text, list and image containers). The `Renderer`:

- maps glyphs the firmware font lacks (Ⓢ → S, ✓ → +) and sanitises list items;
- clips each list item to **63 UTF-8 bytes** (simulator 0.9.5 rejects 64);
- validates the spec against the SDK limits (≤4 text boxes, ≤20 list rows, container bounds);
- uses `textContainerUpgrade` when the structure is unchanged (for example the 45 s countdown) and a full rebuild otherwise.

If the host refuses a rebuild, the app shows DISPLAY ERROR, so its state never silently diverges from what the wearer sees.
