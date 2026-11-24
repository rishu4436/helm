# Hackathon submission: HELM G2

**Event:** Heads Up: Even Realities Hackathon (TVM Ventures × Daos Hub, DoraHacks). **Track:** Exchanges & Stocks.
The user handles the DoraHacks submission himself; this file is the source text.

## One-liner

HELM is a heads-up trading command center for Even Realities G2: one glance across all your exchange accounts, and nothing is sent until you've seen the impact and confirmed.

## Short description (about 150 words)

Traders spread positions across Binance, Bybit, OKX and brokers, then lose track of total exposure and which positions have no stop. HELM puts every demo and paper account on the G2 display. You can glance at the whole book, ask by voice ("buy 100 dollars of BTC" gets "Which exchange?"), and trade with the R1 ring.

Every order goes Trade Impact → Risk check → Confirm, with Cancel selected by default and a 45-second single-use token. **Trade-to-Protect** sizes a reduce-only stop from the actual fill. It can also add a stop to a position opened without one, and it only says PROTECTED once the exchange lists the stop. Closing a position cancels its leftover stop. "Close everything" is never broadcast; it becomes an itemized review. A timeout is reconciled, never retried.

Keys stay encrypted on the backend, live trading is hard-disabled, and speech-to-text runs locally. It was demonstrated with real Binance Demo and Bybit Demo orders.

## What's real

- Real orders on **Binance Demo** (spot and USDⓈ-M) and **Bybit Demo** (spot and linear) through the HELM API and through the G2 simulator. Redacted evidence is in `evidence/`.
- 276 unit and integration tests, 46 Playwright tests, and scripted simulator runs (`docs/TEST-REPORT.md`).
- OKX is BLOCKED (region), IBKR is NOT RUN, and real G2 hardware is NOT RUN. These are stated, not hidden.

## Built with

Even Hub SDK 0.0.16, evenhub-simulator 0.9.5, evenhub-cli, @evenrealities/pretext; TypeScript, Fastify 5, Prisma/Postgres, Next.js 15, faster-whisper (local STT).

## Feature requests for Even Realities (up to 5)

1. **A documented, explicit list-item limit, and an error reason from `rebuildPageContainer`.** It returns only `false`. A Pulse list with exactly 64-byte items failed silently and took bisecting to find that the real limit is 63 bytes. Returning a reason such as "item 6 exceeds 63 bytes" would save every developer hours.
2. **A native "confirm" primitive with a hold or long-press gesture.** Money-moving apps need a deliberate, hard-to-trigger confirmation. A system-level long-press, or a two-step ring gesture with haptics, would be safer than each app inventing swipe-then-tap.
3. **Simulator microphone input from a file.** Something like `--mic-wav path.wav`, or an automation endpoint that injects PCM, so voice flows can be tested in CI. Today it needs a virtual PulseAudio source.
4. **Partial list updates and a busy indicator.** A way to update one list item, or show a native spinner, without a full rebuild. This would help live prices and slow network calls (exchange previews can take 10 s).
5. **A glyph coverage table for the firmware font, plus a fallback.** Ⓢ (as in USDⓈ-M) and ✓ are missing from the firmware font, so HELM maps them by hand. A published charset, or automatic fallback glyphs, would avoid that guesswork.

## Links

- Repo: https://github.com/rishu4436/helm (public, MIT)
- Companion website: https://helm-silk-rho.vercel.app
- API: https://helm-api-v8lu.onrender.com (`/health`)
- Demo video: planned (`docs/DEMO-VIDEO-PLAN.md`), not yet rendered.
