import { describe, expect, it } from 'vitest'
import { areComparable, fromProviderSymbol, instrumentId, parseInstrumentId, splitConcatSymbol, toProviderSymbol } from './instruments'

describe('canonical instrument ids', () => {
  it('builds provider-qualified ids', () => {
    expect(instrumentId({ provider: 'binance', product: 'spot', base: 'btc', quote: 'usdt' })).toBe('binance:spot:BTC-USDT')
    expect(instrumentId({ provider: 'okx', product: 'perp', base: 'BTC', quote: 'USDT', settle: 'USDT' })).toBe('okx:perp:BTC-USDT:USDT')
    expect(instrumentId({ provider: 'ibkr', product: 'stock', base: 'AAPL', quote: 'USD' })).toBe('ibkr:stock:AAPL:USD')
  })
  it('round-trips ids', () => {
    for (const id of ['bybit:perp:ETH-USDT:USDT', 'coinbase:spot:BTC-USD', 'alpaca:stock:AAPL:USD']) {
      expect(instrumentId(parseInstrumentId(id))).toBe(id)
    }
    expect(() => parseInstrumentId('nonsense')).toThrow()
  })
})

describe('provider symbol mapping', () => {
  it('maps to each provider format', () => {
    expect(toProviderSymbol({ provider: 'binance', product: 'spot', base: 'BTC', quote: 'USDT' })).toBe('BTCUSDT')
    expect(toProviderSymbol({ provider: 'okx', product: 'spot', base: 'BTC', quote: 'USDT' })).toBe('BTC-USDT')
    expect(toProviderSymbol({ provider: 'okx', product: 'perp', base: 'BTC', quote: 'USDT' })).toBe('BTC-USDT-SWAP')
    expect(toProviderSymbol({ provider: 'bybit', product: 'perp', base: 'ETH', quote: 'USDT' })).toBe('ETHUSDT')
    expect(toProviderSymbol({ provider: 'coinbase', product: 'spot', base: 'BTC', quote: 'USD' })).toBe('BTC-USD')
    expect(toProviderSymbol({ provider: 'alpaca', product: 'stock', base: 'aapl', quote: 'USD' })).toBe('AAPL')
    expect(() => toProviderSymbol({ provider: 'ibkr', product: 'perp', base: 'BTC', quote: 'USD' })).toThrow()
  })
  it('parses provider symbols back', () => {
    expect(fromProviderSymbol('binance', 'spot', 'BTCFDUSD')).toEqual({ provider: 'binance', product: 'spot', base: 'BTC', quote: 'FDUSD' })
    expect(fromProviderSymbol('bybit', 'perp', 'SOLUSDT')).toMatchObject({ base: 'SOL', quote: 'USDT', settle: 'USDT' })
    expect(fromProviderSymbol('okx', 'perp', 'BTC-USD-SWAP')).toMatchObject({ base: 'BTC', quote: 'USD', settle: 'BTC' })
    expect(fromProviderSymbol('okx', 'perp', 'ETH-USDT-SWAP')).toMatchObject({ settle: 'USDT' })
    expect(() => fromProviderSymbol('okx', 'perp', 'BTC-USDT')).toThrow()
    expect(() => splitConcatSymbol('XYZ')).toThrow()
  })
  it('only treats truly equivalent contracts as comparable', () => {
    const binanceSpot = fromProviderSymbol('binance', 'spot', 'BTCUSDT')
    const okxSpot = fromProviderSymbol('okx', 'spot', 'BTC-USDT')
    const coinbaseSpot = fromProviderSymbol('coinbase', 'spot', 'BTC-USD')
    const okxInverse = fromProviderSymbol('okx', 'perp', 'BTC-USD-SWAP')
    const bybitLinear = fromProviderSymbol('bybit', 'perp', 'BTCUSD'.replace('USD', 'USDT'))
    expect(areComparable(binanceSpot, okxSpot)).toBe(true)
    expect(areComparable(binanceSpot, coinbaseSpot)).toBe(false) // USDT vs USD
    expect(areComparable(okxInverse, bybitLinear)).toBe(false) // inverse vs linear
  })
})
