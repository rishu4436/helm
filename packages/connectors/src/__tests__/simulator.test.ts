import { describe, expect, it } from 'vitest'
import { dec, type OrderBook } from '@helm/shared'
import { MemorySimStore, SimulatedAdapter, simInstruments, type MarketSource } from '../simulator/adapter'

function bookAt(bid: string, ask: string): OrderBook {
  const b = dec(bid), a = dec(ask)
  return { provider: 'binance', instrumentId: 'x', bids: [0, 1, 2].map(i => ({ price: b.minus(i), quantity: dec('0.5') })), asks: [0, 1, 2].map(i => ({ price: a.plus(i), quantity: dec('0.5') })), timestamp: 't', receivedAt: 't' }
}
class FakeMarket implements MarketSource { bid = '60000'; ask = '60001'; async getOrderBook() { return bookAt(this.bid, this.ask) } }
const setup = () => { const m = new FakeMarket(); const store = new MemorySimStore(); const a = new SimulatedAdapter({ venue: 'binance', accountId: 'acc', market: m, store }); return { m, store, a } }
const spot = simInstruments('binance').find(i => i.id === 'binance:spot:BTC-USDT')!
const perp = simInstruments('binance').find(i => i.id === 'binance:perp:BTC-USDT:USDT')!

describe('HELM local simulator (environment=simulated)', () => {
  it('is honestly LIMITED + labelled simulated, never CONNECTED', async () => {
    const { a } = setup()
    const h = await a.connect()
    expect(h.state).toBe('LIMITED')
    expect(h.reasons[0]).toMatch(/SIMULATED/)
    expect(a.getCapabilities().environment).toBe('simulated')
    expect(a.getCapabilities().simulation).toBe('local_simulation')
  })

  it('market buy by notional walks the live book, charges fee, flags simulatedLocal', async () => {
    const { a } = setup()
    const o = await a.submitOrder({ accountId: 'acc', instrument: spot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('100'), clientOrderId: 'c1' })
    expect(o.status).toBe('FILLED')
    expect(o.simulatedLocal).toBe(true)
    expect(o.providerOrderId).toMatch(/^SIM-O-/)
    const usdt = (await a.getBalances()).find(b => b.asset === 'USDT')!
    const spent = dec('10000').minus(usdt.total) // notional + fee, floored to lot size → never more than $100
    expect(spent.lte(dec('100'))).toBe(true)
    expect(spent.gt(dec('99.5'))).toBe(true)
    const fills = await a.getFills()
    expect(fills[0]!.simulatedLocal).toBe(true)
  })

  it('submit is idempotent on clientOrderId', async () => {
    const { a } = setup()
    const r = { accountId: 'acc', instrument: spot, side: 'BUY' as const, type: 'MARKET' as const, quoteQuantity: dec('50'), clientOrderId: 'same' }
    const o1 = await a.submitOrder(r), o2 = await a.submitOrder(r)
    expect(o2.providerOrderId).toBe(o1.providerOrderId)
    expect((await a.getOrderHistory()).length).toBe(1)
  })

  it('rejects insufficient balance instead of inventing a fill', async () => {
    const { a } = setup()
    const o = await a.submitOrder({ accountId: 'acc', instrument: spot, side: 'SELL', type: 'MARKET', quantity: dec('1'), clientOrderId: 'c2' })
    expect(o.status).toBe('REJECTED')
  })

  it('perp long → reduce-only cannot flip; stop protection triggers on price drop', async () => {
    const { a, m } = setup()
    const open = await a.submitOrder({ accountId: 'acc', instrument: perp, side: 'BUY', type: 'MARKET', quantity: dec('0.01'), leverage: dec('5'), clientOrderId: 'p1' })
    expect(open.status).toBe('FILLED')
    const pos = await a.getPositions()
    expect(pos[0]!.side).toBe('LONG'); expect(pos[0]!.quantity.toFixed()).toBe('0.01')
    const flip = await a.submitOrder({ accountId: 'acc', instrument: perp, side: 'SELL', type: 'MARKET', quantity: dec('0.02'), reduceOnly: true, clientOrderId: 'p2' })
    expect(flip.status).toBe('REJECTED')
    const stop = await a.submitOrder({ accountId: 'acc', instrument: perp, side: 'SELL', type: 'STOP_MARKET', quantity: dec('0.01'), stopPrice: dec('58200'), reduceOnly: true, clientOrderId: 'p3' })
    expect(stop.status).toBe('ACCEPTED')
    expect((await a.getOpenOrders()).length).toBe(1)
    m.bid = '58100'; m.ask = '58101'
    const after = await a.reconcileOrder(perp.id, { clientOrderId: 'p3' })
    expect(after!.status).toBe('FILLED')
    expect((await a.getPositions()).length).toBe(0)
  })

  it('perp stop without a position is rejected (no naked conditional)', async () => {
    const { a } = setup()
    const s = await a.submitOrder({ accountId: 'acc', instrument: perp, side: 'SELL', type: 'STOP_MARKET', quantity: dec('0.01'), stopPrice: dec('50000'), reduceOnly: true, clientOrderId: 'x' })
    expect(s.status).toBe('REJECTED')
  })

  it('preview estimates slippage/fee and expires', async () => {
    const { a } = setup()
    const p = await a.previewOrder({ accountId: 'acc', instrument: spot, side: 'BUY', type: 'MARKET', quantity: dec('0.8'), clientOrderId: 'pv' })
    expect(p.estimatedPrice!.gt(dec('60001'))).toBe(true) // walked 2 levels
    expect(p.estimatedSlippageBps!.gt(0)).toBe(true)
    expect(new Date(p.expiresAt).getTime()).toBeGreaterThan(new Date(p.createdAt).getTime())
    expect(p.estimateNotes.join(' ')).toMatch(/SIMULATED/)
  })
})
