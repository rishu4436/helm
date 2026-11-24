'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { SEV, ago, ist, sym } from '@/lib/format'
import type { PulseEvent } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, PageHeader, Segmented, Skeleton } from '../../ui'
import { useShell } from '../../shell'

const GROUPS: Record<string, string[]> = { all: [], risk: ['PROTECTION_FAILED', 'NEAR_LIQUIDATION', 'MARGIN_WARNING', 'POLICY_BLOCK', 'CONNECTION_DEGRADED', 'ORDER_UNKNOWN'], trades: ['ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELED', 'POSITION_CLOSED', 'PROTECTION_PLACED'] }

export default function Pulse() {
  const { accounts } = useShell()
  const ev = useApi<{ events: PulseEvent[] }>('/v1/pulse', { poll: 15000 })
  const [g, setG] = useState<'all' | 'risk' | 'trades'>('all')
  const alias = (id: string | null) => (id ? accounts.find(a => a.id === id)?.alias ?? id : '—')
  const list = (ev.data?.events ?? []).filter(e => g === 'all' || (g === 'risk' ? e.severity >= 3 || GROUPS.risk.includes(e.kind) : GROUPS.trades.includes(e.kind) || e.kind.startsWith('ORDER_')))
  return (
    <div>
      <PageHeader kicker="PULSE" title="Pulse — ranked by what needs you" subtitle="Fills, rejections, protection failures and risk alerts from every exchange, deduplicated and scored by severity and recency. The same feed drives the glasses." actions={<><Segmented value={g} onChange={setG} options={[['all', 'All'], ['risk', 'Risk'], ['trades', 'Trades']]} testId="pulse-filter" /><Btn onClick={ev.reload}>Refresh</Btn></>} />
      <ErrorNote error={ev.error} onRetry={ev.reload} />
      <Card pad={false}>
        {!ev.data ? <div className="p-5"><Skeleton /></div> : list.length === 0 ? <div className="p-5"><Empty title="Nothing here" hint="No events match this filter." /></div> : (
          <table className="tbl"><thead><tr><th></th><th>Event</th><th>What happened</th><th>Where</th><th className="r">Score</th><th>When</th><th></th></tr></thead>
            <tbody>{list.map(e => (
              <tr key={e.id}>
                <td><span className={`inline-block h-2.5 w-2.5 rounded-full ${e.severity >= 4 ? 'bg-down' : e.severity >= 3 ? 'bg-amber-helm' : 'bg-graphite-500'}`} title={SEV[e.severity]} /></td>
                <td className="whitespace-nowrap text-xs font-semibold tracking-wider">{e.kind.replace(/_/g, ' ')}</td>
                <td>{e.reason}{e.count > 1 && <span className="text-graphite-500"> ×{e.count}</span>}</td>
                <td className="text-xs text-graphite-300">{alias(e.accountId)}{e.instrumentId ? ` · ${sym(e.instrumentId).label}` : ''}</td>
                <td className="r num text-xs text-graphite-500">{Math.round(e.score)}</td>
                <td className="whitespace-nowrap text-xs text-graphite-500" title={ist(e.createdAt)}>{ago(e.createdAt)}</td>
                <td className="text-right"><Btn variant="quiet" onClick={async () => { await api(`/v1/pulse/${e.id}/dismiss`, { method: 'POST' }); await ev.reload() }}>Dismiss</Btn></td>
              </tr>
            ))}</tbody></table>
        )}
      </Card>
    </div>
  )
}
