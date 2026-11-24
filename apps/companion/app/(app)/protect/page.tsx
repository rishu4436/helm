'use client'
import { useApi } from '@/lib/hooks'
import { ist, qty, sym, usd } from '@/lib/format'
import type { Compass } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, PageHeader, Pill, Skeleton } from '../../ui'
import { useShell } from '../../shell'

interface Plan { id: string; accountId: string; instrumentId: string; entryOrderId: string; protectionOrderId: string | null; stopOffsetPercent: string | null; stopPrice: string | null; protectedQuantity: string; state: string; history: Array<{ from?: string; to: string; reason?: string; at?: string }>; updatedAt: string }
const STEPS = ['Entry confirmed by you', 'Fill read back from the exchange', 'Stop sized from the ACTUAL fill', 'Reduce-only stop submitted', 'Exchange lists the stop → PROTECTED']

export default function Protect() {
  const { accounts } = useShell()
  const plans = useApi<{ plans: Plan[] }>('/v1/protection')
  const cp = useApi<{ compass: Compass }>('/v1/shield/compass')
  const alias = (id: string) => accounts.find(a => a.id === id)?.alias ?? id
  const un = cp.data?.compass.unprotected ?? []
  const closeHref = (u: { accountId: string; instrumentId: string; side: string }) => { const s = sym(u.instrumentId); return `/terminal?accountId=${u.accountId}&asset=${s.base}&product=${s.product}&side=${u.side === 'SHORT' ? 'BUY' : 'SELL'}&fraction=1&reduceOnly=1` }
  return (
    <div>
      <PageHeader kicker="TRADE-TO-PROTECT" title="Every entry can carry its own stop" subtitle="Add a stop distance to any order in the Terminal or by voice (“…with a 3 percent stop”). HELM sizes the stop from what actually filled and calls a position PROTECTED only when the exchange lists the stop." actions={<Btn href="/terminal?product=perp&stop=3" variant="amber">New protected entry</Btn>} />
      <Card title="How it works">
        <ol className="grid gap-2 sm:grid-cols-5">{STEPS.map((s, i) => <li key={s} className="rounded-lg border border-graphite-800 p-3 text-sm"><div className="num text-xs text-amber-helm">{String(i + 1).padStart(2, '0')}</div>{s}</li>)}</ol>
        <p className="mt-3 text-xs text-graphite-500">If the stop cannot be listed (unsupported order type, no fill price, exchange rejection), the plan is UNPROTECTED and Pulse raises a high-severity alert. A full reduce-only close cancels the now-orphaned stop on that exchange; a partial close keeps it.</p>
      </Card>
      <Card title={`Unprotected positions (${un.length})`} className="mt-6" testId="unprotected">
        <ErrorNote error={cp.error} onRetry={cp.reload} />
        {!cp.data ? <Skeleton /> : un.length === 0 ? <p className="text-sm text-up">No unprotected perp positions on any connected account.</p> : (
          <ul className="space-y-2">{un.map(u => (
            <li key={u.accountId + u.instrumentId} className="flex flex-wrap items-center gap-3 rounded-lg border border-down/30 px-4 py-3 text-sm"><Pill v="UNPROTECTED" /><span className="font-medium">{sym(u.instrumentId).label}</span><span className="text-graphite-300">{alias(u.accountId)} · {u.side} · {usd(u.notionalUsd, 0)}</span>
              <span className="ml-auto flex gap-2"><Btn href={closeHref(u)}>Preview close</Btn></span></li>))}</ul>
        )}
        <p className="mt-3 text-xs text-graphite-500">Known gap: attaching a stop to an existing position that was opened without one is not built yet; today you can close it (reduce-only) or re-enter with a stop.</p>
      </Card>
      <Card title="Protection plans" className="mt-6" pad={false}>
        <ErrorNote error={plans.error} onRetry={plans.reload} />
        {!plans.data ? <div className="p-5"><Skeleton /></div> : plans.data.plans.length === 0 ? <div className="p-5"><Empty title="No protection plans yet" hint="Place an entry with a stop distance to create one." /></div> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Instrument</th><th>Account</th><th>State</th><th className="r">Stop %</th><th className="r">Stop price</th><th className="r">Protected qty</th><th>Last change</th><th>Updated</th></tr></thead>
            <tbody>{plans.data.plans.map(p => { const last = p.history[p.history.length - 1]; return (
              <tr key={p.id}><td className="font-medium">{sym(p.instrumentId).label}</td><td>{alias(p.accountId)}</td><td><Pill v={p.state} /></td><td className="r num">{p.stopOffsetPercent ? `${Number(p.stopOffsetPercent)}%` : '—'}</td><td className="r num">{usd(p.stopPrice)}</td><td className="r num">{qty(p.protectedQuantity)}</td><td className="max-w-xs truncate text-xs text-graphite-300" title={last?.reason}>{last ? `${last.to}${last.reason ? ` · ${last.reason}` : ''}` : '—'}</td><td className="whitespace-nowrap text-xs text-graphite-500">{ist(p.updatedAt)}</td></tr>) })}</tbody></table></div>
        )}
      </Card>
    </div>
  )
}
