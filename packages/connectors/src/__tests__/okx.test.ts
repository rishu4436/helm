import { describe, expect, it } from 'vitest'
import { dec } from '@helm/shared'
import { OkxAdapter, signOkx, mapOkxState, okxIdFromInstId, parseOkxInstrument } from '../index'
import { mockFetch } from './mock-fetch'
import { okxSpot, okxSwap } from './fixtures'

const creds = { apiKey: 'demo-key', apiSecret: 'test-okx-secret', passphrase: 'demo-pass' }
const time = ['GET', '/api/v5/public/time', { body: { code: '0', msg: '', data: [{ ts: String(Date.now()) }] } }] as const
const env = <T>(data: T[]) => ({ body: { code: '0', msg: '', data } })

describe('OKX signing', () => {
  // Vectors computed independently with: printf '%s' "<prehash>" | openssl dgst -sha256 -hmac test-okx-secret -binary | base64
  it('signs GET with the query string in requestPath', () => {
    expect(signOkx('2020-12-08T09:08:57.715Z', 'GET', '/api/v5/account/balance?ccy=BTC', '', 'test-okx-secret')).toBe('albCfCbx/nsIQICrkwf9LIczM5YOPX/2tp8lF6aux4w=')
  })
  it('signs POST over the exact JSON body', () => {
    const body = '{"instId":"BTC-USDT","tdMode":"cash","side":"buy","ordType":"limit","sz":"0.01","px":"30000"}'
    expect(signOkx('2020-12-08T09:08:57.715Z', 'post', '/api/v5/trade/order', body, 'test-okx-secret')).toBe('J5PQ6fcO5+ksZVWotgLSIsabkmBCz04gR9IQlKwBdXw=')
  })
  it('always attaches the demo header and passphrase', async () => {
    const a = new OkxAdapter(creds, { accountId: 'o1', fetch: mockFetch([]).fetch })
    const h = await a.signedHeaders('GET', '/api/v5/account/balance?ccy=BTC', '', '2020-12-08T09:08:57.715Z')
    expect(h).toMatchObject({ 'x-simulated-trading': '1', 'OK-ACCESS-PASSPHRASE': 'demo-pass', 'OK-ACCESS-SIGN': 'albCfCbx/nsIQICrkwf9LIczM5YOPX/2tp8lF6aux4w=' })
  })
})

describe('OKX connection', () => {
  it('reads account config, permissions and position mode', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v5/account/config', env([{ uid: '1', acctLv: '2', posMode: 'net_mode', perm: 'read_only,trade' }])]])
    const a = new OkxAdapter(creds, { accountId: 'o1', fetch: m.fetch })
    expect((await a.connect()).state).toBe('CONNECTED')
    expect(m.calls.at(-1)!.headers['x-simulated-trading']).toBe('1')
    expect(a.getCapabilities().restrictions.join(' ')).toContain('net_mode')
  })
  it('flags withdraw permission and read-only keys', async () => {
    const w = mockFetch([[...time], ['GET', '/api/v5/account/config', env([{ uid: '1', acctLv: '2', posMode: 'net_mode', perm: 'read_only,trade,withdraw' }])]])
    expect((await new OkxAdapter(creds, { accountId: 'o', fetch: w.fetch }).connect()).state).toBe('LIMITED')
    const r = mockFetch([[...time], ['GET', '/api/v5/account/config', env([{ uid: '1', acctLv: '2', posMode: 'net_mode', perm: 'read_only' }])]])
    expect((await new OkxAdapter(creds, { accountId: 'o', fetch: r.fetch }).connect()).state).toBe('READ_ONLY')
  })
  it('detects a live key used against demo (50101) as ENVIRONMENT_MISMATCH', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v5/account/config', { status: 401, body: { code: '50101', msg: 'APIKey does not match current environment.', data: [] } }]])
    const h = await new OkxAdapter(creds, { accountId: 'o', fetch: m.fetch }).connect()
    expect(h.state).toBe('ERROR')
    expect(h.reasons[0]).toBe('ENVIRONMENT_MISMATCH (50101)')
  })
})

