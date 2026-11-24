'use client'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { pct, signedUsd, sym, tone, usd } from '@/lib/format'
import type { Compass, MultiScenario, Policy } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, Field, PageHeader, Pill, Skeleton } from '../../ui'
import { useShell } from '../../shell'

const LIMITS: Array<[keyof Policy, string, string]> = [
  ['maxSpotOrderUsd', 'Max spot order', 'USD'], ['maxFuturesOrderUsd', 'Max futures order', 'USD'], ['maxLeverage', 'Max leverage', '×'],
  ['maxTotalNotionalUsd', 'Max total derivatives notional', 'USD'], ['maxAssetExposureUsd', 'Max exposure per asset', 'USD'], ['maxExchangeExposurePct', 'Max share on one exchange', '%'],
  ['maxMarginUtilizationPct', 'Max margin utilisation', '%'], ['minReserveUsd', 'Keep at least (reserve)', 'USD'], ['maxSlippageBps', 'Max slippage', 'bps'], ['nearLiquidationPct', 'Near-liquidation alert', '%'],
]
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function Rose({ c }: { c: Compass }) {
  const R = 110
  return (
    <svg viewBox="-150 -150 300 300" className="mx-auto h-72 w-72" role="img" aria-label="Exposure compass rose">
      {[0.33, 0.66, 1].map(k => <circle key={k} r={R * k} fill="none" stroke="var(--color-graphite-800)" />)}
      {DIRS.map((d, i) => { const a = (i / 8) * Math.PI * 2 - Math.PI / 2; return <text key={d} x={Math.cos(a) * (R + 22)} y={Math.sin(a) * (R + 22) + 4} textAnchor="middle" fontSize="10" fill="var(--color-graphite-500)">{d}</text> })}
      {c.rose.map((r, i) => {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2, len = Math.max(8, (Number(r.sharePct) / 100) * R), w = 0.28
        const p1 = [Math.cos(a - w) * 18, Math.sin(a - w) * 18], tip = [Math.cos(a) * len, Math.sin(a) * len], p2 = [Math.cos(a + w) * 18, Math.sin(a + w) * 18]
        return <g key={r.asset}><path d={`M0 0 L${p1} L${tip} L${p2} Z`} fill={r.direction === 'SHORT' ? 'var(--color-down)' : 'var(--color-amber-helm)'} opacity={0.85} /><text x={Math.cos(a) * (len + 12)} y={Math.sin(a) * (len + 12) + 4} textAnchor="middle" fontSize="11" fill="var(--color-graphite-100)">{r.asset}</text></g>
      })}
      <circle r="5" fill="var(--color-amber-helm)" />
    </svg>
  )
}

