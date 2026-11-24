import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeterministicSTT, FallbackSTT, LocalWhisperSTT, parseIntent, sttFromEnv } from './index'

const FIX = join(__dirname, '../../../tests/fixtures/voice')
/** Strip the 44-byte RIFF header of our fixture WAVs (16 kHz mono PCM16) to get the raw PCM G2 would send. */
const pcm = (name: string) => new Uint8Array(readFileSync(join(FIX, `${name}.wav`)).subarray(44))
const local = new LocalWhisperSTT({ url: process.env.HELM_STT_LOCAL_URL })
const up = await local.health()
const heard: Record<string, string> = {}
const say = async (name: string) => { const t = await local.transcribe(pcm(name)); heard[name] = t.text; return t.text }

describe('local STT adapter (unit, mocked sidecar)', () => {
  it('posts a WAV and maps the response', async () => {
    let body: Uint8Array | null = null
    const f = (async (_u: string, init: RequestInit) => { body = init.body as Uint8Array; return new Response(JSON.stringify({ text: ' Buy $100 of BTC. ', confidence: 0.9, noSpeechProb: 0.01, model: 'faster-whisper:base.en' })) }) as unknown as typeof fetch
    const t = await new LocalWhisperSTT({ fetch: f }).transcribe(new Uint8Array(3200))
    expect(t).toMatchObject({ text: 'Buy $100 of BTC.', confidence: 0.9, provider: 'local:faster-whisper:base.en', durationMs: 100 })
    expect(new TextDecoder().decode(body!.subarray(0, 4))).toBe('RIFF')
  })
  it('treats likely silence as no speech (empty transcript)', async () => {
    const f = (async () => new Response(JSON.stringify({ text: 'you', confidence: 0.2, noSpeechProb: 0.9 }))) as unknown as typeof fetch
    const t = await new LocalWhisperSTT({ fetch: f }).transcribe(new Uint8Array(3200))
    expect(t.text).toBe(''); expect(t.label).toBe('No speech detected')
  })
  it('falls back to TEST STT with an explicit FALLBACK label when the sidecar is down', async () => {
    const f = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const t = await new FallbackSTT(new LocalWhisperSTT({ fetch: f }), new DeterministicSTT(['Buy 100 dollars of BTC'])).transcribe(new Uint8Array(10))
    expect(t.provider).toBe('deterministic-test')
    expect(t.label).toMatch(/^FALLBACK — local:faster-whisper:base\.en unavailable .*TEST STT/)
  })
  it('sttFromEnv: local wraps fallback unless HELM_STT_FALLBACK=none', () => {
    expect(sttFromEnv({ HELM_STT_PROVIDER: 'local' })).toBeInstanceOf(FallbackSTT)
    expect(sttFromEnv({ HELM_STT_PROVIDER: 'local', HELM_STT_FALLBACK: 'none' })).toBeInstanceOf(LocalWhisperSTT)
    expect(sttFromEnv({})).toBeInstanceOf(DeterministicSTT)
  })
})

describe.skipIf(!up)('local STT on real spoken WAVs (Kokoro TTS → faster-whisper → parser)', () => {
  it('“Buy 100 dollars of BTC on Bybit” → PLACE_ORDER BUY BTC $100 on bybit', async () => {
    const t = await local.transcribe(pcm('buy-100-btc-bybit'))
    expect(t.provider).toMatch(/^local:faster-whisper/)
    const { intent } = await parseIntent(t.text)
    expect(intent, intent.transcript).toMatchObject({ intent: 'PLACE_ORDER', side: 'BUY', asset: 'BTC', provider: 'bybit' })
    expect(intent.notional).toBe('100')
  })
  it('“Buy 100 dollars of BTC” (no venue) → PLACE_ORDER with provider unset (will ask Which exchange?)', async () => {
    const { intent } = await parseIntent(await say('buy-100-btc'))
    expect(intent, intent.transcript).toMatchObject({ intent: 'PLACE_ORDER', side: 'BUY', asset: 'BTC' })
    expect(intent.provider ?? null).toBeNull()
  })
  it('“Long 200 dollars of ETH on Binance with a 3 percent stop” → BUY ETH $200 binance, 3% stop', async () => {
    const { intent } = await parseIntent(await say('long-eth-stop'))
    expect(intent, intent.transcript).toMatchObject({ intent: 'PLACE_ORDER', side: 'BUY', asset: 'ETH', provider: 'binance', notional: '200', stopOffsetPercent: '3' })
  })
  it('“Show all my positions” → QUERY_POSITIONS', async () => {
    expect((await parseIntent(await say('show-positions'))).intent.intent).toBe('QUERY_POSITIONS')
  })
  it('“Close my BTC position on Bybit” → CLOSE_POSITION BTC bybit', async () => {
    expect((await parseIntent(await say('close-btc-bybit'))).intent).toMatchObject({ intent: 'CLOSE_POSITION', asset: 'BTC', provider: 'bybit' })
  })
  it('“Withdraw all my bitcoin…” → refused', async () => {
    const { intent } = await parseIntent(await say('withdraw'))
    expect(intent.intent, intent.transcript).toBe('UNKNOWN'); expect(intent.rejectedReason).toBeTruthy()
  })
})
