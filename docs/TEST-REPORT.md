# Test report

All times are IST (UTC+5:30), 2026-11-24. Status keys: **PASS · FAIL · BLOCKED · NOT RUN**. Every real-exchange run used **demo endpoints only**. The evidence files are redacted: no key, secret or password appears (each script aborts with `REDACTION FAILURE` if one would).

## Automated suites

| # | Command | Status | Evidence / notes |
|---|---|---|---|
| 1 | `pnpm test` (Vitest, needs Postgres :5444 and the STT sidecar for the 6 real-WAV tests) | **PASS: 276/276, 21 files** (16:50) | Includes API integration tests on `helm_test`, adapter contract tests, glasses screen-fit tests (76), voice parser and STT |
| 2 | `pnpm -r typecheck` | **PASS** (all packages) | — |
| 3 | `pnpm --filter @helm/companion build` (`next build`) | **PASS** | 21 routes |
| 4 | `cd apps/companion && npx playwright test` (prod build, real local API, demo user) | **PASS: 46/46** (16:17) | `evidence/companion/playwright-report.json`, `evidence/companion/*.png`. 27 page/flow tests plus a 19-page dead-button audit (0 dead). Safety: no confirm on a demo exchange; confirms only on HELM SIMULATED accounts |
| 5 | `cd apps/glasses && pnpm run pack` | **PASS** | `apps/glasses/helm.ehpk` (48,095 bytes, rebuilt 16:55 after the voice→Protect change; local only, not uploaded) |

## Real demo-exchange runs (logged in, demo money)

| # | Command | Status | Evidence |
|---|---|---|---|
| 6 | `pnpm check:live-public` (unauthenticated public/demo/sandbox endpoints) | **PASS 12/12** (13:02) | `evidence/live-public-check.json` |
| 7 | `npx tsx scripts/live-binance-demo.ts`: spot + USDⓈ-M, algo stop, reconcile, guard | **PASS 29/29** (13:40) | `evidence/binance-demo/run-2026-11-24T08-10-53-783Z.json` (earlier runs in the same folder were fixed: see PROGRESS bugs 1–3) |
| 8 | `npx tsx scripts/live-bybit-demo.ts`: spot and linear, stop from actual fill listed → PROTECTED, reduce-only close, guard makes 0 calls | **PASS 25/25** (13:40) | `evidence/bybit-demo/run-2026-11-24T08-10-31-139Z.json` (the first run was 24/25: the guard made 1 public call, fixed) |
| 9 | `npx tsx scripts/live-engine-demo.ts`: HELM API end to end (preview → confirm → submit → reconcile → receipt, replay, 409, Trade-to-Protect, Shield BLOCK, voice "Which exchange?") | **PASS 30/30**, 1 **BLOCKED** (OKX) (13:55) | `evidence/engine-e2e/run-2026-11-24T08-25-42-676Z.json` |
| 10 | `npx tsx scripts/live-orphan-demo.ts`: partial close keeps the stop; full close cancels the orphan | **PASS 12/12** (14:21) | `evidence/orphan-cleanup/run-2026-11-24T08-51-42-863Z.json` |
| 11 | `npx tsx scripts/live-recovery-demo.ts`: **Trade-to-Protect recovery** on Bybit Demo linear and Binance Demo USDⓈ-M (open without a stop → Compass UNPROTECTED → recovery preview → PROTECTED only once listed → ALREADY_PROTECTED → reduce-only close cancels the stop → flat) plus **Bybit Demo spot sell-all releases its stop** | **PASS 25/25** (16:07) | `evidence/protection-recovery/run-2026-11-24T10-37-33-009Z.json`. The first run (16:04) was **23/25 because of a bug in the script's own check**: it read `body.code` instead of `body.error.code`, while the venue had correctly returned 409 ALREADY_PROTECTED → `run-2026-11-24T10-34-35-670Z.json` |
| 12 | `pnpm check:stt` (real WAV → local STT → intent → API, 0 orders) | **PASS 8/8** (14:30) | `evidence/stt-local/run-2026-11-24T09-00-13-347Z.json` |
| 13 | `npx tsx scripts/demo-cleanup.ts` then `npx tsx scripts/check-flat.ts` | **PASS: flat** (16:43) | `remaining: []`; Binance Demo Spot, Binance Demo USDⓈ-M and Bybit Demo Unified each have positions=0 and openOrders=0. The Bybit spot SOL sale left about 0.00006 SOL of dust below the lot step |

