# HELM — Progress log

Times are IST (UTC+5:30). Status keys: PASS · FAIL · BLOCKED · NOT RUN.

## 2026-11-24 15:51 IST — Orphan-stop fix, local STT, recipes + scenarios, complete companion site

**Done**
- **Orphan-stop cleanup:** a full reduce-only close cancels that position's reduce-only protective orders at the venue. The preview itemizes them; the receipt, Pulse and audit log record the result; protection plans go to CANCELED. Real run on Bybit Demo + Binance Demo: **PASS 12/12** → `evidence/orphan-cleanup/run-2026-11-24T08-51-42-863Z.json`.
- **Local open-source STT:** faster-whisper `base.en` sidecar on 127.0.0.1:8178 (`services/stt`), `LocalWhisperSTT` with an explicitly labelled TEST-STT fallback. Fixtures are Kokoro-spoken WAVs (synthetic voice, not human). Real WAV → STT → intent → API: **PASS 8/8, 0 orders placed** → `evidence/stt-local/run-2026-11-24T09-00-13-347Z.json`.
  - Finding: `int8` compute was nondeterministic on this CPU (up to ~40% variant/garbage transcripts for identical audio). `float32` + serialized inference gave 25/25 identical results. Documented in `docs/STT.md`.
- **Recipes** (`/v1/recipes`, versioned CRUD + 5 built-ins). Running a recipe never places orders: trade steps become previews with their own 45 s single-use tokens; a missing venue returns "Which exchange?".
- **Scenarios:** `/v1/shield/scenarios` multi-asset, stop-aware stress test (perp losses capped at a venue-listed reduce-only stop) + 5 presets.
- **Insights API:** `/v1/audit`, `/v1/voice/history`, `/v1/protection`, `/v1/diagnostics` (DB, live-trading guard, STT, each account, OKX BLOCKED, devices, signed-host allow-list). `PATCH /v1/me` (display name). Read-only 3 s per-user portfolio cache (trade engine never uses it).
- **Companion website** (Next.js 15, graphite + amber): landing with a clearly labelled **SIMULATED SAMPLE DATA** interactive G2 demo (real screen builders + real deterministic parser, runs in the browser, nothing sent), auth, Exchanges (OKX BLOCKED card, Coinbase STATIC SANDBOX), capability matrix, dashboard, terminal (preview → "I reviewed" → confirm; network error = "outcome unknown", no resubmit), portfolio, positions & orders (itemized emergency review), Trade-to-Protect, Recipes, Voice Studio (mic → 16 kHz PCM, spoken samples, typed), Shield & Exposure Compass with scenario lab, Pulse, market intelligence, Vision (live G2 mirror with ring controls), devices, history & receipts (CSV), security (sessions, key fingerprints, guard hosts, audit log), settings, diagnostics.
- `scripts/dev-up.sh` restores Postgres/STT/API/companion after a box reset.

**Verification**

| Check | Result |
|---|---|
| `pnpm test` | **PASS — 255/255 tests, 20 files** (incl. 6 real-WAV STT tests with the sidecar up) |
| `pnpm -r typecheck` | PASS (all 11 packages) |
| `next build` (companion) | PASS — 21 routes |
| Playwright (`apps/companion`, prod build, real local API + demo accounts) | **PASS 45/45** (26 page/flow tests + 19-page dead-button audit, 0 dead buttons) → `evidence/companion/playwright-report.json` |
| Screenshots | `evidence/companion/*.png` (every page + flows) |
| Demo accounts after the run | **Flat**: `demo-cleanup` → `remaining: []`; portfolio 0 positions, 0 open orders on Binance Demo Spot, Binance Demo USDⓈ-M, Bybit Demo Unified |
| OKX logged in | **BLOCKED** (region: India) |
| Real G2 hardware | NOT RUN |

Playwright safety: no test confirms on a demo exchange. The terminal test previews on Binance Demo and discards; the only confirm is on a HELM SIMULATED account (fills computed locally). The dead-button audit never clicks danger buttons (confirm, cancel order, disconnect, revoke, delete, sign out).

**Bugs found (fixed):** Tailwind 4 unlayered custom CSS overrode utilities (moved to `@layer`); Next.js rejected non-default exports from page/layout files; `/v1/portfolio` 3.6–5 s (parallel reads + cache → ~1.7 s); dead-button audit found selected-state buttons without `aria-pressed`, ring swipes at list bounds, and CSV export with no feedback.

