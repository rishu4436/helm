'use client'
import { useState } from 'react'
import { useApi } from '@/lib/hooks'
import { REAL_ENV, ist, num, pct, signedUsd, tone, usd } from '@/lib/format'
import type { Portfolio } from '@/lib/types'
import { Btn, Card, EnvPill, ErrorNote, PageHeader, Segmented, Skeleton, Stat } from '../../ui'

export default function PortfolioPage() {
  const pf = useApi<{ portfolio: Portfolio; accountErrors: Array<{ accountId: string; error: string }> }>('/v1/portfolio')
  const [scope, setScope] = useState<'all' | 'demo' | 'sim'>('all')
  const p = pf.data?.portfolio
  const inScope = (env: string) => scope === 'all' || (scope === 'demo' ? REAL_ENV(env) : !REAL_ENV(env))
  const accts = p?.accounts.filter(a => inScope(a.environment)) ?? []
  const ids = new Set(accts.map(a => a.accountId))
  const vals = p?.valuations.filter(v => ids.has(v.accountId)) ?? []
  const total = accts.reduce((t, a) => t + Number(a.valueUsd), 0)
  const byAsset = Object.values(vals.reduce<Record<string, { asset: string; amount: number; value: number }>>((m, v) => { const r = (m[v.asset] ??= { asset: v.asset, amount: 0, value: 0 }); r.amount += Number(v.amount); r.value += Number(v.value ?? 0); return m }, {})).sort((a, b) => b.value - a.value)
  return (
    <div>
      <PageHeader kicker="PORTFOLIO" title="Holdings across every exchange" subtitle="Balances are read from each exchange and valued at public mid prices. Demo exchange funds and HELM-simulated balances are kept apart."
        actions={<><Segmented value={scope} onChange={setScope} options={[['all', 'All'], ['demo', 'Demo exchanges'], ['sim', 'SIM / sandbox']]} testId="scope" /><Btn onClick={pf.reload} busy={pf.loading}>Refresh</Btn></>} />
      <ErrorNote error={pf.error} onRetry={pf.reload} />
      {!p ? <Skeleton h="h-64" /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Value in scope" value={usd(total, 0)} sub={`${accts.length} accounts`} />
          <Stat label="Assets" value={String(byAsset.length)} sub={p.unvaluedAssets.length ? `${p.unvaluedAssets.length} unvalued: ${p.unvaluedAssets.join(', ')}` : 'all valued'} />
          <Stat label="Unrealised PnL" value={signedUsd(p.unrealizedPnlUsd)} tone={tone(p.unrealizedPnlUsd)} />
          <Stat label="As of" value={<span className="text-base">{ist(p.asOf)}</span>} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card title="Allocation by asset" pad={false}>
            <table className="tbl"><thead><tr><th>Asset</th><th className="r">Amount</th><th className="r">Value</th><th className="r">Share</th><th></th></tr></thead>
              <tbody>{byAsset.map(a => (
                <tr key={a.asset}><td className="font-medium">{a.asset}</td><td className="r num">{num(a.amount, a.amount < 10 ? 6 : 2)}</td><td className="r num">{usd(a.value)}</td><td className="r num">{pct(total ? (a.value / total) * 100 : 0)}</td>
                  <td className="w-28"><div className="h-1.5 rounded bg-graphite-800"><div className="h-1.5 rounded bg-amber-helm" style={{ width: `${total ? (a.value / total) * 100 : 0}%` }} /></div></td></tr>
              ))}</tbody></table>
          </Card>
          <Card title="By account" pad={false}>
            {accts.map(a => {
              const av = vals.filter(v => v.accountId === a.accountId).sort((x, y) => Number(y.value ?? 0) - Number(x.value ?? 0))
              return (
                <details key={a.accountId} className="border-b border-graphite-850 last:border-0" open={av.length <= 6}>
                  <summary className="flex cursor-pointer items-center gap-3 px-5 py-3 text-sm"><span className="font-medium">{a.alias}</span><EnvPill env={a.environment} /><span className="num ml-auto">{usd(a.valueUsd)}</span></summary>
                  <table className="tbl mb-2"><tbody>{av.map(v => (
                    <tr key={v.asset}><td className="pl-8 text-graphite-300">{v.asset}</td><td className="r num">{num(v.amount, Number(v.amount) < 10 ? 8 : 2)}</td><td className="r num">{usd(v.value)}</td><td className="text-[11px] text-graphite-500">{v.rateSource ?? v.method}</td></tr>
                  ))}</tbody></table>
                </details>
              )
            })}
          </Card>
        </div>
        <Card title="Exposure by asset (spot + derivatives)" className="mt-6" pad={false}>
          <table className="tbl"><thead><tr><th>Asset</th><th className="r">Spot</th><th className="r">Derivatives net</th><th className="r">Net directional</th><th className="r">Gross</th><th>Where</th></tr></thead>
            <tbody>{p.exposures.map(e => (
              <tr key={e.asset}><td className="font-medium">{e.asset}</td><td className="r num">{usd(e.spotUsd, 0)}</td><td className={`r num ${tone(e.derivativesNetUsd)}`}>{usd(e.derivativesNetUsd, 0)}</td><td className="r num">{usd(e.netDirectionalUsd, 0)}</td><td className="r num">{usd(e.grossUsd, 0)}</td>
                <td className="text-xs text-graphite-300">{e.byAccount.filter(b => ids.has(b.accountId)).map(b => `${b.alias} ${b.kind} ${usd(b.usd, 0)}`).join(' · ')}</td></tr>
            ))}</tbody></table>
        </Card>
        <ul className="mt-4 space-y-1 text-xs text-graphite-500">{p.notes.map(n => <li key={n}>• {n}</li>)}</ul>
      </>}
    </div>
  )
}
