/**
 * REAL demo run of orphan cleanup on Bybit Demo and Binance Demo USDⓈ-M via the HELM API:
 * open long + Trade-to-Protect → partial reduce-only close (stop stays) → full close (stop canceled at venue,
 * plan CANCELED) → venue shows no position and no protective order. Redacted evidence.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { demoSession } from './demo-session'
const s = await demoSession()
type Row = { step: string; result: 'PASS' | 'FAIL'; detail: unknown }
const rows: Row[] = []
const rec = (step: string, ok: boolean, detail: unknown) => { rows.push({ step, result: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 300)}`}`) }
const accts = (await s.call('GET', '/v1/accounts')).body.accounts as Array<{ id: string; alias: string }>
async function trade(t: Record<string, unknown>) {
  const p = await s.call('POST', '/v1/trade/preview', t)
  if (p.status !== 200 || !p.body.canConfirm) return { p: p.body, r: null }
  const c = await s.call('POST', '/v1/trade/confirm', { proposalId: p.body.proposalId, confirmToken: p.body.confirmToken, idempotencyKey: `orph-${randomBytes(8).toString('hex')}`, via: 'glasses' })
  return { p: p.body, r: c.body.receipt ?? c.body }
}
for (const alias of ['Bybit Demo · Unified', 'Binance Demo · USDⓈ-M']) {
  const id = accts.find(a => a.alias === alias)!.id
  const inst = alias.startsWith('Bybit') ? 'bybit:perp:BTC-USDT:USDT' : 'binance:perp:BTC-USDT:USDT'
  const e = await trade({ accountId: id, asset: 'BTC', product: 'perp', side: 'BUY', notional: '250', leverage: '2', stopOffsetPercent: '3' })
  rec(`${alias}: entry FILLED + PROTECTED`, e.r?.status === 'FILLED' && e.r?.protection?.state === 'PROTECTED', { status: e.r?.status, filled: e.r?.filledQuantity, avg: e.r?.avgFillPrice, protection: e.r?.protection && { state: e.r.protection.state, stop: e.r.protection.stopPrice, qty: e.r.protection.protectedQuantity }, risk: e.p?.risk?.verdict })
  if (e.r?.status !== 'FILLED') continue
  const h = await trade({ accountId: id, asset: 'BTC', product: 'perp', side: 'SELL', fraction: '0.5', reduceOnly: true })
  const emH = await s.call('GET', '/v1/emergency')
  const stopsAfterHalf = emH.body.items.filter((i: any) => i.instrumentId === inst && i.kind === 'CANCEL_ORDER')
  rec(`${alias}: partial close FILLED, preview promised no cancel, stop still live at venue`, h.r?.status === 'FILLED' && (h.p.preview.willCancel ?? []).length === 0 && h.r.orphanCleanup === null && stopsAfterHalf.length === 1, { status: h.r?.status, qty: h.r?.filledQuantity, willCancel: h.p.preview?.willCancel, venueStops: stopsAfterHalf.map((x: any) => x.detail) })
  const f = await trade({ accountId: id, asset: 'BTC', product: 'perp', side: 'SELL', fraction: '1', reduceOnly: true })
  rec(`${alias}: full-close preview itemizes the orphan to cancel`, (f.p.preview?.willCancel ?? []).length === 1, f.p.preview?.willCancel)
  rec(`${alias}: full close FILLED → orphan stop CANCELED at venue`, f.r?.status === 'FILLED' && f.r.orphanCleanup?.length === 1 && f.r.orphanCleanup[0].result === 'CANCELED', { status: f.r?.status, qty: f.r?.filledQuantity, orphanCleanup: f.r?.orphanCleanup })
  const em = await s.call('GET', '/v1/emergency')
  const left = em.body.items.filter((i: any) => i.instrumentId === inst)
  rec(`${alias}: venue shows no position and no protective order`, left.length === 0, left)
  const plan = await s.prisma.protectionPlan.findFirst({ where: { accountId: id }, orderBy: { updatedAt: 'desc' } })
  rec(`${alias}: protection plan CANCELED (position closed)`, plan?.state === 'CANCELED', plan?.state)
}
const out = JSON.stringify({ ranAt: new Date().toISOString(), what: 'Orphaned protective order cleanup on real Bybit Demo + Binance Demo', rows }, null, 2)
for (const v of [process.env.BYBIT_DEMO_API_KEY, process.env.BYBIT_DEMO_API_SECRET, process.env.BINANCE_DEMO_API_KEY, process.env.BINANCE_DEMO_API_SECRET]) if (v && out.includes(v)) { console.error('REDACTION FAILURE'); process.exit(3) }
mkdirSync('evidence/orphan-cleanup', { recursive: true })
const file = `evidence/orphan-cleanup/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, out)
console.log(`\n${rows.filter(r => r.result === 'PASS').length}/${rows.length} PASS → ${file}`)
await s.close()
