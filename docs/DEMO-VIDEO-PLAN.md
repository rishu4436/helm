# HELM — Demo video plan (Spec Part 21, flagship demo)

Target: 1080p30, **2:30–2:55** (hard max 3:00). Output: `/workspace/helm-video/final/helm_demo_v1.mp4`
(outside the repo; copied to `evidence/video/` only if < 50 MB).

**Accounts used:** Binance Demo (Spot + USDⓈ-M) and **Bybit Demo (Unified) in place of OKX.**
OKX is implemented and supported, but **untested from India** (OKX is not available there) — the video says so plainly.
All orders are real **demo-environment** orders; no production signed-trading endpoint is called. Both demo
accounts are left flat afterwards (reduce-only closes / exact-quantity sell-back), verified with `scripts/check-flat.ts`.

## Brand
- Intro (≈5 s): **Rishabh Originals** on top, **HELM — Hands-free trading on Even Realities G2** below.
  Graphite (#14161A → #1E2127) with amber accent (#F5A524). Same deterministic `render(t)` HTML → Playwright → ffmpeg
  approach as the Atlas brand system, re-implemented and retinted (the Atlas folder is read only, not modified).
- Outro (≈6 s): same lockup + disclaimer.
- **Mandatory disclaimer**, on the end card and the outro: *Demo/paper accounts only. Not financial advice.*

## Audio
- Narration: Kokoro **am_adam**, one continuous read of the whole script (single `create()` call, speed 0.92,
  no time-stretch, no line stitching). Pauses are the read's own sentence gaps; at a few scene boundaries the
  existing silent gap is lengthened so the picture can land (cut inside silence, same take).
- The two spoken commands ("HELM, show all my positions", "Buy 100 dollars of BTC") are generated in the same voice
  and played into the simulator microphone during capture, so the glasses really transcribe them (faster-whisper).
- Light procedural music bed (graphite/amber mood: soft pad + pulse), ducked under voice; soft tap clicks.

## Scenes (spec Part 21 points 1–10)
| # | Spec point | Picture | Source |
|---|---|---|---|
| 0 | — | Rishabh Originals intro | brand render |
| 1 | Connect accounts | Companion Exchanges page: Binance Demo Spot + USDⓈ-M and Bybit Demo connected; OKX card "supported — untested from India"; other venues listed | Playwright video |
| 2 | Universal portfolio | G2 Overview: totals from real demo balances, SIM labelled separately | simulator capture |
| 3 | "HELM, show all my positions" | Listening → Heard → cross-exchange positions summary (asset total, then each account) | simulator capture (real STT) |
| 4 | "Buy 100 dollars of BTC" | Heard → **Which exchange?** → pick Binance Demo · Spot | simulator capture |
| 5 | Risk preview | Impact (account, order, est. cost/fee, available balance) → Risk check → Confirm (Cancel default) | simulator capture |
| 6 | Confirm on glasses | Receipt: provider order id + "Verified: read back from Binance demo" | simulator capture, real Binance Demo order |
| 7 | Second exchange | Trade → Bybit Demo · Unified → LONG BTC perp + 3% stop → preview → confirm → receipt | simulator capture, real Bybit Demo order |
| 8 | Shield | Combined BTC exposure across accounts + one insight (concentration: most money on one exchange) + stress test | companion Shield + G2 Compass |
| 9 | Trade-to-Protect | PROTECTED only because Bybit lists the stop; companion Protect page; reduce-only close cancels the leftover stop | simulator + companion |
| 10 | End card | **One interface. Multiple exchanges. Verified actions.** + disclaimer | brand render |
| 11 | — | Rishabh Originals outro | brand render |

## Motion & captions
- Glasses screen is shown large (green-on-black display scaled ~2.6×, crisp nearest-neighbour) in a G2 lens frame;
  zoom/highlight only on the moment that matters (Which exchange?, order id, PROTECTED).
- Short captions only where they add information (e.g. "Real Binance Demo order", "OKX: supported, untested from India").
- Idle venue latency may be trimmed in the edit; no screen content is altered.

## Honesty rules for the edit
- Every glasses frame is a real simulator screenshot; every companion frame is a real Playwright recording.
- No fill, balance or order id is typed in or mocked. Coinbase Sandbox static responses are never shown as fills.
- QA: frame contact sheet reviewed for flashes, overflow and black frames before release.

## As rendered (v1, 2026-11-24)
- Output `/workspace/helm-video/final/helm_demo_v1.mp4`, 1920×1080 30 fps, H.264 + AAC, **2:47** (167 s), −14.3 LUFS integrated, true peak −1.2 dBFS, 5010 frames, 78 MB (not committed: over 50 MB). QA: blackdetect found no black frames; one luma step at 5.0 s (intro whip → first shot, intended); contact sheet reviewed.
- Narration: one 149.9 s am_adam take at speed 0.92. 15 sentence gaps were lengthened by 0.4–5.3 s at silent points (≥60 ms of silence, found by energy) → 153.4 s. Words, pitch and tempo are untouched.
- Glasses captures: `video/scripts/rec_glasses.py` polls `/api/screenshot/glasses` (~12 fps) while driving `run1.json` / `run2.json`. The spoken commands were played into the simulator mic, and local faster-whisper heard *"Helm, show all my positions."* and *"Buy $100 of BTC."*
- Real demo orders shown (receipt ids in `evidence/video/glasses-run*-events.json`):
  - Binance Demo · Spot: BUY $100 BTC, FILLED 0.00166 @ 59,900.01, sold back afterwards (0.00165, net of the BTC fee).
  - Bybit Demo · Unified: BUY 0.002 BTC perp 2×, FILLED @ 59,872.20, stop 58,076.0 listed → PROTECTED. Reduce-only close FILLED @ 59,855.30 → 1/1 orphan stop canceled.
- Companion: `video/scripts/rec_companion.mjs`, a Playwright `recordVideo` at 1440×810 (Exchanges, Shield + Crypto-crash scenario, Trade-to-Protect).
- Edit: `video/scripts/build_edl.py` → `video/brand/film.js` (deterministic `render(t)`, Atlas approach, graphite/amber). Venue latency on preview/submit screens is trimmed. Some screens hold their last real frame while zoomed in on a line.
- After the shoot: `scripts/sellback-spot.ts`, `demo-cleanup.ts` → `remaining: []`, and `check-flat.ts` → all three demo accounts have positions=0 and openOrders=0.
