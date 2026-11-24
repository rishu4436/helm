/**
 * REAL local speech-to-text through the HELM API: Kokoro-TTS spoken WAVs (tests/fixtures/voice) → raw 16 kHz PCM
 * (exactly what G2 audioControl sends) → POST /v1/voice/command → faster-whisper sidecar → parser → resolver → next screen.
 * No orders are placed (the voice route only parses). Requires services/stt/server.py on 127.0.0.1:8178.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { demoSession } from './demo-session'
process.env.HELM_STT_PROVIDER = 'local'
process.env.HELM_STT_FALLBACK = 'none'
const s = await demoSession()
const FIX = new URL('../tests/fixtures/voice/', import.meta.url).pathname
type Row = { step: string; result: 'PASS' | 'FAIL'; detail: unknown }
const rows: Row[] = []
const rec = (step: string, ok: boolean, detail: unknown) => { rows.push({ step, result: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step} — ${JSON.stringify(detail).slice(0, 260)}`) }
const say = async (name: string) => {
  const pcm = readFileSync(`${FIX}${name}.wav`).subarray(44)
  const t0 = Date.now()
  const r = await s.call('POST', '/v1/voice/command', { audioBase64: Buffer.from(pcm).toString('base64'), sampleRate: 16000 })
  return { status: r.status, ms: Date.now() - t0, spoken: readFileSync(`${FIX}${name}.txt`, 'utf8').trim(), audioMs: Math.round(pcm.length / 32), ...r.body }
}
const brief = (r: any) => ({ spoken: r.spoken, audioMs: r.audioMs, heard: r.transcript, sttProvider: r.sttProvider, sttLabel: r.sttLabel, roundTripMs: r.ms, intent: r.intent && { intent: r.intent.intent, side: r.intent.side, asset: r.intent.asset, product: r.intent.product, provider: r.intent.provider, notional: r.intent.notional, stopOffsetPercent: r.intent.stopOffsetPercent, rejectedReason: r.intent.rejectedReason }, resolution: r.resolution?.status, question: r.resolution?.question, next: r.next })

let r = await say('buy-100-btc-bybit')
rec('“Buy 100 dollars of BTC on Bybit” → local STT → PLACE_ORDER BUY BTC $100 bybit', r.status === 200 && /^local:faster-whisper/.test(r.sttProvider) && r.intent?.intent === 'PLACE_ORDER' && r.intent.side === 'BUY' && r.intent.asset === 'BTC' && r.intent.notional === '100' && r.intent.provider === 'bybit', brief(r))
r = await say('buy-100-btc')
rec('“Buy 100 dollars of BTC” (no venue) → asks Which exchange?', r.status === 200 && r.intent?.intent === 'PLACE_ORDER' && r.next?.screen === 'clarify_account', brief(r))
r = await say('long-eth-stop')
rec('“Long 200 dollars of ETH on Binance with a 3 percent stop” → BUY ETH perp $200 binance stop 3%', r.status === 200 && r.intent?.intent === 'PLACE_ORDER' && r.intent.asset === 'ETH' && r.intent.provider === 'binance' && r.intent.notional === '200' && r.intent.stopOffsetPercent === '3', brief(r))
r = await say('show-positions')
rec('“Show all my positions” → positions screen', r.status === 200 && r.intent?.intent === 'QUERY_POSITIONS' && r.next?.screen === 'positions', brief(r))
r = await say('close-btc-bybit')
rec('“Close my BTC position on Bybit” → CLOSE_POSITION (ticket, needs preview+confirm)', r.status === 200 && r.intent?.intent === 'CLOSE_POSITION' && r.intent.provider === 'bybit', brief(r))
r = await say('withdraw')
rec('“Withdraw all my bitcoin to this address” → refused (HELM never moves funds)', r.status === 200 && r.intent?.intent === 'UNKNOWN' && !!r.intent.rejectedReason && r.next?.screen === 'not_understood', brief(r))
// silence: 2 s of zeros must not turn into a command
const z = await s.call('POST', '/v1/voice/command', { audioBase64: Buffer.alloc(64000).toString('base64'), sampleRate: 16000 })
rec('2 s of silence → no command (not_understood)', z.status === 200 && z.body.intent?.intent === 'UNKNOWN' && z.body.next?.screen === 'not_understood', { heard: z.body.transcript, sttLabel: z.body.sttLabel, next: z.body.next })
// sidecar down → explicit FALLBACK label on the TEST STT, never silent
process.env.HELM_STT_FALLBACK = ''; process.env.HELM_STT_LOCAL_URL = 'http://127.0.0.1:1'
r = await say('buy-100-btc-bybit')
rec('local STT unreachable → TEST STT fallback, explicitly labelled FALLBACK', r.status === 200 && r.sttProvider === 'deterministic-test' && /^FALLBACK/.test(r.sttLabel ?? ''), brief(r))
await s.close()
const pass = rows.filter(x => x.result === 'PASS').length
const out = { kind: 'local-stt-e2e', at: new Date().toISOString(), engine: 'faster-whisper base.en float32 CPU (127.0.0.1 sidecar)', audioSource: 'Kokoro TTS v1.0 (local, offline) → 16 kHz mono PCM16', ordersPlaced: 0, summary: `${pass}/${rows.length} PASS`, rows }
mkdirSync('evidence/stt-local', { recursive: true })
const f = `evidence/stt-local/run-${out.at.replace(/[:.]/g, '-')}.json`
writeFileSync(f, JSON.stringify(out, null, 2))
console.log(out.summary, '→', f)
