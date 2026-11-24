import { afterEach, describe, expect, it } from 'vitest'
import { assertEndpointAllowed, assertLiveTradingDisabled, redact } from './env-guard'
import { HelmError } from './errors'

const ok = (c: Parameters<typeof assertEndpointAllowed>[0]) => expect(() => assertEndpointAllowed(c)).not.toThrow()
const blocked = (c: Parameters<typeof assertEndpointAllowed>[0]) => {
  try { assertEndpointAllowed(c); throw new Error('expected block') } catch (e) {
    expect(e).toBeInstanceOf(HelmError); expect((e as HelmError).code).toBe('ENVIRONMENT_MISMATCH')
  }
}

describe('environment guard', () => {
  afterEach(() => { delete process.env.HELM_LIVE_TRADING })

  it('allows signed requests only to demo/paper hosts', () => {
    ok({ provider: 'binance', url: 'https://demo-api.binance.com/api/v3/order', method: 'POST', authenticated: true })
    ok({ provider: 'binance', url: 'https://demo-fapi.binance.com/fapi/v1/order', method: 'POST', authenticated: true })
    ok({ provider: 'bybit', url: 'https://api-demo.bybit.com/v5/order/create', method: 'POST', authenticated: true })
    ok({ provider: 'alpaca', url: 'https://paper-api.alpaca.markets/v2/orders', method: 'POST', authenticated: true })
    ok({ provider: 'ibkr', url: 'https://localhost:5000/v1/api/iserver/auth/status', method: 'POST', authenticated: true })
  })

  it('hard-blocks production signed trading endpoints', () => {
    blocked({ provider: 'binance', url: 'https://api.binance.com/api/v3/order', method: 'POST', authenticated: true })
    blocked({ provider: 'binance', url: 'https://fapi.binance.com/fapi/v1/order', method: 'POST', authenticated: true })
    blocked({ provider: 'binance', url: 'https://testnet.binance.vision/api/v3/order', method: 'POST', authenticated: true })
    blocked({ provider: 'bybit', url: 'https://api.bybit.com/v5/order/create', method: 'POST', authenticated: true })
    blocked({ provider: 'alpaca', url: 'https://api.alpaca.markets/v2/orders', method: 'POST', authenticated: true })
    blocked({ provider: 'coinbase', url: 'https://api.coinbase.com/api/v3/brokerage/orders', method: 'POST', authenticated: true })
    blocked({ provider: 'ibkr', url: 'https://api.ibkr.com/v1/api/iserver/account/orders', method: 'POST', authenticated: true })
  })

  it('requires x-simulated-trading: 1 on every authenticated OKX request', () => {
    blocked({ provider: 'okx', url: 'https://www.okx.com/api/v5/trade/order', method: 'POST', authenticated: true, headers: {} })
    blocked({ provider: 'okx', url: 'https://www.okx.com/api/v5/trade/order', method: 'POST', authenticated: true, headers: { 'x-simulated-trading': '0' } })
    ok({ provider: 'okx', url: 'https://www.okx.com/api/v5/trade/order', method: 'POST', authenticated: true, headers: { 'x-simulated-trading': '1' } })
    ok({ provider: 'okx', url: 'https://www.okx.com/api/v5/account/balance', method: 'GET', authenticated: true, headers: { 'X-Simulated-Trading': '1' } })
  })

  it('allows only public market-data GETs without auth', () => {
    ok({ provider: 'bybit', url: 'https://api.bybit.com/v5/market/orderbook?category=spot&symbol=BTCUSDT', method: 'GET', authenticated: false })
    blocked({ provider: 'bybit', url: 'https://api.bybit.com/v5/order/create', method: 'GET', authenticated: false })
    blocked({ provider: 'bybit', url: 'https://api.bybit.com/v5/market/orderbook', method: 'POST', authenticated: false })
    ok({ provider: 'okx', url: 'https://www.okx.com/api/v5/market/books?instId=BTC-USDT', method: 'GET', authenticated: false })
    blocked({ provider: 'okx', url: 'https://www.okx.com/api/v5/trade/order', method: 'GET', authenticated: false })
    ok({ provider: 'coinbase', url: 'https://api-sandbox.coinbase.com/api/v3/brokerage/accounts', method: 'GET', authenticated: false })
    blocked({ provider: 'coinbase', url: 'https://evil.example.com/api/v3/brokerage/accounts', method: 'GET', authenticated: false })
    ok({ provider: 'coinbase', url: 'https://api-sandbox.coinbase.com/api/v3/brokerage/orders', method: 'POST', authenticated: false })
    blocked({ provider: 'coinbase', url: 'https://api-sandbox.coinbase.com/api/v3/brokerage/orders', method: 'POST', authenticated: true })
    ok({ provider: 'coinbase', url: 'https://api.coinbase.com/api/v3/brokerage/market/products/BTC-USD', method: 'GET', authenticated: false })
    blocked({ provider: 'coinbase', url: 'https://api.coinbase.com/api/v3/brokerage/orders', method: 'POST', authenticated: false })
    blocked({ provider: 'coinbase', url: 'https://api.coinbase.com/api/v3/brokerage/accounts', method: 'GET', authenticated: false })
  })

  it('treats Alpaca data API as GET-only', () => {
    ok({ provider: 'alpaca', url: 'https://data.alpaca.markets/v2/stocks/AAPL/quotes/latest', method: 'GET', authenticated: true })
    blocked({ provider: 'alpaca', url: 'https://data.alpaca.markets/v2/orders', method: 'POST', authenticated: true })
  })

  it('rejects insecure schemes, URL credentials and non-loopback IBKR gateways', () => {
    blocked({ provider: 'binance', url: 'http://demo-api.binance.com/api/v3/order', method: 'POST', authenticated: true })
    blocked({ provider: 'binance', url: 'https://user:pw@demo-api.binance.com/api/v3/order', method: 'POST', authenticated: true })
    blocked({ provider: 'ibkr', url: 'https://192.168.1.20:5000/v1/api/iserver/auth/status', method: 'GET', authenticated: true })
    blocked({ provider: 'binance', url: 'not a url', method: 'GET', authenticated: false })
  })

  it('refuses to run with live trading enabled', () => {
    process.env.HELM_LIVE_TRADING = 'true'
    expect(() => assertLiveTradingDisabled()).toThrow(/live trading is disabled/)
    try { assertEndpointAllowed({ provider: 'binance', url: 'https://demo-api.binance.com/api/v3/order', method: 'POST', authenticated: true }) } catch (e) {
      expect((e as HelmError).code).toBe('LIVE_TRADING_DISABLED')
    }
    process.env.HELM_LIVE_TRADING = 'false'
    expect(() => assertLiveTradingDisabled()).not.toThrow()
  })

  it('redacts secrets recursively', () => {
    const out = redact({ apiKey: 'k', nested: { secret: 's', ok: 1, headers: { 'X-MBX-APIKEY': 'abc', 'OK-ACCESS-SIGN': 'z' } }, url: 'https://x/y?a=1&signature=deadbeef' })
    expect(JSON.stringify(out)).not.toMatch(/deadbeef|"k"|"s"|abc/)
    expect(out.nested.ok).toBe(1)
  })
})
