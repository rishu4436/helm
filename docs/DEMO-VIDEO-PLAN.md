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

## v2 — product video for everyday traders (2026-11-24 evening)
Feedback on v1: the voice sounded like AI, and the whole thing felt like a produced explainer rather than a real demo. v2 is restructured as a plain product demo:
- **Structure:** ~2 s Rishabh Originals intro (name on top, topic below) → a problem hook in the first ~17 s over real glasses screens → how input works → one-time setup on the companion → morning glance → spoken voice command → preview → confirm → real demo fill read back from the exchange → double-tap backs out with nothing sent → Bybit long with a 3 % stop shown PROTECTED once Bybit lists it → reduce-only close cancels the leftover stop → one honest closing line → ~2 s outro.
  - The Shield aside was cut to stay under 2:55.
  - No chapter tags, no zooms, two short captions (the OKX note and "nothing sent").
- **Input is shown truthfully.** The G2 has no touchscreen. Input comes from the touchpads on the temples, or the optional Even R1 ring with the same gestures: press = tap, double press = back, swipe up/down = scroll. Sources: Even Hub docs "Input & Events" and the Even support article "How to Control".
  - A small inset shows Swipe / Tap / Double-tap at each real recorded simulator input (from `events.json`). The only exception is a 6-second illustrative loop while the narration explains the touchpad.
  - Includes one double-tap cancel (`run3.json`: preview → double-tap → back to the ticket, no order).
- **Voice:** Chatterbox TTS (Resemble AI, MIT), CPU.
  - Reference timbre: a clip synthesized with the built-in XTTS-v2 studio speaker "Aaron Dreschner", which ships with the model. No personal voice recording was used.
  - Licensing: XTTS-v2 is under the Coqui Public Model License (non-commercial). Re-check this before any commercial use of the video.
  - Chatterbox embeds its inaudible Perth watermark in the output.
  - Settings: exaggeration 0.5, cfg 0.3.
  - Each paragraph is one unbroken take. Paragraphs are joined with natural 0.6–0.9 s pauses. Nothing is time-stretched or stitched line by line.
  - Paragraphs with whisper mismatches were regenerated with new seeds; final per-paragraph WER is 0–6 %.
- **Picture retimed to the voice:** idle venue latency is cut; there are no long silent gaps. Countdown screens play in real time except a few sub-second cuts.
- **Audio:** low procedural bed (−25 dB under voice), real-input tap ticks, and a soft chime on each confirm. About −14 LUFS overall.
- **Script:** `video/vo2/script_v2.txt`. EDL: `video/scripts/build_edl_v2.py` → `evidence/video/edl_v2.json`. Renderer: `video/brand/film2.js`.