**Known gaps**
- Attaching a stop to an *existing* unprotected position is not built (stated on /protect).
- Spot orphan cleanup is not implemented (spot stops are not reduce-only).
- "Vision" is interpreted as the live G2 HUD mirror (no separate spec text was available).
- Dead-button audit covers up to 30 buttons per page; on long lists (history, pulse, voice samples) it clicks a subset.
- Box resets wipe /tmp and uncommitted work; WIP is now committed often.

## 2026-11-24 14:15 IST — Real demo trading end to end, trade engine, glasses trade flow

**Exchanges in the flagship demo:** Binance Demo and Bybit Demo (real logged-in demo accounts).
**OKX:** logged-in tests are **BLOCKED**. OKX is unavailable in the user's region (India), so no keys will come. The OKX adapter stays fully built and is covered by mocked contract tests and public endpoints.

**Done**
- **Bybit adapter:** conditional stops (`triggerPrice`, `triggerDirection` 2 = falling / 1 = rising, `triggerBy` MarkPrice, reduce-only on linear, `orderFilter: StopOrder` on spot), fills via `/v5/execution/list`, set-leverage 110043 ("not modified") treated as OK.
- **Binance adapter:**
  - USDⓈ-M stops via the **Algo Order API** (`/fapi/v1/algoOrder`). The classic endpoint returns -4120.
  - Key scope comes from `apiRestrictions`, which is 404 on demo, so the scope is reported as uninspectable.
  - `getFills`.
- **Guard hardening:** `GuardedHttp.preflight()` now runs *before* clock sync and signing in the Binance, OKX and Bybit signed paths. A production host makes **zero** network calls, including public time sync. The Bybit live run found the earlier version sending one public `/v5/market/time` request to api.bybit.com before blocking.
- **HELM simulator venue** (`environment: simulated`) for Binance, OKX and Bybit. It uses live public books, computes fills locally, and is labelled `SIMULATED by HELM …` everywhere. The connection state is honestly LIMITED.
- **Trade engine** (`apps/api/src/engine/trade.ts`):
  - **Preview:** builds the instrument-validated request, an estimate (book walk plus labelled fee assumption, or the provider preview), buying power from the account, Shield `assess`, `tradeImpact` and a Trade-to-Protect plan. It issues a 45 s single-use token (stored as a hash) and BLOCK gets no token.
  - **Confirm:**
    1. The idempotency key replays the same order, and a used token returns 409.
    2. Atomic token consumption.
    3. Expiry gives 410.
    4. It rechecks connection health and price; a move of more than 50 bps gives STALE.
    5. It re-runs the risk check; BLOCK gives 422.
    6. The Order and its events are persisted before submit, and an ExecutionAttempt is recorded.
    7. Submit. ORDER_UNKNOWN goes to UNKNOWN → RECONCILING and is **never resubmitted**.
    8. It reconciles to provider truth and stores fills, with a short re-read because execution lists lag.
    9. It emits Pulse events.
  - **Trade-to-Protect:** the stop is sized from **actual** fills (minus base fee, capped by free balance) and is reduce-only on perps. It is **PROTECTED only when the venue lists the stop**; otherwise UNPROTECTED plus a PROTECTION_FAILED Pulse. Cancelling the stop flips it to UNPROTECTED.
- **Routes:**
  - `/v1/accounts`, `/v1/portfolio`, `/v1/markets/watchlist`, `/v1/markets/:asset` (venue compare)
  - `/v1/trade/preview|confirm`, `/v1/orders[/:id[/cancel]]`, `/v1/receipts`
  - `/v1/shield/policy|compass|scenario`, `/v1/pulse[/:id/dismiss]`
  - `/v1/emergency` (itemized, never broadcast)
  - `/v1/voice/command` (typed or PCM → STT → parser → account resolution → next screen)
  - Device or user auth.
- **Glasses:**
  - **Screens:** home menu, all-exchange overview, positions & holdings, watchlist (live public), venue compare, "Which exchange?", ticket presets, **Trade Impact → Risk check → Confirm** (Cancel is the default selection; live 45 s countdown), Submitting, Receipt, Pulse, Exposure Compass, Emergency review, Receipts, voice listening and Heard.
  - **Voice:** `audioControl(true, Glasses)` and PCM `audioEvent` capture, sent to the server STT.
  - **Pretext fit tests:** 61 glasses tests.
