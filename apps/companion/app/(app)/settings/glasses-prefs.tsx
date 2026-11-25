'use client'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { DEFAULT_DECK, withDefaults, type Prefs } from '@helm/glasses/src/ux/types'
import { CARD_TITLE, type CardId } from '@helm/glasses/src/screens/v2'
import { Btn, Card, Field, Segmented } from '../../ui'

/** Glasses presentation preferences. Nothing here can change trading limits (those live in Shield). */
export function GlassesPrefs() {
  const [p, setP] = useState<Prefs | null>(null)
  const [wl, setWl] = useState('')
  const [sizes, setSizes] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<{ preferences: Partial<Prefs> }>('/v1/preferences').then(r => { const v = withDefaults(r.preferences); setP(v); setWl(v.watchlist.join(', ')); setSizes(v.sizePresets.join(', ')) }).catch(e => setErr(e instanceof ApiError ? e.message : 'Could not load preferences')) }, [])
  async function save(patch: Partial<Prefs>, note = 'Saved. The glasses pick this up on their next refresh.') {
    setMsg(null)
    try { const r = await api<{ preferences: Partial<Prefs> }>('/v1/preferences', { method: 'PUT', body: patch }); setP(withDefaults(r.preferences)); setMsg({ ok: true, text: note }) }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' }) }
  }
  if (err) return <Card title="Glasses display" className="lg:col-span-2"><p className="text-sm text-down">{err}</p></Card>
  if (!p) return <Card title="Glasses display" className="lg:col-span-2"><p className="text-sm text-graphite-500">Loading…</p></Card>
  const move = (id: CardId, d: -1 | 1) => { const o = [...p.deckOrder] as CardId[]; const i = o.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j]!, o[i]!]; void save({ deckOrder: o }) }
  const fav = (id: CardId) => void save({ deckFavorites: p.deckFavorites.includes(id) ? p.deckFavorites.filter(x => x !== id) : [...p.deckFavorites, id] })
  const deck = p.deckOrder as CardId[]
  return (
    <Card title="Glasses display" className="lg:col-span-2">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Experience" hint="Beginner explains terms and shows fewer cards. Pro is denser, with short labels."><div className="mt-2"><Segmented value={p.mode} onChange={v => save({ mode: v })} options={[['beginner', 'Beginner'], ['pro', 'Pro']]} testId="pref-mode" /></div></Field>
          <Field label="Privacy mode" hint="Hides portfolio balances on the lens. An order's own size and cost always show before you confirm."><div className="mt-2"><Segmented value={p.privacy ? 'on' : 'off'} onChange={v => save({ privacy: v === 'on' })} options={[['off', 'Off'], ['on', 'On']]} testId="pref-privacy" /></div></Field>
          <Field label="Home focus"><div className="mt-2"><Segmented value={p.homeMode} onChange={v => save({ homeMode: v })} options={[['auto', 'Auto'], ['spot', 'Spot'], ['futures', 'Futures'], ['multi', 'Multi-account']]} testId="pref-home" /></div></Field>
          <Field label="Alerts on the lens"><div className="mt-2"><Segmented value={p.alertSensitivity} onChange={v => save({ alertSensitivity: v })} options={[['all', 'All'], ['normal', 'Important'], ['critical', 'Critical only']]} testId="pref-alerts" /></div></Field>
          <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void save({ watchlist: wl.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 12) }) }}>
            <Field label="Watchlist" hint="Up to 12 assets, e.g. BTC, ETH, SOL"><input className="input num" value={wl} onChange={e => setWl(e.target.value)} data-testid="pref-watchlist" /></Field>
            <Btn type="submit">Save</Btn>
          </form>
          <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); void save({ sizePresets: sizes.split(/[,\s]+/).map(s => s.replace(/[^0-9.]/g, '')).filter(Boolean).slice(0, 6) }) }}>
            <Field label="Order size presets (USD)" hint="Shown first in the manual order builder. Shield limits still apply."><input className="input num" value={sizes} onChange={e => setSizes(e.target.value)} data-testid="pref-sizes" /></Field>
            <Btn type="submit">Save</Btn>
          </form>
        </div>
        <div>
          <div className="text-sm text-graphite-300">Quick Deck (swipe on Home)</div>
          <ol className="mt-2 space-y-1.5" data-testid="pref-deck">
            {deck.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-lg border border-graphite-800 px-3 py-2 text-sm">
                <span className="num w-5 text-graphite-500">{i + 1}</span>
                <span className="flex-1">{CARD_TITLE[id] ?? id}</span>
                <button type="button" className="btn btn-quiet px-2 py-1 text-xs" aria-pressed={p.deckFavorites.includes(id)} onClick={() => fav(id)}>{p.deckFavorites.includes(id) ? '★ Pinned' : '☆ Pin'}</button>
                <button type="button" className="btn btn-quiet px-2 py-1 text-xs" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move ${id} up`}>↑</button>
                <button type="button" className="btn btn-quiet px-2 py-1 text-xs" disabled={i === deck.length - 1} onClick={() => move(id, 1)} aria-label={`Move ${id} down`}>↓</button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn variant="quiet" onClick={() => save({ deckOrder: [...DEFAULT_DECK], deckFavorites: [] }, 'Deck reset.')}>Reset deck</Btn>
            <Btn variant="quiet" onClick={() => save({ onboarding: { completedAt: null, skippedAt: null, stage: null } }, 'The glasses will show the welcome tour next time HELM opens.')} testId="pref-replay-onboarding">Replay glasses tour</Btn>
          </div>
        </div>
      </div>
      {msg && <p role="status" className={`mt-4 text-sm ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
      <p className="mt-3 text-xs text-graphite-500">Presentation only. Order limits, leverage caps and stop rules are in Shield and never change here.</p>
    </Card>
  )
}
