'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken } from '@/lib/api'
import type { Account } from '@/lib/types'
import { HelmMark } from './brand'

export const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: string }> }> = [
  { group: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: '◎' }, { href: '/portfolio', label: 'Portfolio', icon: '▤' }, { href: '/positions', label: 'Positions & orders', icon: '≡' }] },
  { group: 'Trade', items: [{ href: '/terminal', label: 'Terminal', icon: '⌁' }, { href: '/protect', label: 'Trade-to-Protect', icon: '⛉' }, { href: '/recipes', label: 'Recipes', icon: '❖' }, { href: '/voice', label: 'Voice Studio', icon: '◉' }] },
  { group: 'Risk', items: [{ href: '/shield', label: 'Shield & Compass', icon: '✧' }, { href: '/pulse', label: 'Activity & alerts', icon: '∿' }] },
  { group: 'Markets', items: [{ href: '/markets', label: 'Market intelligence', icon: '⇅' }] },
  { group: 'Glasses', items: [{ href: '/vision', label: 'Vision', icon: '◐' }, { href: '/devices', label: 'Devices', icon: '▭' }] },
  { group: 'Records', items: [{ href: '/history', label: 'History & receipts', icon: '☰' }] },
  { group: 'Account', items: [{ href: '/connect', label: 'Exchanges', icon: '⊕' }, { href: '/security', label: 'Security', icon: '⚿' }, { href: '/settings', label: 'Settings', icon: '⚙' }, { href: '/diagnostics', label: 'Diagnostics', icon: '✓' }] },
]

interface Shell { me: { email: string; displayName: string | null; guest?: boolean } | null; accounts: Account[]; reloadAccounts: () => Promise<void> }
const Ctx = createContext<Shell>({ me: null, accounts: [], reloadAccounts: async () => {} })
export const useShell = () => useContext(Ctx)

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState<Shell['me']>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [cmd, setCmd] = useState('')
  const [open, setOpen] = useState(false)
  const reloadAccounts = useCallback(async () => { try { setAccounts((await api<{ accounts: Account[] }>('/v1/accounts')).accounts) } catch { /* each page shows its own errors */ } }, [])
  useEffect(() => {
    if (!getToken()) { router.replace(`/login?next=${encodeURIComponent(path)}`); return }
    setReady(true)
  }, [router, path])
  useEffect(() => {
    if (!ready) return
    api<{ user: Shell['me'] }>('/v1/me').then(r => setMe(r.user)).catch(() => { if (!getToken()) router.replace('/login') })
    reloadAccounts()
  }, [ready, router, reloadAccounts])
  useEffect(() => setOpen(false), [path])
  if (!ready) return null
  const live = accounts.filter(a => a.environment === 'demo' || a.environment === 'paper')
  const degraded = accounts.filter(a => a.state !== 'CONNECTED' && a.state !== 'READ_ONLY')
  return (
    <Ctx.Provider value={{ me, accounts, reloadAccounts }}>
      <div className="flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 overflow-y-auto border-r border-graphite-800 bg-graphite-950 px-3 py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <Link href="/dashboard" className="mb-5 flex items-center gap-2 px-2 font-semibold tracking-[0.2em]"><HelmMark size={22} /> HELM</Link>
          <nav aria-label="Main">
            {NAV.map(g => (
              <div key={g.group} className="mb-4">
                <div className="mb-1 px-2 text-[10px] font-semibold tracking-[0.2em] text-graphite-500 uppercase">{g.group}</div>
                {g.items.map(i => <Link key={i.href} href={i.href} className={`nav-link ${path === i.href || path.startsWith(i.href + '/') ? 'active' : ''}`}><span className="w-4 text-center text-amber-helm/80">{i.icon}</span>{i.label}</Link>)}
              </div>
            ))}
          </nav>
          <div className="mt-6 rounded-lg border border-graphite-800 p-3 text-[11px] leading-relaxed text-graphite-500">
            <div className="mb-1 font-semibold text-amber-helm">LIVE TRADING OFF</div>
            Signed requests only reach demo, paper and sandbox hosts. SIMULATED and STATIC SANDBOX results are never real fills.
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-graphite-800 bg-graphite-950/85 px-4 backdrop-blur lg:px-8">
            <button className="btn btn-quiet lg:hidden" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
            <form className="flex max-w-xl flex-1" onSubmit={e => { e.preventDefault(); if (cmd.trim()) { router.push(`/voice?say=${encodeURIComponent(cmd.trim())}`); setCmd('') } }}>
              <input className="input h-9 py-1.5" placeholder='Ask HELM — e.g. "buy 100 dollars of BTC on Bybit"' value={cmd} onChange={e => setCmd(e.target.value)} aria-label="Command" data-testid="cmdbar" />
            </form>
            <div className="ml-auto flex items-center gap-3 text-xs">
              <Link href="/connect" className="hidden items-center gap-1.5 text-graphite-300 hover:text-graphite-100 md:flex" title="Connected accounts">
                <span className={`h-2 w-2 rounded-full ${degraded.length ? 'bg-amber-helm' : 'bg-up'}`} />{live.length} demo · {accounts.length - live.length} sim/sandbox
              </Link>
              <span className="pill bg-amber-helm/15 text-amber-helm">Demo only</span>
              <span className="hidden text-graphite-500 xl:inline">{me?.displayName ?? me?.email ?? ''}</span>
              <button className="btn btn-ghost h-8 py-1" onClick={async () => { try { await api('/v1/auth/logout', { method: 'POST' }) } catch { /* already gone */ } setToken(null); router.push('/login') }}>Sign out</button>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
            {me?.guest && (
              <div className="mb-6 rounded-xl border border-violet-400/40 bg-violet-400/10 px-4 py-3 text-sm text-violet-200" data-testid="guest-banner">
                You&apos;re on a simulated demo. The Binance, Bybit and OKX accounts are labelled <span className="font-semibold">SIMULATED</span> — live public prices, fills computed by HELM, nothing is sent to any exchange. This session lasts 12 hours. You can also register and connect your own demo keys.
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  )
}
