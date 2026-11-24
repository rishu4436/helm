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

/**
 * Local open-source STT: faster-whisper (CTranslate2, int8 on CPU) running as a sidecar on the HELM server,
 * bound to 127.0.0.1 (services/stt/server.py). No paid key, audio never leaves the box.
 */
export class LocalWhisperSTT implements SpeechToText {
  readonly id: string
  constructor(private readonly cfg: { url?: string; model?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) { this.id = `local:faster-whisper:${cfg.model ?? 'base.en'}` }
  private get base() { return (this.cfg.url ?? 'http://127.0.0.1:8178').replace(/\/$/, '') }
  async health(): Promise<boolean> {
    try { const r = await (this.cfg.fetch ?? fetch)(`${this.base}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false }
  }
  async transcribe(pcm: Uint8Array, opts: { sampleRate?: number; language?: string } = {}): Promise<Transcript> {
    const f = this.cfg.fetch ?? fetch
    const r = await f(`${this.base}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: pcmToWav(pcm, opts.sampleRate) as BodyInit, signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20000) })
    if (!r.ok) throw new Error(`local STT HTTP ${r.status}`)
    const b = await r.json() as { text?: string; confidence?: number; noSpeechProb?: number; model?: string }
    const noSpeech = (b.noSpeechProb ?? 0) > 0.6 && (b.confidence ?? 0) < 0.5
    return {
      text: noSpeech ? '' : (b.text ?? '').trim().slice(0, 500),
      confidence: typeof b.confidence === 'number' ? b.confidence : null,
      provider: b.model ? `local:${b.model}` : this.id,
      durationMs: pcmDurationMs(pcm.length, opts.sampleRate),
      label: noSpeech ? 'No speech detected' : undefined,
    }
  }
}

/**
 * Primary → fallback. When the primary STT is unreachable the fallback (normally the TEST STT) answers, and the
 * result is explicitly labelled so a scripted transcript can never pass as recognised speech.
 */
export class FallbackSTT implements SpeechToText {
  readonly id: string
  constructor(private readonly primary: SpeechToText, private readonly fallback: SpeechToText) { this.id = `${primary.id}|fallback:${fallback.id}` }
  async transcribe(pcm: Uint8Array, opts?: { sampleRate?: number; language?: string }): Promise<Transcript> {
    try { return await this.primary.transcribe(pcm, opts) } catch (e) {
      const t = await this.fallback.transcribe(pcm, opts)
      return { ...t, label: `FALLBACK — ${this.primary.id} unavailable (${(e as Error).message.slice(0, 60)}). ${t.label ?? ''}`.trim() }
    }
  }
}

export function sttFromEnv(env: Record<string, string | undefined> = process.env): SpeechToText | null {
  const p = env.HELM_STT_PROVIDER ?? 'deterministic'
  const test = () => new DeterministicSTT((env.HELM_STT_SCRIPT ?? 'Buy 100 dollars of BTC|Show all my positions').split('|'))
  if (p === 'deterministic') return test()
  if (p === 'local') {
    const local = new LocalWhisperSTT({ url: env.HELM_STT_LOCAL_URL, model: env.HELM_STT_LOCAL_MODEL })
    return env.HELM_STT_FALLBACK === 'none' ? local : new FallbackSTT(local, test())
  }
  if (p === 'whisper' && env.HELM_STT_API_KEY) return new HttpWhisperSTT({ url: env.HELM_STT_URL ?? 'https://api.openai.com/v1/audio/transcriptions', apiKey: env.HELM_STT_API_KEY, model: env.HELM_STT_MODEL ?? 'whisper-1' })
  return null
}
