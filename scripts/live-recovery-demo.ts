/**
 * REAL demo run of Trade-to-Protect RECOVERY and spot-stop cleanup via the HELM API (in-process, helm_dev):
 *  Perps (Bybit Demo linear + Binance Demo USDⓈ-M): open a small long WITHOUT a stop → Compass lists it UNPROTECTED →
 *  /v1/protection/preview (reduce-only STOP_MARKET for the whole position) → confirm → PROTECTED only once the venue
 *  lists it → second preview refused ALREADY_PROTECTED → reduce-only full close cancels the stop → flat.
 *  Spot (Bybit Demo): buy a small SOL holding with a 3% stop → "sell all" preview itemizes the stop → confirm →
 *  stop canceled BEFORE the sale → no resting SOL stop left.
 * Demo endpoints only. Keys come from .env and are never printed; evidence is checked for key material before writing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { demoSession } from './demo-session'
const s = await demoSession()
type Row = { step: string; result: 'PASS' | 'FAIL'; detail: unknown }
const rows: Row[] = []
const rec = (step: string, ok: boolean, detail: unknown) => { rows.push({ step, result: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 400)}`}`) }
const accts = (await s.call('GET', '/v1/accounts')).body.accounts as Array<{ id: string; alias: string }>
const idem = () => `recov-${randomBytes(8).toString('hex')}`
const confirm = async (p: any) => { const c = await s.call('POST', '/v1/trade/confirm', { proposalId: p.proposalId, confirmToken: p.confirmToken, idempotencyKey: idem(), via: 'glasses' }); return c.body.receipt ?? c.body }
async function trade(t: Record<string, unknown>) {
  const p = await s.call('POST', '/v1/trade/preview', t)
  if (p.status !== 200 || !p.body.canConfirm) return { p: p.body, r: null as any }
  return { p: p.body, r: await confirm(p.body) }
}
const brief = (r: any) => r && ({ status: r.status, side: r.side, type: r.type, qty: r.filledQuantity ?? r.quantity, avg: r.avgFillPrice, providerOrderId: r.providerOrderId ? `…${String(r.providerOrderId).slice(-6)}` : null, protection: r.protection && { state: r.protection.state, stopPrice: r.protection.stopPrice, qty: r.protection.protectedQuantity, providerOrderId: r.protection.providerOrderId ? `…${String(r.protection.providerOrderId).slice(-6)}` : null }, orphanCleanup: r.orphanCleanup, error: r.error })
const unprotected = async () => (await s.call('GET', '/v1/shield/compass')).body.compass.unprotected as Array<{ accountId: string; instrumentId: string }>

for (const alias of ['Bybit Demo · Unified', 'Binance Demo · USDⓈ-M']) {
  const id = accts.find(a => a.alias === alias)!.id
  const inst = alias.startsWith('Bybit') ? 'bybit:perp:BTC-USDT:USDT' : 'binance:perp:BTC-USDT:USDT'
  const e = await trade({ accountId: id, asset: 'BTC', product: 'perp', side: 'BUY', notional: '250', leverage: '2' })
  rec(`${alias}: entry WITHOUT a stop FILLED (no protection attached)`, e.r?.status === 'FILLED' && !e.r?.protection, brief(e.r) ?? e.p)
  if (e.r?.status !== 'FILLED') continue
  const u0 = (await unprotected()).filter(u => u.accountId === id && u.instrumentId === inst)
  rec(`${alias}: Compass lists the position as UNPROTECTED`, u0.length === 1, u0)
  const pv = await s.call('POST', '/v1/protection/preview', { accountId: id, instrumentId: inst, stopOffsetPercent: '3' })
  const o = pv.body.order ?? {}
  rec(`${alias}: recovery preview = reduce-only STOP_MARKET SELL for the full position, stop below mark`, pv.status === 200 && pv.body.kind === 'protect_existing' && o.type === 'STOP_MARKET' && o.side === 'SELL' && o.reduceOnly === true && o.quantity === e.r.filledQuantity && Number(o.stopPrice) < Number(pv.body.preview.recovery.referencePrice) && pv.body.canConfirm,
    { status: pv.status, kind: pv.body.kind, order: o, recovery: pv.body.preview?.recovery, risk: pv.body.risk?.verdict, notes: pv.body.preview?.estimateNotes, code: pv.body.error?.code })
  if (!pv.body.canConfirm) continue
  const r = await confirm(pv.body)
  rec(`${alias}: stop accepted and LISTED by the venue → PROTECTED`, ['NEW', 'ACCEPTED', 'OPEN'].includes(r.status) && r.protection?.state === 'PROTECTED', brief(r))
  const em = (await s.call('GET', '/v1/emergency')).body.items.filter((i: any) => i.instrumentId === inst)
  rec(`${alias}: venue open orders show the reduce-only stop`, em.some((i: any) => i.kind === 'CANCEL_ORDER'), em.map((i: any) => ({ kind: i.kind, detail: i.detail })))
  const u1 = (await unprotected()).filter(u => u.accountId === id && u.instrumentId === inst)
  rec(`${alias}: Compass no longer lists it as unprotected`, u1.length === 0, u1)
  const again = await s.call('POST', '/v1/protection/preview', { accountId: id, instrumentId: inst, stopOffsetPercent: '3' })
  rec(`${alias}: second recovery preview refused ALREADY_PROTECTED (no duplicate stop)`, again.status === 409 && again.body.error?.code === 'ALREADY_PROTECTED', { status: again.status, code: again.body.error?.code, message: again.body.error?.message })
  const f = await trade({ accountId: id, asset: 'BTC', product: 'perp', side: 'SELL', fraction: '1', reduceOnly: true })
  rec(`${alias}: reduce-only full close FILLED → recovery stop CANCELED at venue`, f.r?.status === 'FILLED' && f.r.orphanCleanup?.length === 1 && f.r.orphanCleanup[0].result === 'CANCELED', { willCancel: f.p.preview?.willCancel, ...brief(f.r) })
  const left = (await s.call('GET', '/v1/emergency')).body.items.filter((i: any) => i.instrumentId === inst)
  rec(`${alias}: venue shows no position and no protective order`, left.length === 0, left)
  const plan = await s.prisma.protectionPlan.findFirst({ where: { accountId: id, source: 'recovery' }, orderBy: { updatedAt: 'desc' } })
  rec(`${alias}: recovery plan (source=recovery, no entry order) ended CANCELED`, plan?.state === 'CANCELED' && plan.entryOrderId === null, { state: plan?.state, source: plan?.source, history: (plan?.history as any[] | undefined)?.map(h => h.to) })
}

// Spot: Bybit Demo, SOL (the demo account holds none, so "sell all" sells only what this run bought)
{
  const id = accts.find(a => a.alias === 'Bybit Demo · Unified')!.id
  const inst = 'bybit:spot:SOL-USDT'
  const b = await trade({ accountId: id, asset: 'SOL', product: 'spot', side: 'BUY', notional: '25', stopOffsetPercent: '3' })
  rec('Bybit Demo spot: buy SOL with a 3% stop → FILLED + PROTECTED', b.r?.status === 'FILLED' && b.r?.protection?.state === 'PROTECTED', brief(b.r) ?? b.p)
  if (b.r?.status === 'FILLED') {
    const sa = await trade({ accountId: id, asset: 'SOL', product: 'spot', side: 'SELL', fraction: '1' })
    rec('Bybit Demo spot: "sell all" preview itemizes the spot stop it will cancel first', (sa.p.preview?.willCancel ?? []).length >= 1 && (sa.p.preview?.estimateNotes ?? []).some((n: string) => /first cancels/.test(n)), { willCancel: sa.p.preview?.willCancel, notes: sa.p.preview?.estimateNotes, order: sa.p.order, code: sa.p.error?.code, risk: sa.p.risk?.findings })
    rec('Bybit Demo spot: sale FILLED after the stop was released', sa.r?.status === 'FILLED' && (sa.r.orphanCleanup ?? []).some((x: any) => x.result === 'CANCELED'), brief(sa.r))
    const left = (await s.call('GET', '/v1/emergency')).body.items.filter((i: any) => i.instrumentId === inst)
    rec('Bybit Demo spot: no resting SOL stop left at the venue', left.length === 0, left)
    const plan = await s.prisma.protectionPlan.findFirst({ where: { accountId: id, instrumentId: inst }, orderBy: { updatedAt: 'desc' } })
    rec('Bybit Demo spot: protection plan ended CANCELED', plan?.state === 'CANCELED', { state: plan?.state, history: (plan?.history as any[] | undefined)?.map(h => h.to) })
  }
}

const out = JSON.stringify({ ranAt: new Date().toISOString(), what: 'Trade-to-Protect recovery (perps) + spot stop cleanup on sale — real Bybit Demo + Binance Demo', rows }, null, 2)
for (const v of [process.env.BYBIT_DEMO_API_KEY, process.env.BYBIT_DEMO_API_SECRET, process.env.BINANCE_DEMO_API_KEY, process.env.BINANCE_DEMO_API_SECRET]) if (v && out.includes(v)) { console.error('REDACTION FAILURE'); process.exit(3) }
mkdirSync('evidence/protection-recovery', { recursive: true })
const file = `evidence/protection-recovery/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, out)
console.log(`\n${rows.filter(r => r.result === 'PASS').length}/${rows.length} PASS → ${file}`)
await s.close()
