'use client'
import { useState } from 'react'
import { api, type Connection } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { ago, ist } from '@/lib/format'
import { Btn, Card, Empty, EnvPill, ErrorNote, PageHeader, Pill, Skeleton } from '../../ui'

type Session = { id: string; userAgent: string | null; createdAt: string; expiresAt: string; current: boolean }
type Audit = { id: string; actor: string; action: string; subject: string | null; detail: Record<string, unknown>; at: string }
type Guard = Record<string, { signedHostsAllowed: string[]; requiredAuthHeader: string | null; loopbackOnly: boolean }>
const ua = (s: string | null) => !s ? 'Unknown client' : /Chrome|Firefox|Safari|Edg/.test(s) ? (s.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? 'Browser') : s.slice(0, 40)

export default function Security() {
  const ss = useApi<{ sessions: Session[] }>('/v1/sessions')
  const conns = useApi<{ connections: Connection[] }>('/v1/connections')
  const diag = useApi<{ guard: Guard }>('/v1/diagnostics')
  const [limit, setLimit] = useState(25)
  const audit = useApi<{ events: Audit[] }>(`/v1/audit?limit=${limit}`)
  const [busy, setBusy] = useState<string | null>(null)
  async function revoke(id: string) { setBusy(id); try { await api(`/v1/sessions/${id}`, { method: 'DELETE' }); await ss.reload() } finally { setBusy(null) } }
  async function revokeOthers() { setBusy('all'); try { for (const s of ss.data?.sessions.filter(x => !x.current) ?? []) await api(`/v1/sessions/${s.id}`, { method: 'DELETE' }); await ss.reload() } finally { setBusy(null) } }
  const others = ss.data?.sessions.filter(s => !s.current).length ?? 0
  return (
    <div>
      <PageHeader kicker="ACCOUNT" title="Security" subtitle="Sessions, stored exchange keys, the network guard that keeps HELM on demo/paper/sandbox hosts, and an audit trail of every sensitive action." />
      <ErrorNote error={ss.error ?? conns.error ?? diag.error ?? audit.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Signed-in sessions (${ss.data?.sessions.length ?? '…'})`} action={others > 0 && <Btn variant="quiet" danger busy={busy === 'all'} onClick={revokeOthers} testId="revoke-others">Sign out other sessions</Btn>} pad={false}>
          {!ss.data ? <div className="p-5"><Skeleton /></div> : (
            <table className="tbl"><thead><tr><th>Client</th><th>Signed in</th><th>Expires</th><th /></tr></thead><tbody>
              {ss.data.sessions.map(s => <tr key={s.id}><td>{ua(s.userAgent)} {s.current && <Pill v="CONNECTED" title="This browser" />}</td><td>{ago(s.createdAt)}</td><td>{ist(s.expiresAt)}</td><td className="text-right">{s.current ? <span className="text-xs text-graphite-500">this session</span> : <Btn variant="quiet" danger busy={busy === s.id} onClick={() => revoke(s.id)}>Revoke</Btn>}</td></tr>)}
            </tbody></table>
          )}
        </Card>
        <Card title="Stored exchange keys" pad={false}>
          {!conns.data ? <div className="p-5"><Skeleton /></div> : conns.data.connections.filter(c => c.credential).length === 0 ? <div className="p-5"><Empty title="No stored keys" /></div> : (
            <table className="tbl"><thead><tr><th>Account</th><th>Env</th><th>Key fingerprint</th><th>Scopes</th></tr></thead><tbody>
              {conns.data.connections.filter(c => c.credential).map(c => <tr key={c.id}><td>{c.alias}</td><td><EnvPill env={c.environment} /></td><td className="num">{c.credential!.keyFingerprint}</td><td className="text-xs">{c.credential!.scopes.join(', ') || '—'}</td></tr>)}
            </tbody></table>
          )}
          <p className="border-t border-graphite-800 px-5 py-3 text-xs text-graphite-500">Secrets are AES-256-GCM encrypted at rest and never returned by the API — only a short fingerprint. HELM never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permission.</p>
        </Card>
        <Card title="Network guard — where signed requests may go" className="xl:col-span-2" pad={false}>
          {!diag.data ? <div className="p-5"><Skeleton /></div> : (
            <table className="tbl"><thead><tr><th>Provider</th><th>Signed hosts allowed</th><th>Required header</th></tr></thead><tbody>
              {Object.entries(diag.data.guard).map(([k, g]) => <tr key={k}><td className="capitalize">{k}</td><td className="num text-xs">{g.signedHostsAllowed.length ? g.signedHostsAllowed.join(' · ') : <span className="text-graphite-500">none (public data only)</span>}{g.loopbackOnly ? ' (localhost only)' : ''}</td><td className="num text-xs">{g.requiredAuthHeader ?? '—'}</td></tr>)}
            </tbody></table>
          )}
          <p className="border-t border-graphite-800 px-5 py-3 text-xs text-graphite-500">Any signed request to a host outside this list — including every production trading host — is refused before it leaves the server. Live trading is disabled in this build.</p>
        </Card>
        <Card title="Audit log" className="xl:col-span-2" pad={false} action={<Btn variant="quiet" onClick={() => setLimit(l => Math.min(200, l + 50))} disabled={limit >= 200}>Show more</Btn>}>
          {!audit.data ? <div className="p-5"><Skeleton h="h-64" /></div> : audit.data.events.length === 0 ? <div className="p-5"><Empty title="No events yet" /></div> : (
            <table className="tbl"><thead><tr><th>When (IST)</th><th>Actor</th><th>Action</th><th>Subject</th><th>Detail</th></tr></thead><tbody>
              {audit.data.events.map(e => <tr key={e.id}><td className="whitespace-nowrap">{ist(e.at)}</td><td>{e.actor}</td><td className="num text-xs">{e.action}</td><td className="num max-w-[180px] truncate text-xs">{e.subject ?? '—'}</td><td className="num max-w-[360px] truncate text-xs text-graphite-500">{Object.keys(e.detail ?? {}).length ? JSON.stringify(e.detail) : ''}</td></tr>)}
            </tbody></table>
          )}
        </Card>
      </div>
    </div>
  )
}
