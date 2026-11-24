import { describe, expect, it } from 'vitest'
import { dec } from '@helm/shared'
import { BybitAdapter, mapBybitStatus, signBybit } from '../index'
import { mockFetch } from './mock-fetch'
import { bybitLinear, bybitSpot } from './fixtures'

const creds = { apiKey: 'XXXXXXXXXX', apiSecret: 'test-bybit-secret' }
const time = ['GET', '/v5/market/time', { body: { retCode: 0, retMsg: 'OK', result: { timeSecond: '1', timeNano: String(BigInt(Date.now()) * 1_000_000n) }, time: Date.now() } }] as const
const ok = <T>(result: T) => ({ body: { retCode: 0, retMsg: 'OK', result, time: Date.now() } })

describe('Bybit signing', () => {
  // Vectors computed independently with openssl (see docs/RESEARCH.md)
  it('signs GET over timestamp+key+recvWindow+queryString', () => {
    expect(signBybit('1658385579423', 'XXXXXXXXXX', '5000', 'category=option&symbol=BTC-29JUL22-25000-C', 'test-bybit-secret')).toBe('9769f6ba9c6923919996da576cf887502d39ed75e15b457d4afae9a3f89cf001')
  })
  it('signs POST over the raw JSON body', () => {
    const body = '{"category":"option","symbol":"BTC-29JUL22-25000-C","orderType":"Limit","side":"Buy","qty":"1","price":"0.05","orderLinkId":"x"}'
    expect(signBybit('1658384314791', 'XXXXXXXXXX', '5000', body, 'test-bybit-secret')).toBe('6f78dbf73de68d21fb170ab861be699459d0afd2e748413a20fde9cc65baa3ec')
  })
})

describe('Bybit connection', () => {
  it('targets api-demo.bybit.com and inspects key permissions', async () => {
    const m = mockFetch([[...time], ['GET', '/v5/account/info', ok({ unifiedMarginStatus: 5, marginMode: 'REGULAR_MARGIN' })], ['GET', '/v5/user/query-api', ok({ readOnly: 0, permissions: { ContractTrade: ['Order', 'Position'], Spot: ['SpotTrade'], Wallet: ['AccountTransfer'] } })]])
    const a = new BybitAdapter(creds, { accountId: 'b', fetch: m.fetch })
    expect((await a.connect()).state).toBe('CONNECTED')
    for (const c of m.calls) expect(c.url.startsWith('https://api-demo.bybit.com/')).toBe(true)
    const info = m.calls.find(c => c.url.includes('/v5/account/info'))!
    expect(info.headers['X-BAPI-SIGN']).toBe(signBybit(info.headers['X-BAPI-TIMESTAMP']!, creds.apiKey, '5000', '', creds.apiSecret))
  })
  it('read-only key → READ_ONLY; withdraw permission → LIMITED; missing query-api → LIMITED', async () => {
    const ro = mockFetch([[...time], ['GET', '/v5/account/info', ok({ unifiedMarginStatus: 5 })], ['GET', '/v5/user/query-api', ok({ readOnly: 1, permissions: {} })]])
    expect((await new BybitAdapter(creds, { accountId: 'b', fetch: ro.fetch }).connect()).state).toBe('READ_ONLY')
    const wd = mockFetch([[...time], ['GET', '/v5/account/info', ok({ unifiedMarginStatus: 5 })], ['GET', '/v5/user/query-api', ok({ readOnly: 0, permissions: { Wallet: ['Withdraw'] } })]])
    expect((await new BybitAdapter(creds, { accountId: 'b', fetch: wd.fetch }).connect()).state).toBe('LIMITED')
    const na = mockFetch([[...time], ['GET', '/v5/account/info', ok({ unifiedMarginStatus: 5 })]])
    expect((await new BybitAdapter(creds, { accountId: 'b', fetch: na.fetch }).connect()).state).toBe('LIMITED')
  })
  it('maps invalid key', async () => {
    const m = mockFetch([[...time], ['GET', '/v5/account/info', { body: { retCode: 10003, retMsg: 'API key is invalid.', result: {}, time: 0 } }]])
    const h = await new BybitAdapter(creds, { accountId: 'b', fetch: m.fetch }).connect()
    expect(h).toMatchObject({ state: 'ERROR', reasons: ['INVALID_CREDENTIALS (10003)'] })
  })
})

describe('Bybit orders', () => {
  const a = new BybitAdapter(creds, { accountId: 'b', fetch: mockFetch([]).fetch })
  it('spot market by quote uses marketUnit=quoteCoin', () => {
    expect(a.buildOrderBody({ accountId: 'b', instrument: bybitSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('100'), clientOrderId: 'c' })).toMatchObject({ category: 'spot', qty: '100', marketUnit: 'quoteCoin', side: 'Buy', orderType: 'Market' })
  })
  it('linear orders set positionIdx and reduceOnly', () => {
    expect(a.buildOrderBody({ accountId: 'b', instrument: bybitLinear, side: 'SELL', type: 'MARKET', quantity: dec('0.01'), reduceOnly: true, clientOrderId: 'c' })).toMatchObject({ category: 'linear', positionIdx: 0, reduceOnly: true })
    expect(a.buildOrderBody({ accountId: 'b', instrument: bybitLinear, side: 'BUY', type: 'LIMIT', quantity: dec('0.01'), price: dec('90000'), positionSide: 'LONG', clientOrderId: 'c' })).toMatchObject({ positionIdx: 1, price: '90000', timeInForce: 'GTC' })
  })
  it('submit reconciles via realtime, falling back to history', async () => {
    const m = mockFetch([[...time], ['POST', '/v5/order/create', ok({ orderId: 'b-1', orderLinkId: 'c' })], ['GET', '/v5/order/realtime', ok({ list: [] })],
      ['GET', '/v5/order/history', ok({ list: [{ orderId: 'b-1', orderLinkId: 'c', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', price: '0', qty: '0.01', cumExecQty: '0.004', avgPrice: '95000', orderStatus: 'PartiallyFilledCanceled', timeInForce: 'IOC', reduceOnly: false, createdTime: '1700000000000', updatedTime: '1700000000001' }] })]])
    const b = new BybitAdapter(creds, { accountId: 'b', fetch: m.fetch })
    const o = await b.submitOrder({ accountId: 'b', instrument: bybitLinear, side: 'BUY', type: 'MARKET', quantity: dec('0.01'), clientOrderId: 'c' })
    expect(o.status).toBe('CANCELED')
    expect(o.filledQuantity.toFixed()).toBe('0.004')
    const post = m.calls.find(c => c.method === 'POST')!
    expect(post.headers['X-BAPI-SIGN']).toBe(signBybit(post.headers['X-BAPI-TIMESTAMP']!, creds.apiKey, '5000', post.body!, creds.apiSecret))
  })
  it('maps insufficient balance', async () => {
    const m = mockFetch([[...time], ['POST', '/v5/order/create', { body: { retCode: 110007, retMsg: 'ab not enough for new order', result: {}, time: 0 } }]])
    await expect(new BybitAdapter(creds, { accountId: 'b', fetch: m.fetch }).submitOrder({ accountId: 'b', instrument: bybitLinear, side: 'BUY', type: 'MARKET', quantity: dec('0.01'), clientOrderId: 'c' })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
  })
  it('maps statuses', () => {
    expect(mapBybitStatus('Untriggered')).toBe('ACCEPTED')
    expect(mapBybitStatus('PartiallyFilled')).toBe('PARTIALLY_FILLED')
    expect(mapBybitStatus('Rejected')).toBe('REJECTED')
  })
})
