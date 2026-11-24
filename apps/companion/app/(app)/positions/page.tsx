'use client'
import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { qty, signedUsd, sym, tone, usd } from '@/lib/format'
import type { Compass, Portfolio } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, Modal, PageHeader, Pill, Skeleton } from '../../ui'
import { useShell } from '../../shell'

interface EmItem { kind: 'CANCEL_ORDER' | 'CLOSE_POSITION'; accountId: string; instrumentId: string; detail: string; providerOrderId?: string; unprotected?: boolean }
interface DbOrder { orderId: string; account: string; instrumentId: string; side: string; type: string; status: string; providerOrderId: string | null }

export default function Positions() {
  const { accounts } = useShell()
  const pf = useApi<{ portfolio: Portfolio }>('/v1/portfolio')
  const cp = useApi<{ compass: Compass }>('/v1/shield/compass')
  const em = useApi<{ items: EmItem[]; note: string }>('/v1/emergency')
  const orders = useApi<{ orders: DbOrder[] }>('/v1/orders')
  const [cancel, setCancel] = useState<{ orderId: string; label: string } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const alias = (id: string) => accounts.find(a => a.id === id)?.alias ?? id
  const p = pf.data?.portfolio
  const pos = p?.positions.filter(x => Number(x.quantity) !== 0) ?? []
  const unprot = cp.data?.compass.unprotected ?? []
  const helmOrder = (providerOrderId: string | null) => orders.data?.orders.find(o => o.providerOrderId && o.providerOrderId === providerOrderId && ['ACCEPTED', 'PARTIALLY_FILLED'].includes(o.status))
  const reload = async () => { await Promise.all([pf.reload(), cp.reload(), em.reload(), orders.reload()]) }
  const closeHref = (accountId: string, instrumentId: string, frac: string) => { const s = sym(instrumentId); const x = pos.find(q => q.accountId === accountId && q.instrumentId === instrumentId); const long = x ? !(Number(x.quantity) < 0 || x.side === 'SHORT') : true; return `/terminal?accountId=${accountId}&asset=${s.base}&product=${s.product}&side=${long ? 'SELL' : 'BUY'}&fraction=${frac}&reduceOnly=1` }

  async function doCancel() {
    if (!cancel) return
    setBusy(true); setMsg(null)
    try { const r = await api<{ status: string }>(`/v1/orders/${cancel.orderId}/cancel`, { method: 'POST', body: { confirm: true } }); setMsg({ ok: true, text: `Cancel sent: ${cancel.label} → ${r.status ?? 'requested'}` }); setCancel(null); await reload() }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Cancel failed' }) }
    finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader kicker="POSITIONS & ORDERS" title="Open positions and working orders" subtitle="Live from each exchange. Closing is always a reduce-only order you preview and confirm; cancelling asks you first." actions={<Btn onClick={reload} busy={pf.loading}>Refresh</Btn>} />
      <ErrorNote error={pf.error} onRetry={pf.reload} />
      {msg && <div role="status" className={`mb-4 rounded-lg border px-4 py-2 text-sm ${msg.ok ? 'border-up/40 text-up' : 'border-down/40 text-down'}`}>{msg.text}</div>}
      <Card title={`Positions (${pos.length})`} pad={false}>
        {!p ? <div className="p-5"><Skeleton /></div> : pos.length === 0 ? <div className="p-5"><Empty title="No open positions" hint="No positions on any connected account." action={<Btn href="/terminal" variant="amber">Open the terminal</Btn>} /></div> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Instrument</th><th>Account</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Mark</th><th className="r">Liq.</th><th className="r">uPnL</th><th>Protection</th><th></th></tr></thead>
            <tbody>{pos.map(x => { const un = unprot.some(u => u.accountId === x.accountId && u.instrumentId === x.instrumentId); const long = !(Number(x.quantity) < 0 || x.side === 'SHORT'); return (
              <tr key={x.accountId + x.instrumentId}>
                <td className="font-medium">{sym(x.instrumentId).label}</td><td>{alias(x.accountId)}</td><td className={long ? 'text-up' : 'text-down'}>{long ? 'LONG' : 'SHORT'}</td><td className="r num">{qty(String(Math.abs(Number(x.quantity))))}</td><td className="r num">{usd(x.entryPrice)}</td><td className="r num">{usd(x.markPrice)}</td><td className="r num">{usd(x.liquidationPrice)}</td><td className={`r num ${tone(x.unrealizedPnl)}`}>{signedUsd(x.unrealizedPnl)}</td>
                <td>{x.product === 'perp' ? <Pill v={un ? 'UNPROTECTED' : 'PROTECTED'} /> : <span className="text-xs text-graphite-500">spot</span>}</td>
                <td className="whitespace-nowrap text-right">{x.product === 'perp' && <><Btn variant="quiet" href={closeHref(x.accountId, x.instrumentId, '0.5')}>Close 50%</Btn><Btn variant="quiet" href={closeHref(x.accountId, x.instrumentId, '1')}>Close</Btn></>}{un && <Btn variant="quiet" href="/protect">Protect</Btn>}</td>
              </tr>) })}</tbody></table></div>
        )}
      </Card>
      <Card title={`Working orders (${p?.openOrders.length ?? 0})`} className="mt-6" pad={false}>
        {!p ? <div className="p-5"><Skeleton /></div> : p.openOrders.length === 0 ? <div className="p-5"><Empty title="No working orders" /></div> : (
          <table className="tbl"><thead><tr><th>Instrument</th><th>Account</th><th>Side</th><th>Type</th><th className="r">Qty</th><th className="r">Price / trigger</th><th>Flags</th><th></th></tr></thead>
            <tbody>{p.openOrders.map(o => { const h = helmOrder(o.providerOrderId); return (
              <tr key={(o.providerOrderId ?? '') + o.instrumentId}><td className="font-medium">{sym(o.instrumentId).label}</td><td>{alias(o.accountId)}</td><td>{o.side}</td><td>{o.type}</td><td className="r num">{qty(o.quantity)}</td><td className="r num">{usd(o.price ?? o.stopPrice)}</td><td className="text-xs text-graphite-500">{o.reduceOnly ? 'reduce-only' : ''}</td>
                <td className="text-right">{h ? <Btn variant="danger" danger onClick={() => setCancel({ orderId: h.orderId, label: `${o.side} ${o.type} ${sym(o.instrumentId).label}` })}>Cancel…</Btn> : <span className="text-xs text-graphite-500" title="Placed outside HELM">external</span>}</td></tr>) })}</tbody></table>
        )}
      </Card>
      <div id="emergency" className="scroll-mt-20" />
      <Card title="Emergency review" className="mt-6" testId="emergency">
        <p className="mb-3 text-sm text-graphite-300">{em.data?.note ?? 'HELM never broadcasts “close everything”. Every item needs its own preview and explicit confirmation.'}</p>
        {em.data && (em.data.items.length === 0 ? <Empty title="Nothing to review" hint="No open positions or working orders on any connected account." /> : (
          <ol className="space-y-2">{em.data.items.map((i, n) => (
            <li key={n} className="flex flex-wrap items-center gap-3 rounded-lg border border-graphite-800 px-4 py-3 text-sm">
              <span className="num text-xs text-graphite-500">{String(n + 1).padStart(2, '0')}</span><Pill v={i.kind === 'CLOSE_POSITION' ? 'CLOSE' : 'CANCEL'} /><span className="font-medium">{sym(i.instrumentId).label}</span><span className="text-graphite-300">{alias(i.accountId)}</span><span className="text-graphite-500">{i.detail}</span>{i.unprotected && <Pill v="UNPROTECTED" />}
              <span className="ml-auto">{i.kind === 'CLOSE_POSITION' ? <Btn variant="ghost" href={closeHref(i.accountId, i.instrumentId, '1')}>Preview close</Btn> : (() => { const h = helmOrder(i.providerOrderId ?? null); return h ? <Btn variant="danger" danger onClick={() => setCancel({ orderId: h.orderId, label: i.detail })}>Cancel…</Btn> : <span className="text-xs text-graphite-500">placed outside HELM — cancel at the exchange</span> })()}</span>
            </li>))}</ol>
        ))}
      </Card>
      <Modal open={!!cancel} title="Cancel this order?" onClose={() => setCancel(null)}>
        <p className="text-sm text-graphite-300">{cancel?.label}</p>
        <p className="mt-2 text-xs text-graphite-500">HELM sends one cancel to the exchange and then reads the order back. If this is a protective stop, the position becomes UNPROTECTED.</p>
        <div className="mt-5 flex gap-2"><Btn variant="danger" danger busy={busy} onClick={doCancel} testId="confirm-cancel">Yes, cancel order</Btn><Btn variant="quiet" onClick={() => setCancel(null)}>Keep it</Btn></div>
      </Modal>
    </div>
  )
}
