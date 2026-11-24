'use client'
import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { ago, ist } from '@/lib/format'
import { Btn, Card, Empty, Field, Modal, PageHeader, Pill, Skeleton } from '../../ui'

interface Device { id: string; label: string; createdAt: string; lastSeenAt: string | null; expiresAt: string; revokedAt: string | null }

export default function Devices() {
  const ds = useApi<{ devices: Device[] }>('/v1/devices', { poll: 10000 })
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('Even G2')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [revoke, setRevoke] = useState<Device | null>(null)
  async function approve() {
    setMsg(null); setBusy(true)
    try {
      await api('/v1/pairing/approve', { method: 'POST', body: { code, label } })
      setMsg({ ok: true, text: 'Approved. Your glasses finish pairing within a few seconds.' }); setCode('')
      setTimeout(() => void ds.reload(), 4000)
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Approval failed' }) } finally { setBusy(false) }
  }
  const active = (ds.data?.devices ?? []).filter(d => !d.revokedAt)
  const revoked = (ds.data?.devices ?? []).filter(d => d.revokedAt)
  return (
    <div>
      <PageHeader kicker="GLASSES" title="Devices" subtitle="Open HELM on your G2. It shows a short pairing code — enter it here. Glasses get a short-lived HELM device session, never your exchange keys." />
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card title="Pair new glasses">
          <form onSubmit={e => { e.preventDefault(); void approve() }} className="space-y-3">
            <Field label="Pairing code"><input className="input num text-lg tracking-[0.35em] uppercase" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={8} required placeholder="K7M4Q2" data-testid="pair-code" /></Field>
            <Field label="Device name"><input className="input" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} /></Field>
            <Btn type="submit" variant="amber" busy={busy} testId="pair-approve">Approve glasses</Btn>
          </form>
          {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
          <ol className="mt-5 space-y-1 text-xs text-graphite-500"><li>1. On the glasses: HELM → Pair.</li><li>2. Type the code shown on the lens.</li><li>3. Codes expire after a few minutes and work once.</li></ol>
        </Card>
        <Card title={`Paired (${active.length})`} pad={false}>
          {!ds.data ? <div className="p-5"><Skeleton h="h-24" /></div> : active.length === 0 ? <div className="p-5"><Empty title="No paired glasses" hint="Pair your G2 with the code it shows." /></div> : (
            <table className="tbl"><thead><tr><th>Device</th><th>Paired</th><th>Last seen</th><th>Session expires</th><th /></tr></thead><tbody>
              {active.map(d => <tr key={d.id}><td className="font-medium">{d.label}</td><td>{ist(d.createdAt)}</td><td>{d.lastSeenAt ? ago(d.lastSeenAt) : 'not yet'}</td><td>{ist(d.expiresAt)}</td><td className="text-right"><Btn variant="quiet" danger onClick={() => setRevoke(d)}>Revoke</Btn></td></tr>)}
            </tbody></table>
          )}
          {revoked.length > 0 && <div className="border-t border-graphite-800 px-5 py-3 text-xs text-graphite-500">{revoked.length} revoked device(s): {revoked.slice(0, 5).map(d => d.label).join(', ')} <Pill v="CANCELED" /></div>}
        </Card>
      </div>
      <Modal open={!!revoke} title="Revoke these glasses?" onClose={() => setRevoke(null)}>
        <p className="text-sm text-graphite-300">{revoke?.label} will be signed out immediately and must pair again. Exchange accounts are not affected.</p>
        <div className="mt-4 flex gap-2"><Btn variant="danger" danger onClick={async () => { await api(`/v1/devices/${revoke!.id}`, { method: 'DELETE' }); setRevoke(null); await ds.reload() }} testId="revoke-confirm">Revoke</Btn><Btn variant="quiet" onClick={() => setRevoke(null)}>Keep</Btn></div>
      </Modal>
    </div>
  )
}