- **Scripts:** `wire-demo-accounts.ts` (keys from env → validated → sealed in helm_dev; never printed), `live-bybit-demo.ts`, `live-engine-demo.ts`, `approve-pairing.ts`, `demo-cleanup.ts`, `sim.sh`.

**Verification (real, redacted evidence)**

| Check | Result |
|---|---|
| `pnpm test` | **PASS — 240/240 tests, 19 files** |
| Binance Demo adapter run (spot + USDⓈ-M, algo stop, reconcile, guard) | **PASS 29/29** → `evidence/binance-demo/run-2026-11-24T08-10-53-783Z.json` |
| Bybit Demo adapter run (balance, spot limit/cancel/market/stop/sell-back, linear leverage/limit/cancel, market entry → position → **reduce-only stop from actual fill, listed Untriggered → PROTECTED** → cancel → reduce-only close → flat, reduce-only with no position rejected 110017, production guard 0 calls) | **PASS 25/25** → `evidence/bybit-demo/run-2026-11-24T08-10-31-139Z.json` (first run 24/25: the guard made 1 public time call, fixed above) |
| HELM API end to end on real Binance Demo + Bybit Demo (preview → confirm → submit → reconcile → receipt; idempotent replay; used token 409; Bybit + Binance Trade-to-Protect PROTECTED; stop cancel → UNPROTECTED; reduce-only closes; Shield BLOCK $5000; voice "Which exchange?"; Pulse) | **PASS 30/30, OKX BLOCKED** → `evidence/engine-e2e/run-2026-11-24T08-25-42-676Z.json` |
| Even Hub simulator 0.9.5: pair (demo user) → overview → holdings → watchlist → venues → Which exchange? → ticket → impact → risk → confirm (Cancel default) → submitting → **receipt FILLED on Bybit Demo with PROTECTED stop** → Pulse → Compass → Emergency → reduce-only close FILLED | **PASS** → `evidence/g2-trade-flow/*.png`, `contact-sheet.jpg`, `console.json` |
| Simulator voice: G2 mic open → 35 PCM frames captured → server STT → intent PLACE_ORDER BTC BUY $100 → **"Which exchange?"** → Binance · SIM → impact → confirm → **SIMULATED receipt** (labelled) | **PASS** (STT = deterministic **TEST STT**, labelled on screen; the simulator mic sends silence) → `evidence/g2-trade-flow/21…25` |
| OKX Demo logged in | **BLOCKED** (region) |
| Voice with a real STT provider | NOT RUN (no STT key; deterministic TEST STT is used and labelled as such) |
| Real G2 hardware | NOT RUN |

**Bugs found by real runs (fixed)**
1. Binance spot connect was LIMITED because the account-level `canWithdraw` was misread as key scope.
2. Binance USDⓈ-M stops returned -4120 and now go through the Algo Order API.
3. Binance spot sell-back failed because the base-asset fee was not deducted.
4. The production guard made one public time-sync call before blocking. A preflight now runs before the clock sync.
5. The default Shield caps (BTC exposure $15k) BLOCKED every buy on the pre-funded demo accounts (BTC ≈ $97k). The user profile now raises the exposure caps through the Shield API; per-order caps are unchanged. Evidence of the BLOCK is in `engine-e2e/run-…08-19-48`.
6. A NET (one-way) position close picked the wrong side. Binance rejected it as reduce-only, so nothing executed. Fixed using the sign of the quantity.
7. A Binance futures fill acked with avgPrice 0 left the position UNPROTECTED (honestly reported, then closed). Fixed by re-reading the order, falling back to the venue trade list.
8. G2 list items: the limit is **64 UTF-8 bytes** ("·" is 2 bytes). Simulator 0.9.5 also rejected a rebuild whose list items contained `@ ( ) _`; list items are now sanitized.
9. The "Ⓢ" glyph (USDⓈ-M) is not in the firmware font and is mapped to "S".
10. Voice upload of 8 s PCM exceeded the 64 KB API body limit (413); the voice route now allows 1 MB.
11. Bybit execution lists lag the order state. The engine re-reads, and GET /orders/:id backfills.

**Known gaps / next**
- After a reduce-only close fills, also cancel the now-orphaned protective stop (and say so in the preview). Bybit does not auto-cancel it; `demo-cleanup.ts` did it for this run.
- Companion pages: dashboard, portfolio, terminal, Shield, Pulse, history, devices, diagnostics.
- Voice: a real STT provider (a Whisper-compatible adapter exists but needs a key). Mic capture works in the simulator, which only sends silence.
- Demo video script.

