'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { usd } from '@/lib/format'
import type { PreviewResp } from '@/lib/types'
import { Btn, Card, EnvPill, ErrorNote, Empty, Field, PageHeader, Pill, Segmented } from '../../ui'
import { PreviewPanel } from '../../trade-flow'
import { useShell } from '../../shell'

const ASSETS = ['BTC', 'ETH', 'SOL', 'BNB']
type Venue = { venue: string; source?: string; bid: string | null; ask: string | null; spreadBps: string | null; depthUsd10bps?: string | null; error?: string }

function Terminal() {
  const q = useSearchParams()
  const { accounts } = useShell()
  const tradable = accounts.filter(a => a.canTrade)
  const [accountId, setAccountId] = useState(q.get('accountId') ?? '')
  const [asset, setAsset] = useState((q.get('asset') ?? 'BTC').toUpperCase())
  const [product, setProduct] = useState<'spot' | 'perp'>((q.get('product') as 'spot' | 'perp') ?? 'spot')
  const [side, setSide] = useState<'BUY' | 'SELL'>((q.get('side') as 'BUY' | 'SELL') ?? 'BUY')
  const [sizeMode, setSizeMode] = useState<'notional' | 'quantity' | 'fraction'>(q.get('fraction') ? 'fraction' : 'notional')
  const [size, setSize] = useState(q.get('fraction') ?? q.get('notional') ?? '100')
  const [leverage, setLeverage] = useState(q.get('leverage') ?? '2')
  const [stop, setStop] = useState(q.get('stop') ?? '')
  const [reduceOnly, setReduceOnly] = useState(q.get('reduceOnly') === '1')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const acct = tradable.find(a => a.id === accountId)
  useEffect(() => { if (!accountId && tradable[0]) setAccountId(tradable[0].id) }, [accountId, tradable])
  useEffect(() => { if (acct && !acct.products.includes(product)) setProduct(acct.products[0] as 'spot' | 'perp') }, [acct, product])
  const mk = useApi<{ asset: string; venues: Venue[] }>(`/v1/markets/${asset}?product=${product}`, { poll: 10000 })
  const best = useMemo(() => {
    const v = (mk.data?.venues ?? []).filter(x => x.ask && x.bid)
    return { ask: v.sort((a, b) => Number(a.ask) - Number(b.ask))[0], bid: [...v].sort((a, b) => Number(b.bid) - Number(a.bid))[0] }
  }, [mk.data])

  async function doPreview(e?: React.FormEvent) {
    e?.preventDefault(); if (!acct) return
    setBusy(true); setErr(null); setPreview(null)
    try {
      const body: Record<string, unknown> = { accountId: acct.id, asset, product, side, [sizeMode]: sizeMode === 'fraction' ? String(Number(size) > 1 ? Number(size) / 100 : Number(size)) : size }
      if (product === 'perp') { body.leverage = leverage; if (reduceOnly) body.reduceOnly = true }
      if (stop && !reduceOnly) body.stopOffsetPercent = stop
      setPreview(await api<PreviewResp>('/v1/trade/preview', { method: 'POST', body }))
    } catch (e) { setErr(e instanceof ApiError ? e : new ApiError(0, 'ERR', (e as Error).message)) }
    finally { setBusy(false) }
  }

  if (accounts.length && !tradable.length) return <Empty title="No account can trade" hint="Connect a demo exchange or a HELM simulated account." action={<Btn href="/connect" variant="amber">Connect</Btn>} />
  return (
    <div>
      <PageHeader kicker="TERMINAL" title="Trade any connected exchange" subtitle="Build an order, preview the exact impact and Shield verdict, then confirm it yourself. Previews expire after 45 s and each confirm token works once." />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form onSubmit={doPreview} className="space-y-5" data-testid="ticket">
          <Card title="Account">
            <div className="grid gap-2">
              {tradable.map(a => (
                <button type="button" key={a.id} aria-pressed={a.id === accountId} onClick={() => setAccountId(a.id)} data-testid={`acct-${a.alias}`} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${a.id === accountId ? 'border-amber-helm bg-amber-helm/5' : 'border-graphite-800 hover:border-graphite-700'}`}>
                  <span className="font-medium">{a.alias}</span><span className="ml-auto flex gap-1"><EnvPill env={a.environment} />{a.state !== 'CONNECTED' && <Pill v={a.state} />}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Order">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">{ASSETS.map(x => <button type="button" key={x} aria-pressed={asset === x} onClick={() => setAsset(x)} className={`rounded-md border px-3 py-1 text-sm ${asset === x ? 'border-amber-helm text-amber-helm' : 'border-graphite-700 text-graphite-300'}`}>{x}</button>)}</div>
              <div className="flex flex-wrap gap-3">
                <Segmented value={product} onChange={setProduct} options={(acct?.products ?? ['spot']).filter(p => p === 'spot' || p === 'perp').map(p => [p as 'spot' | 'perp', p === 'perp' ? 'Perpetual' : 'Spot'])} testId="product" />
                <Segmented value={side} onChange={setSide} options={[['BUY', product === 'perp' ? 'Long / Buy' : 'Buy'], ['SELL', product === 'perp' ? 'Short / Sell' : 'Sell']]} testId="side" />
              </div>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <Field label={sizeMode === 'notional' ? 'Amount (USD)' : sizeMode === 'quantity' ? `Quantity (${asset})` : 'Fraction of position (%)'}>
                  <input className="input num" inputMode="decimal" value={size} onChange={e => setSize(e.target.value.replace(/[^0-9.]/g, ''))} required data-testid="size" />
                </Field>
                <Segmented value={sizeMode} onChange={setSizeMode} options={[['notional', '$'], ['quantity', 'Qty'], ['fraction', '%']]} />
              </div>
              {product === 'perp' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Leverage"><input className="input num" value={leverage} onChange={e => setLeverage(e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
                  <label className="mt-6 flex items-center gap-2 text-sm text-graphite-300"><input type="checkbox" checked={reduceOnly} onChange={e => setReduceOnly(e.target.checked)} /> Reduce-only (close)</label>
                </div>
              )}
              {!reduceOnly && <Field label="Trade-to-Protect stop distance (%)" hint={product === 'perp' ? 'After the fill, HELM places a reduce-only stop sized from the actual fill. PROTECTED only once the exchange lists it.' : 'Spot: a stop-market sell sized from the fill, where the venue supports it.'}><input className="input num" placeholder="e.g. 3 (optional)" value={stop} onChange={e => setStop(e.target.value.replace(/[^0-9.]/g, ''))} data-testid="stop" /></Field>}
              <Btn type="submit" variant="amber" busy={busy} disabled={!acct} className="w-full justify-center" testId="preview-btn">Preview order</Btn>
            </div>
          </Card>
        </form>
        <div className="space-y-6">
          <Card title={`${asset} ${product === 'perp' ? 'perpetual' : 'spot'} — venues`} action={<Btn variant="quiet" onClick={mk.reload}>Refresh</Btn>} pad={false}>
            {mk.data ? (
              <table className="tbl"><thead><tr><th>Venue</th><th className="r">Bid</th><th className="r">Ask</th><th className="r">Spread</th><th className="r">Depth ±10bps</th><th>Source</th></tr></thead>
                <tbody>{mk.data.venues.map(v => (
                  <tr key={v.venue}><td className="font-medium capitalize">{v.venue}</td>
                    {v.error ? <td colSpan={5} className="text-xs text-down">{v.error}</td> : <>
                      <td className={`r num ${best.bid?.venue === v.venue ? 'text-up' : ''}`}>{usd(v.bid)}</td><td className={`r num ${best.ask?.venue === v.venue ? 'text-up' : ''}`}>{usd(v.ask)}</td><td className="r num whitespace-nowrap">{v.spreadBps ?? "—"} bps</td><td className="r num">{usd(v.depthUsd10bps, 0)}</td><td className="text-xs text-graphite-500">{v.source}</td></>}
                  </tr>))}</tbody></table>
            ) : <div className="p-5 text-sm text-graphite-500">{mk.error ? mk.error.message : 'Loading books…'}</div>}
            <div className="border-t border-graphite-800 px-5 py-2 text-[11px] text-graphite-500">Green = best bid / best ask across venues. Public order books; OKX shows production public market data only (logged-in OKX is blocked in your region).</div>
          </Card>
          <Card title="Preview & confirm" testId="preview-card">
            <ErrorNote error={err} />
            {preview ? <PreviewPanel preview={preview as never} onDiscard={() => setPreview(null)} /> : !err && <Empty title="No preview yet" hint="Fill the ticket and press Preview. Nothing is sent to the exchange until you confirm." />}
          </Card>
        </div>
      </div>
    </div>
  )
}
export default function Page() { return <Suspense><Terminal /></Suspense> }
