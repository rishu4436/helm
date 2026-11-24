'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api, ApiError, setToken } from '@/lib/api'
import { HelmMark } from '../components'

export default function Login() {
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api<{ token: string }>(`/v1/auth/${mode}`, { method: 'POST', auth: false, body: mode === 'register' ? { email, password, displayName: name || undefined } : { email, password } })
      setToken(r.token)
      router.push('/connect')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto mt-20 max-w-sm">
      <div className="mb-8 flex items-center gap-3"><HelmMark /><h1 className="text-2xl font-semibold">{mode === 'login' ? 'Sign in to HELM' : 'Create your HELM account'}</h1></div>
      <form onSubmit={submit} className="card space-y-4 p-6">
        {mode === 'register' && <label className="block text-sm">Name<input className="input mt-1" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
        <label className="block text-sm">Email<input className="input mt-1" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="block text-sm">Password<input className="input mt-1" type="password" required minLength={mode === 'register' ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'register' && <p className="text-xs text-graphite-500">This is your HELM password. HELM never asks for exchange passwords, 2FA codes or recovery phrases.</p>}
        {err && <p role="alert" className="text-sm text-down">{err}</p>}
        <button className="btn btn-amber w-full justify-center" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="mt-4 text-sm text-graphite-300 hover:text-graphite-100" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null) }}>
        {mode === 'login' ? 'New to HELM? Create an account' : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
