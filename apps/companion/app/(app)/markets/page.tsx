'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useApi } from '@/lib/hooks'
import { ago, usd } from '@/lib/format'
import { Btn, Card, ErrorNote, PageHeader, Segmented, Skeleton } from '../../ui'

type Venue = { venue: string; source?: string; instrumentId?: string; bid: string | null; ask: string | null; spreadBps: string | null; depthUsd10bps?: string | null; ageMs?: number; error?: string }
const ASSETS = ['BTC', 'ETH', 'SOL', 'BNB']

function Markets() {
  const q = useSearchParams()
  const [asset, setAsset] = useState((q.get('asset') ?? 'BTC').toUpperCase())
  const [product, setProduct] = useState<'spot' | 'perp'>('spot')
  const wl = useApi<{ source: string; items: Array<{ asset: string; price: string | null; at: string | null }> }>('/v1/markets/watchlist', { poll: 10000 })
  const mk = useApi<{ venues: Venue[] }>(`/v1/markets/${asset}?product=${product}`, { poll: 8000 })
  const ok = (mk.data?.venues ?? []).filter(v => v.bid && v.ask)
  const bestBid = [...ok].sort((a, b) => Number(b.bid) - Number(a.bid))[0], bestAsk = [...ok].sort((a, b) => Number(a.ask) - Number(b.ask))[0]
  const mids = ok.map(v => (Number(v.bid) + Number(v.ask)) / 2)
  const disp = mids.length > 1 ? ((Math.max(...mids) - Math.min(...mids)) / Math.min(...mids)) * 10000 : null
  const deepest = [...ok].sort((a, b) => Number(b.depthUsd10bps ?? 0) - Number(a.depthUsd10bps ?? 0))[0]
  return (
    <div>
      <PageHeader kicker="MARKET INTELLIGENCE" title="Where is the best price right now?" subtitle="Live public order books from every venue HELM supports, side by side. HELM never routes for you — it shows the facts, you pick the venue." actions={<><Segmented value={product} onChange={setProduct} options={[['spot', 'Spot'], ['perp', 'Perpetual']]} testId="mk-product" /><Btn onClick={() => { mk.reload(); wl.reload() }}>Refresh</Btn></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(wl.data?.items ?? ASSETS.map(a => ({ asset: a, price: null, at: null }))).map(i => (
          <button key={i.asset} onClick={() => setAsset(i.asset)} className={`card p-4 text-left ${asset === i.asset ? 'border-amber-helm' : 'hover:border-graphite-700'}`} data-testid={`asset-${i.asset}`}>
            <div className="text-xs font-semibold tracking-[0.14em] text-graphite-500">{i.asset}</div><div className="num mt-1 text-xl">{usd(i.price, Number(i.price) < 10 ? 4 : 2)}</div><div className="text-[11px] text-graphite-500">{ago(i.at)}</div>
          </button>
        ))}
      </div>
      <ErrorNote error={mk.error} onRetry={mk.reload} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-xs text-graphite-500">Best bid (sell here)</div><div className="num text-lg text-up">{bestBid ? `${usd(bestBid.bid)} · ${bestBid.venue}` : '—'}</div></div>
        <div className="card p-4"><div className="text-xs text-graphite-500">Best ask (buy here)</div><div className="num text-lg text-up">{bestAsk ? `${usd(bestAsk.ask)} · ${bestAsk.venue}` : '—'}</div></div>
        <div className="card p-4"><div className="text-xs text-graphite-500">Cross-venue dispersion · deepest book</div><div className="num text-lg">{disp !== null ? `${disp.toFixed(1)} bps` : '—'} · {deepest?.venue ?? '—'}</div></div>
      </div>
      <Card title={`${asset} ${product === 'perp' ? 'perpetual' : 'spot'} books`} className="mt-6" pad={false}>
        {!mk.data ? <div className="p-5"><Skeleton /></div> : (
          <table className="tbl"><thead><tr><th>Venue</th><th className="r">Bid</th><th className="r">Ask</th><th className="r">Spread</th><th className="r">Depth ±10 bps</th><th className="r">Age</th><th>Source</th><th></th></tr></thead>
            <tbody>{mk.data.venues.map(v => (
              <tr key={v.venue}><td className="font-medium capitalize">{v.venue}</td>
                {v.error ? <td colSpan={6} className="text-xs text-down">{v.error}</td> : <>
                  <td className={`r num ${bestBid?.venue === v.venue ? 'text-up' : ''}`}>{usd(v.bid)}</td><td className={`r num ${bestAsk?.venue === v.venue ? 'text-up' : ''}`}>{usd(v.ask)}</td><td className="r num whitespace-nowrap">{v.spreadBps ?? '—'} bps</td><td className="r num">{usd(v.depthUsd10bps, 0)}</td><td className="r num text-xs text-graphite-500">{v.ageMs !== undefined ? `${v.ageMs} ms` : '—'}</td><td className="text-xs text-graphite-500">{v.source}</td></>}
                <td className="text-right">{v.venue !== 'okx' && !v.error ? <Btn variant="quiet" href={`/terminal?asset=${asset}&product=${product}`}>Trade</Btn> : <span className="text-[11px] text-graphite-500">{v.venue === 'okx' ? 'data only' : ''}</span>}</td></tr>
            ))}</tbody></table>
        )}
        <div className="border-t border-graphite-800 px-5 py-2 text-[11px] text-graphite-500">Public order books from each venue (OKX public data comes from its production host, read-only). Prices are not advice.</div>
      </Card>
    </div>
  )
}
export default function Page() { return <Suspense><Markets /></Suspense> }
