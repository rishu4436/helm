'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Connection, type ProviderInfo } from '@/lib/api'
import { EnvPill, StatePill, useRequireAuth } from '../components'

type Field = { name: string; label: string; type?: 'password' | 'text' | 'select'; options?: Array<[string, string]> }
const FORMS: Record<string, { fields: Field[]; help: React.ReactNode }> = {
  binance: {
    fields: [{ name: 'apiKey', label: 'Demo API key' }, { name: 'apiSecret', label: 'Demo API secret', type: 'password' }, { name: 'market', label: 'Account', type: 'select', options: [['spot', 'Spot'], ['usdm', 'USDⓈ-M Futures']] }],
    help: <>Create a key at <b>demo.binance.com → API Management</b>. Enable reading and trading only — never withdrawals. Production Binance keys will not work: HELM only talks to <code>demo-api.binance.com</code> / <code>demo-fapi.binance.com</code>.</>,
  },
  okx: {
    fields: [{ name: 'apiKey', label: 'Demo API key' }, { name: 'apiSecret', label: 'Demo secret key', type: 'password' }, { name: 'passphrase', label: 'API passphrase', type: 'password' }],
    help: <>In OKX switch to <b>Demo Trading</b>, then create an API key with <b>Read + Trade</b> permissions. Every HELM request carries <code>x-simulated-trading: 1</code>; a live key is rejected by OKX (error 50101).</>,
  },
  bybit: {
    fields: [{ name: 'apiKey', label: 'Demo API key' }, { name: 'apiSecret', label: 'Demo API secret', type: 'password' }],
    help: <>Log in to Bybit, switch to <b>Demo Trading</b> (a separate account), then create the key from the avatar → API menu inside demo mode. HELM uses <code>api-demo.bybit.com</code>.</>,
  },
  coinbase: {
    fields: [],
    help: <>Connects the official Advanced Trade <b>static sandbox</b>. It needs no credentials and returns <b>predefined mock responses</b> — HELM labels every result as static and never as a real fill.</>,
  },
  ibkr: {
    fields: [],
    help: <>Download and start the IBKR <b>Client Portal Gateway</b> on this computer, open <code>https://localhost:5000</code> and log in with your <b>paper</b> account there. HELM then checks the local session. HELM never sees your IBKR password, and the gateway must stay on localhost.</>,
  },
  alpaca: { fields: [], help: <>Alpaca is not in the official Exchanges &amp; Stocks track list, so it is disabled until organisers confirm it is allowed.</> },
}

