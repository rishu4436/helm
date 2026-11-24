# HELM — trading command center for Even Realities G2

HELM puts your exchange and broker accounts on the G2 display: pick an account and glance at balances and positions. Every order goes through a preview and an explicit confirmation. Exchange keys stay on the HELM backend, encrypted, and never reach the glasses.

Built for the **Heads Up: Even Realities Hackathon** (TVM Ventures × Daos Hub, DoraHacks), **Exchanges & Stocks** track.

> **Safety:** HELM runs against **demo, paper and sandbox environments only**.
> - Live trading is hard-disabled: the API refuses to start unless `HELM_LIVE_TRADING=false`.
> - An environment guard blocks every production signed endpoint before any network call.
> - HELM never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permissions. Keys with withdrawal permission are downgraded to LIMITED.
> - Nothing here is financial advice.

## Providers

| Provider | Environment | Track-eligible | Status |
|---|---|---|---|
| Binance | Demo Trading (spot + USDⓈ-M) | ✅ | Adapter + tests. Public demo endpoints verified live; authenticated calls need demo keys |
| OKX | Demo trading (`x-simulated-trading: 1`) | ✅ | Adapter + tests. Public endpoints verified live |
| Bybit | Demo Trading (`api-demo.bybit.com`) | ✅ | Adapter + tests. Public demo endpoints verified live |
| Coinbase | Advanced Trade **static sandbox** | ✅ | Works with no keys. Static mock data, so it is shown as LIMITED and orders are labelled simulated |
| Interactive Brokers | Paper account via local Client Portal Gateway | ✅ | Adapter + tests. Needs a paper login and a running gateway |
| Alpaca | Paper | ❌ not in track list | Off by default (`HELM_ENABLE_ALPACA=true` to enable) |

## Repo layout

```
apps/api         Fastify 5 + Prisma API: auth, G2 pairing, encrypted connections, capability matrix, audit
apps/glasses     Even Hub plugin (SDK 0.0.16): splash, pairing, account selector — packs to .ehpk
apps/companion   Next.js 15 companion: sign in, connect exchanges, approve glasses, capability matrix
packages/shared        domain models, Decimal money maths, instruments, capabilities, errors, env guard
packages/connectors    guarded HTTP + Binance / OKX / Bybit / Coinbase / Alpaca / IBKR adapters
packages/trading-core  order lifecycle state machine, single-use confirmation tokens
packages/security      AES-256-GCM credential vault, pairing codes, token hashing
prisma/                schema + migrations
evidence/              real run outputs (public-endpoint check, simulator screenshots)
docs/                  RESEARCH.md (sources), PROGRESS.md (log)
```

## Setup

You need Node 24+, pnpm 10 and PostgreSQL 16/17.

```bash
pnpm install
cp .env.example .env && cp .env.example apps/api/.env   # then set HELM_CREDENTIAL_KEY=$(openssl rand -base64 32)

# Postgres (any instance works; the dev setup used a throwaway cluster on port 5444)
createdb -h 127.0.0.1 -p 5444 -U helm helm_dev && createdb -h 127.0.0.1 -p 5444 -U helm helm_test
pnpm --filter @helm/api db:deploy
DATABASE_URL=postgresql://helm@127.0.0.1:5444/helm_test pnpm --filter @helm/api db:deploy

pnpm dev:api        # http://localhost:4000
pnpm dev:companion  # http://localhost:3000
pnpm dev:glasses    # http://localhost:5173
npx evenhub-simulator --automation-port 9898 http://localhost:5173   # from apps/glasses (Linux needs libwebkit2gtk-4.1-0)
```

**Pairing flow:**
1. Tap the splash on the glasses. A 6-character code appears.
2. In the companion, go to **Devices** and enter the code.
3. The glasses switch to your account list.
4. Tap an account to make it active.

## Tests

```bash
pnpm test                 # Vitest: 126 tests (API suite uses HELM_TEST_DATABASE_URL, default helm_test on :5444)
pnpm typecheck
pnpm check:live-public    # real, unauthenticated calls to demo/public/sandbox endpoints → evidence/live-public-check.json
scripts/sim-shot.sh out   # capture the simulator's glasses display to out.png
pnpm --filter @helm/glasses pack   # builds helm.ehpk (gitignored)
```

## What existed before Nov 23, 2026

- The Even Realities **minimal template** (`index.html`, `vite.config.ts`, `tsconfig.json` in `apps/glasses`) and Even Realities' published SDK, simulator, CLI and pretext packages.
- Open-source libraries listed in the `package.json` files: Fastify, Prisma, Next.js, React, Tailwind, Zod, decimal.js, Vitest and Vite.

Everything else in this repo was written during the build week, starting Nov 23, 2026.

## License

MIT
