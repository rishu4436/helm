# Deployment

**Current status:** HELM runs **locally only**. Nothing is deployed publicly, by decision: no paid accounts and no public deploy before the user approves it. `helm.ehpk` has been built but **not uploaded** to Even Hub.

## Local stack (what the demo uses)

| Service | Port | Start |
|---|---|---|
| Postgres 17 (`helm_dev`, `helm_test`, user `helm`) | 5444 | `scripts/dev-up.sh` |
| STT sidecar (faster-whisper `base.en`) | 8178 (loopback) | `scripts/dev-up.sh` (`services/stt`) |
| HELM API | 4000 | `scripts/dev-up.sh` (`--restart-api` kills it by PID first) |
| Companion | 3000 | `pnpm dev:companion`, or prod: `pnpm --filter @helm/companion build && npx next start -p 3000` (restart after every rebuild, or stale chunks are served) |
| Glasses dev server | 5173 | `pnpm dev:glasses` |
| Even Hub simulator | automation 9898 | `npx evenhub-simulator --no-glow --automation-port 9898 http://localhost:5173` (from `apps/glasses`; Linux needs `libwebkit2gtk-4.1-0`) |

## Packaging the G2 plugin

```bash
cd apps/glasses && pnpm run pack      # tsc + vite build + evenhub pack app.json dist -o helm.ehpk
```

The plugin reads the API base URL from `VITE_HELM_API` at build time (default `http://localhost:4000`, see `apps/glasses/src/api.ts`). For a phone test on the same network, point it at the machine's LAN address. Sideloading needs the Even app developer mode. **NOT RUN on real hardware.**

## If and when it is deployed (not done)

A possible target that fits this stack: managed Postgres, the API as a Node service, and the companion as a Next.js host. Any public deployment must:

1. Keep `HELM_LIVE_TRADING=false` (any other value makes the guard throw).
2. Set a fresh `HELM_CREDENTIAL_KEY` from a secret manager, never from the repo.
3. Restrict CORS to the companion origin and keep the rate limits at their defaults.
4. Keep the STT sidecar private (loopback or private network).
5. Run `prisma migrate deploy`.
6. Re-run the secret scan before making anything public.
