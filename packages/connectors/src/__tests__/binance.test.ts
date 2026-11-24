import { describe, expect, it } from 'vitest'
import { dec, HelmError } from '@helm/shared'
import { BinanceAdapter, buildQuery, parseBinanceSymbol, signBinance, mapBinanceStatus } from '../index'
import { failingFetch, mockFetch } from './mock-fetch'
import { btcusdtPerp, btcusdtSpot } from './fixtures'

const creds = { apiKey: 'demo-key', apiSecret: 'demo-secret' }
const time = ['GET', '/api/v3/time', { body: { serverTime: 1_700_000_000_000 } }] as const

describe('Binance signing', () => {
  it('matches the documented HMAC example from the Binance Spot API docs', () => {
    // https://developers.binance.com/docs/binance-spot-api-docs/rest-api/endpoint-security-type (SIGNED example)
    const qs = 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559'
    expect(signBinance(qs, 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j')).toBe('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71')
  })
  it('builds query strings in insertion order and drops undefined', () => {
    expect(buildQuery({ symbol: 'BTCUSDT', side: 'BUY', price: undefined, quantity: '0.001' })).toBe('symbol=BTCUSDT&side=BUY&quantity=0.001')
  })
  it('signs with server-synchronised timestamp and recvWindow', async () => {
    const m = mockFetch([[...time]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    await a.clock.sync()
    const signed = await a.buildSigned({ symbol: 'BTCUSDT' })
    const [qs, sig] = signed.split('&signature=') as [string, string]
    expect(qs).toMatch(/^symbol=BTCUSDT&recvWindow=5000&timestamp=17\d{11}$/)
    expect(sig).toBe(signBinance(qs, creds.apiSecret))
    expect(Math.abs(Number(qs.split('timestamp=')[1]) - 1_700_000_000_000)).toBeLessThan(5000)
  })
})

describe('Binance connection', () => {
  it('is CONNECTED only after an authenticated demo account read', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v3/account', { body: { canTrade: true, canWithdraw: false, canDeposit: true, accountType: 'SPOT', balances: [] } }]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    expect((await a.connect()).state).toBe('CONNECTED')
    const acct = m.calls.find(c => c.url.includes('/api/v3/account'))!
    expect(acct.url.startsWith('https://demo-api.binance.com/')).toBe(true)
    expect(acct.headers['X-MBX-APIKEY']).toBe('demo-key')
    expect(a.getCapabilities().permissions.trade).toBe(true)
  })
  it('downgrades to LIMITED when the key can withdraw', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v3/account', { body: { canTrade: true, canWithdraw: true, balances: [] } }]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    const h = await a.connect()
    expect(h.state).toBe('LIMITED')
    expect(a.getCapabilities().permissions.trade).toBe(false)
  })
  it('reports invalid key as ERROR with the provider code', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v3/account', { status: 401, body: { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' } }]])
    const h = await new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch }).connect()
    expect(h.state).toBe('ERROR')
    expect(h.reasons[0]).toBe('INVALID_CREDENTIALS (-2015)')
  })
  it('never contacts production: a production base URL is blocked before fetch', async () => {
    const m = mockFetch([])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch, baseUrl: 'https://api.binance.com' })
    await expect(a.submitOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'c1' })).rejects.toMatchObject({ code: 'ENVIRONMENT_MISMATCH' })
    // The public time call is the first thing that would hit the network; it's blocked too (not a demo host)
    expect(m.calls.length).toBe(0)
  })
})

