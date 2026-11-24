# Deployment

**Current status:** The companion website and API are hosted on free plans so hackathon judges can try them. `helm.ehpk` has been built but **not uploaded** to Even Hub.

| | |
|---|---|
| Companion | https://helm-silk-rho.vercel.app |
| API | https://helm-api-v8lu.onrender.com |
| API health | https://helm-api-v8lu.onrender.com/health |
| Repo | https://github.com/rishu4436/helm |

The hosted API is a **new** Render free web service (`helm-api`, URL `helm-api-v8lu.onrender.com`) and a **new** Neon project (`helm`, id `mute-band-45994041`). It does not use the ATLAS Social Vercel, Render or Neon projects. Public visitors use **SIMULATED** accounts (or their own demo keys). The owner's Binance/Bybit demo keys are **not** stored on the hosted server. `HELM_LIVE_TRADING=false`. Spoken commands on the free hosted API fall back to typed input or a labelled TEST STT. A GitHub Actions cron pings `/health` every 10 minutes so the free Render service does not sleep.

Vercel project: `helm` (team of rishu4436). The GitHub integration could not auto-link this new repo at deploy time, so production was created with `create_deployment` from `main` at `cbcf580`. Later companion changes need a new Vercel deploy (or a GitHub link in the Vercel dashboard). Render auto-deploys the API from `main`.

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

## Hosted deployment checklist

A possible target that fits this stack: managed Postgres, the API as a Node service, and the companion as a Next.js host. Any public deployment must:

1. Keep `HELM_LIVE_TRADING=false` (any other value makes the guard throw).
2. Set a fresh `HELM_CREDENTIAL_KEY` from a secret manager, never from the repo.
3. Restrict CORS to the companion origin and keep the rate limits at their defaults.
4. Keep the STT sidecar private (loopback or private network).
5. Run `prisma migrate deploy`.
6. Re-run the secret scan before making anything public.
