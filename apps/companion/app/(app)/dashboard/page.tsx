'use client'
import Link from 'next/link'
import { api } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { REAL_ENV, SEV, ago, pct, signedUsd, sym, tone, usd } from '@/lib/format'
import type { Compass, Portfolio, PulseEvent } from '@/lib/types'
import { Btn, Card, EnvPill, ErrorNote, Empty, PageHeader, Pill, Skeleton, Stat } from '../../ui'
import { useShell } from '../../shell'

export default function Dashboard() {
  const { me, accounts } = useShell()
  const pf = useApi<{ portfolio: Portfolio; accountErrors: Array<{ accountId: string; error: string }> }>('/v1/portfolio', { poll: 30000 })
  const cp = useApi<{ compass: Compass; netLiquidationUsd: string }>('/v1/shield/compass', { poll: 30000 })
  const pulse = useApi<{ events: PulseEvent[] }>('/v1/pulse', { poll: 20000 })
  const wl = useApi<{ source: string; items: Array<{ asset: string; price: string | null; at: string | null }> }>('/v1/markets/watchlist', { poll: 15000 })
  const p = pf.data?.portfolio
  const real = p?.accounts.filter(a => REAL_ENV(a.environment)) ?? []
  const other = p?.accounts.filter(a => !REAL_ENV(a.environment)) ?? []
  const sum = (xs: Array<{ valueUsd: string }>) => xs.reduce((t, a) => t + Number(a.valueUsd), 0)
  const openPos = p?.positions.filter(x => Number(x.quantity) !== 0) ?? []
  const unprot = cp.data?.compass.unprotected ?? []
  return (
    <div>
      <PageHeader kicker="DASHBOARD" title={`Good to see you${me?.displayName ? `, ${me.displayName}` : ''}`} subtitle="Everything across your connected exchanges, in one place. Values refresh every 30 s."
        actions={<><Btn href="/terminal" variant="amber">New trade</Btn><Btn href="/recipes?run=builtin:pre-sleep">Pre-sleep check</Btn><Btn href="/positions#emergency">Emergency review</Btn></>} />
      <ErrorNote error={pf.error} onRetry={pf.reload} />
      {accounts.length === 0 && !pf.loading && <div className="mb-6"><Empty title="No accounts connected yet" hint="Connect Binance Demo, Bybit Demo or a HELM simulated account to get started." action={<Btn href="/connect" variant="amber">Connect an exchange</Btn>} /></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {p ? <>
          <Stat testId="stat-demo" label="Demo exchanges" value={usd(sum(real), 0)} sub={`${real.length} account${real.length === 1 ? '' : 's'} · exchange-reported`} />
          <Stat label="SIM / sandbox" value={usd(sum(other), 0)} sub="HELM-simulated or static — not exchange funds" />
          <Stat label="Unrealised PnL" value={signedUsd(p.unrealizedPnlUsd)} tone={tone(p.unrealizedPnlUsd)} sub="open derivatives" />
          <Stat label="Gross derivatives" value={usd(p.grossDerivativeExposureUsd, 0)} sub={`${openPos.length} open position${openPos.length === 1 ? '' : 's'}`} />
          <Stat label="Unprotected" value={String(unprot.length)} tone={unprot.length ? 'text-down' : 'text-up'} sub={unprot.length ? 'positions without a venue-listed stop' : 'every perp has a listed stop'} />
        </> : Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Accounts" className="lg:col-span-2" action={<Btn variant="quiet" href="/connect">Manage</Btn>} pad={false}>
          {p ? (
            <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Account</th><th>Env</th><th>State</th><th className="r">Value</th><th className="r">uPnL</th><th className="r">Pos / orders</th></tr></thead>
              <tbody>{p.accounts.map(a => (
                <tr key={a.accountId}><td className="font-medium">{a.alias}</td><td><EnvPill env={a.environment} /></td><td><Pill v={a.state} /></td><td className="r num">{usd(a.valueUsd)}</td><td className={`r num ${tone(a.unrealizedPnlUsd)}`}>{signedUsd(a.unrealizedPnlUsd)}</td><td className="r num">{a.positions} / {a.openOrders}</td></tr>
              ))}</tbody></table></div>
          ) : <div className="p-5"><Skeleton /></div>}
          {pf.data?.accountErrors.length ? <div className="border-t border-graphite-800 px-5 py-3 text-xs text-down">{pf.data.accountErrors.map(e => <div key={e.accountId}>{accounts.find(a => a.id === e.accountId)?.alias ?? e.accountId}: {e.error}</div>)}</div> : null}
        </Card>
        <Card title="Exposure compass" action={<Btn variant="quiet" href="/shield">Open Shield</Btn>}>
          {cp.data ? (
            <div className="space-y-3 text-sm">
              <div><span className="text-graphite-500">Largest directional</span><div className="num text-lg">{cp.data.compass.largestDirectional ? `${cp.data.compass.largestDirectional.asset} ${cp.data.compass.largestDirectional.direction} ${usd(cp.data.compass.largestDirectional.netUsd, 0)}` : '—'}</div></div>
              <div><span className="text-graphite-500">Largest exchange share</span><div className="num">{cp.data.compass.largestExchange ? `${cp.data.compass.largestExchange.alias} · ${pct(cp.data.compass.largestExchange.sharePct)}` : '—'}</div></div>
              <div className="space-y-1.5">{cp.data.compass.rose.map(r => (
                <div key={r.asset} className="flex items-center gap-2"><span className="num w-10 text-xs">{r.asset}</span><div className="h-2 flex-1 rounded bg-graphite-800"><div className={`h-2 rounded ${r.direction === 'SHORT' ? 'bg-down' : 'bg-amber-helm'}`} style={{ width: `${Math.min(100, Number(r.sharePct))}%` }} /></div><span className="num w-12 text-right text-xs text-graphite-300">{pct(r.sharePct, 0)}</span></div>
              ))}</div>
            </div>
          ) : cp.error ? <ErrorNote error={cp.error} onRetry={cp.reload} /> : <Skeleton />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Pulse — what needs attention" className="lg:col-span-2" action={<Btn variant="quiet" href="/pulse">All events</Btn>} pad={false}>
          {pulse.data ? (pulse.data.events.length ? (
            <ul>{pulse.data.events.slice(0, 6).map(e => (
              <li key={e.id} className="flex items-center gap-3 border-b border-graphite-850 px-5 py-3 text-sm last:border-0">
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.severity >= 4 ? 'bg-down' : e.severity >= 3 ? 'bg-amber-helm' : 'bg-graphite-500'}`} title={SEV[e.severity]} />
                <span className="w-40 shrink-0 text-xs font-semibold tracking-wider text-graphite-300">{e.kind.replace(/_/g, ' ')}</span>
                <span className="min-w-0 flex-1 truncate" title={e.reason}>{e.reason}{e.count > 1 ? <span className="text-graphite-500"> ×{e.count}</span> : null}</span>
                <span className="shrink-0 text-xs text-graphite-500">{ago(e.createdAt)}</span>
                <Btn variant="quiet" onClick={async () => { await api(`/v1/pulse/${e.id}/dismiss`, { method: 'POST' }); await pulse.reload() }}>Dismiss</Btn>
              </li>
            ))}</ul>
          ) : <div className="p-5"><Empty title="All quiet" hint="No fills, failures or risk events right now." /></div>) : <div className="p-5"><Skeleton /></div>}
        </Card>
        <Card title="Watchlist" action={<Btn variant="quiet" href="/markets">Markets</Btn>} pad={false}>
          {wl.data ? <table className="tbl"><tbody>{wl.data.items.map(i => <tr key={i.asset}><td><Link href={`/markets?asset=${i.asset}`} className="font-medium hover:text-amber-helm">{i.asset}</Link></td><td className="r num">{usd(i.price, Number(i.price) < 10 ? 4 : 2)}</td><td className="r text-xs text-graphite-500">{ago(i.at)}</td></tr>)}</tbody></table> : <div className="p-5"><Skeleton /></div>}
          {wl.data && <div className="border-t border-graphite-800 px-5 py-2 text-[11px] text-graphite-500">{wl.data.source}</div>}
        </Card>
      </div>
      {openPos.length > 0 && (
        <Card title="Open positions" className="mt-6" action={<Btn variant="quiet" href="/positions">Manage</Btn>} pad={false}>
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Instrument</th><th>Account</th><th>Side</th><th className="r">Size</th><th className="r">Mark</th><th className="r">uPnL</th><th>Protection</th></tr></thead>
            <tbody>{openPos.map(x => { const un = unprot.some(u => u.accountId === x.accountId && u.instrumentId === x.instrumentId); return (
              <tr key={x.accountId + x.instrumentId}><td className="font-medium">{sym(x.instrumentId).label}</td><td>{accounts.find(a => a.id === x.accountId)?.alias}</td><td>{Number(x.quantity) < 0 || x.side === 'SHORT' ? 'SHORT' : 'LONG'}</td><td className="r num">{Math.abs(Number(x.quantity))}</td><td className="r num">{usd(x.markPrice)}</td><td className={`r num ${tone(x.unrealizedPnl)}`}>{signedUsd(x.unrealizedPnl)}</td><td>{x.product === 'perp' ? <Pill v={un ? 'UNPROTECTED' : 'PROTECTED'} /> : <span className="text-xs text-graphite-500">spot</span>}</td></tr>
            ) })}</tbody></table></div>
        </Card>
      )}
    </div>
  )
}
