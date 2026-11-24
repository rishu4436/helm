# Security

## Hard safety rails (in code, not only in policy)

| Rail | Where |
|---|---|
| **Live trading is disabled.** `assertLiveTradingDisabled` throws unless `HELM_LIVE_TRADING` is absent or exactly `false`; it runs at process start and per request | `packages/shared/src/env-guard.ts` |
| **Environment guard.** Every outbound request is checked against per-provider allow-lists of demo, paper and sandbox hosts. Production signed endpoints are blocked **before** clock sync and signing (zero network calls). OKX requests must carry `x-simulated-trading: 1`. IBKR is loopback only. URLs with embedded credentials are rejected | `env-guard.ts`, `GuardedHttp.preflight()` |
| **No funds movement.** There is no withdraw or transfer code path, and `permissions.withdraw` is `false` by type. A key with withdraw/transfer scope is downgraded to LIMITED, never CONNECTED. Voice refuses withdraw/transfer/secret phrases | `capabilities.ts`, `connection.ts`, `parser.ts` |
| **Human confirmation.** Every order needs a preview and a single-use 45 s token (stored hashed), atomically consumed, bound to the exact request, and rechecked at confirm | `apps/api/src/engine/trade.ts` |
| **No blind retries.** Unknown outcomes are reconciled, never resubmitted. Idempotency keys replay, never duplicate | trade engine, `GuardedHttp` |

Allowed hosts:

- **Binance:** `demo-api` and `demo-fapi.binance.com` (plus the demo streams and `data-api.binance.vision` for public data).
- **Bybit:** `api-demo.bybit.com` (plus public `api.bybit.com` for market data only).
- **OKX:** `www.okx.com` with the simulated-trading header.
- **Coinbase:** `api-sandbox.coinbase.com`.
- **IBKR:** localhost.

## Credentials

- HELM never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permissions.
- API keys are validated through the adapter before storage. **Keys that fail validation are never stored.**
- At rest they are encrypted with **AES-256-GCM** under `HELM_CREDENTIAL_KEY` (32 random bytes from the environment), with AAD `userId:connectionId`, so a ciphertext cannot be moved to another user or connection.
- The UI only ever shows a **key fingerprint**. Plaintext keys exist only in memory while a request is being signed.
- Logs and errors pass through redaction helpers. Evidence scripts refuse to write a file that contains any key value (`REDACTION FAILURE`).
- Keys never reach the glasses or the browser.

## Accounts and sessions

- Passwords are hashed with scrypt. Sessions and device tokens are random opaque tokens **stored as hashes**. Sessions can be listed and revoked (`/v1/sessions`), and devices revoked (`/v1/devices/:id`).
- Pairing: 6-character code, 5-minute TTL, user-authenticated approval, and a poll secret (hashed) for claim.
- Rate limits are per IP (default 120/min; `HELM_RATE_LIMIT_MAX` for local runs). CORS allows only local origins with explicit methods. Zod validates every body.
- Audit log (`/v1/audit`): connections, previews, confirms, protection changes, cleanups, pairing, policy changes.

## Repository hygiene and secret scan (2026-11-24)

- `.env` and `apps/api/.env` are gitignored and `chmod 600`. `.env.example` holds placeholders and a password-less local Postgres URL.
- **gitleaks 8.21.2 over the full history (37 commits): 0 leaks** → `evidence/secret-scan/gitleaks-history.json`.
- gitleaks over the working tree: 9 generic-api-key hits, **all in gitignored, untracked files** (`.env`, `apps/api/.env`, `apps/companion/.next/*` build manifests) → `evidence/secret-scan/gitleaks-worktree.json` (redacted).
- **Literal-value check** (`scripts/secret-history-check.ts`): every stored exchange key and secret is unsealed in memory, along with `HELM_CREDENTIAL_KEY` and the demo password, and searched for in every patch of the git history and in all tracked files. **8 values checked, 0 found** → `evidence/secret-scan/value-check.txt` (names and counts only).
- The repo `rishu4436/helm` is **private**.

## Reporting

This is a hackathon project with no bug bounty. Report issues privately to the repo owner.
