/**
 * REAL logged-in Binance DEMO TRADING integration run (demo-api.binance.com / demo-fapi.binance.com).
 * Keys come from env (BINANCE_DEMO_API_KEY / BINANCE_DEMO_API_SECRET) and are never printed or written.
 * Every request passes the HELM environment guard (production hosts are blocked before network).
 * Usage: pnpm tsx scripts/live-binance-demo.ts  → evidence/binance-demo/run-<ts>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Decimal, dec, floorToStep, roundToTick, type Instrument, type Order } from '@helm/shared'
import { BinanceAdapter, newClientOrderId, type FetchLike } from '@helm/connectors'

const key = process.env.BINANCE_DEMO_API_KEY, secret = process.env.BINANCE_DEMO_API_SECRET
if (!key || !secret) { console.error('BLOCKED: BINANCE_DEMO_API_KEY / BINANCE_DEMO_API_SECRET not set'); process.exit(2) }

type Row = { step: string; result: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP'; detail: unknown }
const rows: Row[] = []
const wire: Array<{ method: string; endpoint: string; status: number; ms: number }> = []
const redactingFetch: FetchLike = async (url, init) => {
  const t0 = Date.now()
  const r = await fetch(url, init as RequestInit)
  const u = new URL(url)
  wire.push({ method: init.method, endpoint: `${u.host}${u.pathname}`, status: r.status, ms: Date.now() - t0 }) // query (timestamp/signature) dropped
  return r
}
const ser = (o: Order | null) => o && ({ providerOrderId: o.providerOrderId, clientOrderId: o.clientOrderId, instrument: o.instrumentId, side: o.side, type: o.type, status: o.status, qty: o.quantity?.toFixed() ?? null, quoteQty: o.quoteQuantity?.toFixed() ?? null, price: o.price?.toFixed() ?? null, filled: o.filledQuantity.toFixed(), avgFill: o.avgFillPrice?.toFixed() ?? null, reduceOnly: o.reduceOnly, updatedAt: o.updatedAt })
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try { const d = await fn(); rows.push({ step: name, result: 'PASS', detail: d }); console.log(`PASS ${name}`); return d }
  catch (e) { const err = e as { code?: string; providerCode?: string; detail?: string; message?: string }; rows.push({ step: name, result: 'FAIL', detail: { code: err.code, providerCode: err.providerCode, detail: err.detail ?? err.message } }); console.log(`FAIL ${name}: ${err.code ?? ''} ${err.providerCode ?? ''} ${err.detail ?? err.message}`); return null }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function waitTerminal(a: BinanceAdapter, i: Instrument, o: Order, want: Order['status'][]): Promise<Order | null> {
  for (let k = 0; k < 10; k++) { const r = await a.reconcileOrder(i.id, { providerOrderId: o.providerOrderId ?? undefined, clientOrderId: o.clientOrderId }); if (r && want.includes(r.status)) return r; await sleep(500) }
  return a.reconcileOrder(i.id, { providerOrderId: o.providerOrderId ?? undefined, clientOrderId: o.clientOrderId })
}

// ---------------- SPOT ----------------
const spot = new BinanceAdapter({ apiKey: key, apiSecret: secret }, { market: 'spot', accountId: 'binance-demo-spot', fetch: redactingFetch })
const sh = await step('spot: connect (authenticated account read + environment check)', async () => spot.connect())
await step('spot: capabilities after connect', async () => { const c = spot.getCapabilities(); return { environment: c.environment, permissions: c.permissions, simulation: c.simulation } })
await step('spot: balances (non-zero)', async () => (await spot.getBalances()).filter(b => !b.total.isZero()).map(b => ({ asset: b.asset, free: b.free.toFixed(), locked: b.locked.toFixed() })))
const inst = await step('spot: BTCUSDT filters from exchangeInfo', async () => { const i = (await spot.getInstruments()).find(x => x.providerSymbol === 'BTCUSDT')!; return i })
const book = await step('spot: BTCUSDT book', async () => { const b = await spot.getOrderBook('binance:spot:BTC-USDT', 5); return { bid: b.bids[0]!.price.toFixed(), ask: b.asks[0]!.price.toFixed(), ts: b.timestamp } })
if (sh?.state === 'CONNECTED' && inst && book) {
  const i = inst as Instrument
  // 1) Resting LIMIT BUY 15% below bid (will not fill) → open orders → cancel → reconcile CANCELED
  const px = roundToTick(dec(book.bid).mul('0.85'), i.tickSize, 'BUY')
  const qty = floorToStep(dec('12').div(px), i.lotSize).plus(i.lotSize) // ≈ $12 ≥ minNotional
  const lim = await step('spot: submit LIMIT BUY (resting, 15% below bid)', async () => ser(await spot.submitOrder({ accountId: 'binance-demo-spot', instrument: i, side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', quantity: qty, price: px, clientOrderId: newClientOrderId('helmlv') })))
  if (lim) {
    await step('spot: open orders contains the limit order', async () => { const oo = await spot.getOpenOrders(i.id); const hit = oo.find(o => o.clientOrderId === lim.clientOrderId); if (!hit) throw new Error('not in open orders'); return ser(hit) })
    await step('spot: cancel limit order', async () => ser(await spot.cancelOrder(i.id, { clientOrderId: lim.clientOrderId })))
    await step('spot: reconcile cancelled order (provider truth)', async () => { const r = await spot.reconcileOrder(i.id, { clientOrderId: lim.clientOrderId }); if (r?.status !== 'CANCELED') throw new Error(`status ${r?.status}`); return ser(r) })
  }
  // 2) Small MARKET BUY $11 quote → reconcile FILLED → fills → MARKET SELL same qty back
  const mkt = await step('spot: submit MARKET BUY quoteOrderQty 11 USDT', async () => ser(await spot.submitOrder({ accountId: 'binance-demo-spot', instrument: i, side: 'BUY', type: 'MARKET', quoteQuantity: dec('11'), clientOrderId: newClientOrderId('helmlv') })))
  if (mkt) {
    const rec = await step('spot: reconcile market order → FILLED with exchange-reported fills', async () => { const r = await waitTerminal(spot, i, { ...mkt, providerOrderId: mkt.providerOrderId, clientOrderId: mkt.clientOrderId } as unknown as Order, ['FILLED']); if (r?.status !== 'FILLED') throw new Error(`status ${r?.status}`); return ser(r) })
    await step('spot: trade history (myTrades) for the fill', async () => (await spot.getFills(i.id, 5)).filter(f => f.providerOrderId === mkt.providerOrderId).map(f => ({ tradeId: f.providerTradeId, price: f.price.toFixed(), qty: f.quantity.toFixed(), fee: f.fee?.toFixed(), feeAsset: f.feeAsset })))
    if (rec) {
      // Binance takes the spot BUY commission in the base asset: sell what is actually free, never more.
      const free = (await spot.getBalances()).find(b => b.asset === 'BTC')?.free ?? dec(0)
      const fills = (await spot.getFills(i.id, 10)).filter(f => f.providerOrderId === mkt.providerOrderId)
      const baseFee = fills.filter(f => f.feeAsset === 'BTC').reduce((a, f) => a.plus(f.fee ?? 0), dec(0))
      const sellQty = floorToStep(Decimal.min(dec(rec.filled).minus(baseFee), free), i.lotSize)
      const sell = await step('spot: MARKET SELL the filled qty back', async () => ser(await spot.submitOrder({ accountId: 'binance-demo-spot', instrument: i, side: 'SELL', type: 'MARKET', quantity: sellQty, clientOrderId: newClientOrderId('helmlv') })))
      if (sell) await step('spot: reconcile sell → FILLED', async () => { const r = await waitTerminal(spot, i, sell as unknown as Order, ['FILLED']); if (r?.status !== 'FILLED') throw new Error(`status ${r?.status}`); return ser(r) })
    }
  }
  await step('spot: duplicate clientOrderId is rejected by venue (no double submit)', async () => {
    const cid = newClientOrderId('helmdup')
    const req = { accountId: 'binance-demo-spot', instrument: i, side: 'BUY' as const, type: 'LIMIT' as const, timeInForce: 'GTC' as const, quantity: qty, price: px, clientOrderId: cid }
    const first = await spot.submitOrder(req)
    let second: string
    try { await spot.submitOrder(req); second = 'ACCEPTED (unexpected)' } catch (e) { second = `rejected: ${(e as { code?: string; providerCode?: string }).code} ${(e as { providerCode?: string }).providerCode}` }
    await spot.cancelOrder(i.id, { clientOrderId: cid })
    if (!second.startsWith('rejected')) throw new Error(second)
    return { first: first.status, second }
  })
} else rows.push({ step: 'spot: trading steps', result: 'BLOCKED', detail: `connection state ${sh?.state}: ${sh?.reasons?.join('; ')}` })

// ---------------- USDⓈ-M FUTURES ----------------
const fut = new BinanceAdapter({ apiKey: key, apiSecret: secret }, { market: 'usdm', accountId: 'binance-demo-usdm', fetch: redactingFetch })
const fh = await step('usdm: connect', async () => fut.connect())
if (fh?.state === 'CONNECTED') {
  await step('usdm: balances', async () => (await fut.getBalances()).filter(b => !b.total.isZero()).map(b => ({ asset: b.asset, free: b.free.toFixed(), total: b.total.toFixed() })))
  await step('usdm: positions (before)', async () => (await fut.getPositions()).map(p => ({ instrument: p.instrumentId, side: p.side, qty: p.quantity.toFixed() })))
  const fi = await step('usdm: BTCUSDT perp filters', async () => (await fut.getInstruments()).find(x => x.providerSymbol === 'BTCUSDT')!)
  if (fi) {
    const i = fi as Instrument
    await step('usdm: set leverage 2x', async () => { await fut.setLeverage(i.id, dec(2)); return 'ok' })
    const b = await fut.getOrderBook(i.id, 5)
    const q = Decimal.max(i.minQty, floorToStep(dec('120').div(b.asks[0]!.price), i.lotSize).plus(i.lotSize))
    const open = await step('usdm: MARKET BUY (open long, ≈$120 notional)', async () => ser(await fut.submitOrder({ accountId: 'binance-demo-usdm', instrument: i, side: 'BUY', type: 'MARKET', quantity: q, leverage: dec(2), clientOrderId: newClientOrderId('helmlv') })))
    if (open) {
      await step('usdm: reconcile open → FILLED', async () => { const r = await waitTerminal(fut, i, open as unknown as Order, ['FILLED']); if (r?.status !== 'FILLED') throw new Error(`status ${r?.status}`); return ser(r) })
      const pos = await step('usdm: position update visible', async () => { const p = (await fut.getPositions()).find(x => x.instrumentId === i.id); if (!p) throw new Error('no position'); return { side: p.side, qty: p.quantity.toFixed(), entry: p.entryPrice?.toFixed(), mark: p.markPrice?.toFixed(), liq: p.liquidationPrice?.toFixed() ?? null, lev: p.leverage?.toFixed() } })
      const stopPx = roundToTick(b.bids[0]!.price.mul('0.9'), i.tickSize, 'SELL')
      const stop = await step('usdm: reduce-only STOP_MARKET protection 10% below', async () => ser(await fut.submitOrder({ accountId: 'binance-demo-usdm', instrument: i, side: 'SELL', type: 'STOP_MARKET', quantity: q, stopPrice: stopPx, reduceOnly: true, clientOrderId: newClientOrderId('helmst') })))
      if (stop) {
        await step('usdm: protection visible in open orders', async () => { const oo = await fut.getOpenOrders(i.id); const s = oo.find(o => o.clientOrderId === stop.clientOrderId); if (!s) throw new Error('stop not in open orders'); return ser(s) })
        await step('usdm: cancel protection', async () => ser(await fut.cancelOrder(i.id, { clientOrderId: stop.clientOrderId })))
      }
      if (pos) {
        const close = await step('usdm: reduce-only MARKET SELL (close long)', async () => ser(await fut.submitOrder({ accountId: 'binance-demo-usdm', instrument: i, side: 'SELL', type: 'MARKET', quantity: q, reduceOnly: true, clientOrderId: newClientOrderId('helmlv') })))
        if (close) await step('usdm: reconcile close → FILLED, position flat', async () => { const r = await waitTerminal(fut, i, close as unknown as Order, ['FILLED']); const p = (await fut.getPositions()).find(x => x.instrumentId === i.id); return { order: ser(r), positionAfter: p ? p.quantity.toFixed() : '0' } })
      }
    }
  }
} else rows.push({ step: 'usdm: trading steps', result: 'BLOCKED', detail: `connection state ${fh?.state}: ${fh?.reasons?.join('; ')}` })

// ---------------- guard ----------------
await step('guard: same keys against PRODUCTION host are blocked before network', async () => {
  const prod = new BinanceAdapter({ apiKey: key, apiSecret: secret }, { market: 'spot', accountId: 'x', baseUrl: 'https://api.binance.com', fetch: redactingFetch })
  const before = wire.length
  try { await prod.getBalances(); throw new Error('NOT BLOCKED') } catch (e) { if ((e as { code?: string }).code !== 'ENVIRONMENT_MISMATCH') throw e }
  if (wire.length !== before) throw new Error('a network call was made')
  return 'ENVIRONMENT_MISMATCH, 0 network calls'
})

const out = JSON.stringify({ ranAt: new Date().toISOString(), environment: 'Binance Demo Trading (demo-api.binance.com, demo-fapi.binance.com)', credentials: 'from env, redacted', rows, wire }, (_k, v) => (Decimal.isDecimal(v) ? (v as Decimal).toFixed() : v), 2)
if (out.includes(key) || out.includes(secret)) { console.error('REDACTION FAILURE — evidence not written'); process.exit(3) }
mkdirSync('evidence/binance-demo', { recursive: true })
const file = `evidence/binance-demo/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, out)
const s = { PASS: 0, FAIL: 0, BLOCKED: 0, SKIP: 0 }; for (const r of rows) s[r.result]++
console.log(`\n${JSON.stringify(s)} → ${file}`)
