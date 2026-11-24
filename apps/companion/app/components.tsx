'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getToken, setToken, api } from '@/lib/api'

export function HelmMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="12" fill="none" stroke="var(--color-amber-helm)" strokeWidth="3" />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (Math.PI / 4) * i
        return <line key={i} x1={20 + Math.cos(a) * 4} y1={20 + Math.sin(a) * 4} x2={20 + Math.cos(a) * 18} y2={20 + Math.sin(a) * 18} stroke="var(--color-amber-helm)" strokeWidth="2.5" strokeLinecap="round" />
      })}
      <circle cx="20" cy="20" r="3.5" fill="var(--color-amber-helm)" />
    </svg>
  )
}

const LINKS = [
  { href: '/connect', label: 'Exchanges' },
  { href: '/devices', label: 'Devices' },
  { href: '/capabilities', label: 'Capabilities' },
]

export function Nav() {
  const path = usePathname()
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  useEffect(() => { setAuthed(!!getToken()) }, [path])
  return (
    <header className="sticky top-0 z-20 border-b border-graphite-800 bg-graphite-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-[0.18em]"><HelmMark size={24} /> HELM</Link>
        <nav className="flex gap-1 text-sm">
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className={`rounded-md px-3 py-1.5 ${path.startsWith(l.href) ? 'bg-graphite-800 text-graphite-100' : 'text-graphite-300 hover:text-graphite-100'}`}>{l.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="pill bg-amber-helm/15 text-amber-helm" title="Signed requests are restricted to demo, paper and sandbox endpoints">Live trading off</span>
          {authed ? (
            <button className="btn btn-ghost" onClick={async () => { try { await api('/v1/auth/logout', { method: 'POST' }) } catch {} setToken(null); router.push('/login') }}>Sign out</button>
          ) : (
            <Link className="btn btn-amber" href="/login">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  )
}

export function useRequireAuth() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  useEffect(() => { if (!getToken()) router.replace('/login'); else setReady(true) }, [router])
  return ready
}

const STATE_STYLE: Record<string, string> = {
  CONNECTED: 'bg-up/15 text-up', READ_ONLY: 'bg-sky-400/15 text-sky-300', LIMITED: 'bg-amber-helm/15 text-amber-helm',
  EXPIRED: 'bg-down/15 text-down', ERROR: 'bg-down/15 text-down', RECONNECTING: 'bg-graphite-700 text-graphite-300', DISCONNECTED: 'bg-graphite-700 text-graphite-300',
}
export function StatePill({ state }: { state: string }) {
  return <span className={`pill ${STATE_STYLE[state] ?? 'bg-graphite-700'}`}>{state.replace('_', ' ')}</span>
}
const ENV_STYLE: Record<string, string> = { demo: 'text-up border-up/40', paper: 'text-sky-300 border-sky-400/40', sandbox_static: 'text-amber-helm border-amber-helm/40' }
export function EnvPill({ env }: { env: string }) {
  return <span className={`pill border ${ENV_STYLE[env] ?? ''}`}>{env === 'sandbox_static' ? 'static sandbox' : env}</span>
}
