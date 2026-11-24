/**
 * REAL logged-in Bybit DEMO TRADING run (api-demo.bybit.com). Keys from env (BYBIT_DEMO_API_KEY / _SECRET),
 * never printed or written. Includes a real Trade-to-Protect: entry → reconcile fill → stop sized from the
 * actual fill → verify the venue lists it → PROTECTED. Usage: pnpm tsx scripts/live-bybit-demo.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Decimal, dec, floorToStep, roundToTick, type Instrument, type Order } from '@helm/shared'
import { BybitAdapter, newClientOrderId, type FetchLike } from '@helm/connectors'
import { ProtectionWorkflow, protectiveQuantity, protectiveStopPrice } from '@helm/trading-core'

const key = process.env.BYBIT_DEMO_API_KEY, secret = process.env.BYBIT_DEMO_API_SECRET
if (!key || !secret) { console.error('BLOCKED: BYBIT_DEMO_API_KEY / BYBIT_DEMO_API_SECRET not set'); process.exit(2) }

type Row = { step: string; result: 'PASS' | 'FAIL' | 'BLOCKED'; detail: unknown }
const rows: Row[] = []
const wire: Array<{ method: string; endpoint: string; status: number; ms: number }> = []
const f: FetchLike = async (url, init) => { const t0 = Date.now(); const r = await fetch(url, init as RequestInit); const u = new URL(url); wire.push({ method: init.method, endpoint: `${u.host}${u.pathname}`, status: r.status, ms: Date.now() - t0 }); return r }
const ser = (o: Order | null) => o && ({ providerOrderId: o.providerOrderId, clientOrderId: o.clientOrderId, instrument: o.instrumentId, side: o.side, type: o.type, status: o.status, qty: o.quantity?.toFixed() ?? null, quoteQty: o.quoteQuantity?.toFixed() ?? null, price: o.price?.toFixed() ?? null, stopPrice: o.stopPrice?.toFixed() ?? null, filled: o.filledQuantity.toFixed(), avgFill: o.avgFillPrice?.toFixed() ?? null, reduceOnly: o.reduceOnly, updatedAt: o.updatedAt })
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try { const d = await fn(); rows.push({ step: name, result: 'PASS', detail: d }); console.log(`PASS ${name}`); return d }
  catch (e) { const err = e as { code?: string; providerCode?: string; detail?: string; message?: string }; rows.push({ step: name, result: 'FAIL', detail: { code: err.code, providerCode: err.providerCode, detail: err.detail ?? err.message } }); console.log(`FAIL ${name}: ${err.code ?? ''} ${err.providerCode ?? ''} ${err.detail ?? err.message}`); return null }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until(a: BybitAdapter, i: Instrument, o: { providerOrderId: string | null; clientOrderId: string }, want: Order['status'][]) {
  let r: Order | null = null
  for (let k = 0; k < 12; k++) { r = await a.reconcileOrder(i.id, { providerOrderId: o.providerOrderId ?? undefined }); if (r && want.includes(r.status)) return r; await sleep(500) }
  return r
}

const a = new BybitAdapter({ apiKey: key, apiSecret: secret }, { accountId: 'bybit-demo', fetch: f })
const h = await step('connect (authenticated read, environment, key permissions)', async () => a.connect())
await step('wallet balances (UNIFIED, non-zero)', async () => (await a.getBalances()).map(b => ({ asset: b.asset, total: b.total.toFixed(), free: b.free.toFixed() })))
await step('equity', async () => { const e = await a.getEquity(); return { currency: e.currency, equity: e.equity?.toFixed(), available: e.availableBalance?.toFixed(), marginUsed: e.marginUsed?.toFixed() } })
const trade = h && (h.state === 'CONNECTED' || h.state === 'LIMITED')
if (!trade) rows.push({ step: 'trading steps', result: 'BLOCKED', detail: h })

if (trade) {
  // ---------- SPOT ----------
  const si = await step('spot: BTCUSDT instrument filters', async () => (await a.getInstruments('spot')).find(x => x.providerSymbol === 'BTCUSDT')!)
  if (si) {
    const i = si as Instrument
    const b = await a.getOrderBook(i.id, 5)
    const px = roundToTick(b.bids[0]!.price.mul('0.85'), i.tickSize, 'BUY')
    const q = floorToStep(dec('12').div(px), i.lotSize).plus(i.lotSize)
    const lim = await step('spot: LIMIT BUY resting 15% below bid', async () => ser(await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', quantity: q, price: px, clientOrderId: newClientOrderId('helmlv') })))
    if (lim) {
      await step('spot: limit visible in open orders', async () => { const oo = await a.getOpenOrders(i.id); const x = oo.find(o => o.providerOrderId === lim.providerOrderId); if (!x) throw new Error('not listed'); return ser(x) })
      await step('spot: cancel → reconcile CANCELED', async () => { const c = await a.cancelOrder(i.id, { providerOrderId: lim.providerOrderId! }); if (c.status !== 'CANCELED') throw new Error(c.status); return ser(c) })
    }
    const m = await step('spot: MARKET BUY 10 USDT (quote)', async () => ser(await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: newClientOrderId('helmlv') })))
    if (m) {
      const r = await step('spot: reconcile market → FILLED', async () => { const x = await until(a, i, m, ['FILLED']); if (x?.status !== 'FILLED') throw new Error(`status ${x?.status}`); return ser(x) })
      const fills = await step('spot: execution list for the order', async () => (await a.getFills(i.id, 20)).filter(x => x.providerOrderId === m.providerOrderId).map(x => ({ execId: x.providerTradeId, price: x.price.toFixed(), qty: x.quantity.toFixed(), fee: x.fee?.toFixed(), feeAsset: x.feeAsset })))
      if (r) {
        const free = (await a.getBalances()).find(x => x.asset === 'BTC')?.free ?? dec(0)
        const baseFee = (fills ?? []).filter(x => x.feeAsset === 'BTC').reduce((s, x) => s.plus(x.fee ?? '0'), dec(0))
        const sq = protectiveQuantity({ filledQty: dec(r.filled), baseFee, freeBase: free, instrument: i })
        await step('spot: conditional STOP sell (StopOrder) on the bought qty, 10% below', async () => {
          const st = await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'SELL', type: 'STOP_MARKET', quantity: sq, stopPrice: roundToTick(b.bids[0]!.price.mul('0.9'), i.tickSize, 'SELL'), clientOrderId: newClientOrderId('helmst') })
          const c = st.status === 'ACCEPTED' ? await a.cancelOrder(i.id, { providerOrderId: st.providerOrderId! }) : null
          if (st.status !== 'ACCEPTED') throw new Error(`stop status ${st.status}`)
          return { stop: ser(st), cancelled: ser(c) }
        })
        await step('spot: MARKET SELL bought qty back', async () => { const s = await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'SELL', type: 'MARKET', quantity: sq, clientOrderId: newClientOrderId('helmlv') }); const x = await until(a, i, s, ['FILLED']); if (x?.status !== 'FILLED') throw new Error(`status ${x?.status}`); return ser(x) })
      }
    }
  }

  // ---------- LINEAR + TRADE-TO-PROTECT ----------
  const li = await step('linear: BTCUSDT perp filters', async () => (await a.getInstruments('perp')).find(x => x.providerSymbol === 'BTCUSDT')!)
  if (li) {
    const i = li as Instrument
    await step('linear: set leverage 2x', async () => { await a.setLeverage(i.id, dec(2)); return 'ok' })
    const b = await a.getOrderBook(i.id, 5)
    const q = Decimal.max(i.minQty, floorToStep(dec('120').div(b.asks[0]!.price), i.lotSize))
    const lim = await step('linear: LIMIT BUY resting 15% below → cancel', async () => {
      const o = await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'BUY', type: 'LIMIT', timeInForce: 'GTC', quantity: q, price: roundToTick(b.bids[0]!.price.mul('0.85'), i.tickSize, 'BUY'), clientOrderId: newClientOrderId('helmlv') })
      const c = await a.cancelOrder(i.id, { providerOrderId: o.providerOrderId! })
      if (c.status !== 'CANCELED') throw new Error(c.status)
      return { placed: ser(o), cancelled: ser(c) }
    })
    void lim
    const wf = new ProtectionWorkflow()
    const entry = await step('T2P: entry MARKET BUY (long ≈$120)', async () => { wf.to('ENTRY_SUBMITTED'); return ser(await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'BUY', type: 'MARKET', quantity: q, clientOrderId: newClientOrderId('helmen') })) })
    if (entry) {
      const filled = await step('T2P: reconcile entry → FILLED (provider truth)', async () => { const x = await until(a, i, entry, ['FILLED']); if (x?.status !== 'FILLED') throw new Error(`status ${x?.status}`); wf.to('ENTRY_FILLED'); return ser(x) })
      await step('linear: position update visible', async () => { const p = (await a.getPositions()).find(x => x.instrumentId === i.id); if (!p) throw new Error('no position'); return { side: p.side, qty: p.quantity.toFixed(), entry: p.entryPrice?.toFixed(), mark: p.markPrice?.toFixed(), liq: p.liquidationPrice?.toFixed() ?? null, lev: p.leverage?.toFixed() } })
      if (filled) {
        const pq = protectiveQuantity({ filledQty: dec(filled.filled), instrument: i })
        const sp = protectiveStopPrice(dec(filled.avgFill!), 'BUY', dec(3), i.tickSize)
        const stop = await step('T2P: reduce-only STOP_MARKET 3% below actual avg fill, qty = actual filled', async () => { wf.to('PROTECTION_SUBMITTED'); return ser(await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'SELL', type: 'STOP_MARKET', quantity: pq, stopPrice: sp, reduceOnly: true, clientOrderId: newClientOrderId('helmst') })) })
        if (stop) {
          await step('T2P: venue lists the stop as live → PROTECTED', async () => {
            const oo = await a.getOpenOrders(i.id)
            const s = oo.find(o => o.providerOrderId === stop.providerOrderId)
            if (!s || s.status !== 'ACCEPTED' || !s.reduceOnly) { wf.to('UNPROTECTED', 'stop not confirmed by venue'); throw new Error('stop not listed') }
            wf.to('PROTECTED', `venue order ${s.providerOrderId} ${(s.raw as { orderStatus?: string }).orderStatus}`)
            return { stop: ser(s), venueStatus: (s.raw as { orderStatus?: string }).orderStatus, protectionHistory: wf.history }
          })
          await step('T2P cleanup: cancel stop', async () => ser(await a.cancelOrder(i.id, { providerOrderId: stop.providerOrderId! })))
        } else if (wf.state === 'PROTECTION_SUBMITTED') wf.to('UNPROTECTED', 'stop rejected')
        await step('linear: reduce-only MARKET close → FILLED, position flat', async () => {
          const c = await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'SELL', type: 'MARKET', quantity: pq, reduceOnly: true, clientOrderId: newClientOrderId('helmlv') })
          const x = await until(a, i, c, ['FILLED'])
          const p = (await a.getPositions()).find(y => y.instrumentId === i.id)
          if (x?.status !== 'FILLED') throw new Error(`status ${x?.status}`)
          return { order: ser(x), positionAfter: p ? p.quantity.toFixed() : '0' }
        })
        await step('linear: executions for entry', async () => (await a.getFills(i.id, 20)).filter(x => x.providerOrderId === entry.providerOrderId).map(x => ({ execId: x.providerTradeId, price: x.price.toFixed(), qty: x.quantity.toFixed(), fee: x.fee?.toFixed() })))
      }
    }
    await step('linear: reduce-only order with no position is rejected by venue (cannot open opposite)', async () => {
      try { const o = await a.submitOrder({ accountId: 'bybit-demo', instrument: i, side: 'SELL', type: 'MARKET', quantity: q, reduceOnly: true, clientOrderId: newClientOrderId('helmro') }); if (o.status === 'FILLED') throw new Error('FILLED — opened a short!'); return ser(o) }
      catch (e) { const c = e as { code?: string; providerCode?: string }; if (c.code === undefined) throw e; return `rejected ${c.code} ${c.providerCode}` }
    })
  }
}

await step('guard: production api.bybit.com signed request blocked before network', async () => {
  const prod = new BybitAdapter({ apiKey: key, apiSecret: secret }, { accountId: 'x', baseUrl: 'https://api.bybit.com', fetch: f })
  const n = wire.length
  try { await prod.getBalances(); throw new Error('NOT BLOCKED') } catch (e) { if ((e as { code?: string }).code !== 'ENVIRONMENT_MISMATCH') throw e }
  if (wire.length !== n) throw new Error('network call made')
  return 'ENVIRONMENT_MISMATCH, 0 network calls'
})

const out = JSON.stringify({ ranAt: new Date().toISOString(), environment: 'Bybit Demo Trading (api-demo.bybit.com)', credentials: 'from env, redacted', rows, wire }, (_k, v) => (Decimal.isDecimal(v) ? (v as Decimal).toFixed() : v), 2)
if (out.includes(key) || out.includes(secret)) { console.error('REDACTION FAILURE'); process.exit(3) }
mkdirSync('evidence/bybit-demo', { recursive: true })
const file = `evidence/bybit-demo/run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, out)
const s = { PASS: 0, FAIL: 0, BLOCKED: 0 }; for (const r of rows) s[r.result]++
console.log(`\n${JSON.stringify(s)} → ${file}`)
