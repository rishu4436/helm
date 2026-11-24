'use client'
import { useApi } from '@/lib/hooks'
import { ist } from '@/lib/format'
import { Btn, Card, ErrorNote, PageHeader, Pill, Skeleton, Stat } from '../../ui'

type Check = { id: string; label: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string; ms?: number }
type Diag = { at: string; checks: Check[]; build: { node: string } }

export default function Diagnostics() {
  const d = useApi<Diag>('/v1/diagnostics')
  const health = useApi<Record<string, unknown>>('/health')
  const c = d.data?.checks ?? []
  const n = (s: string) => c.filter(x => x.status === s).length
  return (
    <div>
      <PageHeader kicker="ACCOUNT" title="Diagnostics" subtitle="Live checks against the database, the speech-to-text sidecar and every connected account. Run this before a demo." actions={<Btn variant="amber" busy={d.loading} onClick={async () => { await Promise.all([d.reload(), health.reload()]) }} testId="diag-run">Run checks again</Btn>} />
      <ErrorNote error={d.error} onRetry={d.reload} />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Pass" value={d.data ? n('PASS') : '…'} tone="text-up" />
        <Stat label="Warn" value={d.data ? n('WARN') : '…'} tone="text-amber-helm" />
        <Stat label="Fail" value={d.data ? n('FAIL') : '…'} tone={n('FAIL') ? 'text-down' : ''} />
        <Stat label="Checked" value={d.data ? ist(d.data.at).split(' ').slice(-1)[0] : '…'} sub={d.data ? `API on Node ${d.data.build.node}` : undefined} />
      </div>
      <Card title="Checks" pad={false}>
        {!d.data ? <div className="p-5"><Skeleton h="h-64" /></div> : (
          <table className="tbl"><thead><tr><th>Status</th><th>Check</th><th>Detail</th><th className="text-right">Time</th></tr></thead><tbody>
            {c.map(x => <tr key={x.id} data-testid={`check-${x.id}`}><td><Pill v={x.id === 'okx' ? 'BLOCKED' : x.status} /></td><td className="font-medium">{x.label}</td><td className="text-sm text-graphite-300">{x.detail}</td><td className="num text-right text-xs text-graphite-500">{x.ms !== undefined ? `${x.ms} ms` : ''}</td></tr>)}
          </tbody></table>
        )}
      </Card>
      <p className="mt-4 text-xs text-graphite-500">Account checks use the same authenticated reads as the portfolio. OKX shows BLOCKED: it is unavailable in India, so only the mock/public-endpoint adapter tests apply.</p>
    </div>
  )
}
