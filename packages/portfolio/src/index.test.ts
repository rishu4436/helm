import { describe, expect, it } from 'vitest'
import { dec, type Balance, type Position } from '@helm/shared'
import { aggregate, valueAsset, type PriceBook } from './index'

const now = new Date('2026-11-24T08:00:00Z')
const prices: PriceBook = new Map([['BTC', { asset: 'BTC', price: dec('60000'), source: 'binance mid', timestamp: '2026-11-24T07:59:50Z' }]])
const bal = (accountId: string, asset: string, total: string): Balance => ({ accountId, asset, free: dec(total), locked: dec(0), total: dec(total), asOf: '', source: 'binance' })
const pos = (accountId: string, side: 'LONG' | 'SHORT', qty: string, extra: Partial<Position> = {}): Position => ({ accountId, instrumentId: 'bybit:perp:BTC-USDT:USDT', provider: 'bybit', product: 'perp', side, quantity: dec(qty), entryPrice: dec('59000'), markPrice: dec('60000'), notional: dec(qty).abs().mul(60000), unrealizedPnl: dec('10'), realizedPnl: null, leverage: dec(5), liquidationPrice: null, marginMode: 'cross', positionMode: 'one_way', asOf: '', ...extra })
const acct = (id: string, provider: 'binance' | 'bybit' | 'okx') => ({ id, alias: id, provider, environment: 'demo' as const, state: 'CONNECTED' })

describe('portfolio valuation', () => {
  it('stablecoins at par, priced assets via cross rate, missing price → unvalued (never guessed)', () => {
    expect(valueAsset('USDT', dec(5), prices, now).method).toBe('stablecoin_par')
    expect(valueAsset('BTC', dec('0.5'), prices, now).value!.toFixed()).toBe('30000')
    const u = valueAsset('DOGE', dec(100), prices, now)
    expect(u.value).toBeNull(); expect(u.method).toBe('unvalued')
  })
  it('stale price is treated as unvalued', () => {
    expect(valueAsset('BTC', dec(1), prices, new Date('2026-11-24T08:05:00Z')).value).toBeNull()
  })
})

describe('cross-exchange aggregation (spec example: BTC long Binance, short Bybit, spot OKX)', () => {
  const p = aggregate([
    { account: acct('bin', 'binance'), balances: [bal('bin', 'USDT', '1000')], positions: [pos('bin', 'LONG', '0.1', { instrumentId: 'binance:perp:BTC-USDT:USDT', provider: 'binance' })], openOrders: [] },
    { account: acct('byb', 'bybit'), balances: [bal('byb', 'USDT', '2000')], positions: [pos('byb', 'SHORT', '-0.05')], openOrders: [] },
    { account: acct('okx', 'okx'), balances: [bal('okx', 'BTC', '0.2'), bal('okx', 'DOGE', '50')], positions: [], openOrders: [] },
  ], prices, now)
  it('derivative notional is not added to value; unvalued assets flagged', () => {
    expect(p.netLiquidationUsd.toFixed()).toBe('15000') // 1000 + 2000 + 0.2*60000
    expect(p.grossDerivativeExposureUsd.toFixed()).toBe('9000') // 6000 + 3000
    expect(p.unvaluedAssets).toContain('DOGE')
  })
  it('BTC exposure shows all three legs and a documented net directional view', () => {
    const btc = p.exposures.find(e => e.asset === 'BTC')!
    expect(btc.byAccount).toHaveLength(3)
    expect(btc.spotUsd.toFixed()).toBe('12000')
    expect(btc.derivativesNetUsd.toFixed()).toBe('3000')
    expect(btc.netDirectionalUsd.toFixed()).toBe('15000')
    expect(btc.grossUsd.toFixed()).toBe('21000')
    expect(p.notes.join(' ')).toMatch(/do not net out liquidation/)
  })
  it('isolated margin + uPnL is added only where balances exclude it', () => {
    const q = aggregate([{ account: acct('sim', 'binance'), balances: [bal('sim', 'USDT', '900')], positions: [pos('sim', 'LONG', '0.01', { isolatedMargin: dec('120') })], openOrders: [] }], prices, now)
    expect(q.netLiquidationUsd.toFixed()).toBe('1030') // 900 + 120 + 10
  })
})
