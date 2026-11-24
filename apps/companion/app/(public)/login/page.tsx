'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { api, ApiError, setToken } from '@/lib/api'
import { HelmMark } from '../../brand'
import { TryDemoButton } from '../try-demo'

function LoginInner() {
  const router = useRouter()
  const q = useSearchParams()
  const [mode, setMode] = useState<'login' | 'register'>(q.get('mode') === 'register' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setMode(q.get('mode') === 'register' ? 'register' : 'login') }, [q])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api<{ token: string }>(`/v1/auth/${mode}`, { method: 'POST', auth: false, body: mode === 'register' ? { email, password, displayName: name || undefined } : { email, password } })
      setToken(r.token)
      const next = q.get('next')
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : mode === 'register' ? '/connect' : '/dashboard')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto mt-16 grid max-w-4xl items-start gap-10 md:grid-cols-2">
      <div className="pt-4">
        <div className="mb-6 flex items-center gap-3"><HelmMark /><h1 className="text-2xl font-semibold">{mode === 'login' ? 'Sign in to HELM' : 'Create your HELM account'}</h1></div>
        <ul className="space-y-3 text-sm text-graphite-300">
          <li>• HELM never asks for exchange passwords, 2FA codes or recovery phrases.</li>
          <li>• Exchange API keys are trade + read only. Keys with withdrawal permission are refused.</li>
          <li>• Every order is previewed, risk-checked and confirmed by you. Nothing trades by itself.</li>
          <li>• This build only talks to demo, paper and sandbox environments.</li>
        </ul>
      </div>
      <div>
        <div className="mb-4 inline-flex rounded-lg border border-graphite-700 p-0.5" role="tablist">
          {(['login', 'register'] as const).map(m => <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr(null) }} className={`rounded-md px-4 py-1.5 text-sm ${mode === m ? 'bg-graphite-700' : 'text-graphite-300'}`}>{m === 'login' ? 'Sign in' : 'Create account'}</button>)}
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          {mode === 'register' && <label className="block text-sm">Name<input className="input mt-1" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
          <label className="block text-sm">Email<input className="input mt-1" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" name="email" /></label>
          <label className="block text-sm">Password<input className="input mt-1" type="password" required minLength={mode === 'register' ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} name="password" /></label>
          {mode === 'register' && <p className="text-xs text-graphite-500">At least 10 characters. This is your HELM password only.</p>}
          {err && <p role="alert" className="text-sm text-down">{err}</p>}
          <button className="btn btn-amber w-full justify-center" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <div className="relative py-1 text-center text-xs text-graphite-500">or</div>
          <div className="flex justify-center"><TryDemoButton className="btn btn-ghost w-full justify-center" label="Try the demo — simulated accounts, no keys" /></div>
          <p className="text-xs text-graphite-500">Opens a guest session with simulated Binance, Bybit and OKX accounts. Fills are computed by HELM and labelled SIMULATED.</p>
        </form>
      </div>
    </div>
  )
}
export default function Login() { return <Suspense><LoginInner /></Suspense> }
