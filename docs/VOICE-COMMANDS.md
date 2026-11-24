# Voice commands

**Pipeline:** G2 mic (`audioControl(true)`, 16 kHz PCM `audioEvent` frames) → `POST /v1/voice/command` → STT → deterministic parser (`packages/voice-engine/src/parser.ts`) → account resolution → the next G2 screen.

- **STT:** local open-source **faster-whisper `base.en`** (float32, serialized) in `services/stt` on 127.0.0.1:8178. No cloud STT and no audio leaves the box. If the sidecar is down, a deterministic **TEST STT** is used for typed input, and it is labelled on screen. See `STT.md` for accuracy, the int8 nondeterminism finding and the limits.
- **Parser:** rules, not an LLM, so the same words always give the same intent. Every parsed command is stored in voice history (`GET /v1/voice/history`).
- **Voice never places an order.** At most it opens a preview; the Impact → Risk → Confirm taps still apply.

## Supported intents (examples from `voice.test.ts`)

| Say | Intent | G2 goes to |
|---|---|---|
| "Show all my open trades" / "Show all my positions" | QUERY_POSITIONS | Positions & holdings |
| "How much BTC exposure do I have?" / "Which exchange has my largest BTC position?" | QUERY_EXPOSURE | Exposure Compass |
| "What's my balance?" / "Show my portfolio" | QUERY_BALANCE / QUERY_PORTFOLIO | Overview |
| "Show my open orders" | QUERY_ORDERS | Receipts / orders |
| "Show my unprotected futures positions" | QUERY_UNPROTECTED | **Protect positions** |
| "Prepare a stop for my ETH long" / "Add a 3 percent stop to my BTC position" | PREPARE_PROTECTION | **Protect positions** (narrowed; one match plus a spoken distance goes to the recovery preview) |
| "Buy 100 dollars of BTC on Binance" | PLACE_ORDER (spot) | Trade Impact preview |
| "Buy 100 dollars of BTC" (no venue, several accounts fit) | PLACE_ORDER | **"Which exchange?"** |
| "Open a $200 BTC long on Bybit and put a stop 3 percent below the entry" | PLACE_ORDER perp + stop | Preview with Trade-to-Protect |
| "Close half my SOL position on OKX" | REDUCE_POSITION (fraction 0.5) | Reduce-only preview |
| "Close my BTC position on Bybit" | CLOSE_POSITION | Reduce-only preview (lists orphan stops to cancel) |
| "Cancel my pending BTC order" | CANCEL_ORDER | Orders |
| "What happens if BTC falls 5%?" | STRESS_TEST | Scenario |
| "Compare BTC across exchanges" | COMPARE_VENUES | Venue compare |
| "Close everything" / "panic" | EMERGENCY_REVIEW | **Itemized** emergency review (never broadcast) |
| "Buy one share of Apple on my paper brokerage account" | PLACE_ORDER stock (IBKR) | Preview (IBKR paper is NOT RUN live) |

## Refused on purpose

Any mention of **withdraw, withdrawal, transfer, send, deposit, seed/recovery phrase, password, private key or 2FA** returns `UNKNOWN` with "HELM never moves funds or handles secrets", and no trading screen opens. Unclear speech returns "not understood" with an example, and the mic reopens.

## Ambiguity

- If more than one connected account fits a trading command, the answer is always **"Which exchange?"**, listing only the accounts that fit.
- Missing asset, side or size gives "Missing: …". HELM never guesses a venue or size.

## Evidence

| Run | Result |
|---|---|
| `evidence/stt-local/run-2026-11-24T09-00-13-347Z.json`: real WAV → STT → intent → API, 0 orders | 8/8 |
| `evidence/g2-trade-flow/50–58`: a Kokoro-spoken WAV played into the box's audio monitor and captured by the **simulator microphone**; local STT heard "Buy $100 of BTC." → Which exchange? → Binance · SIM → SIMULATED receipt | PASS |
| Playwright "voice sample (real WAV) → local STT → intent, no order placed" | PASS |

All voices so far are synthetic (TTS). A human voice through the real G2 microphones is NOT RUN.