export function ScenarioLab() {
  const presets = useApi<{ presets: Array<{ id: string; name: string; shocks: Array<{ asset: string; shockPercent: string }> }> }>('/v1/shield/scenario/presets')
  const [shocks, setShocks] = useState<Array<{ asset: string; shockPercent: string }>>([{ asset: 'BTC', shockPercent: '-10' }])
  const [name, setName] = useState<string | null>('BTC −10%')
  const [res, setRes] = useState<MultiScenario | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(s = shocks, n = name) {
    setBusy(true); setErr(null)
    try { setRes((await api<{ scenario: MultiScenario }>('/v1/shield/scenarios', { method: 'POST', body: { shocks: s, name: n ?? undefined } })).scenario) }
    catch (e) { setErr(e as ApiError) } finally { setBusy(false) }
  }
  useEffect(() => { run() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Scenario analysis" testId="scenario">
      <div className="flex flex-wrap gap-2">{presets.data?.presets.map(p => <Btn key={p.id} variant="ghost" onClick={() => { setShocks(p.shocks); setName(p.name); run(p.shocks, p.name) }}>{p.name}</Btn>)}</div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {shocks.map((s, i) => (
          <div key={i} className="flex items-end gap-1">
            <Field label="Asset"><select className="input w-24" value={s.asset} onChange={e => setShocks(shocks.map((x, j) => j === i ? { ...x, asset: e.target.value } : x))}>{['BTC', 'ETH', 'SOL', 'BNB'].map(a => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Move %"><input className="input num w-24" value={s.shockPercent} onChange={e => setShocks(shocks.map((x, j) => j === i ? { ...x, shockPercent: e.target.value.replace(/[^0-9.-]/g, '') } : x))} data-testid={`shock-${i}`} /></Field>
            {shocks.length > 1 && <Btn variant="quiet" onClick={() => setShocks(shocks.filter((_, j) => j !== i))}>✕</Btn>}
          </div>
        ))}
        {shocks.length < 4 && <Btn variant="quiet" onClick={() => setShocks([...shocks, { asset: 'ETH', shockPercent: '-10' }])}>+ asset</Btn>}
        <Btn variant="amber" busy={busy} onClick={() => { setName(null); run(shocks, null) }} testId="run-scenario">Run scenario</Btn>
      </div>
      <ErrorNote error={err} />
      {res && (
        <div className="mt-5" data-testid="scenario-result">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-graphite-800 p-3"><div className="text-xs text-graphite-500">Linear P&amp;L</div><div className={`num text-xl ${tone(res.totalPnlUsd)}`}>{signedUsd(res.totalPnlUsd)}</div><div className="text-xs text-graphite-500">{res.pnlPctOfNetLiq ? `${pct(res.pnlPctOfNetLiq, 2)} of net liquidation` : ''}</div></div>
            <div className="rounded-lg border border-graphite-800 p-3"><div className="text-xs text-graphite-500">With venue-listed stops</div><div className={`num text-xl ${tone(res.totalPnlWithStopsUsd)}`}>{signedUsd(res.totalPnlWithStopsUsd)}</div><div className="text-xs text-graphite-500">{res.stopsCounted.length} stop(s) counted</div></div>
            <div className="rounded-lg border border-graphite-800 p-3"><div className="text-xs text-graphite-500">Liquidation breaches</div><div className={`num text-xl ${res.liquidationBreaches.length ? 'text-down' : 'text-up'}`}>{res.liquidationBreaches.length}</div><div className="text-xs text-graphite-500">{res.unprotectedLegs.length} unprotected perp leg(s)</div></div>
          </div>
          <table className="tbl mt-4"><thead><tr><th>Account</th><th className="r">Linear</th><th className="r">With stops</th></tr></thead>
            <tbody>{res.byAccount.map(a => <tr key={a.accountId}><td>{a.alias}</td><td className={`r num ${tone(a.pnlUsd)}`}>{signedUsd(a.pnlUsd)}</td><td className={`r num ${tone(a.pnlWithStopsUsd)}`}>{signedUsd(a.pnlWithStopsUsd)}</td></tr>)}</tbody></table>
          <p className="mt-3 text-xs text-graphite-500">{res.disclaimer}</p>
        </div>
      )}
    </Card>
  )
}

export default function Shield() {
  const { accounts } = useShell()
  const pol = useApi<{ policy: Policy; version: number }>('/v1/shield/policy')
  const cp = useApi<{ compass: Compass; netLiquidationUsd: string; asOf: string }>('/v1/shield/compass')
  const [draft, setDraft] = useState<Policy | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (pol.data) setDraft(pol.data.policy) }, [pol.data])
  const alias = (id: string) => accounts.find(a => a.id === id)?.alias ?? id
  const dirty = draft && pol.data && JSON.stringify(draft) !== JSON.stringify(pol.data.policy)
  async function save() {
    if (!draft) return
    setBusy(true); setMsg(null)
    try { const r = await api<{ version: number }>('/v1/shield/policy', { method: 'PUT', body: draft }); setMsg({ ok: true, text: `Saved as policy v${r.version}. New previews use it immediately.` }); await pol.reload() }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? `${e.message}${e.reasons.length ? ' — ' + e.reasons.join('; ') : ''}` : 'Failed' }) }
    finally { setBusy(false) }
  }
  const c = cp.data?.compass
  return (
    <div>
      <PageHeader kicker="SHIELD" title="Shield & Exposure Compass" subtitle="Shield checks every preview against your limits. BLOCK means no confirm token is issued. The compass shows where your risk actually sits across exchanges." actions={<Btn onClick={() => { cp.reload(); pol.reload() }}>Refresh</Btn>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card title="Exposure compass" testId="compass">
          <ErrorNote error={cp.error} onRetry={cp.reload} />
          {!c ? <Skeleton h="h-72" /> : <>
            <Rose c={c} />
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-graphite-500">Largest directional</div><div className="num">{c.largestDirectional ? `${c.largestDirectional.asset} ${c.largestDirectional.direction} ${usd(c.largestDirectional.netUsd, 0)}` : '—'}</div></div>
              <div><div className="text-xs text-graphite-500">Largest exchange</div><div className="num">{c.largestExchange ? `${c.largestExchange.alias} ${pct(c.largestExchange.sharePct)}` : '—'}</div></div>
              <div><div className="text-xs text-graphite-500">Net liquidation</div><div className="num">{usd(cp.data!.netLiquidationUsd, 0)}</div></div>
              <div><div className="text-xs text-graphite-500">Pending limit-order delta</div><div className="num">{usd(c.pendingOrderDeltaUsd, 0)}</div></div>
            </div>
            <div className="mt-4 space-y-2">
              {c.unprotected.map(u => <div key={u.accountId + u.instrumentId} className="flex items-center gap-2 text-sm"><Pill v="UNPROTECTED" /><span>{sym(u.instrumentId).label} · {alias(u.accountId)} · {usd(u.notionalUsd, 0)}</span><Btn variant="quiet" href="/protect" className="ml-auto">Protect</Btn></div>)}
              {c.nearRisk.map(n => <div key={n.accountId + n.instrumentId} className="flex items-center gap-2 text-sm"><Pill v="WARN" /><span>{sym(n.instrumentId).label} · {alias(n.accountId)} is {pct(n.distancePct)} from liquidation</span></div>)}
              {c.marginWarnings.map(m => <div key={m.accountId} className="flex items-center gap-2 text-sm"><Pill v="WARN" /><span>{m.alias} margin utilisation {pct(m.utilizationPct)}</span></div>)}
              {!c.unprotected.length && !c.nearRisk.length && !c.marginWarnings.length && <p className="text-sm text-up">No unprotected positions, nothing near liquidation, margin within limits.</p>}
            </div>
          </>}
        </Card>
        <Card title={`Shield policy ${pol.data ? `v${pol.data.version}` : ''}`} action={dirty ? <Btn variant="amber" busy={busy} onClick={save} testId="save-policy">Save new version</Btn> : null} testId="policy">
          {!draft ? <Skeleton h="h-72" /> : <>
            <div className="grid gap-3 sm:grid-cols-2">
              {LIMITS.map(([k, label, unit]) => (
                <Field key={k} label={`${label} (${unit})`}><input className="input num" value={String(draft[k] ?? '')} onChange={e => setDraft({ ...draft, [k]: e.target.value.replace(/[^0-9.]/g, '') })} data-testid={`pol-${k}`} /></Field>
              ))}
              <Field label="Max open orders"><input className="input num" value={draft.maxOpenOrders} onChange={e => setDraft({ ...draft, maxOpenOrders: Number(e.target.value.replace(/\D/g, '') || 0) })} /></Field>
              <Field label="Session budget (USD, optional)"><input className="input num" value={draft.sessionBudgetUsd ?? ''} placeholder="none" onChange={e => setDraft({ ...draft, sessionBudgetUsd: e.target.value.replace(/[^0-9.]/g, '') || null })} /></Field>
            </div>
            <Field label="Blocked instruments (comma-separated ids)" hint="e.g. bybit:perp:SOL-USDT:USDT"><input className="input num mt-3" value={draft.blockedInstruments.join(', ')} onChange={e => setDraft({ ...draft, blockedInstruments: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Field>
            {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
            {dirty && <div className="mt-3 flex gap-2"><Btn variant="quiet" onClick={() => setDraft(pol.data!.policy)}>Revert</Btn></div>}
            <p className="mt-3 text-xs text-graphite-500">Each save creates a new immutable policy version; receipts record which version approved the trade.</p>
          </>}
        </Card>
      </div>
      <div className="mt-6"><ScenarioLab /></div>
      {!accounts.length && <div className="mt-6"><Empty title="Nothing to analyse yet" action={<Btn href="/connect" variant="amber">Connect an exchange</Btn>} /></div>}
    </div>
  )
}
