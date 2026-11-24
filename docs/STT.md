# Speech-to-text (local, open source, no paid key)

G2 streams 16 kHz mono PCM16 from its microphones (`audioControl`). The glasses never recognise speech; the HELM API does.

| Provider (`HELM_STT_PROVIDER`) | What it is | Label shown on glasses |
|---|---|---|
| `local` (default in .env.example) | **faster-whisper `base.en`** (CTranslate2, CPU) in a sidecar bound to `127.0.0.1:8178` — `services/stt/server.py`. Audio never leaves the server. | none (real recognition) / `No speech detected` |
| `local` + sidecar down | TEST STT answers instead | `FALLBACK — local:faster-whisper:base.en unavailable (…). TEST STT — scripted transcript, audio not recognised` |
| `deterministic` | TEST STT (scripted) | `TEST STT — scripted transcript, audio not recognised` |
| `whisper` | OpenAI-compatible HTTP endpoint (needs `HELM_STT_API_KEY`; not used) | none |

`HELM_STT_FALLBACK=none` turns the fallback off (then a sidecar outage is a 5xx, never a scripted transcript).

Every transcript still goes through the deterministic parser → account resolver → preview → explicit confirm. Speech never places an order by itself.

## Run
```
pnpm stt:setup     # venv at /workspace/helm-stt/venv (outside the repo) + model download
pnpm stt:serve     # 127.0.0.1:8178
pnpm stt:fixtures  # regenerate spoken WAVs with local Kokoro TTS (tests/fixtures/voice)
pnpm check:stt     # end-to-end through POST /v1/voice/command → evidence/stt-local/
```

## Measured (2026-11-24, 8-vCPU Xeon box)
- 6 Kokoro-spoken commands (4 voices) transcribed correctly; ~0.3–0.8 s per 1.5–4.3 s clip; model load 0.6 s.
- Silence (2 s of zeros) → empty transcript → `not_understood`.
- **int8 was not usable on this CPU**: same audio, 25 runs → 4–9 distinct outputs incl. garbage; `float32` → 25/25 identical. Default is therefore `HELM_STT_COMPUTE=float32`; inference is serialized with a lock.
- Limits: tested on synthetic (TTS) speech only, not on a real human voice through the G2 microphones or the simulator's mic. English only (`base.en`). The initial prompt lists tickers/venues to bias spelling; it cannot add words that were not spoken.
