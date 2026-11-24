'use client'
import { useState } from 'react'
import { api, ApiError, type Connection, type ProviderInfo } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { ago } from '@/lib/format'
import { Btn, Card, Empty, EnvPill, ErrorNote, Field, Modal, PageHeader, Pill, Skeleton } from '../../ui'
import { useShell } from '../../shell'

type F = { name: string; label: string; type?: 'password' | 'text' | 'select'; options?: Array<[string, string]> }
const FORMS: Record<string, { fields: F[]; help: React.ReactNode }> = {
  binance: { fields: [{ name: 'apiKey', label: 'Demo API key' }, { name: 'apiSecret', label: 'Demo API secret', type: 'password' }, { name: 'market', label: 'Account', type: 'select', options: [['spot', 'Spot'], ['usdm', 'USDⓈ-M Futures']] }],
    help: <>Create a key at <b>demo.binance.com → API Management</b>. Enable reading and trading only — never withdrawals. Production Binance keys will not work: HELM only talks to <code>demo-api.binance.com</code> / <code>demo-fapi.binance.com</code>.</> },
  okx: { fields: [], help: <>OKX is <b>unavailable in India</b>, so a logged-in OKX demo is <b>BLOCKED</b> for this team. The adapter (with <code>x-simulated-trading: 1</code> on every request) is built and tested against mocks and OKX public endpoints.</> },
  bybit: { fields: [{ name: 'apiKey', label: 'Demo API key' }, { name: 'apiSecret', label: 'Demo API secret', type: 'password' }],
    help: <>Log in to Bybit, switch to <b>Demo Trading</b> (a separate account), then create the key from avatar → API inside demo mode. Read + trade only. HELM uses <code>api-demo.bybit.com</code>.</> },
  coinbase: { fields: [], help: <>Connects the Advanced Trade <b>static sandbox</b>. It needs no credentials and returns <b>predefined mock responses</b> — HELM labels every result STATIC SANDBOX and never presents it as a fill.</> },
  ibkr: { fields: [], help: <>Start the IBKR <b>Client Portal Gateway</b> on this computer, open <code>https://localhost:5000</code> and log in with your <b>paper</b> account there. HELM never sees your IBKR password; the gateway must stay on localhost.</> },
  alpaca: { fields: [], help: <>Alpaca is not in the official Exchanges &amp; Stocks track list, so it stays disabled.</> },
}
const BLOCKED = new Set(['okx'])

export default function Connect() {
  const { reloadAccounts } = useShell()
  const prov = useApi<{ providers: ProviderInfo[] }>('/v1/providers')
  const conns = useApi<{ connections: Connection[] }>('/v1/connections')
  const [picked, setPicked] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; reasons?: string[] } | null>(null)
  const [balances, setBalances] = useState<Record<string, Array<{ asset: string; total: string }> | string>>({})
  const [del, setDel] = useState<Connection | null>(null)

  function pick(p: ProviderInfo) {
    setPicked(p.id); setMsg(null)
    setAlias(p.id === 'ibkr' ? 'Stock Portfolio' : p.id === 'coinbase' ? 'Coinbase Sandbox' : `My ${p.name.split(' ')[0]}`)
    setForm(p.id === 'binance' ? { market: 'spot' } : {})
  }
  async function addSim(provider: string) {
    const names: Record<string, string> = { binance: 'Binance (SIMULATED)', bybit: 'Bybit (SIMULATED)', okx: 'OKX (SIMULATED)' }
    setBusy(`sim-${provider}`); setMsg(null)
    try {
      const r = await api<{ connection: Connection }>('/v1/connections', { method: 'POST', body: { provider, alias: names[provider] ?? `${provider} (SIMULATED)`, simulated: true } })
      setMsg({ ok: true, text: `${r.connection.alias}: ${r.connection.state} — labelled SIMULATED, no keys, nothing is sent to the exchange.`, reasons: r.connection.reasons })
      setPicked(null)
      await Promise.all([conns.reload(), reloadAccounts()])
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Failed', reasons: e instanceof ApiError ? e.reasons : [] }) }
    finally { setBusy(null) }
  }
  async function submit() {
    if (!picked) return
    setBusy('connect'); setMsg(null)
    try {
      const r = await api<{ connection: Connection }>('/v1/connections', { method: 'POST', body: { provider: picked, alias, credentials: form } })
      setMsg({ ok: true, text: `${r.connection.alias}: ${r.connection.state}`, reasons: r.connection.reasons }); setPicked(null); setForm({})
      await Promise.all([conns.reload(), reloadAccounts()])
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Failed', reasons: e instanceof ApiError ? e.reasons : [] }) } finally { setBusy(null) }
  }
  async function check(id: string) { setBusy(`check-${id}`); try { await api(`/v1/connections/${id}/check`, { method: 'POST' }) } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } await conns.reload(); setBusy(null) }
  async function showBalances(id: string) {
    setBusy(`bal-${id}`)
    try { const r = await api<{ balances: Array<{ asset: string; total: string }> }>(`/v1/connections/${id}/balances`); setBalances(b => ({ ...b, [id]: r.balances })) }
    catch (e) { setBalances(b => ({ ...b, [id]: e instanceof ApiError ? e.message : 'Failed' })) } finally { setBusy(null) }
  }
  async function remove() {
    const c = del!; setDel(null)
    const r = await api<{ revokeAtExchange: string }>(`/v1/connections/${c.id}`, { method: 'DELETE' })
    setMsg({ ok: true, text: `Deleted ${c.alias}. ${r.revokeAtExchange}` }); await Promise.all([conns.reload(), reloadAccounts()])
  }
  const cfg = picked ? FORMS[picked] : null
  const list = conns.data?.connections ?? []
  return (
    <div>
      <PageHeader kicker="ACCOUNT" title="Exchanges" subtitle="Connect the exchange or brokerage accounts you already use — demo, paper and sandbox environments only in this build. Keys are verified with an authenticated read and encrypted on the HELM server." actions={<Btn href="/capabilities">Capability matrix</Btn>} />
      <ErrorNote error={prov.error ?? conns.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!prov.data ? <Skeleton h="h-24" /> : prov.data.providers.map(p => {
          const blocked = BLOCKED.has(p.id)
          return (
            <button key={p.id} disabled={!p.enabled && !blocked} onClick={() => pick(p)} data-testid={`provider-${p.id}`} className={`card p-5 text-left transition ${picked === p.id ? 'border-amber-helm' : 'hover:border-graphite-700'} disabled:opacity-40`}>
              <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span><EnvPill env={blocked ? 'blocked' : p.hackathonEnvironment} /></div>
              <div className="mt-2 text-xs text-graphite-500">{blocked ? 'Unavailable in your region (India) · adapter tested with mocks' : p.enabled ? p.connectionMethod.replace(/_/g, ' ') : 'disabled — not in track list'}</div>
            </button>
          )
        })}
      </div>

      {cfg && picked && (
        <Card className="mt-6" title={`Connect ${prov.data?.providers.find(p => p.id === picked)?.name}`} action={<Btn variant="quiet" onClick={() => setPicked(null)}>Close</Btn>}>
          <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
            <div className="text-sm leading-relaxed text-graphite-300">{cfg.help}</div>
            {picked === 'alpaca' ? <div className="flex items-start gap-3"><Pill v="BLOCKED" /><p className="text-sm text-graphite-300">Alpaca is not in the official track list, so it stays disabled.</p></div> : (
              <div className="space-y-6">
                {['binance', 'bybit', 'okx'].includes(picked) && (
                  <div className="space-y-2">
                    <p className="text-sm text-graphite-300">Or add a <span className="font-semibold">SIMULATED</span> account — live public prices, fills computed by HELM, no API keys, nothing sent to the exchange.</p>
                    <Btn type="button" variant="amber" busy={busy === `sim-${picked}`} testId={`sim-${picked}`} onClick={() => addSim(picked)}>Add {picked === 'okx' ? 'OKX' : picked[0].toUpperCase()+picked.slice(1)} (SIMULATED)</Btn>
                  </div>
                )}
                {BLOCKED.has(picked) ? <div className="flex items-start gap-3"><Pill v="BLOCKED" /><p className="text-sm text-graphite-300">Logged-in OKX demo keys are unavailable in India. Use the simulator above, or connect Binance Demo / Bybit Demo.</p></div> : (
              <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit() }}>
                <Field label="Account name"><input className="input" value={alias} onChange={e => setAlias(e.target.value)} required maxLength={40} data-testid="conn-alias" /></Field>
                {cfg.fields.map(f => <Field key={f.name} label={f.label}>{f.type === 'select'
                  ? <select className="input" value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value })}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <input className="input num" type={f.type ?? 'text'} autoComplete="off" spellCheck={false} required value={form[f.name] ?? ''} onChange={e => setForm({ ...form, [f.name]: e.target.value.trim() })} />}</Field>)}
                <Btn type="submit" variant="amber" busy={busy === 'connect'} testId="conn-submit">{picked === 'ibkr' ? 'Check gateway session' : 'Verify & connect'}</Btn>
                <p className="text-xs text-graphite-500">HELM never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permission. Keys are AES-256-GCM encrypted and never sent to your glasses.</p>
              </form>
                )}
              </div>
            )}
          </div>
        </Card>
      )}
      {msg && <div role="status" className={`mt-6 rounded-xl border px-4 py-3 text-sm ${msg.ok ? 'border-up/40 text-up' : 'border-down/40 text-down'}`}>{msg.text}{msg.reasons && msg.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-graphite-300">{msg.reasons.map(r => <li key={r}>{r}</li>)}</ul>}</div>}

      <h2 className="mb-3 mt-10 text-[12px] font-semibold tracking-[0.16em] text-graphite-300 uppercase">Connected ({list.length})</h2>
      {!conns.data ? <Skeleton /> : list.length === 0 ? <Empty title="Nothing connected yet" hint="Pick a provider above." /> : (
        <div className="space-y-3">
          {list.map(c => {
            const b = balances[c.id]; const caps = c.accounts[0]?.capabilities
            return (
              <div key={c.id} className="card p-5" data-testid={`conn-${c.id}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{c.alias}</span><Pill v={c.state} /><EnvPill env={c.environment} />
                  <span className="text-xs text-graphite-500">{c.provider}{c.credential ? ` · key ${c.credential.keyFingerprint}` : ''}{c.lastCheckedAt ? ` · checked ${ago(c.lastCheckedAt)}` : ''}</span>
                  <div className="ml-auto flex gap-2">
                    <Btn onClick={() => showBalances(c.id)} busy={busy === `bal-${c.id}`}>Balances</Btn>
                    <Btn onClick={() => check(c.id)} busy={busy === `check-${c.id}`}>Re-check</Btn>
                    <Btn variant="quiet" danger onClick={() => setDel(c)}>Disconnect</Btn>
                  </div>
                </div>
                {c.reasons.length > 0 && <ul className="mt-2 text-xs text-graphite-300">{c.reasons.map(r => <li key={r}>• {r}</li>)}</ul>}
                {caps && <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-graphite-300">{caps.orderTypes.map(o => <span key={o} className="rounded bg-graphite-800 px-2 py-0.5">{o}</span>)}{caps.reduceOnly && <span className="rounded bg-graphite-800 px-2 py-0.5">reduce-only</span>}{caps.hedgeMode && <span className="rounded bg-graphite-800 px-2 py-0.5">hedge mode</span>}</div>}
                {b && (typeof b === 'string' ? <p className="mt-3 text-sm text-down">{b}</p> : (
                  <table className="num mt-3 w-full max-w-sm text-sm"><tbody>{b.filter(x => Number(x.total) !== 0).slice(0, 12).map(x => <tr key={x.asset} className="border-t border-graphite-800"><td className="py-1.5 text-graphite-300">{x.asset}</td><td className="text-right">{x.total}</td></tr>)}</tbody></table>
                ))}
                {b && typeof b !== 'string' && c.environment === 'sandbox_static' && <p className="mt-2 text-xs text-amber-helm">Static sandbox values — predefined by Coinbase, not a real balance.</p>}
              </div>
            )
          })}
        </div>
      )}
      <Modal open={!!del} title={`Disconnect ${del?.alias}?`} onClose={() => setDel(null)}>
        <p className="text-sm text-graphite-300">HELM deletes the encrypted credentials. Also revoke the key at the exchange. Open orders and positions at the exchange are not touched.</p>
        <div className="mt-4 flex gap-2"><Btn variant="danger" danger onClick={remove}>Disconnect</Btn><Btn variant="quiet" onClick={() => setDel(null)}>Cancel</Btn></div>
      </Modal>
    </div>
  )
}
