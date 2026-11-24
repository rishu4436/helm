# HELM G2: a trading command center for Even Realities G2

HELM puts every demo and paper trading account you hold (Binance, Bybit, OKX, Coinbase sandbox, IBKR paper) on the G2 display.

- **Glance** at the whole book and **ask by voice** ("buy 100 dollars of BTC" gets "Which exchange?").
- **Trade with the ring.** Nothing is sent until you've seen the **Trade Impact** and **Risk check** and confirmed. Cancel is selected by default.
- **Trade-to-Protect** sizes a reduce-only stop from the actual fill. It can also add a stop to a position that has none, and it only says PROTECTED once the exchange lists the stop.

Built for the **Heads Up: Even Realities Hackathon** (TVM Ventures × Daos Hub, DoraHacks), **Exchanges & Stocks** track.

**Try it:** [Companion website](https://helm-silk-rho.vercel.app) · [API health](https://helm-api-v8lu.onrender.com/health) · [Source](https://github.com/rishu4436/helm)

The hosted site is **demo / paper / sandbox only**. Click **Try the demo** for simulated Binance, Bybit and OKX accounts (labelled SIMULATED, no API keys, nothing sent to any exchange). You can also register and connect your own demo keys. The owner's demo keys are not on the hosted server. Live trading is hard-disabled. Spoken audio on the free hosted API falls back to typed commands or a labelled TEST STT.


> ### Safety
> - **Demo, paper and sandbox only.** Live trading is hard-disabled: `HELM_LIVE_TRADING` must be `false`, or the guard throws.
> - An **environment guard** allow-lists demo/paper/sandbox hosts and blocks production signed endpoints before any network call.
> - HELM **never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permission**, and it has no withdraw/transfer code path. Keys with withdraw scope are downgraded to LIMITED.
> - Keys are validated before storage, encrypted with AES-256-GCM on the backend, and **never reach the glasses or the browser**.
> - Every order needs a **preview plus a single-use 45 s confirmation**. Timeouts are **reconciled, never retried**. "Close everything" is an **itemized, reduce-only** review, never a broadcast. Coinbase static-sandbox responses are labelled and never shown as fills.
> - Nothing here is financial advice.

## Setup in minutes

Requirements: Node 24+, pnpm 10, PostgreSQL 16/17, and Python 3.11+ (for local STT). Linux simulator only: `libwebkit2gtk-4.1-0`.

```bash
pnpm install
cp .env.example .env && cp .env.example apps/api/.env
# set HELM_CREDENTIAL_KEY=$(openssl rand -base64 32) and HELM_DEMO_PASSWORD in both files (never commit them)

# databases (any Postgres; dev used a throwaway cluster on :5444)
createdb -h 127.0.0.1 -p 5444 -U helm helm_dev && createdb -h 127.0.0.1 -p 5444 -U helm helm_test
pnpm --filter @helm/api db:deploy
DATABASE_URL=postgresql://helm@127.0.0.1:5444/helm_test pnpm --filter @helm/api db:deploy

pnpm stt:setup && pnpm stt:serve &    # local faster-whisper on 127.0.0.1:8178 (optional; typed input works without it)
pnpm dev:api                          # http://localhost:4000
pnpm dev:companion                    # http://localhost:3000
pnpm dev:glasses                      # http://localhost:5173
cd apps/glasses && npx evenhub-simulator --automation-port 9898 http://localhost:5173
```

After a machine restart, `bash scripts/dev-up.sh` brings Postgres, STT, API and companion back.

**First run:**

1. Register in the companion.
2. Go to **Exchanges** and connect a Binance Demo or Bybit Demo API key (trade permission, **no withdrawal**). You can also add a HELM simulator account, which needs no keys.
3. Tap the splash on the glasses and enter the 6-character code under **Devices**.
4. Pick an account.

**Package the plugin:** `cd apps/glasses && pnpm run pack` produces `helm.ehpk`.

## Docs

| | |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Components, request path, data model, renderer |
| [PRODUCT-SPEC](docs/PRODUCT-SPEC.md) | What HELM does, principles, features per surface |
| [EXCHANGE-ADAPTERS](docs/EXCHANGE-ADAPTERS.md) · [PROVIDER-CAPABILITIES](docs/PROVIDER-CAPABILITIES.md) · [CONNECTION-FLOWS](docs/CONNECTION-FLOWS.md) | Providers, capabilities, pairing and key handling |
| [ORDER-LIFECYCLE](docs/ORDER-LIFECYCLE.md) · [RISK-ENGINE](docs/RISK-ENGINE.md) · [TRADE-TO-PROTECT](docs/TRADE-TO-PROTECT.md) | How an order moves, Shield, protection and cleanup |
| [GLASSES-UX](docs/GLASSES-UX.md) · [VOICE-COMMANDS](docs/VOICE-COMMANDS.md) | Screens, gestures, G2 limits, voice grammar |
| [SECURITY](docs/SECURITY.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) | Safety rails, secrets, secret scan; local stack and packaging |
| [TEST-REPORT](docs/TEST-REPORT.md) · [DEMO-RUNBOOK](docs/DEMO-RUNBOOK.md) · [KNOWN-LIMITATIONS](docs/KNOWN-LIMITATIONS.md) | Exact commands with PASS/FAIL/BLOCKED/NOT RUN and evidence; how to run the demo; honest gaps |
| [HACKATHON-SUBMISSION](docs/HACKATHON-SUBMISSION.md) · [DEMO-VIDEO-PLAN](docs/DEMO-VIDEO-PLAN.md) · [LICENSE-DECISION](docs/LICENSE-DECISION.md) | Submission text, video plan, MIT license |
| [PROGRESS](docs/PROGRESS.md) · [RESEARCH](docs/RESEARCH.md) · [STT](docs/STT.md) | Build log, sources, speech-to-text notes |

## Repo layout

```
apps/api         Fastify 5 + Prisma: auth, pairing, connections, trade engine, Shield, Pulse, voice, recipes, audit
apps/glasses     Even Hub plugin (SDK 0.0.16) → helm.ehpk
apps/companion   Next.js 15 companion website (+ Playwright e2e)
packages/        shared · connectors · trading-core · risk-engine · portfolio · pulse · voice-engine · security
services/stt     local faster-whisper sidecar
scripts/         dev-up, live demo runs (redacted evidence), simulator driver, cleanup, secret checks
evidence/        real run outputs and screenshots
```

## Status at a glance

The full table is in [TEST-REPORT](docs/TEST-REPORT.md).

- **PASS:** 276 tests; 46 Playwright tests; real Binance Demo and Bybit Demo runs, including Trade-to-Protect recovery (25/25); scripted simulator flows; secret scan (0 leaks).
- **BLOCKED:** OKX logged in (region).
- **NOT RUN:** IBKR paper, real G2 hardware, a human voice.

## What existed before Nov 23, 2026

- The Even Realities **minimal template** (`apps/glasses/index.html`, `vite.config.ts`, `tsconfig.json`), plus Even Realities' published SDK, simulator, CLI and pretext packages.
- Open-source libraries and models listed in the `package.json` and `services/stt` requirements: Fastify, Prisma, Next.js, React, Tailwind, Zod, decimal.js, Vitest, Vite, Playwright, faster-whisper and the Whisper `base.en` weights. Kokoro TTS was used only to generate the test voice fixtures.
- Public exchange API documentation (sources in `docs/RESEARCH.md`).

Everything else in this repo was written during the build week, starting Nov 23, 2026.

## License

[MIT](LICENSE) © 2026 Rishu Kumar Gupta (Rishabh Originals). See [LICENSE-DECISION](docs/LICENSE-DECISION.md).
