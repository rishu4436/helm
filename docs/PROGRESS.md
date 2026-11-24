# HELM — Progress log

Times are IST (UTC+5:30). Status keys: PASS · FAIL · BLOCKED · NOT RUN.

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