## 2026-11-24 — Day 2 of build week (Phases 1–3, first glasses screens)

**Done**
- Research on the hackathon rules and tracks, the Even Hub SDK/simulator/CLI, and the provider demo/paper/sandbox APIs → `docs/RESEARCH.md`.
- `@helm/shared`:
  - domain models plus a Zod `TradeIntent`
  - Decimal money maths (no float), with step/tick rounding
  - canonical instrument ids
  - capability manifest and `assertCapability`
  - typed `HelmError` codes
  - connection-health derivation
  - **environment guard**, which allow-lists demo/paper/sandbox hosts per provider, blocks production signed endpoints, requires OKX `x-simulated-trading: 1`, keeps IBKR loopback-only and hard-fails if `HELM_LIVE_TRADING` is not `false`
  - redaction helpers
- `@helm/connectors`:
  - `GuardedHttp`: every request goes through the env guard. 429 maps to RATE_LIMITED. A transport error or 5xx on submit maps to ORDER_UNKNOWN and is reconciled, never retried blindly.
  - Binance Demo spot + USDⓈ-M, OKX demo, Bybit demo adapters, with signing checked against doc vectors.
  - Coinbase static sandbox (labelled LIMITED, orders `simulatedStatic`), Alpaca paper (off by default, not track-eligible), and IBKR Client Portal Gateway paper (DU-account check; reply prompts are never auto-confirmed).
- `@helm/trading-core`: order lifecycle state machine (CONFIRMED only by the user; fills only from the provider; UNKNOWN → RECONCILING) and single-use, 30 s, hash-bound confirmation tokens.
- `@helm/security`: AES-256-GCM credential vault (AAD = user:connection), pairing codes and hashed opaque tokens.
- Prisma schema plus migrations on local Postgres 17 (port 5444).
- `@helm/api` (Fastify 5):
  - auth sessions (scrypt)
  - G2 pairing (start / approve / claim with a poll secret, 5-min TTL, atomic approval)
  - devices, and an active account per device
  - exchange connections: validated through the adapter before storage, sealed, failed keys never stored
  - capability matrix, audit log, rate limits, CORS for local origins
- `apps/glasses` (Even Hub plugin): splash with wordmark, pairing with a large code image and live countdown, account selector (list), active account, connection error, relaunch that skips pairing. Has layout validation against G2 limits.
- `apps/companion` (Next.js 15 + Tailwind 4): landing, sign-in/up, provider-specific connect forms with permission guidance, device approval, capability matrix. A "Live trading off" pill is always visible.

**Verification**

| Check | Result |
|---|---|
| `pnpm test` (Vitest) | **PASS — 126/126 tests, 12 files** (needs local Postgres for the API suite) |
| `tsc --noEmit` on shared, connectors, trading-core, security, api, glasses | PASS |
| `next build` (companion) | PASS (6 static routes) |
| `vite build` + `evenhub pack` → `helm.ehpk` (40 KB, local only, not uploaded) | PASS |
| `pnpm check:live-public`, real public/sandbox endpoints, no credentials | **PASS 12/12** → `evidence/live-public-check.json` |
| Even Hub simulator 0.9.5 flow: splash → pairing → approve via API → accounts → set active → relaunch skips pairing | **PASS** → `evidence/g2-simulator/*.png`, console logs |
| Authenticated Binance / OKX / Bybit demo calls | **BLOCKED** (no demo API keys yet; covered by mocked contract tests only) |
| IBKR paper via Client Portal Gateway | **BLOCKED** (needs a paper account plus a locally running gateway) |
| Real G2 hardware | NOT RUN (no device) |

**Bugs found by running the simulator (fixed)**
1. The glasses client sent `Content-Type: application/json` with an empty body, so Fastify returned 400 on `/v1/pairing/start`.
2. `createStartUpPageContainer` returns 1 after a WebView reload, so HELM now falls back to rebuild.
3. `✓` is not in the firmware font.
4. Token persistence across a simulator restart now mirrors into WebView localStorage.

**Next**
- Phase 4+: portfolio and positions glance screens, live tickers over WS, and order ticket → preview → confirm-token → submit → reconcile on demo.
- Voice (STT provider), alerts.
- Demo video script.
