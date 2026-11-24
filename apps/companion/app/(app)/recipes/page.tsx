'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { signedUsd, sym, tone, usd } from '@/lib/format'
import type { MultiScenario, PreviewResp, Recipe } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, Field, Modal, PageHeader, Pill, Skeleton } from '../../ui'
import { PreviewPanel } from '../../trade-flow'
import { useShell } from '../../shell'

type Step = { index: number; type: string; label: string | null; status: string; check?: string; result?: Record<string, unknown> & Partial<MultiScenario>; preview?: PreviewResp; question?: string; options?: Array<{ id: string; alias: string }>; message?: string; missing?: string[]; error?: { message?: string; code?: string }; account?: { alias: string }; draft?: Record<string, unknown> }
const TEMPLATE = JSON.stringify({ description: 'Buy a little ETH on spot, then stress-test.', params: { amount: { label: 'Amount (USD)', kind: 'amount', default: '25' }, account: { label: 'Account', kind: 'account' } }, steps: [{ type: 'trade', product: 'spot', asset: 'ETH', side: 'BUY', notional: '{{amount}}' }, { type: 'scenario', preset: 'eth-underperform' }] }, null, 2)

function StepView({ s, onDiscard, onChoose }: { s: Step; onDiscard: () => void; onChoose: (accountId: string) => void }) {
  const r = s.result
  return (
    <div className="rounded-xl border border-graphite-800 p-4" data-testid={`step-${s.index}`}>
      <div className="mb-2 flex items-center gap-2 text-sm"><span className="num text-xs text-graphite-500">{String(s.index + 1).padStart(2, '0')}</span><span className="font-medium">{s.label ?? (s.type === 'check' ? `Check: ${s.check}` : s.type === 'trade' ? 'Trade' : 'Scenario')}</span><Pill v={s.status} /></div>
      {s.type === 'check' && r && (
        s.check === 'unprotected' ? ((r.unprotected as unknown[]).length ? <ul className="text-sm">{(r.unprotected as Array<{ instrumentId: string; side: string }>).map(u => <li key={u.instrumentId}>• {sym(u.instrumentId).label} {u.side} — no venue-listed stop</li>)}</ul> : <p className="text-sm text-up">Every perp position has a venue-listed stop.</p>)
        : s.check === 'policy' ? <p className="text-sm text-graphite-300">Shield policy v{String(r.version)} will check the trade.</p>
        : s.check === 'exposure' ? <p className="text-sm text-graphite-300">Net liquidation {usd(r.netLiquidationUsd as string, 0)} · {(r.rose as Array<{ asset: string; sharePct: string }>).map(x => `${x.asset} ${Number(x.sharePct).toFixed(0)}%`).join(' · ')}{(r.nearRisk as unknown[]).length ? ` · ${(r.nearRisk as unknown[]).length} near liquidation` : ''}</p>
        : <p className="text-sm text-graphite-300">{String(r.openPositions)} open positions · {String(r.openOrders)} working orders. {String(r.note)}</p>
      )}
      {s.type === 'scenario' && r && <p className="text-sm">{r.name ?? 'Scenario'}: <span className={`num ${tone(r.totalPnlUsd)}`}>{signedUsd(r.totalPnlUsd)}</span> linear · <span className={`num ${tone(r.totalPnlWithStopsUsd)}`}>{signedUsd(r.totalPnlWithStopsUsd)}</span> with stops · {r.liquidationBreaches?.length ?? 0} liquidation breach(es)</p>}
      {s.status === 'needs_account' && <div><p className="mb-2 text-sm">{s.question}</p><div className="flex flex-wrap gap-2">{s.options?.map(o => <Btn key={o.id} onClick={() => onChoose(o.id)}>{o.alias}</Btn>)}</div></div>}
      {(s.status === 'no_account' || s.status === 'error') && <p className="text-sm text-down">{s.message ?? s.error?.message ?? s.error?.code}</p>}
      {s.status === 'needs_params' && <p className="text-sm text-amber-helm">Missing: {s.missing?.join(', ')}</p>}
      {s.preview && <PreviewPanel preview={s.preview as never} onDiscard={onDiscard} testId={`step-${s.index}-preview`} />}
    </div>
  )
}