export default function Connect() {
  const ready = useRequireAuth()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [conns, setConns] = useState<Connection[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; reasons?: string[] } | null>(null)
  const [balances, setBalances] = useState<Record<string, Array<{ asset: string; total: string }> | string>>({})

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api<{ providers: ProviderInfo[] }>('/v1/providers', { auth: false }), api<{ connections: Connection[] }>('/v1/connections')])
    setProviders(p.providers); setConns(c.connections)
  }, [])
  useEffect(() => { if (ready) load().catch(e => setMsg({ kind: 'err', text: e.message })) }, [ready, load])

  function pick(id: string) {
    setPicked(id); setMsg(null)
    const p = providers.find(x => x.id === id)
    setAlias(p ? (id === 'ibkr' ? 'Stock Portfolio' : id === 'coinbase' ? 'Coinbase Sandbox' : `My ${p.name.split(' ')[0]}`) : '')
    setForm(id === 'binance' ? { market: 'spot' } : {})
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!picked) return
    setBusy(true); setMsg(null)
    try {
      const r = await api<{ connection: Connection }>('/v1/connections', { method: 'POST', body: { provider: picked, alias, credentials: form } })
      setMsg({ kind: 'ok', text: `${r.connection.alias}: ${r.connection.state}`, reasons: r.connection.reasons })
      setPicked(null); setForm({})
      await load()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Failed', reasons: e instanceof ApiError ? e.reasons : [] })
    } finally { setBusy(false) }
  }

  async function check(id: string) { await api(`/v1/connections/${id}/check`, { method: 'POST' }).catch(() => {}); await load() }
  async function remove(id: string) {
    if (!confirm('Disconnect and delete the stored credentials?')) return
    const r = await api<{ revokeAtExchange: string }>(`/v1/connections/${id}`, { method: 'DELETE' })
    setMsg({ kind: 'ok', text: `Deleted. ${r.revokeAtExchange}` }); await load()
  }
  async function showBalances(id: string) {
    try { const r = await api<{ balances: Array<{ asset: string; total: string }> }>(`/v1/connections/${id}/balances`); setBalances(b => ({ ...b, [id]: r.balances })) }
    catch (e) { setBalances(b => ({ ...b, [id]: e instanceof ApiError ? e.message : 'Failed' })) }
  }

  if (!ready) return null
  const cfg = picked ? FORMS[picked] : null
  return (
    <div className="pt-10">
      <h1 className="text-3xl font-semibold">Welcome to HELM</h1>
      <p className="mt-2 text-graphite-300">Connect your existing exchange or brokerage account. No exchange is required — start with any one.</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map(p => (
          <button key={p.id} disabled={!p.enabled} onClick={() => pick(p.id)} className={`card p-5 text-left transition ${picked === p.id ? 'border-amber-helm' : 'hover:border-graphite-700'} disabled:opacity-40`}>
            <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span><EnvPill env={p.hackathonEnvironment} /></div>
            <div className="mt-2 text-xs text-graphite-500">{p.enabled ? p.connectionMethod.replace(/_/g, ' ') : 'disabled — not in track list'}</div>
          </button>
        ))}
      </div>

      {cfg && picked && (
        <form onSubmit={submit} className="card mt-6 grid gap-5 p-6 md:grid-cols-[1fr_1.2fr]">
          <div className="text-sm leading-relaxed text-graphite-300">{cfg.help}</div>
          <div className="space-y-3">
            <label className="block text-sm">Account name<input className="input mt-1" value={alias} onChange={e => setAlias(e.target.value)} required maxLength={40} /></label>
            {cfg.fields.map(f => f.type === 'select' ? (
              <label key={f.name} className="block text-sm">{f.label}
                <select className="input mt-1" value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </label>
            ) : (
              <label key={f.name} className="block text-sm">{f.label}<input className="input mt-1 num" type={f.type ?? 'text'} autoComplete="off" spellCheck={false} required value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value.trim() })} /></label>
            ))}
            <button className="btn btn-amber" disabled={busy || picked === 'alpaca'}>{busy ? 'Verifying with the exchange…' : picked === 'ibkr' ? 'Check gateway session' : 'Verify & connect'}</button>
            <p className="text-xs text-graphite-500">Credentials are verified with an authenticated read, encrypted (AES-256-GCM) on the HELM server and never sent to your glasses.</p>
          </div>
        </form>
      )}

      {msg && (
        <div role="status" className={`mt-6 rounded-xl border px-4 py-3 text-sm ${msg.kind === 'ok' ? 'border-up/40 text-up' : 'border-down/40 text-down'}`}>
          {msg.text}{msg.reasons && msg.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-graphite-300">{msg.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}

      <h2 className="mt-12 text-sm font-semibold tracking-[0.2em] text-graphite-300">CONNECTED ACCOUNTS</h2>
      {conns.length === 0 && <p className="mt-3 text-sm text-graphite-500">Nothing connected yet.</p>}
      <div className="mt-4 space-y-3">
        {conns.map(c => {
          const b = balances[c.id]
          const caps = c.accounts[0]?.capabilities
          return (
            <div key={c.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{c.alias}</span><StatePill state={c.state} /><EnvPill env={c.environment} />
                <span className="text-xs text-graphite-500">{c.provider}{c.credential ? ` · key ${c.credential.keyFingerprint}` : ''}</span>
                <div className="ml-auto flex gap-2">
                  <button className="btn btn-ghost" onClick={() => showBalances(c.id)}>Balances</button>
                  <button className="btn btn-ghost" onClick={() => check(c.id)}>Re-check</button>
                  <button className="btn btn-ghost text-down" onClick={() => remove(c.id)}>Disconnect</button>
                </div>
              </div>
              {c.reasons.length > 0 && <ul className="mt-2 text-xs text-graphite-300">{c.reasons.map(r => <li key={r}>• {r}</li>)}</ul>}
              {caps && <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-graphite-300">{caps.orderTypes.map(o => <span key={o} className="rounded bg-graphite-800 px-2 py-0.5">{o}</span>)}{caps.reduceOnly && <span className="rounded bg-graphite-800 px-2 py-0.5">reduce-only</span>}{caps.hedgeMode && <span className="rounded bg-graphite-800 px-2 py-0.5">hedge mode</span>}</div>}
              {b && (typeof b === 'string' ? <p className="mt-3 text-sm text-down">{b}</p> : (
                <table className="num mt-3 w-full max-w-sm text-sm"><tbody>{b.map(x => <tr key={x.asset} className="border-t border-graphite-800"><td className="py-1.5 text-graphite-300">{x.asset}</td><td className="text-right">{x.total}</td></tr>)}</tbody></table>
              ))}
              {b && typeof b !== 'string' && c.environment === 'sandbox_static' && <p className="mt-2 text-xs text-amber-helm">Static sandbox values — predefined by Coinbase, not your real balance.</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
