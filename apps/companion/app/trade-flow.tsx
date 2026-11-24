'use client'
import Link from 'next/link'
import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { newIdemKey, useNow } from '@/lib/hooks'
import { ist, qty, sym, usd } from '@/lib/format'
import type { FullReceipt, PreviewResp } from '@/lib/types'
import { Btn, Pill } from './ui'

export function Row({ k, v, mono = true, tone = '' }: { k: string; v: React.ReactNode; mono?: boolean; tone?: string }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-graphite-850 py-1.5 text-sm last:border-0"><span className="text-graphite-500">{k}</span><span className={`${mono ? 'num' : ''} text-right ${tone}`}>{v}</span></div>
}

/** Preview → explicit confirm → receipt. Never auto-retries: a failed/unknown submit keeps the same idempotency key. */
export function PreviewPanel({ preview, onDone, onDiscard, testId = 'preview' }: { preview: PreviewResp & { preview: PreviewResp['preview'] & { willCancel?: Array<{ type: string; stopPrice: string | null }> } }; onDone?: (r: FullReceipt) => void; onDiscard: () => void; testId?: string }) {
  const now = useNow(500)
  const [idem] = useState(newIdemKey)
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)
  const [receipt, setReceipt] = useState<FullReceipt | null>(null)
  const [err, setErr] = useState<{ msg: string; unknown: boolean } | null>(null)
  const left = Math.max(0, Math.round((Date.parse(preview.expiresAt) - now) / 1000))
  const pv = preview.preview, im = pv.impact, risk = preview.risk
  const s = sym(preview.order.instrument ?? (preview.order as unknown as { instrumentId?: string }).instrumentId ?? '')
  const recovery = (preview as { kind?: string }).kind === 'protect_existing'

  async function confirm() {
    setBusy(true); setErr(null)
    try {
      const r = await api<{ receipt: FullReceipt; replayed?: boolean }>('/v1/trade/confirm', { method: 'POST', body: { proposalId: preview.proposalId, confirmToken: preview.confirmToken, idempotencyKey: idem, via: 'companion' } })
      setReceipt(r.receipt); onDone?.(r.receipt)
    } catch (e) {
      const ae = e instanceof ApiError ? e : null
      // Network failure = outcome unknown. HELM never blindly resubmits; the same idempotency key can only replay.
      setErr({ msg: ae?.status === 0 ? 'No response from HELM. The order outcome is unknown — check History; HELM reconciles with the exchange and will not resubmit.' : ae ? `${ae.message}${ae.reasons.length ? ` — ${ae.reasons.join('; ')}` : ''}` : 'Failed', unknown: ae?.status === 0 })
    } finally { setBusy(false) }
  }

  if (receipt) return <ReceiptView r={receipt} onClose={onDiscard} testId={`${testId}-receipt`} />
  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{recovery ? `Protect ${s.label}` : `${preview.order.side} ${s.label}`}</span>
        <Pill v={risk.verdict} />
        <span className="pill border border-graphite-700">{preview.account.environmentLabel}</span>
        <span className="text-sm text-graphite-300">{preview.account.alias}</span>
        <span className={`num ml-auto text-sm ${left <= 10 ? 'text-down' : 'text-graphite-300'}`} data-testid="countdown">{left > 0 ? `expires in ${left}s` : 'expired'}</span>
      </div>
      {preview.label && <div className="rounded-lg border border-violet-400/40 bg-violet-400/5 px-3 py-2 text-xs text-violet-200">{preview.label}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-graphite-500 uppercase">Order</div>
          <Row k="Type" v={`${preview.order.type}${preview.order.reduceOnly ? ' · reduce-only' : ''}`} />
          <Row k="Quantity" v={preview.order.quantity ? `${qty(preview.order.quantity)} ${s.base}` : preview.order.quoteQuantity ? `${usd(preview.order.quoteQuantity)} of ${s.base}` : '—'} />
          {preview.order.leverage && <Row k="Leverage" v={`${preview.order.leverage}×`} />}
          <Row k={recovery ? 'Stop price' : 'Est. price'} v={usd(pv.estimatedPrice)} />
          <Row k="Est. notional" v={usd(pv.estimatedNotional)} />
          <Row k="Est. fee" v={usd(pv.estimatedFee, 4)} />
          <Row k="Est. slippage" v={pv.estimatedSlippageBps ? `${pv.estimatedSlippageBps} bps` : '—'} />
          {pv.requiredMargin && <Row k="Required margin" v={usd(pv.requiredMargin)} />}
          <Row k="Buying power after" v={usd(pv.remainingBuyingPower)} />
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-graphite-500 uppercase">Impact</div>
          <Row k={`${im.asset} exposure`} v={`${usd(im.currentExposureUsd, 0)} → ${usd(im.proposedExposureUsd, 0)}`} />
          <Row k="Position" v={`${qty(im.currentPositionQty)} → ${qty(im.proposedPositionQty)}`} />
          <Row k="Spread" v={im.spreadBps ? `${im.spreadBps} bps` : '—'} />
          <Row k="Liquidation" v={im.liquidation.proposed ? usd(im.liquidation.proposed) : '—'} />
          {pv.protection && <Row k={recovery ? 'Adds stop' : 'Trade-to-Protect'} v={pv.protection.supported ? `${pv.protection.stopOffsetPercent ? `${recovery ? '' : '−'}${pv.protection.stopOffsetPercent}% ` : ''}≈ ${usd(pv.protection.estimatedStopPrice)}${recovery ? ' (reduce-only)' : ''}` : 'not supported here'} tone={pv.protection.supported ? 'text-up' : 'text-amber-helm'} />}
          {pv.willCancel && pv.willCancel.length > 0 && <Row k="Full close" v={`cancels ${pv.willCancel.length} protective order(s)`} tone="text-amber-helm" />}
          <p className="mt-2 text-xs text-graphite-500">{im.liquidation.note}</p>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-graphite-500 uppercase">Shield · policy v{risk.policyVersion}</div>
        <ul className="space-y-1">{risk.findings.map((f, i) => <li key={i} className="flex gap-2 text-sm"><Pill v={f.verdict} /><span className="text-graphite-300">{f.message}</span></li>)}</ul>
        {pv.estimateNotes.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-graphite-500">{pv.estimateNotes.map(n => <li key={n}>• {n}</li>)}</ul>}
      </div>
      {err && <div role="alert" className={`rounded-lg border px-3 py-2 text-sm ${err.unknown ? 'border-amber-helm/50 text-amber-helm' : 'border-down/40 text-down'}`}>{err.msg}{err.unknown && <> <Link className="underline" href="/history">Open History</Link></>}</div>}
      <div className="flex flex-wrap items-center gap-3 border-t border-graphite-800 pt-4">
        {preview.canConfirm ? <>
          <label className="flex items-center gap-2 text-sm text-graphite-300"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} data-testid="ack" /> I reviewed the impact and risk</label>
          <Btn variant="amber" danger onClick={confirm} busy={busy} disabled={!ack || left === 0 || (err?.unknown ?? false)} testId="confirm">{err?.unknown ? 'Outcome unknown' : recovery ? 'Confirm reduce-only stop' : `Confirm ${preview.order.side.toLowerCase()}`}</Btn>
        </> : <span className="text-sm text-down">Blocked by Shield — no confirm token was issued.</span>}
        <Btn variant="quiet" onClick={onDiscard} testId="discard">{left === 0 ? 'Close' : 'Discard'}</Btn>
      </div>
    </div>
  )
}

