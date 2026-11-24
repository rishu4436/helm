'use client'
import { useEffect, useState } from 'react'
import { api, ApiError, setToken } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { Btn, Card, ErrorNote, Field, PageHeader, Pill } from '../../ui'
import { useShell } from '../../shell'

type Me = { user: { id: string; email: string; displayName: string | null; reportingCurrency: string; createdAt: string } }
type Diag = { checks: Array<{ id: string; status: string; detail: string }> }

export default function Settings() {
  const me = useApi<Me>('/v1/me')
  const diag = useApi<Diag>('/v1/diagnostics')
  const { reloadAccounts } = useShell()
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (me.data) setName(me.data.user.displayName ?? '') }, [me.data])
  async function save() {
    setBusy(true); setMsg(null)
    try { await api('/v1/me', { method: 'PATCH', body: { displayName: name.trim() || null } }); await me.reload(); await reloadAccounts(); setMsg({ ok: true, text: 'Saved.' }) }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' }) } finally { setBusy(false) }
  }
  const stt = diag.data?.checks.find(c => c.id === 'stt')
  return (
    <div>
      <PageHeader kicker="ACCOUNT" title="Settings" />
      <ErrorNote error={me.error} onRetry={me.reload} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save() }}>
            <Field label="Email"><input className="input" value={me.data?.user.email ?? ''} readOnly disabled /></Field>
            <Field label="Display name" hint="Shown on the glasses home screen."><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} data-testid="settings-name" /></Field>
            <Btn type="submit" variant="amber" busy={busy} testId="settings-save">Save</Btn>
            {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
          </form>
        </Card>
        <Card title="Reporting">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-graphite-300">Reporting currency</dt><dd className="num">{me.data?.user.reportingCurrency ?? 'USD'}</dd></div>
            <p className="text-xs text-graphite-500">Values are USD-equivalent, using live venue prices. Other currencies are not offered yet.</p>
            <div className="flex justify-between"><dt className="text-graphite-300">Times</dt><dd>India Standard Time (IST)</dd></div>
          </dl>
        </Card>
        <Card title="Voice">
          <div className="flex items-center gap-2 text-sm">{stt ? <Pill v={stt.status} /> : null}<span className="text-graphite-300">{stt?.detail ?? 'Checking…'}</span></div>
          <p className="mt-3 text-xs text-graphite-500">Speech is transcribed by a local faster-whisper model (base.en) on the HELM server — audio never goes to a third party and is not stored. If the sidecar is down, commands fall back to a clearly labelled test transcriber.</p>
          <div className="mt-4"><Btn href="/voice">Open Voice Studio</Btn></div>
        </Card>
        <Card title="Risk & region">
          <p className="text-sm text-graphite-300">Order limits, leverage caps and stop requirements live in your Shield policy.</p>
          <div className="mt-3 flex gap-2"><Btn href="/shield">Edit Shield policy</Btn><Btn href="/connect">Exchanges</Btn></div>
          <p className="mt-4 text-xs text-graphite-500">Region: India. OKX is unavailable here, so logged-in OKX is BLOCKED; Binance Demo and Bybit Demo are used instead. Live trading is disabled in this build.</p>
        </Card>
        <Card title="Session" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2"><Btn href="/security">Manage sessions</Btn><Btn variant="quiet" danger onClick={async () => { await api('/v1/auth/logout', { method: 'POST' }).catch(() => {}); setToken(null); window.location.href = '/login' }} testId="settings-signout">Sign out</Btn></div>
        </Card>
      </div>
    </div>
  )
}
