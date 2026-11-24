/**
 * Speech-to-text adapters. G2 delivers raw 16 kHz mono PCM (s16le) via audioControl; HELM never does
 * recognition on the glasses. Providers are configurable; the deterministic adapter is for tests/demo
 * and is always labelled as such.
 */
export interface Transcript { text: string; confidence: number | null; provider: string; durationMs: number; label?: string }
export interface SpeechToText { readonly id: string; transcribe(pcm: Uint8Array, opts?: { sampleRate?: number; language?: string }): Promise<Transcript> }

export const pcmDurationMs = (bytes: number, sampleRate = 16000) => Math.round((bytes / 2 / sampleRate) * 1000)

/** Wrap s16le mono PCM in a WAV container for HTTP STT APIs. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 16000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/** Deterministic test STT: returns scripted transcripts in order (or a fixed one). Labelled TEST. */
export class DeterministicSTT implements SpeechToText {
  readonly id = 'deterministic-test'
  private i = 0
  constructor(private readonly script: string[]) { if (script.length === 0) throw new Error('script required') }
  async transcribe(pcm: Uint8Array): Promise<Transcript> {
    const text = this.script[this.i % this.script.length]!
    this.i += 1
    return { text, confidence: 1, provider: this.id, durationMs: pcmDurationMs(pcm.length), label: 'TEST STT — scripted transcript, audio not recognised' }
  }
}

/** OpenAI-compatible `/audio/transcriptions` endpoint (Whisper-style). Requires HELM_STT_API_KEY. */
export class HttpWhisperSTT implements SpeechToText {
  readonly id: string
  constructor(private readonly cfg: { url: string; apiKey: string; model: string; fetch?: typeof fetch }) { this.id = `whisper:${cfg.model}` }
  async transcribe(pcm: Uint8Array, opts: { sampleRate?: number; language?: string } = {}): Promise<Transcript> {
    const fd = new FormData()
    fd.append('file', new Blob([pcmToWav(pcm, opts.sampleRate) as BlobPart], { type: 'audio/wav' }), 'helm.wav')
    fd.append('model', this.cfg.model)
    if (opts.language) fd.append('language', opts.language)
    const f = this.cfg.fetch ?? fetch
    const r = await f(this.cfg.url, { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, body: fd, signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`STT HTTP ${r.status}`)
    const b = await r.json() as { text?: string }
    return { text: (b.text ?? '').slice(0, 500), confidence: null, provider: this.id, durationMs: pcmDurationMs(pcm.length, opts.sampleRate) }
  }
}

export function sttFromEnv(env: Record<string, string | undefined> = process.env): SpeechToText | null {
  const p = env.HELM_STT_PROVIDER ?? 'deterministic'
  if (p === 'deterministic') return new DeterministicSTT((env.HELM_STT_SCRIPT ?? 'Buy 100 dollars of BTC|Show all my positions').split('|'))
  if (p === 'whisper' && env.HELM_STT_API_KEY) return new HttpWhisperSTT({ url: env.HELM_STT_URL ?? 'https://api.openai.com/v1/audio/transcriptions', apiKey: env.HELM_STT_API_KEY, model: env.HELM_STT_MODEL ?? 'whisper-1' })
  return null
}
