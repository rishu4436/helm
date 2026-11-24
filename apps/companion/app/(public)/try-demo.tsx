'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api, ApiError, setToken } from '@/lib/api'

export function TryDemoButton({ className = 'btn btn-amber', label = 'Try the demo' }: { className?: string; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true); setErr(null)
    try {
      const r = await api<{ token: string }>('/v1/auth/demo', { method: 'POST', auth: false })
      setToken(r.token)
      router.push('/dashboard')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start the demo')
    } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={className} onClick={go} disabled={busy} data-testid="try-demo">{busy ? 'Starting demo…' : label}</button>
      {err && <span role="alert" className="text-xs text-down">{err}</span>}
    </span>
  )
}
