# Demo video plan: HELM G2 (2:45)

**Status: plan only, nothing rendered.** It follows the user's video preferences:

- A **"Rishabh Originals"** intro and outro, with "Rishabh Originals" on top and the topic below.
- A natural, deep English narrator that **is not ElevenLabs**: **Kokoro `am_adam`**, as used before, run locally from `/workspace/tts/venv`.
- Purposeful motion and no filler.
- Real simulator and companion captures, and **real Binance Demo and Bybit Demo orders**.

> **About the scene list:** the master spec's Part 21 text was not available on disk or in searchable history while this was written. The scenes below are reconstructed from the spec's requirements that are known (glance, voice with "Which exchange?", preview → confirm, Trade-to-Protect, Shield/Compass, Pulse, itemized emergency, safety). Please check them against Part 21 before recording.

## Ground rules for the edit

1. **Every UI frame is a real capture.** Simulator footage comes from Even Hub simulator 0.9.5 driven by `scripts/sim-run.py`. Companion footage comes from the prod build on the box desktop. No mock-ups, no re-typed numbers, no composited fake fills.
2. **Orders are placed live during the recording**, on Binance Demo and Bybit Demo, and the accounts are flattened afterwards (`demo-cleanup.ts` + `check-flat.ts` must show 0/0). Keep the DEMO tag visible in every trade shot.
3. **SIMULATED stays labelled.** If a SIM receipt appears (the voice scene), its "SIMULATED by HELM" line stays on screen and the narration says "simulated".
4. **The narration states no prices or P&L figures.** Live demo prices will differ from any script, so the screen carries the numbers.
5. **Motion has a job:** a push-in to read a line, a cut on the ring tap, a highlight box on the one value that matters. No idle pans, stock footage, whooshes on every cut, or music bed louder than the voice (−20 LUFS bed under −14 LUFS voice).
6. **Glasses frames** are the 576×288 green HUD, captured at 2× (1152×576). Present them large on a dark graphite canvas with a thin amber frame (HELM colours). A small "Even G2 · simulator" caption appears in the first shot only, so we never imply hardware footage.

## Shot list

| # | Time | Dur | Scene | Picture (source) | On-screen text | Motion |
|---|---|---|---|---|---|---|
| 1 | 0:00–0:05 | 5 s | **Intro** | Title card: **Rishabh Originals** (top, large), **HELM G2 — a trading command center for your glasses** (below, smaller) | as stated | The title rises in over 12 frames and the subtitle follows 6 frames later; hold; a clean cut. No sting longer than 1 s |
| 2 | 0:05–0:17 | 12 s | **The problem** | Companion `/positions` with several venues (fresh capture), then a quick cut to Compass "Unprotected: 1" | "4 exchanges. 1 position without a stop." | A slow push into the unprotected row |
| 3 | 0:17–0:32 | 15 s | **Glance** | Simulator: splash → Home → Overview (all exchanges, DEMO vs SIM split) → Positions & holdings (`sim-flows/01` steps 1–5) | "Every account, one glance" | A cut on each ring tap; brief highlight on "Demo exchanges $…" |
| 4 | 0:32–0:52 | 20 s | **Voice → "Which exchange?"** | Simulator: Voice command → LISTENING → HEARD "Buy $100 of BTC." (local STT label visible) → **Which exchange?** list (`sim-flows/03` + `paplay`) | "Local speech-to-text · nothing guessed" | Hold on the HEARD transcript for 1.5 s, then a push-in on the question |
| 5 | 0:52–1:22 | 30 s | **Preview → confirm, real Bybit Demo order with protection** | Simulator: ticket *LONG $150 BTC perp 2× + 3% stop* on Bybit Demo → TRADE IMPACT → RISK CHECK (ALLOW) → CONFIRM (cursor on **Cancel**) → swipe → confirm → Submitting → **RECEIPT FILLED · Protection: PROTECTED** (`sim-flows/01` steps 7–14). Optional 2 s picture-in-picture of Bybit Demo's own order list showing the untriggered stop, captured from the demo web UI with the user's own login only if he wants it; otherwise use the companion Positions page | "Cancel is the default" · "PROTECTED only when the exchange lists the stop" | A highlight box moves Cancel → Confirm in time with the swipe. A 1.2× push on the "Protection: PROTECTED" line |
| 6 | 1:22–1:52 | 30 s | **Protect what's already open: real Binance Demo** | Before recording, `open-unprotected-demo.ts` opens a no-stop long on Binance Demo USDⓈ-M. Simulator: Protect positions (1 open) → 3% → **PROTECT POSITION** (stop, mark, entry, "If triggered", "Places no new exposure") → CONFIRM STOP → receipt **PROTECTED** → "Every position has a venue-listed stop" (`sim-flows/02` steps 1–12). Cut to companion `/protect` plans table showing **Recovery · PROTECTED** | "Adds a reduce-only stop · no new exposure" | Split screen for 3 s: glasses left, companion right |
| 7 | 1:52–2:14 | 22 s | **Shield, Compass, Pulse** | Companion `/shield`: policy and the scenario lab "crypto crash" result (stop-aware). Simulator: Pulse ("BTC stop … live at venue"), Exposure Compass (Unprotected: 0) | "Risk checked on the server, every order" | Cut on each beat; no scrolling longer than 2 s |
| 8 | 2:14–2:35 | 21 s | **Itemized exit + safety** | Simulator: Emergency review (itemized CANCEL / CLOSE lines) → CLOSE BTC perp (reduce-only) → impact "Then cancels 1 stop(s)…" → receipt "Position flat · 1/1 orphan stop(s) canceled". Then companion `/security` (key fingerprints, guard hosts) for 4 s | "Never 'close all' · reduce-only · leftover stop canceled" · "Demo & paper only · no withdrawals · keys never on the glasses" | A push on "1/1 orphan stop(s) canceled" |
| 9 | 2:35–2:45 | 10 s | **Outro** | Title card: **Rishabh Originals** (top) / **HELM G2 · Even Realities Heads Up Hackathon** (below), with a small "Demo trading only. Not financial advice." line | as stated | Same motion as the intro, reversed out; hold 4 s on the readable card |

