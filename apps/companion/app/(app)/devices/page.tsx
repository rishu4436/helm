'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useRequireAuth } from '../components'

interface Device { id: string; label: string; createdAt: string; lastSeenAt: string | null; expiresAt: string; revokedAt: string | null }

export default function Devices() {
  const ready = useRequireAuth()
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('Even G2')
  const [devices, setDevices] = useState<Device[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(async () => setDevices((await api<{ devices: Device[] }>('/v1/devices')).devices), [])
  useEffect(() => { if (ready) load().catch(() => {}) }, [ready, load])

  async function approve(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      await api('/v1/pairing/approve', { method: 'POST', body: { code, label } })
      setMsg({ ok: true, text: 'Approved. Your glasses will finish pairing in a few seconds.' }); setCode('')
      setTimeout(() => load().catch(() => {}), 4000)
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Failed' }) }
  }
  async function revoke(id: string) { await api(`/v1/devices/${id}`, { method: 'DELETE' }); await load() }

  if (!ready) return null
  return (
    <div className="pt-10">
      <h1 className="text-3xl font-semibold">Devices</h1>
      <p className="mt-2 text-graphite-300">Open HELM on your G2. It shows a 6-character code — enter it here. Glasses get a short-lived HELM session, never your exchange keys.</p>
      <form onSubmit={approve} className="card mt-6 flex flex-wrap items-end gap-3 p-5">
        <label className="text-sm">Pairing code<input className="input num mt-1 w-48 text-lg tracking-[0.35em] uppercase" value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} required placeholder="K7M4Q2" /></label>
        <label className="text-sm">Device name<input className="input mt-1 w-56" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} /></label>
        <button className="btn btn-amber">Approve glasses</button>
      </form>
      {msg && <p role="status" className={`mt-4 text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
      <div className="mt-8 space-y-2">
        {devices.length === 0 && <p className="text-sm text-graphite-500">No paired devices.</p>}
        {devices.map(d => (
          <div key={d.id} className="card flex items-center gap-4 p-4 text-sm">
            <span className="font-medium">{d.label}</span>
            <span className="text-graphite-500">paired {new Date(d.createdAt).toLocaleString()}</span>
            <span className="text-graphite-500">{d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleTimeString()}` : 'not seen yet'}</span>
            {d.revokedAt ? <span className="pill ml-auto bg-down/15 text-down">revoked</span> : <button className="btn btn-ghost ml-auto text-down" onClick={() => revoke(d.id)}>Revoke</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
