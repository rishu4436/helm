'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { heardScreen } from '@helm/glasses/src/screens/trade'
import { api, ApiError } from '@/lib/api'
import { recordPcm16, wavUrlToPcmBase64 } from '@/lib/audio'
import { useApi } from '@/lib/hooks'
import { ago } from '@/lib/format'
import type { PreviewResp, VoiceResp } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, G2Screen, PageHeader, Pill } from '../../ui'
import { PreviewPanel } from '../../trade-flow'

const SAMPLES: Array<[string, string]> = [['buy-100-btc-bybit', 'Buy 100 dollars of BTC on Bybit'], ['buy-100-btc', 'Buy 100 dollars of BTC'], ['long-eth-stop', 'Long 200 dollars of ETH on Binance with a 3 percent stop'], ['show-positions', 'Show all my positions'], ['close-btc-bybit', 'Close my BTC position on Bybit'], ['withdraw', 'Withdraw all my bitcoin to this address']]
const SCREEN_HREF: Record<string, string> = { positions: '/positions', overview: '/dashboard', compass: '/shield', scenario: '/shield', orders: '/positions', market: '/markets', emergency: '/positions#emergency' }

function Voice() {
  const q = useSearchParams()
  const [text, setText] = useState(q.get('say') ?? '')
  const [res, setRes] = useState<(VoiceResp & { parser?: string }) | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const stopRef = useRef({ stop: false })
  const hist = useApi<{ commands: Array<{ id: string; transcript: string; sttProvider: string; confidence: string | null; intent: string | null; outcome: string; at: string }> }>('/v1/voice/history')
  const diag = useApi<{ checks: Array<{ id: string; status: string; detail: string }> }>('/v1/diagnostics')
  const stt = diag.data?.checks.find(c => c.id === 'stt')

  async function send(body: Record<string, unknown>, tag: string) {
    setBusy(tag); setErr(null); setPreview(null)
    try { setRes(await api('/v1/voice/command', { method: 'POST', body })); hist.reload() } catch (e) { setErr(e as ApiError) } finally { setBusy(null) }
  }
  useEffect(() => { const s = q.get('say'); if (s) send({ transcript: s }, 'typed') }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  async function mic() {
    stopRef.current = { stop: false }; setErr(null)
    try { setBusy('mic'); const r = await recordPcm16(8000, setLevel, stopRef.current); setLevel(0); await send({ audioBase64: r.base64, sampleRate: 16000 }, 'mic') }
    catch (e) { setBusy(null); setErr(new ApiError(0, 'MIC', `Microphone unavailable: ${(e as Error).message}`)) }
  }
  async function previewFrom(accountId: string) {
    if (!res) return
    const i = res.intent
    setBusy('preview'); setErr(null)
    try {
      const body: Record<string, unknown> = { accountId, asset: i.asset, product: i.product ?? 'spot', side: i.side ?? 'BUY' }
      if (i.notional) body.notional = i.notional; else if (i.quantity) body.quantity = i.quantity; else if (i.fraction) body.fraction = i.fraction
      if (i.leverage) body.leverage = i.leverage; if (i.stopOffsetPercent) body.stopOffsetPercent = i.stopOffsetPercent
      if (res.intent.intent === 'CLOSE_POSITION' || res.intent.intent === 'REDUCE_POSITION') { body.reduceOnly = true; body.fraction = i.fraction ?? '1'; body.product = 'perp' }
      setPreview(await api<PreviewResp>('/v1/trade/preview', { method: 'POST', body }))
    } catch (e) { setErr(e as ApiError) } finally { setBusy(null) }
  }
  const tradeable = res && ['PLACE_ORDER', 'CLOSE_POSITION', 'REDUCE_POSITION'].includes(res.intent.intent) && res.next.screen !== 'clarify'
  return (
    <div>
      <PageHeader kicker="VOICE STUDIO" title="Talk to HELM" subtitle="The same pipeline the glasses use: speech → transcript → deterministic intent parser → account resolver → preview. Speech never places an order by itself." />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-graphite-500">Speech-to-text:</span>{stt ? <><Pill v={stt.status} /><span className="text-graphite-300">{stt.detail}</span></> : <span className="text-graphite-500">checking…</span>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_600px]">
        <div className="space-y-6">
          <Card title="Say it">
            <div className="flex flex-wrap items-center gap-3">
              <Btn variant={busy === 'mic' ? 'danger' : 'amber'} onClick={busy === 'mic' ? () => { stopRef.current.stop = true } : mic} disabled={!!busy && busy !== 'mic'} testId="mic">{busy === 'mic' ? '■ Stop & send' : '● Hold a command (mic)'}</Btn>
              {busy === 'mic' && <div className="h-2 w-40 rounded bg-graphite-800"><div className="h-2 rounded bg-amber-helm transition-all" style={{ width: `${Math.min(100, level * 600)}%` }} /></div>}
              <span className="text-xs text-graphite-500">Records up to 8 s, 16 kHz mono — like the G2 microphones. On a full server this is transcribed by local faster-whisper and not stored. The hosted demo may be too small for that model and then falls back to typed commands, or a labelled TEST STT.</span>
            </div>
            <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) send({ transcript: text.trim() }, 'typed') }}>
              <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder='Or type: "long 200 dollars of ETH on Binance with a 3 percent stop"' data-testid="voice-text" />
              <Btn type="submit" busy={busy === 'typed'} testId="voice-send">Send</Btn>
            </form>
          </Card>
          <Card title="Spoken samples (Kokoro TTS, generated locally)">
            <div className="grid gap-2">
              {SAMPLES.map(([id, label]) => (
                <div key={id} className="flex items-center gap-2 rounded-lg border border-graphite-800 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={label}>“{label}”</span>
                  <Btn variant="quiet" onClick={() => new Audio(`/voice-samples/${id}.wav`).play()}>▶</Btn>
                  <Btn variant="ghost" busy={busy === id} disabled={!!busy && busy !== id} onClick={async () => send({ audioBase64: await wavUrlToPcmBase64(`/voice-samples/${id}.wav`), sampleRate: 16000 }, id)} testId={`sample-${id}`}>Transcribe</Btn>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-graphite-500">Synthetic speech, not a human voice. The raw PCM is sent exactly as the glasses would send it.</p>
          </Card>
          <ErrorNote error={err} />
          {res && (
            <Card title="Understood as" testId="voice-result">
              <div className="space-y-2 text-sm">
                <div className="text-lg">“{res.transcript || '(nothing heard)'}”</div>
                <div className="flex flex-wrap gap-2 text-xs"><span className="pill border border-graphite-700">{res.sttProvider}</span>{res.sttLabel && <span className={`pill ${res.sttLabel.startsWith('FALLBACK') || res.sttLabel.startsWith('TEST') ? 'bg-amber-helm/15 text-amber-helm' : 'bg-graphite-700'}`}>{res.sttLabel}</span>}<span className="pill border border-graphite-700">parser: {res.parser ?? 'deterministic'}</span></div>
                <div className="num grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-graphite-300 sm:grid-cols-4">
                  {Object.entries(res.intent).filter(([k, v]) => v !== null && v !== '' && !['transcript', 'requiresConfirmation', 'clarificationNeeded', 'accountId', 'confidence'].includes(k)).map(([k, v]) => <div key={k}><span className="text-graphite-500">{k}</span> {String(v)}</div>)}
                </div>
                {res.next.message && <p className="text-amber-helm">{res.next.message}</p>}
                {res.resolution.status === 'clarify' && res.resolution.options && (
                  <div><div className="mb-2 font-medium">{res.resolution.question}</div><div className="flex flex-wrap gap-2">{res.resolution.options.map(o => <Btn key={o.id} onClick={() => previewFrom(o.id)} busy={busy === 'preview'} testId={`choose-${o.alias}`}>{o.alias}</Btn>)}</div></div>
                )}
                {tradeable && res.resolution.account && <Btn variant="amber" busy={busy === 'preview'} onClick={() => previewFrom(res.resolution.account!.id)} testId="voice-preview">Preview on {res.resolution.account.alias}</Btn>}
                {SCREEN_HREF[res.next.screen] && <Btn href={SCREEN_HREF[res.next.screen]!}>Open {res.next.screen}</Btn>}
              </div>
            </Card>
          )}
          {preview && <Card title="Preview & confirm"><PreviewPanel preview={preview as never} onDiscard={() => setPreview(null)} /></Card>}
        </div>
        <div className="space-y-6">
          <Card title="What your glasses show">
            {res ? <G2Screen spec={heardScreen(res as VoiceResp)} scale={0.98} caption="Rendered from the real G2 screen code (576×288)" testId="g2-heard" /> : <Empty title="Waiting for a command" hint="The G2 HEARD screen appears here." />}
          </Card>
          <Card title="Recent commands" pad={false}>
            {hist.data?.commands.length ? <ul>{hist.data.commands.slice(0, 12).map(c => (
              <li key={c.id} className="flex items-center gap-3 border-b border-graphite-850 px-5 py-2.5 text-sm last:border-0">
                <span className="min-w-0 flex-1 truncate" title={c.transcript}>“{c.transcript}”</span><span className="text-xs text-graphite-500">{c.intent ?? '—'}</span><span className="w-20 truncate text-[11px] text-graphite-500" title={c.sttProvider}>{c.sttProvider.replace('local:faster-whisper:', 'whisper ')}</span><span className="w-14 text-right text-[11px] text-graphite-500">{ago(c.at)}</span>
                <Btn variant="quiet" onClick={() => { setText(c.transcript); send({ transcript: c.transcript }, 'typed') }}>↻</Btn>
              </li>))}</ul> : <div className="p-5"><Empty title="No commands yet" /></div>}
          </Card>
        </div>
      </div>
    </div>
  )
}
export default function Page() { return <Suspense><Voice /></Suspense> }