Total: 165 s = **2:45**.

## Narration script (Kokoro `am_adam`, about 340 words, around 135 wpm)

Write it the way a person talks: contractions, short sentences, one idea per line. The `[n]` marks the shot each line starts on.

> **[2]** If you trade on more than one exchange, you know the feeling. Your money's in four places… and somewhere, there's a position with no stop.
>
> **[3]** This is HELM, on Even Realities G2. One glance, and I can see every account I hold — demo exchanges here, simulated ones kept separate. Positions, holdings, all of it.
>
> **[4]** I can just ask. *"Buy a hundred dollars of BTC."* The speech is turned into text right here on my machine. And because I've got more than one account that could do it… HELM doesn't guess. It asks: which exchange?
>
> **[5]** Let's do a real one on Bybit's demo exchange — a small long, with a three percent stop. Before anything is sent, I see the impact: size, fees, exposure, margin. Then the risk check. And look where the cursor lands on the confirm screen — on Cancel. I have to mean it.
> Filled. And the stop says *protected* — but only because Bybit itself lists that stop. HELM won't claim protection the exchange hasn't confirmed.
>
> **[6]** Now the scary one. This Binance position was opened without a stop. HELM spots it. I pick a distance, and it shows me exactly what I'm adding — a reduce-only stop, no new exposure, and what happens if it triggers. Confirm… and it's protected. Nothing left uncovered.
>
> **[7]** Every order goes through the same server-side Shield — limits, leverage, concentration. Pulse tells me what changed. The compass tells me where I'm exposed.
>
> **[8]** And when I want out, there's no panic button that blasts orders everywhere. Each close is its own reduce-only order — and the leftover stop gets cancelled, so nothing fires later.
> It's demo and paper only. No withdrawals. My keys stay encrypted on the server and never touch the glasses.
>
> **[9]** HELM. Trade what you can see.

Timing check: lines [2]–[8] come to about 150 s at a natural pace. Re-time to the picture after recording, and trim words rather than speeding the voice up.

## Production notes (for the render step, not done yet)

- **Voice:** Kokoro `am_adam`, speed 0.95–1.0, rendered line by line so each line can be placed on its own cut. Light de-ess, −14 LUFS integrated. No ElevenLabs voices.
- **Music:** one quiet, steady instrumental bed under the voice (or none). No drops or risers. Its source and licence must be recorded in a provenance note.
- **Captures:**
  - Simulator: a real-time screen recording of the simulator window on the box desktop (ffmpeg `x11grab` on the agent display), driven by `scripts/sim-run.py` with the same flow JSONs. Use the `api/screenshot/glasses` stills only as fallbacks for freeze-frames.
  - Companion: Playwright `recordVideo` or `x11grab` of the prod build at 1920×1080.
  - Voice scene: `pactl set-default-source speakers.monitor` + `paplay` of a Kokoro WAV, the same method as the test report. Say on screen "synthetic voice sample" or, better, record Rishabh's own voice.
- **Order of the recording day:**
  1. `check-flat.ts` shows 0/0.
  2. Record scenes 3–5 (Bybit entry with stop).
  3. Run `open-unprotected-demo.ts` and record scene 6 (Binance recovery).
  4. Record scenes 7–8 and close each position reduce-only on camera.
  5. Run `demo-cleanup.ts` + `check-flat.ts`, which must show 0/0. Save the output next to the video as evidence.
- **Brand cards:** build new "Rishabh Originals" cards. `/workspace/branding/rishabh-creation/` holds an earlier **"Rishabh Creation"** papercraft draft. It uses a different name, so don't reuse it unless Rishabh says so.
- **Deliverable (later):** 1920×1080, 30 fps, H.264 + AAC, ≤2:45, with burned-in captions as an option and an SRT exported from the script.
