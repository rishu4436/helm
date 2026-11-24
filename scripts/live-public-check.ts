/**
 * Live, credential-free contract check against the real demo/sandbox endpoints.
 * Only unauthenticated public market data + the Coinbase static sandbox are touched.
 * Usage: pnpm tsx scripts/live-public-check.ts  (writes evidence/live-public-check.json)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dec } from '@helm/shared'
import { BinanceAdapter, BybitAdapter, CoinbaseSandboxAdapter, OkxAdapter } from '@helm/connectors'

const noCreds = { apiKey: 'none', apiSecret: 'none' }
type Row = { check: string; result: 'PASS' | 'FAIL'; detail: string }
const rows: Row[] = []
async function check(name: string, fn: () => Promise<string>) {
  try { rows.push({ check: name, result: 'PASS', detail: await fn() }) } catch (e) { rows.push({ check: name, result: 'FAIL', detail: e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : String(e) }) }
}
const book = (b: { bids: { price: { toFixed(): string } }[]; asks: { price: { toFixed(): string } }[]; timestamp: string }) => `bid ${b.bids[0]?.price.toFixed()} / ask ${b.asks[0]?.price.toFixed()} @ ${b.timestamp} (${b.bids.length}x${b.asks.length} levels)`

const binSpot = new BinanceAdapter(noCreds, { market: 'spot', accountId: 'public' })
const binFut = new BinanceAdapter(noCreds, { market: 'usdm', accountId: 'public' })
const okx = new OkxAdapter({ ...noCreds, passphrase: 'none' }, { accountId: 'public' })
const bybit = new BybitAdapter(noCreds, { accountId: 'public' })
const cb = new CoinbaseSandboxAdapter({ accountId: 'sandbox' })

await check('binance demo spot clock sync', async () => `offset ${await binSpot.clock.sync()} ms`)
await check('binance demo spot order book BTCUSDT', async () => book(await binSpot.getOrderBook('binance:spot:BTC-USDT', 5)))
await check('binance demo spot exchangeInfo BTCUSDT filters', async () => { const i = (await binSpot.getInstruments()).find(x => x.providerSymbol === 'BTCUSDT')!; return `lot ${i.lotSize.toFixed()} tick ${i.tickSize.toFixed()} minNotional ${i.minNotional?.toFixed()} status ${i.status}` })
await check('binance demo usdm order book BTCUSDT', async () => book(await binFut.getOrderBook('binance:perp:BTC-USDT:USDT', 5)))
await check('okx public order book BTC-USDT', async () => book(await okx.getOrderBook('okx:spot:BTC-USDT', 5)))
await check('okx public swap instruments', async () => { const i = (await okx.getInstruments('perp')).find(x => x.providerSymbol === 'BTC-USDT-SWAP')!; return `ctVal ${i.contractMultiplier.toFixed()} lot ${i.lotSize.toFixed()} tick ${i.tickSize.toFixed()}` })
await check('bybit demo clock sync', async () => `offset ${await bybit.clock.sync()} ms`)
await check('bybit demo order book linear BTCUSDT', async () => book(await bybit.getOrderBook('bybit:perp:BTC-USDT:USDT', 5)))
await check('coinbase static sandbox connect', async () => { const h = await cb.connect(); return `${h.state}: ${h.reasons.join('; ')}` })
await check('coinbase static sandbox balances', async () => (await cb.getBalances()).map(b => `${b.asset} ${b.total.toFixed()}`).join(', '))
await check('coinbase static sandbox create order (mock)', async () => {
  const o = await cb.submitOrder({ accountId: 'sandbox', instrument: { id: 'coinbase:spot:BTC-USD', provider: 'coinbase', providerSymbol: 'BTC-USD', product: 'spot', base: 'BTC', quote: 'USD', contractMultiplier: dec('1'), quantityUnit: 'base', lotSize: dec('0.00000001'), minQty: dec('0'), tickSize: dec('0.01'), venue: 'Coinbase sandbox', currency: 'USD', status: 'trading' }, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: `helm-evidence-${Date.now()}` })
  return `status ${o.status} simulatedStatic=${o.simulatedStatic} providerOrderId=${o.providerOrderId}`
})
await check('env guard blocks production signed order (no network)', async () => {
  const prod = new BinanceAdapter(noCreds, { market: 'spot', accountId: 'x', baseUrl: 'https://api.binance.com' })
  try { await prod.cancelOrder('binance:spot:BTC-USDT', { clientOrderId: 'x' }); return 'NOT BLOCKED' } catch (e) { if ((e as { code?: string }).code !== 'ENVIRONMENT_MISMATCH') throw e; return `blocked: ${(e as Error).message}` }
})

mkdirSync('evidence', { recursive: true })
const out = { ranAt: new Date().toISOString(), note: 'No credentials used. Public market data + Coinbase static sandbox only.', rows }
writeFileSync('evidence/live-public-check.json', JSON.stringify(out, null, 2))
for (const r of rows) console.log(`${r.result.padEnd(4)} ${r.check} — ${r.detail}`)
if (rows.some(r => r.result === 'FAIL')) process.exitCode = 1