describe('OKX orders', () => {
  it('builds spot market-by-quote body with tgtCcy and cash mode', () => {
    const a = new OkxAdapter(creds, { accountId: 'o', fetch: mockFetch([]).fetch })
    expect(a.buildOrderBody({ accountId: 'o', instrument: okxSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('100'), clientOrderId: 'c1' }))
      .toEqual({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '100', px: undefined, clOrdId: 'c1', tgtCcy: 'quote_ccy' })
  })
  it('requires posSide in hedge mode, reduceOnly in net mode', async () => {
    const m = mockFetch([[...time], ['GET', '/api/v5/account/config', env([{ uid: '1', acctLv: '2', posMode: 'long_short_mode', perm: 'read_only,trade' }])]])
    const a = new OkxAdapter(creds, { accountId: 'o', fetch: m.fetch })
    await a.connect()
    expect(() => a.buildOrderBody({ accountId: 'o', instrument: okxSwap, side: 'SELL', type: 'MARKET', quantity: dec('1'), clientOrderId: 'c' })).toThrow(/hedge mode/)
    expect(a.buildOrderBody({ accountId: 'o', instrument: okxSwap, side: 'SELL', type: 'MARKET', quantity: dec('1'), positionSide: 'LONG', clientOrderId: 'c' }).posSide).toBe('long')
    const n = new OkxAdapter(creds, { accountId: 'o', fetch: mockFetch([]).fetch })
    expect(n.buildOrderBody({ accountId: 'o', instrument: okxSwap, side: 'SELL', type: 'MARKET', quantity: dec('1'), reduceOnly: true, clientOrderId: 'c' })).toMatchObject({ reduceOnly: true, tdMode: 'cross' })
  })
  it('submits, then reconciles the real state instead of trusting the ack', async () => {
    const m = mockFetch([[...time],
      ['POST', '/api/v5/trade/order', env([{ ordId: '999', clOrdId: 'c1', sCode: '0', sMsg: '' }])],
      ['GET', '/api/v5/trade/order', env([{ instId: 'BTC-USDT', ordId: '999', clOrdId: 'c1', px: '', sz: '100', ordType: 'market', side: 'buy', state: 'filled', accFillSz: '0.00105', avgPx: '95238.1', cTime: '1700000000000', uTime: '1700000000100', tgtCcy: 'quote_ccy' }])]])
    const a = new OkxAdapter(creds, { accountId: 'o', fetch: m.fetch })
    const o = await a.submitOrder({ accountId: 'o', instrument: okxSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('100'), clientOrderId: 'c1' })
    expect(o.status).toBe('FILLED')
    expect(o.filledQuantity.toFixed()).toBe('0.00105')
    expect(o.quoteQuantity!.toFixed()).toBe('100')
    const post = m.calls.find(c => c.method === 'POST')!
    expect(JSON.parse(post.body!)).toMatchObject({ clOrdId: 'c1', tgtCcy: 'quote_ccy' })
    expect(post.headers['OK-ACCESS-SIGN']).toBe(signOkx(post.headers['OK-ACCESS-TIMESTAMP']!, 'POST', '/api/v5/trade/order', post.body!, creds.apiSecret))
  })
  it('maps per-order sCode errors (51008 insufficient balance)', async () => {
    const m = mockFetch([[...time], ['POST', '/api/v5/trade/order', { body: { code: '1', msg: 'All operations failed', data: [{ ordId: '', clOrdId: 'c', sCode: '51008', sMsg: 'Order failed. Insufficient USDT balance in account.' }] } }]])
    const a = new OkxAdapter(creds, { accountId: 'o', fetch: m.fetch })
    await expect(a.submitOrder({ accountId: 'o', instrument: okxSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('100'), clientOrderId: 'c' })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', providerCode: '51008' })
  })
  it('does not support conditional orders on the plain order path', () => {
    const a = new OkxAdapter(creds, { accountId: 'o', fetch: mockFetch([]).fetch })
    expect(() => a.buildOrderBody({ accountId: 'o', instrument: okxSwap, side: 'SELL', type: 'STOP_MARKET', quantity: dec('1'), stopPrice: dec('1'), clientOrderId: 'c' })).toThrow(/algo-order/)
  })
})

describe('OKX parsing', () => {
  it('maps instruments, ids and states', () => {
    const ins = parseOkxInstrument({ instId: 'BTC-USDT-SWAP', baseCcy: '', quoteCcy: '', settleCcy: 'USDT', ctVal: '0.01', ctValCcy: 'BTC', lotSz: '0.01', minSz: '0.01', tickSz: '0.1', state: 'live', uly: 'BTC-USDT' }, 'perp')
    expect(ins).toMatchObject({ id: 'okx:perp:BTC-USDT:USDT', quantityUnit: 'contracts', status: 'trading' })
    expect(ins.contractMultiplier.toFixed()).toBe('0.01')
    expect(okxIdFromInstId('BTC-USD-SWAP')).toBe('okx:perp:BTC-USD:BTC')
    expect(mapOkxState('partially_filled')).toBe('PARTIALLY_FILLED')
  })
})
