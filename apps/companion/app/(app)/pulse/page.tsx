'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { SEV, ago, ist, sym } from '@/lib/format'
import type { PulseEvent } from '@/lib/types'
import type { ActivityItem, ActivityPayload } from '@helm/glasses/src/ux/types'
import { Btn, Card, Empty, ErrorNote, PageHeader, Segmented, Skeleton } from '../../ui'
import { useShell } from '../../shell'

const GROUPS: Record<string, string[]> = { all: [], risk: ['PROTECTION_FAILED', 'NEAR_LIQUIDATION', 'MARGIN_WARNING', 'POLICY_BLOCK', 'CONNECTION_DEGRADED', 'ORDER_UNKNOWN'], trades: ['ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELED', 'POSITION_CLOSED', 'PROTECTION_PLACED'] }
const sevTone = (s: number) => (s >= 5 ? 'border-down/50 bg-down/5' : s >= 4 ? 'border-amber-helm/40 bg-amber-helm/5' : 'border-graphite-800')
const dot = (s: number) => (s >= 4 ? 'bg-down' : s >= 3 ? 'bg-amber-helm' : 'bg-graphite-500')

/** Activity & Alerts: the same current / recent / resolved model the glasses use (recomputed from live state). */
export default function Pulse() {
  const [tab, setTab] = useState<'activity' | 'log'>('activity')
  return (
    <div>
      <PageHeader kicker="ACTIVITY" title="Activity & alerts" subtitle="What needs you now (recomputed from live exchange state), what happened recently, and what has resolved. Acknowledge or dismiss here and the glasses update too. Critical items cannot be dismissed while they are still true."
        actions={<Segmented value={tab} onChange={setTab} options={[['activity', 'Activity'], ['log', 'Raw event log']]} testId="activity-tab" />} />
      {tab === 'activity' ? <ActivityView /> : <EventLog />}
    </div>
  )
}

function ActivityView() {
  const act = useApi<ActivityPayload>('/v1/activity', { poll: 15000 })
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Error | null>(null)
  const mark = async (id: string, kind: 'ack' | 'dismiss') => {
    setBusy(id + kind); setErr(null)
    try { await api(`/v1/activity/${encodeURIComponent(id)}/${kind}`, { method: 'POST', body: {} }); await act.reload() } catch (e) { setErr(e as Error) } finally { setBusy(null) }
  }
  const a = act.data
  const Row = ({ i }: { i: ActivityItem }) => (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${sevTone(i.state === 'current' ? i.severity : 0)} ${i.acknowledged || i.state === 'resolved' ? 'opacity-75' : ''}`} data-testid={`activity-${i.state}`}>
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${i.state === 'resolved' ? 'bg-up' : dot(i.severity)}`} title={SEV[i.severity]} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{i.title}{i.acknowledged && i.state === 'current' && <span className="ml-2 text-xs text-graphite-500">acknowledged</span>}</div>
        <div className="text-xs text-graphite-400">{i.detail}{i.account ? ` · ${i.account}` : ''} · <span title={ist(i.at)}>{ago(i.at)}</span></div>
      </div>
      {i.state !== 'resolved' && i.actions.some(x => x.kind === 'protect') && <Btn href="/protect" variant="amber">Add protection</Btn>}
      {i.actions.some(x => x.kind === 'position') && <Btn href="/positions" variant="quiet">Open position</Btn>}
      {i.actions.some(x => x.kind === 'receipt' || x.kind === 'reconcile') && <Btn href="/history" variant="quiet">Open receipt</Btn>}
      {i.state === 'current' && !i.acknowledged && <Btn variant="quiet" disabled={!!busy} onClick={() => mark(i.id, 'ack')} testId={`ack-${i.id}`}>Acknowledge</Btn>}
      {i.state !== 'resolved' && (i.dismissible ? <Btn variant="quiet" disabled={!!busy} onClick={() => mark(i.id, 'dismiss')}>Dismiss 4 h</Btn> : i.state === 'current' && <span className="text-xs text-graphite-500" title="Critical items stay until the condition is fixed">stays until fixed</span>)}
    </div>
  )
  const Section = ({ title, items, empty }: { title: string; items: ActivityItem[]; empty: string }) => (
    <section className="mb-6">
      <div className="mb-2 text-[12px] font-semibold tracking-[0.16em] text-graphite-300 uppercase">{title} ({items.length})</div>
      {items.length ? <div className="space-y-2">{items.map(i => <Row key={i.id} i={i} />)}</div> : <div className="rounded-xl border border-graphite-800 px-4 py-3 text-sm text-graphite-400">{empty}</div>}
    </section>
  )
  return (
    <>
      <ErrorNote error={act.error ?? err} onRetry={act.reload} />
      {!a ? <Card><Skeleton /></Card> : (
        <>
          <Section title="Needs attention now" items={a.current} empty="Nothing needs attention right now." />
          <Section title="Recent" items={a.recent} empty="No recent events in the last 7 days." />
          <Section title="Resolved" items={a.resolved.slice(0, 12)} empty="Nothing resolved recently." />
        </>
      )}
    </>
  )
}

function EventLog() {
  const { accounts } = useShell()
  const ev = useApi<{ events: PulseEvent[] }>('/v1/pulse', { poll: 15000 })
  const [g, setG] = useState<'all' | 'risk' | 'trades'>('all')
  const alias = (id: string | null) => (id ? accounts.find(a => a.id === id)?.alias ?? id : '—')
  const list = (ev.data?.events ?? []).filter(e => g === 'all' || (g === 'risk' ? e.severity >= 3 || GROUPS.risk.includes(e.kind) : GROUPS.trades.includes(e.kind) || e.kind.startsWith('ORDER_')))
  return (
    <>
      <div className="mb-3 flex items-center gap-2"><Segmented value={g} onChange={setG} options={[['all', 'All'], ['risk', 'Risk'], ['trades', 'Trades']]} testId="pulse-filter" /><Btn onClick={ev.reload}>Refresh</Btn></div>
      <ErrorNote error={ev.error} onRetry={ev.reload} />
      <Card pad={false}>
        {!ev.data ? <div className="p-5"><Skeleton /></div> : list.length === 0 ? <div className="p-5"><Empty title="Nothing here" hint="No events match this filter." /></div> : (
          <table className="tbl"><thead><tr><th></th><th>Event</th><th>What happened</th><th>Where</th><th className="r">Score</th><th>When</th></tr></thead>
            <tbody>{list.map(e => (
              <tr key={e.id}>
                <td><span className={`inline-block h-2.5 w-2.5 rounded-full ${dot(e.severity)}`} title={SEV[e.severity]} /></td>
                <td className="whitespace-nowrap text-xs font-semibold tracking-wider">{e.kind.replace(/_/g, ' ')}</td>
                <td>{e.reason}{e.count > 1 && <span className="text-graphite-500"> ×{e.count}</span>}</td>
                <td className="text-xs text-graphite-300">{alias(e.accountId)}{e.instrumentId ? ` · ${sym(e.instrumentId).label}` : ''}</td>
                <td className="r num text-xs text-graphite-500">{Math.round(e.score)}</td>
                <td className="whitespace-nowrap text-xs text-graphite-500" title={ist(e.createdAt)}>{ago(e.createdAt)}</td>
              </tr>
            ))}</tbody></table>
        )}
      </Card>
    </>
  )
}
