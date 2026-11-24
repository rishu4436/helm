import { describe, expect, it } from 'vitest'
import { dec, type Instrument, type Order, type OrderPreview, type OrderRequest, type Position } from '@helm/shared'
import { aggregate, type PriceBook } from '@helm/portfolio'
import { DEFAULT_POLICY, RiskPolicySchema, assess, compass, scenario, tradeImpact } from './index'

const now = new Date('2026-11-24T08:00:00Z')
const prices: PriceBook = new Map([['BTC', { asset: 'BTC', price: dec('60000'), source: 'mid', timestamp: '2026-11-24T07:59:59Z' }]])
const inst = (product: 'spot' | 'perp'): Instrument => ({ id: product === 'spot' ? 'binance:spot:BTC-USDT' : 'binance:perp:BTC-USDT:USDT', provider: 'binance', providerSymbol: 'BTCUSDT', product, base: 'BTC', quote: 'USDT', contractMultiplier: dec(1), quantityUnit: 'base', lotSize: dec('0.00001'), minQty: dec('0.00001'), tickSize: dec('0.01'), venue: 'x', currency: 'USDT', status: 'trading' })
const preview = (r: OrderRequest, notional: string, extra: Partial<OrderPreview> = {}): OrderPreview => ({ id: 'p', request: r, estimatedPrice: dec('60000'), estimatedNotional: dec(notional), estimatedFee: dec(notional).mul('0.001'), estimatedSlippageBps: dec('1'), requiredMargin: null, remainingBuyingPower: dec('5000'), estimateNotes: [], createdAt: '', expiresAt: '', ...extra })
const perpPos = (extra: Partial<Position> = {}): Position => ({ accountId: 'a1', instrumentId: 'binance:perp:BTC-USDT:USDT', provider: 'binance', product: 'perp', side: 'LONG', quantity: dec('0.1'), entryPrice: dec('59000'), markPrice: dec('60000'), notional: dec('6000'), unrealizedPnl: dec('100'), realizedPnl: null, leverage: dec(5), liquidationPrice: dec('57000'), marginMode: 'isolated', positionMode: 'one_way', isolatedMargin: dec('1200'), asOf: '', ...extra })
const pf = (positions: Position[] = [], openOrders: Order[] = []) => aggregate([{ account: { id: 'a1', alias: 'Binance', provider: 'binance', environment: 'simulated', state: 'LIMITED' }, balances: [{ accountId: 'a1', asset: 'USDT', free: dec('5000'), locked: dec(0), total: dec('5000'), asOf: '', source: 'binance' }], positions, openOrders }, { account: { id: 'a2', alias: 'OKX', provider: 'okx', environment: 'demo', state: 'CONNECTED' }, balances: [{ accountId: 'a2', asset: 'USDT', free: dec('5000'), locked: dec(0), total: dec('5000'), asOf: '', source: 'okx' }], positions: [], openOrders: [] }], prices, now)

