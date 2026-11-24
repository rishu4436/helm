/**
 * END-TO-END through the HELM API (preview → confirm → submit → reconcile → receipt → Trade-to-Protect)
 * against the REAL Bybit Demo and Binance Demo accounts wired by wire-demo-accounts.ts.
 * Evidence is redacted (no keys; HTTP bodies only from HELM's own API). Usage: pnpm tsx scripts/live-engine-demo.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { demoSession } from './demo-session'

const s = await demoSession()
type Row = { step: string; result: 'PASS' | 'FAIL' | 'BLOCKED'; detail: unknown }
const rows: Row[] = []
const rec = (step: string, ok: boolean, detail: unknown) => { rows.push({ step, result: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ` — ${JSON.stringify(detail).slice(0, 300)}`}`) }
const key = () => `live-${randomBytes(8).toString('hex')}`
const brief = (r: any) => r && ({ orderId: r.orderId, account: r.account, env: r.environmentLabel, label: r.label, instrument: r.instrumentId, side: r.side, type: r.type, status: r.status, providerOrderId: r.providerOrderId, filled: r.filledQuantity, avg: r.avgFillPrice, fills: r.fills, protection: r.protection && { state: r.protection.state, stopPrice: r.protection.stopPrice, qty: r.protection.protectedQuantity, history: r.protection.history }, events: r.events?.map((e: any) => `${e.from ?? '∅'}→${e.to} (${e.actor}${e.reason ? `: ${e.reason}` : ''})`), fillTruth: r.fillTruth })

const accts = (await s.call('GET', '/v1/accounts')).body.accounts as Array<{ id: string; alias: string; provider: string; environment: string; state: string; canTrade: boolean }>
rec('accounts listed (Binance Demo + Bybit Demo real; OKX BLOCKED region)', accts.some(a => a.alias.startsWith('Bybit Demo')) && accts.some(a => a.alias.startsWith('Binance Demo')), accts.map(a => `${a.alias} ${a.environment} ${a.state} canTrade=${a.canTrade}`))
rows.push({ step: 'OKX Demo logged-in tests', result: 'BLOCKED', detail: 'OKX unavailable in the user’s region (India); adapter covered by mocks + public endpoints' })
// Demo accounts are pre-funded far above HELM's conservative defaults (demo BTC alone ≈ $97k), so the default
// $15k per-asset cap correctly BLOCKs every BTC buy (recorded in run-…08-19-48). The user raises the exposure caps for
// the demo profile through the normal Shield API; per-order caps (spot $1000, futures $2000, 5x) stay at defaults.
const pol = await s.call('GET', '/v1/shield/policy')
if (pol.body.version === 0) {
  const put = await s.call('PUT', '/v1/shield/policy', { ...pol.body.policy, maxAssetExposureUsd: '400000', maxExchangeExposurePct: '100' })
  rec('Shield policy v1 for demo funds (asset cap 400k, venue concentration 100%; per-order caps unchanged)', put.status === 200, put.body)
} else rows.push({ step: 'Shield policy', result: 'PASS', detail: { version: pol.body.version, policy: pol.body.policy } })
const byA = (alias: string) => accts.find(a => a.alias === alias)!.id

const pf = await s.call('GET', '/v1/portfolio')
rec('portfolio aggregates real demo balances across venues', pf.status === 200 && Number(pf.body.portfolio.netLiquidationUsd) > 0, { netLiquidationUsd: pf.body.portfolio?.netLiquidationUsd, accounts: pf.body.portfolio?.accounts?.map((a: any) => `${a.alias}: ${a.valueUsd}`), unvalued: pf.body.portfolio?.unvaluedAssets, errors: pf.body.accountErrors })

async function trade(label: string, ticket: Record<string, unknown>, expectStatus = 'FILLED') {
  const p = await s.call('POST', '/v1/trade/preview', ticket)
  if (p.status !== 200 || !p.body.canConfirm) { rec(`${label}: preview`, false, { status: p.status, err: p.body.error, risk: p.body.risk }); return null }
  rec(`${label}: preview (risk ${p.body.risk.verdict}, est ${p.body.preview.estimatedPrice}, expires ${p.body.expiresAt})`, true, { order: p.body.order, est: { price: p.body.preview.estimatedPrice, notional: p.body.preview.estimatedNotional, fee: p.body.preview.estimatedFee, slippageBps: p.body.preview.estimatedSlippageBps, notes: p.body.preview.estimateNotes }, risk: p.body.risk, protection: p.body.preview.protection })
  const k = key()
  const c = await s.call('POST', '/v1/trade/confirm', { proposalId: p.body.proposalId, confirmToken: p.body.confirmToken, idempotencyKey: k, via: 'glasses' })
  const r = c.body.receipt
  rec(`${label}: confirm → ${r?.status ?? c.status}`, c.status === 200 && r?.status === expectStatus, c.status === 200 ? brief(r) : c.body)
  return c.status === 200 ? { r, p: p.body, k } : null
}

// ---- Bybit spot round trip ----
const bySpot = await trade('Bybit spot BUY $15 BTC', { accountId: byA('Bybit Demo · Unified'), asset: 'BTC', product: 'spot', side: 'BUY', notional: '15' })
if (bySpot) {
  const again = await s.call('POST', '/v1/trade/confirm', { proposalId: bySpot.p.proposalId, confirmToken: bySpot.p.confirmToken, idempotencyKey: bySpot.k, via: 'glasses' })
  rec('Bybit idempotent replay returns the same order (no second submission)', again.status === 200 && again.body.replayed === true && again.body.receipt.orderId === bySpot.r.orderId, { replayed: again.body.replayed, orderId: again.body.receipt?.orderId })
  const reuse = await s.call('POST', '/v1/trade/confirm', { proposalId: bySpot.p.proposalId, confirmToken: bySpot.p.confirmToken, idempotencyKey: key(), via: 'glasses' })
  rec('used confirmation token cannot submit again', reuse.status === 409, reuse.body.error)
  const fee = (bySpot.r.fills as Array<{ fee: string | null; feeAsset: string | null }>).filter(f => f.feeAsset === 'BTC').reduce((a, f) => a + Number(f.fee ?? 0), 0)
  const q = Math.floor((Number(bySpot.r.filledQuantity) - fee) * 1e6) / 1e6
  await trade('Bybit spot SELL back', { accountId: byA('Bybit Demo · Unified'), asset: 'BTC', product: 'spot', side: 'SELL', quantity: q.toFixed(6) })
}

// ---- Bybit linear with Trade-to-Protect ----
const t2p = await trade('Bybit linear BUY $150 BTC 2x + 3% Trade-to-Protect', { accountId: byA('Bybit Demo · Unified'), asset: 'BTC', product: 'perp', side: 'BUY', notional: '150', leverage: '2', stopOffsetPercent: '3' })
if (t2p) {
  rec('T2P: protection PROTECTED (venue lists the stop), qty = actual fill', t2p.r.protection?.state === 'PROTECTED' && t2p.r.protection.protectedQuantity === t2p.r.filledQuantity, t2p.r.protection)
  const comp = await s.call('GET', '/v1/shield/compass')
  rec('Compass does not list the protected BTC perp as unprotected', comp.status === 200 && !comp.body.compass.unprotected.some((u: any) => u.instrumentId.startsWith('bybit:perp:BTC')), comp.body.compass?.unprotected)
  const stop = await s.prisma.order.findFirst({ where: { protectionPlanId: { not: null }, type: 'STOP_MARKET', accountId: byA('Bybit Demo · Unified') }, orderBy: { createdAt: 'desc' } })
  const cx = await s.call('POST', `/v1/orders/${stop!.id}/cancel`, { confirm: true })
  rec('cancel the protective stop (explicit confirm) → CANCELED at venue', cx.status === 200 && cx.body.receipt.status === 'CANCELED', brief(cx.body.receipt))
  const plan = await s.prisma.protectionPlan.findFirst({ where: { protectionOrderId: stop!.id } })
  rec('protection state honestly flips to UNPROTECTED after stop cancel', plan?.state === 'UNPROTECTED', plan?.state)
  await trade('Bybit linear reduce-only close', { accountId: byA('Bybit Demo · Unified'), asset: 'BTC', product: 'perp', side: 'SELL', quantity: t2p.r.filledQuantity, reduceOnly: true })
}

// ---- Binance spot round trip ----
const bnSpot = await trade('Binance spot BUY $15 BTC', { accountId: byA('Binance Demo · Spot'), asset: 'BTC', product: 'spot', side: 'BUY', notional: '15' })
if (bnSpot) {
  const fee = (bnSpot.r.fills as Array<{ fee: string | null; feeAsset: string | null }>).filter(f => f.feeAsset === 'BTC').reduce((a, f) => a + Number(f.fee ?? 0), 0)
  const q = Math.floor((Number(bnSpot.r.filledQuantity) - fee) * 1e5) / 1e5
  await trade('Binance spot SELL back', { accountId: byA('Binance Demo · Spot'), asset: 'BTC', product: 'spot', side: 'SELL', quantity: q.toFixed(5) })
}
// ---- Binance USDⓈ-M with Trade-to-Protect ----
const bnT2p = await trade('Binance USDⓈ-M BUY $150 BTC 2x + 3% Trade-to-Protect', { accountId: byA('Binance Demo · USDⓈ-M'), asset: 'BTC', product: 'perp', side: 'BUY', notional: '150', leverage: '2', stopOffsetPercent: '3' })
if (bnT2p) {
  rec('Binance T2P: PROTECTED via Algo Order API', bnT2p.r.protection?.state === 'PROTECTED', bnT2p.r.protection)
  const stop = await s.prisma.order.findFirst({ where: { type: 'STOP_MARKET', accountId: byA('Binance Demo · USDⓈ-M'), protectionPlanId: bnT2p.r.protection ? { not: null } : undefined, createdAt: { gt: new Date(Date.now() - 120_000) } }, orderBy: { createdAt: 'desc' } })
  if (stop) {
    const cx = await s.call('POST', `/v1/orders/${stop.id}/cancel`, { confirm: true })
    rec('Binance stop cancel → CANCELED', cx.status === 200 && cx.body.receipt.status === 'CANCELED', brief(cx.body.receipt))
  } else rec('Binance stop cancel', false, 'no protective stop order was created')
  await trade('Binance USDⓈ-M reduce-only close (fraction 1 of NET position)', { accountId: byA('Binance Demo · USDⓈ-M'), asset: 'BTC', product: 'perp', side: 'SELL', fraction: '1', reduceOnly: true })
}

// ---- Shield block on real data + voice clarification ----
const big = await s.call('POST', '/v1/trade/preview', { accountId: byA('Bybit Demo · Unified'), asset: 'BTC', product: 'spot', side: 'BUY', notional: '5000' })
rec('Shield BLOCKs $5000 spot (> max 1000), no confirm token issued', big.status === 200 && big.body.risk.verdict === 'BLOCK' && big.body.confirmToken === null, big.body.risk?.findings?.filter((f: any) => f.verdict === 'BLOCK'))
const v = await s.call('POST', '/v1/voice/command', { transcript: 'Buy 100 dollars of BTC' })
rec('voice: ambiguous buy asks "Which exchange?"', v.body.next?.screen === 'clarify_account', { next: v.body.next, options: v.body.resolution?.options?.map((o: any) => o.alias) })
const pulse = await s.call('GET', '/v1/pulse')
rec('Pulse has ranked real events (fills, protection)', pulse.body.events?.length > 0, pulse.body.events?.slice(0, 8).map((e: any) => `${e.kind} s${e.severity}: ${e.reason}`))

const out = JSON.stringify({ ranAt: new Date().toISOString(), what: 'HELM API end-to-end on real Binance Demo + Bybit Demo accounts', rows }, null, 2)
for (const v of [process.env.BYBIT_DEMO_API_KEY, process.env.BYBIT_DEMO_API_SECRET, process.env.BINANCE_DEMO_API_KEY, process.env.BINANCE_DEMO_API_SECRET]) if (v && out.includes(v)) { console.error('REDACTION FAILURE'); process.exit(3) }
mkdirSync('evidence/engine-e2e', { recursive: true })
const file = `evidence/engine-e2e/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, out)
const sum = { PASS: 0, FAIL: 0, BLOCKED: 0 }; for (const r of rows) sum[r.result]++
console.log(`\n${JSON.stringify(sum)} → ${file}`)
await s.close()