describe('Binance orders', () => {
  it('submits a spot market order by quote amount and derives avg price from fills', async () => {
    const m = mockFetch([[...time], ['POST', '/api/v3/order', { body: { symbol: 'BTCUSDT', orderId: 42, clientOrderId: 'helm1', price: '0.00000000', origQty: '0.00010000', executedQty: '0.00010000', cummulativeQuoteQty: '9.50000000', status: 'FILLED', timeInForce: 'GTC', type: 'MARKET', side: 'BUY', transactTime: 1_700_000_000_500 } }]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    const o = await a.submitOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'helm1' })
    const post = m.calls.find(c => c.method === 'POST')!
    const qs = new URL(post.url).search.slice(1)
    expect(qs).toContain('quoteOrderQty=10')
    expect(qs).toContain('newClientOrderId=helm1')
    const [unsigned, sig] = qs.split('&signature=') as [string, string]
    expect(sig).toBe(signBinance(unsigned, creds.apiSecret))
    expect(o.status).toBe('FILLED')
    expect(o.providerOrderId).toBe('42')
    expect(o.avgFillPrice!.toFixed()).toBe('95000')
    expect(o.price).toBeNull()
  })
  it('treats a transport failure during submit as ORDER_UNKNOWN (never retried blindly)', async () => {
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: failingFetch() })
    ;(a.clock as unknown as { syncedAt: number }).syncedAt = Date.now()
    await expect(a.submitOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'x' })).rejects.toMatchObject({ code: 'ORDER_UNKNOWN', retryable: false })
  })
  it('treats HTTP 5xx on submit as ORDER_UNKNOWN', async () => {
    const m = mockFetch([[...time], ['POST', '/api/v3/order', { status: 503, body: { code: -1001, msg: 'Internal error; unable to process your request. Please try again.' } }]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    await expect(a.submitOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'x' })).rejects.toMatchObject({ code: 'ORDER_UNKNOWN' })
  })
  it('maps insufficient balance rejection', async () => {
    const m = mockFetch([[...time], ['POST', '/api/v3/order', { status: 400, body: { code: -2010, msg: 'Account has insufficient balance for requested action.' } }]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    await expect(a.submitOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'x' })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', providerCode: '-2010' })
  })
  it('reconcile returns null for an order the exchange never saw (-2013)', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v3/order', { status: 400, body: { code: -2013, msg: 'Order does not exist.' } }]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    expect(await a.reconcileOrder(btcusdtSpot.id, { clientOrderId: 'gone' })).toBeNull()
  })
  it('rejects orders breaking lot/tick/min-notional rules before sending', async () => {
    const m = mockFetch([[...time]])
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: m.fetch })
    const v = await a.validateOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'LIMIT', quantity: dec('0.000015'), price: dec('100.005'), clientOrderId: 'x' })
    expect(v.ok).toBe(false)
    expect(v.problems.join('|')).toMatch(/multiple of 0.00001.*tick 0.01.*below minimum 5/)
    await expect(a.submitOrder({ accountId: 'a1', instrument: btcusdtSpot, side: 'BUY', type: 'LIMIT', quantity: dec('0.000015'), price: dec('100.005'), clientOrderId: 'x' })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' })
    expect(m.calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })
  it('USDⓈ-M: hedge-mode orders use positionSide and drop reduceOnly; one-way keeps reduceOnly', async () => {
    const order = { symbol: 'BTCUSDT', orderId: 7, clientOrderId: 'f1', price: '0', origQty: '0.001', executedQty: '0', cumQuote: '0', avgPrice: '0', status: 'NEW', type: 'MARKET', side: 'SELL', updateTime: 1 }
    const m = mockFetch([['GET', '/fapi/v1/time', { body: { serverTime: Date.now() } }], ['POST', '/fapi/v1/order', { body: order }]])
    const a = new BinanceAdapter(creds, { market: 'usdm', accountId: 'f', fetch: m.fetch })
    await a.submitOrder({ accountId: 'f', instrument: btcusdtPerp, side: 'SELL', type: 'MARKET', quantity: dec('0.001'), reduceOnly: true, positionSide: 'LONG', clientOrderId: 'f1' })
    const hedge = new URL(m.calls.at(-1)!.url).searchParams
    expect(hedge.get('positionSide')).toBe('LONG')
    expect(hedge.get('reduceOnly')).toBeNull()
    expect(m.calls.at(-1)!.url.startsWith('https://demo-fapi.binance.com/fapi/v1/order')).toBe(true)
    const o = await a.submitOrder({ accountId: 'f', instrument: btcusdtPerp, side: 'SELL', type: 'MARKET', quantity: dec('0.001'), reduceOnly: true, clientOrderId: 'f2' })
    expect(new URL(m.calls.at(-1)!.url).searchParams.get('reduceOnly')).toBe('true')
    expect(o.status).toBe('ACCEPTED') // NEW ≠ filled
  })
  it('refuses fractional leverage', async () => {
    const a = new BinanceAdapter(creds, { market: 'usdm', accountId: 'f', fetch: mockFetch([]).fetch })
    await expect(a.setLeverage(btcusdtPerp.id, dec('2.5'))).rejects.toBeInstanceOf(HelmError)
  })
  it('spot adapter refuses futures-only operations with a capability error', async () => {
    const a = new BinanceAdapter(creds, { market: 'spot', accountId: 'a1', fetch: mockFetch([]).fetch })
    await expect(a.getPositions()).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    await expect(a.setLeverage(btcusdtSpot.id, dec('2'))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
})

describe('Binance parsing', () => {
  it('parses exchangeInfo filters into instrument rules', () => {
    const ins = parseBinanceSymbol({ symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT', filters: [
      { filterType: 'PRICE_FILTER', tickSize: '0.01000000' }, { filterType: 'LOT_SIZE', stepSize: '0.00010000', minQty: '0.00010000', maxQty: '9000.00000000' }, { filterType: 'NOTIONAL', minNotional: '5.00000000' }] }, 'spot')
    expect(ins.id).toBe('binance:spot:ETH-USDT')
    expect(ins.lotSize.toFixed()).toBe('0.0001')
    expect(ins.tickSize.toFixed()).toBe('0.01')
    expect(ins.minNotional!.toFixed()).toBe('5')
    expect(ins.status).toBe('trading')
  })
  it('maps order statuses', () => {
    expect(mapBinanceStatus('NEW')).toBe('ACCEPTED')
    expect(mapBinanceStatus('EXPIRED_IN_MATCH')).toBe('EXPIRED')
    expect(mapBinanceStatus('???')).toBe('UNKNOWN')
  })
})