describe('HELM Shield policy enforcement', () => {
  const spotReq: OrderRequest = { accountId: 'a1', instrument: inst('spot'), side: 'BUY', type: 'MARKET', quoteQuantity: dec('100'), clientOrderId: 'c' }
  it('ALLOW for a $100 spot buy within limits', () => {
    expect(assess(DEFAULT_POLICY, { request: spotReq, preview: preview(spotReq, '100'), portfolio: pf(), reducesRisk: false, now }).verdict).toBe('ALLOW')
  })
  it('BLOCK over max spot order', () => {
    const a = assess(DEFAULT_POLICY, { request: spotReq, preview: preview(spotReq, '1500'), portfolio: pf(), reducesRisk: false, now })
    expect(a.verdict).toBe('BLOCK'); expect(a.findings.map(f => f.rule)).toContain('max_spot_order')
  })
  it('BLOCK over leverage and blocked instruments', () => {
    const r: OrderRequest = { ...spotReq, instrument: inst('perp'), quantity: dec('0.001'), quoteQuantity: undefined, leverage: dec(10) }
    expect(assess(DEFAULT_POLICY, { request: r, preview: preview(r, '60'), portfolio: pf(), reducesRisk: false, now }).findings.map(f => f.rule)).toContain('max_leverage')
    const p = { ...DEFAULT_POLICY, blockedInstruments: ['BTC'] }
    expect(assess(p, { request: spotReq, preview: preview(spotReq, '10'), portfolio: pf(), reducesRisk: false, now }).verdict).toBe('BLOCK')
  })
  it('BLOCK when reserve would be breached or balance insufficient', () => {
    expect(assess(DEFAULT_POLICY, { request: spotReq, preview: preview(spotReq, '100', { remainingBuyingPower: dec('50') }), portfolio: pf(), reducesRisk: false, now }).findings.map(f => f.rule)).toContain('min_reserve')
    expect(assess(DEFAULT_POLICY, { request: spotReq, preview: preview(spotReq, '100', { remainingBuyingPower: dec('-1') }), portfolio: pf(), reducesRisk: false, now }).findings.map(f => f.rule)).toContain('buying_power')
  })
  it('risk-reducing orders are not blocked by size limits', () => {
    const r: OrderRequest = { ...spotReq, instrument: inst('perp'), side: 'SELL', quantity: dec('0.1'), reduceOnly: true }
    expect(assess(DEFAULT_POLICY, { request: r, preview: preview(r, '6000'), portfolio: pf([perpPos()]), reducesRisk: true, now }).verdict).toBe('ALLOW')
  })
  it('policy schema rejects malformed input', () => {
    expect(RiskPolicySchema.safeParse({ ...DEFAULT_POLICY, maxLeverage: '-1' }).success).toBe(false)
    expect(RiskPolicySchema.safeParse(DEFAULT_POLICY).success).toBe(true)
  })
})

describe('Trade Impact Preview', () => {
  it('projects exposure and position, marks liquidation as not calculable post-trade', () => {
    const r: OrderRequest = { accountId: 'a1', instrument: inst('perp'), side: 'BUY', type: 'MARKET', quantity: dec('0.05'), clientOrderId: 'c' }
    const t = tradeImpact({ request: r, preview: preview(r, '3000', { request: r }), portfolio: pf([perpPos()]), bid: dec('59999'), ask: dec('60001') })
    expect(t.currentExposureUsd.toFixed()).toBe('6000')
    expect(t.proposedExposureUsd.toFixed()).toBe('9000')
    expect(t.proposedPositionQty.toFixed()).toBe('0.15')
    expect(t.liquidation.proposed).toBeNull()
    expect(t.spreadBps!.toFixed(4)).toBe('0.3333')
  })
})

describe('Exposure Compass + scenario', () => {
  it('flags unprotected positions, near-liquidation and margin use', () => {
    const c = compass(pf([perpPos({ liquidationPrice: dec('57000') })]), { ...DEFAULT_POLICY, nearLiquidationPct: '6' })
    expect(c.unprotected).toHaveLength(1)
    expect(c.nearRisk).toHaveLength(1)
    expect(c.largestDirectional!.asset).toBe('BTC')
  })
  it('a reduce-only stop counts as protection', () => {
    const stop: Order = { accountId: 'a1', provider: 'binance', instrumentId: 'binance:perp:BTC-USDT:USDT', providerOrderId: 's', clientOrderId: 's', side: 'SELL', type: 'STOP_MARKET', timeInForce: 'GTC', quantity: dec('0.1'), quoteQuantity: null, price: null, stopPrice: dec('58000'), reduceOnly: true, status: 'ACCEPTED', filledQuantity: dec(0), avgFillPrice: null, createdAt: '', updatedAt: '' }
    expect(compass(pf([perpPos()], [stop])).unprotected).toHaveLength(0)
  })
  it('BTC −5% stress: linear PnL and liquidation breach check', () => {
    const s = scenario(pf([perpPos()]), 'btc', dec(-5))
    expect(s.totalPnlUsd.toFixed()).toBe('-300')
    expect(s.legs[0]!.breachesLiquidation).toBe(true) // 60000 × 0.95 = 57000 = reported liquidation → breach
    expect(scenario(pf([perpPos()]), 'BTC', dec(-4)).legs[0]!.breachesLiquidation).toBe(false)
    expect(s.disclaimer).toMatch(/Not a market prediction/)
  })
})
