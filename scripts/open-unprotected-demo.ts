/** Opens a small Binance Demo USDⓈ-M BTC long WITHOUT a stop (via HELM preview → confirm) so the glasses
 *  "Protect positions" recovery flow has something real to protect. Demo endpoint only; prints no secrets. */
import { randomBytes } from 'node:crypto'
import { demoSession } from './demo-session'
const s = await demoSession()
const alias = process.argv[2] ?? 'Binance Demo · USDⓈ-M'
const id = ((await s.call('GET', '/v1/accounts')).body.accounts as Array<{ id: string; alias: string }>).find(a => a.alias === alias)!.id
const p = await s.call('POST', '/v1/trade/preview', { accountId: id, asset: 'BTC', product: 'perp', side: 'BUY', notional: '150', leverage: '2' })
if (!p.body.canConfirm) { console.log('preview refused', p.status, p.body.error?.code); process.exit(1) }
const c = await s.call('POST', '/v1/trade/confirm', { proposalId: p.body.proposalId, confirmToken: p.body.confirmToken, idempotencyKey: `unprot-${randomBytes(8).toString('hex')}`, via: 'companion' })
const r = c.body.receipt
console.log(`${alias}: ${r?.status} ${r?.side} ${r?.filledQuantity} @ ${r?.avgFillPrice} protection=${r?.protection?.state ?? 'none'}`)
await s.close()