export function ReceiptView({ r, onClose, testId = 'receipt' }: { r: FullReceipt; onClose?: () => void; testId?: string }) {
  const s = sym(r.instrumentId)
  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{r.side} {s.label}</span><Pill v={r.status} /><span className="pill border border-graphite-700">{r.environmentLabel}</span><span className="text-sm text-graphite-300">{r.account}</span>
        {r.protection && <Pill v={r.protection.state} title="Trade-to-Protect" />}
      </div>
      {r.label && <div className="rounded-lg border border-violet-400/40 bg-violet-400/5 px-3 py-2 text-xs text-violet-200">{r.label}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Row k="Filled" v={`${qty(r.filledQuantity)} ${s.base}`} />
          <Row k="Avg fill price" v={usd(r.avgFillPrice)} />
          <Row k="Fees" v={r.fills.length ? r.fills.map(f => `${f.fee ?? '—'} ${f.feeAsset ?? ''}`).join(' + ') : '—'} />
          <Row k="Exchange order id" v={r.providerOrderId ?? '—'} />
          <Row k="Client order id" v={r.clientOrderId} />
          <Row k="Confirmed via" v={r.confirmedVia ?? '—'} mono={false} />
        </div>
        <div>
          {r.protection && <><Row k="Protection" v={r.protection.state} tone={r.protection.state === 'PROTECTED' ? 'text-up' : 'text-down'} /><Row k="Stop price" v={usd(r.protection.stopPrice)} /><Row k="Protected qty" v={qty(r.protection.protectedQuantity)} /></>}
          {r.orphanCleanup && r.orphanCleanup.length > 0 && <Row k="Orphaned stops" v={r.orphanCleanup.map(o => `${o.type} ${o.result}`).join(', ')} tone="text-amber-helm" />}
          <p className="mt-2 text-xs text-graphite-500">{r.fillTruth}</p>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-graphite-500 uppercase">Lifecycle</div>
        <ol className="space-y-1 text-xs">{r.events.map((e, i) => <li key={i} className="flex gap-3"><span className="num w-36 shrink-0 text-graphite-500">{ist(e.at)}</span><span className="w-44 shrink-0 font-semibold">{e.from ? `${e.from} → ` : ''}{e.to}</span><span className="text-graphite-500">{e.actor}{e.reason ? ` · ${e.reason}` : ''}</span></li>)}</ol>
      </div>
      {r.fills.length > 0 && <div className="text-xs text-graphite-500">Fills: {r.fills.map(f => `${f.qty} @ ${f.price}`).join(' · ')}</div>}
      <div className="flex gap-2 border-t border-graphite-800 pt-4">
        <Btn href={`/history?order=${r.orderId}`}>Open in History</Btn>
        {onClose && <Btn variant="quiet" onClick={onClose}>Done</Btn>}
      </div>
    </div>
  )
}