## Even Hub simulator 0.9.5 (real API, real demo accounts)

Driver: `python3 scripts/sim-run.py <flow.json> evidence/g2-trade-flow`. Before each screenshot it waits for the app's `[HELM] screen <name>` log.

| # | Flow | Status | Evidence |
|---|---|---|---|
| 14 | `scripts/sim-flows/01-entry-protect-close.json`: home → overview → holdings → watchlist → venues → Which exchange? → ticket → LONG $150 perp 2× + 3 % stop on **Bybit Demo** → impact → risk → confirm (Cancel default) → receipt **FILLED + PROTECTED** → Pulse → Compass → Emergency → Protect positions (none) → reduce-only close → receipt "1/1 orphan stop canceled" | **PASS** (82/82 steps) | `evidence/g2-trade-flow/01…25*.png`, `run-log-flow1-entry-protect-close.json` |
| 15 | `npx tsx scripts/open-unprotected-demo.ts` (Binance Demo USDⓈ-M long, no stop), then `scripts/sim-flows/02-recovery.json`: Protect positions → 3 % → PROTECT POSITION → CONFIRM STOP → receipt **PROTECTED** → none unprotected → reduce-only close cancels the stop | **PASS** (47/47 steps) | `evidence/g2-trade-flow/31…47*.png`, `run-log-flow2-recovery.json` |
| 16 | Voice through the **simulator microphone**: a Kokoro-spoken WAV (`tests/fixtures/voice/buy-100-btc.wav`) played with `paplay` into the box's PulseAudio monitor source → local faster-whisper heard "Buy $100 of BTC." → Which exchange? → Binance · SIM → SIMULATED receipt | **PASS** | `evidence/g2-trade-flow/50…58*.png`, `run-log-flow3-voice*.json` |
| 17 | Pairing flow (splash → code → approve → accounts → relaunch skips pairing) | **PASS** (earlier run) | `evidence/g2-simulator/` |
| — | `contact-sheet.jpg` of all simulator screens | — | `evidence/g2-trade-flow/contact-sheet.jpg` |

## Security

| # | Command | Status | Evidence |
|---|---|---|---|
| 18 | `gitleaks git . --redact` (gitleaks 8.21.2, 37 commits) | **PASS: 0 leaks** | `evidence/secret-scan/gitleaks-history.json` |
| 19 | `gitleaks dir . --redact` | **PASS**: 9 hits, all in gitignored/untracked `.env`, `apps/api/.env`, `.next/` | `evidence/secret-scan/gitleaks-worktree.json` |
| 20 | `npx tsx scripts/secret-history-check.ts` (literal stored key values vs every patch and every tracked file) | **PASS: 8 values, 0 found** | `evidence/secret-scan/value-check.txt` |

## Not covered

| Item | Status | Why |
|---|---|---|
| OKX logged-in demo | **BLOCKED** | OKX is unavailable in the user's region (India). The adapter is covered by contract tests and live public endpoints |
| IBKR paper via Client Portal Gateway | **NOT RUN** | Needs a paper login and a locally running gateway |
| Alpaca paper | **NOT RUN** | Not in the track list; off by default |
| Real G2 glasses and R1 ring hardware | **NOT RUN** | No device available; everything above used simulator 0.9.5 |
| Human voice through the real G2 microphones | **NOT RUN** | Only synthetic (TTS) speech was tested |
| Voice "add a stop to my BTC position" end to end in the simulator | **NOT RUN** | Covered by unit tests (`apps/api/src/next-screen.test.ts`, parser tests) only |
| Public deployment | **NOT RUN** | Not deployed, by decision |
