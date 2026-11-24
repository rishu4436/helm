import { describe, expect, it } from 'vitest'
import { dec } from '@helm/shared'
import { AlpacaPaperAdapter, CoinbaseSandboxAdapter, COINBASE_STATIC_LABEL, IbkrGatewayAdapter, isIbkrPaperAccountId } from '../index'
import { failingFetch, mockFetch } from './mock-fetch'
import { aaplAlpaca, aaplIbkr, cbSpot } from './fixtures'

describe('Coinbase static sandbox', () => {
  const accounts = { accounts: [{ uuid: 'u', name: 'USDC Wallet', currency: 'USDC', available_balance: { value: '100', currency: 'USDC' }, hold: { value: '0', currency: 'USDC' } }] }
  it('connects as LIMITED with an explicit static label, read-only manifest', async () => {
    const m = mockFetch([['GET', '/accounts', { body: accounts }]])
    const a = new CoinbaseSandboxAdapter({ accountId: 'c', fetch: m.fetch })
    const h = await a.connect()
    expect(h.state).toBe('LIMITED')
    expect(h.reasons).toContain(COINBASE_STATIC_LABEL)
    expect(a.getCapabilities()).toMatchObject({ environment: 'sandbox_static', simulation: 'static_responses', permissions: { trade: false } })
    expect(m.calls[0]!.url.startsWith('https://api-sandbox.coinbase.com/api/v3/brokerage/')).toBe(true)
  })
  it('marks every order simulatedStatic and never FILLED', async () => {
    const m = mockFetch([['POST', '/orders', { body: { success: true, success_response: { order_id: 'mock-1', client_order_id: 'c' } } }]])
    const o = await new CoinbaseSandboxAdapter({ accountId: 'c', fetch: m.fetch }).submitOrder({ accountId: 'c', instrument: cbSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'c' })
    expect(o.simulatedStatic).toBe(true)
    expect(o.status).not.toBe('FILLED')
    expect(JSON.parse(m.calls[0]!.body!).order_configuration).toEqual({ market_market_ioc: { quote_size: '10' } })
  })
  it('sends the X-Sandbox header to trigger documented error variants', async () => {
    const m = mockFetch([['POST', '/orders', { status: 400, body: { error: 'INSUFFICIENT_FUND', message: 'Insufficient balance in source account' } }]])
    const a = new CoinbaseSandboxAdapter({ accountId: 'c', fetch: m.fetch })
    a.useScenario('PostOrder_insufficient_fund')
    await expect(a.submitOrder({ accountId: 'c', instrument: cbSpot, side: 'BUY', type: 'MARKET', quoteQuantity: dec('10'), clientOrderId: 'c' })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' })
    expect(m.calls[0]!.headers['X-Sandbox']).toBe('PostOrder_insufficient_fund')
  })
})

describe('Alpaca paper', () => {
  it('verifies the paper account prefix', async () => {
    const live = mockFetch([['GET', '/v2/account', { body: { account_number: '123456', status: 'ACTIVE', trading_blocked: false } }]])
    expect((await new AlpacaPaperAdapter({ keyId: 'k', secretKey: 's' }, { accountId: 'a', fetch: live.fetch }).connect()).state).toBe('ERROR')
    const paper = mockFetch([['GET', '/v2/account', { body: { account_number: 'PA3ABC', status: 'ACTIVE', trading_blocked: false } }]])
    expect((await new AlpacaPaperAdapter({ keyId: 'k', secretKey: 's' }, { accountId: 'a', fetch: paper.fetch }).connect()).state).toBe('CONNECTED')
    expect(paper.calls[0]!.url.startsWith('https://paper-api.alpaca.markets/')).toBe(true)
  })
  it('fractional orders are DAY and market/limit only', () => {
    const a = new AlpacaPaperAdapter({ keyId: 'k', secretKey: 's' }, { accountId: 'a', fetch: mockFetch([]).fetch })
    expect(a.buildOrderBody({ accountId: 'a', instrument: aaplAlpaca, side: 'BUY', type: 'MARKET', quoteQuantity: dec('25'), clientOrderId: 'c' })).toMatchObject({ notional: '25', time_in_force: 'day', qty: undefined })
    expect(() => a.buildOrderBody({ accountId: 'a', instrument: aaplAlpaca, side: 'BUY', type: 'STOP_MARKET', quantity: dec('0.5'), stopPrice: dec('100'), clientOrderId: 'c' })).toThrow(/fractional/)
  })
})

describe('IBKR Client Portal Gateway', () => {
  it('recognises paper account ids', () => {
    expect(isIbkrPaperAccountId('DU1234567')).toBe(true)
    expect(isIbkrPaperAccountId('U1234567')).toBe(false)
  })
  it('CONNECTED only for an authenticated paper session', async () => {
    const m = mockFetch([['POST', '/iserver/auth/status', { body: { authenticated: true, connected: true, competing: false } }], ['GET', '/iserver/accounts', { body: { accounts: ['DU1234567'], isPaper: true, selectedAccount: 'DU1234567' } }]])
    expect((await new IbkrGatewayAdapter({ accountId: 'i', fetch: m.fetch }).connect()).state).toBe('CONNECTED')
    expect(m.calls[0]!.url).toBe('https://localhost:5000/v1/api/iserver/auth/status')
  })
  it('blocks live sessions, reports EXPIRED when logged out, DISCONNECTED when gateway down', async () => {
    const live = mockFetch([['POST', '/iserver/auth/status', { body: { authenticated: true, connected: true, competing: false } }], ['GET', '/iserver/accounts', { body: { accounts: ['U1234567'], isPaper: false } }]])
    const a = new IbkrGatewayAdapter({ accountId: 'i', fetch: live.fetch })
    expect((await a.connect()).state).toBe('ERROR')
    await expect(a.getPositions()).rejects.toMatchObject({ code: 'ENVIRONMENT_MISMATCH' })
    const out = mockFetch([['POST', '/iserver/auth/status', { body: { authenticated: false, connected: true, competing: false } }]])
    expect((await new IbkrGatewayAdapter({ accountId: 'i', fetch: out.fetch }).connect()).state).toBe('EXPIRED')
    expect((await new IbkrGatewayAdapter({ accountId: 'i', fetch: failingFetch(new Error('ECONNREFUSED')) }).connect()).state).toBe('DISCONNECTED')
  })
  it('refuses a non-loopback gateway', async () => {
    const m = mockFetch([])
    const h = await new IbkrGatewayAdapter({ accountId: 'i', fetch: m.fetch, baseUrl: 'https://10.0.0.5:5000/v1/api' }).connect()
    expect(h.state).toBe('ERROR')
    expect(m.calls).toHaveLength(0)
  })
  it('surfaces order warning prompts instead of auto-confirming', async () => {
    const m = mockFetch([['POST', '/iserver/auth/status', { body: { authenticated: true, connected: true, competing: false } }], ['GET', '/iserver/accounts', { body: { accounts: ['DU1'], isPaper: true } }],
      ['POST', '/iserver/account/DU1/orders', { body: [{ id: 'reply-1', message: ['You are submitting an order without market data.'] }] }]])
    const a = new IbkrGatewayAdapter({ accountId: 'i', fetch: m.fetch })
    await a.connect()
    const o = await a.submitOrder({ accountId: 'i', instrument: aaplIbkr, side: 'BUY', type: 'MARKET', quantity: dec('1'), clientOrderId: 'c' })
    expect(o.status).toBe('AWAITING_CONFIRMATION')
    expect((o.raw as { prompt: { replyId: string } }).prompt.replyId).toBe('reply-1')
    expect(m.calls.some(c => c.url.includes('/iserver/reply/'))).toBe(false)
    expect(JSON.parse(m.calls.at(-1)!.body!).orders[0]).toMatchObject({ conid: 265598, orderType: 'MKT', quantity: 1, cOID: 'c' })
  })
})