function Recipes() {
  const q = useSearchParams()
  const { accounts } = useShell()
  const rs = useApi<{ builtins: Recipe[]; recipes: Recipe[] }>('/v1/recipes')
  const [sel, setSel] = useState<Recipe | null>(null)
  const [params, setParams] = useState<Record<string, string>>({})
  const [run, setRun] = useState<{ steps: Step[]; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  const [edit, setEdit] = useState<{ id?: string; name: string; json: string; enabled: boolean } | null>(null)
  const [editErr, setEditErr] = useState<string | null>(null)
  const all = [...(rs.data?.builtins ?? []), ...(rs.data?.recipes ?? [])]
  function pick(r: Recipe) { setSel(r); setRun(null); setErr(null); setParams(Object.fromEntries(Object.entries(r.definition.params ?? {}).map(([k, p]) => [k, p.default ?? '']))) }
  async function go(r = sel, p = params) {
    if (!r) return
    setBusy(true); setErr(null); setRun(null)
    try { setRun(await api(`/v1/recipes/${encodeURIComponent(r.id)}/run`, { method: 'POST', body: { params: Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '')) } })) } catch (e) { setErr(e as ApiError) } finally { setBusy(false) }
  }
  useEffect(() => { const id = q.get('run'); const r = id && all.find(x => x.id === id); if (r && sel?.id !== r.id) { pick(r); go(r, Object.fromEntries(Object.entries(r.definition.params ?? {}).map(([k, p]) => [k, p.default ?? '']))) } }, [q, rs.data]) // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!edit) return
    setEditErr(null)
    let definition: unknown
    try { definition = JSON.parse(edit.json) } catch { setEditErr('Definition is not valid JSON'); return }
    try {
      const saved = await api<Recipe>(edit.id ? `/v1/recipes/${edit.id}` : '/v1/recipes', { method: edit.id ? 'PUT' : 'POST', body: { name: edit.name, definition, enabled: edit.enabled } })
      setEdit(null); await rs.reload(); pick({ ...saved, builtin: false })
    } catch (e) { setEditErr(e instanceof ApiError ? `${e.message}${e.reasons.length ? ' — ' + e.reasons.join('; ') : ''}` : 'Save failed') }
  }
  async function remove(r: Recipe) { await api(`/v1/recipes/${r.id}`, { method: 'DELETE' }); setSel(null); setRun(null); await rs.reload() }
  return (
    <div>
      <PageHeader kicker="RECIPES" title="Repeatable routines, never autopilot" subtitle="A recipe is a saved checklist: safety checks, stress scenarios and trade drafts. Running it previews every trade with its own 45 s token — you still confirm each one." actions={<Btn variant="amber" onClick={() => { setEditErr(null); setEdit({ name: 'My recipe', json: TEMPLATE, enabled: true }) }} testId="new-recipe">New recipe</Btn>} />
      <ErrorNote error={rs.error} onRetry={rs.reload} />
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-2">
          {!rs.data ? <Skeleton h="h-64" /> : all.map(r => (
            <button key={r.id} onClick={() => pick(r)} data-testid={`recipe-${r.id}`} className={`card w-full p-4 text-left ${sel?.id === r.id ? 'border-amber-helm' : 'hover:border-graphite-700'}`}>
              <div className="flex items-center gap-2"><span className="font-medium">{r.name}</span><span className="ml-auto text-[10px] tracking-wider text-graphite-500 uppercase">{r.builtin ? 'built-in' : `v${r.version}${r.enabled ? '' : ' · off'}`}</span></div>
              <p className="mt-1 text-xs text-graphite-500">{r.definition.description ?? `${r.definition.steps.length} steps`}</p>
              <div className="mt-2 flex flex-wrap gap-1">{r.definition.steps.map((s, i) => <span key={i} className="rounded bg-graphite-800 px-1.5 py-0.5 text-[10px] text-graphite-300">{s.type === 'check' ? String(s.check) : s.type === 'scenario' ? String(s.preset ?? 'scenario') : `${String(s.side)} ${String(s.asset)}`}</span>)}</div>
            </button>
          ))}
        </div>
        <div>
          {!sel ? <Empty title="Pick a recipe" hint="Built-ins cover protected entries, trimming, spot buys and pre-sleep checks." /> : (
            <Card title={sel.name} action={!sel.builtin && <><Btn variant="quiet" onClick={() => { setEditErr(null); setEdit({ id: sel.id, name: sel.name, json: JSON.stringify(sel.definition, null, 2), enabled: sel.enabled }) }}>Edit</Btn><Btn variant="quiet" danger onClick={() => remove(sel)}>Delete</Btn></>}>
              {Object.keys(sel.definition.params ?? {}).length > 0 && (
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  {Object.entries(sel.definition.params ?? {}).map(([k, p]) => (
                    <Field key={k} label={p.label}>{p.kind === 'account'
                      ? <select className="input" value={params[k] ?? ''} onChange={e => setParams({ ...params, [k]: e.target.value })} data-testid={`param-${k}`}><option value="">Ask me (Which exchange?)</option>{accounts.filter(a => a.canTrade).map(a => <option key={a.id} value={a.id}>{a.alias}</option>)}</select>
                      : p.kind === 'asset' ? <select className="input" value={params[k] ?? ''} onChange={e => setParams({ ...params, [k]: e.target.value })}>{['BTC', 'ETH', 'SOL', 'BNB'].map(a => <option key={a}>{a}</option>)}</select>
                      : <input className="input num" value={params[k] ?? ''} onChange={e => setParams({ ...params, [k]: e.target.value.replace(/[^0-9.]/g, '') })} data-testid={`param-${k}`} />}</Field>
                  ))}
                </div>
              )}
              <Btn variant="amber" busy={busy} onClick={() => go()} testId="run-recipe">Run (previews only)</Btn>
              <ErrorNote error={err} />
              {run && <div className="mt-5 space-y-3" data-testid="recipe-run">{run.steps.map(s => <StepView key={s.index} s={s} onDiscard={() => setRun({ ...run, steps: run.steps.map(x => x.index === s.index ? { ...x, preview: undefined, status: 'draft' } : x) })} onChoose={id => { const p = { ...params, account: id }; setParams(p); go(sel, p) }} />)}<p className="text-xs text-graphite-500">{run.note}</p></div>}
            </Card>
          )}
        </div>
      </div>
      <Modal open={!!edit} title={edit?.id ? 'Edit recipe' : 'New recipe'} wide onClose={() => setEdit(null)}>
        {edit && <div className="space-y-3">
          <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} data-testid="recipe-name" /></Field>
          <Field label="Definition (JSON)" hint="Steps: trade {product, asset, side, notional|fraction, leverage?, stopOffsetPercent?, reduceOnly?} · scenario {preset|shocks} · check {unprotected|exposure|emergency|policy}. Use {{param}} placeholders."><textarea className="input num h-72 text-xs" value={edit.json} onChange={e => setEdit({ ...edit, json: e.target.value })} spellCheck={false} data-testid="recipe-json" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.enabled} onChange={e => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled</label>
          {editErr && <p role="alert" className="text-sm text-down">{editErr}</p>}
          <div className="flex gap-2"><Btn variant="amber" onClick={save} testId="save-recipe">Save</Btn><Btn variant="quiet" onClick={() => setEdit(null)}>Cancel</Btn></div>
        </div>}
      </Modal>
    </div>
  )
}
export default function Page() { return <Suspense><Recipes /></Suspense> }
