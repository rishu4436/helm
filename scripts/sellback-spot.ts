/** Sell back a filled demo SPOT buy (exact net quantity, rounded down to 5 dp) through HELM's own preview → confirm.
 *  Demo/sandbox accounts only. Usage: pnpm tsx scripts/sellback-spot.ts <orderId> */
import { randomBytes } from 'node:crypto'
import { demoSession } from './demo-session'
const id = process.argv[2]; if (!id) throw new Error('usage: sellback-spot.ts <orderId>')
const s = await demoSession()
const o = await s.prisma.order.findUniqueOrThrow({ where: { id } })
if (o.environment !== 'demo' || o.side !== 'BUY' || !o.instrumentId.includes('spot')) throw new Error(`refusing: ${o.environment} ${o.side} ${o.instrumentId}`)
const fills = await s.prisma.fill.findMany({ where: { orderId: id } })
const base = o.instrumentId.split(':').at(-1)!.split('-')[0]!
const feeBase = fills.filter(f => f.feeAsset === base).reduce((a, f) => a + Number(f.fee ?? 0), 0)
const net = Number(o.filledQuantity) - feeBase
const qty = (Math.floor(net * 1e5) / 1e5).toFixed(5)
console.log(`order ${o.instrumentId} filled ${o.filledQuantity} fee(${base}) ${feeBase} → sell ${qty}`)
const p = await s.call('POST', '/v1/trade/preview', { accountId: o.accountId, asset: base, product: 'spot', side: 'SELL', quantity: qty })
console.log('preview', p.status, p.body.decision ?? p.body.error?.code)
if (p.status !== 200 || !p.body.canConfirm) { await s.close(); process.exit(1) }
const c = await s.call('POST', '/v1/trade/confirm', { proposalId: p.body.proposalId, confirmToken: p.body.confirmToken, idempotencyKey: `sellback-${randomBytes(8).toString('hex')}`, via: 'companion' })
console.log('confirm', c.status, c.body.receipt?.status, c.body.receipt?.filledQuantity ?? '')
await s.close()
