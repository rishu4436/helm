import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { FetchLike } from '@helm/connectors'
import { makeAdapterFactory } from './registry'
import { buildApp } from './app'
import { cleanupGuests } from './engine/guests'

const TEST_DB = process.env.HELM_TEST_DATABASE_URL ?? 'postgresql://helm@127.0.0.1:5444/helm_test'
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } })
let app: FastifyInstance
const px: Record<string, number> = { BTC: 60000, ETH: 3000, SOL: 150, BNB: 600 }
const seen: string[] = []
const book = (mid: number) => ({ bids: [0, 1, 2, 3].map(i => [String(mid - 0.5 - i), '5']), asks: [0, 1, 2, 3].map(i => [String(mid + 0.5 + i), String(0.01 * (i + 1))]) })
const fakeFetch: FetchLike = async url => {
  seen.push(url)
  const json = (b: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(b) })
  const u = new URL(url)
  const sym = (u.searchParams.get('symbol') ?? '').replace(/USDT$/, '')
  if (u.pathname === '/api/v3/ticker/24hr') return px[sym] ? json({ symbol: `${sym}USDT`, lastPrice: String(px[sym]), priceChangePercent: '-1.234', closeTime: Date.now() }) : json({ code: -1121, msg: 'Invalid symbol.' }, 400)
  if (u.pathname === '/api/v3/klines') return px[sym] ? json(Array.from({ length: 24 }, (_, i) => [Date.now() - (24 - i) * 3600_000, '1', '1', '1', String(px[sym]! + i)])) : json({ code: -1121 }, 400)
  if (u.pathname.endsWith('/depth')) return json({ ...book(px[sym] ?? 100), E: Date.now(), T: Date.now() })
  if (u.pathname === '/v5/market/orderbook') { const b = book(px[sym] ?? 100); return json({ retCode: 0, retMsg: 'OK', result: { b: b.bids, a: b.asks, ts: Date.now() }, time: Date.now() }) }
  if (u.pathname.endsWith('/market/books')) { const b = book(px[(u.searchParams.get('instId') ?? 'BTC').split('-')[0] ?? 'BTC'] ?? 100); return json({ code: '0', data: [{ bids: b.bids, asks: b.asks, ts: String(Date.now()) }] }) }
  return json({ error: 'unmocked' }, 404)
}
const H = (t: string) => ({ authorization: `Bearer ${t}` })
async function register(email: string) { return (await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'correct horse battery' } })).json().token as string }
async function simAccount(t: string) { return (await app.inject({ method: 'POST', url: '/v1/connections', headers: H(t), payload: { provider: 'binance', alias: 'Binance · SIM', simulated: true } })).json().connection.accounts[0].id as string }
const preview = (t: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/trade/preview', headers: H(t), payload })
const confirm = (t: string, p: { proposalId: string; confirmToken: string }) => app.inject({ method: 'POST', url: '/v1/trade/confirm', headers: H(t), payload: { proposalId: p.proposalId, confirmToken: p.confirmToken, idempotencyKey: randomBytes(8).toString('hex'), via: 'glasses' } })

beforeAll(async () => { app = await buildApp({ prisma, credentialKey: randomBytes(32), adapterFactory: makeAdapterFactory(fakeFetch), marketFetch: fakeFetch, rateLimitMax: 10_000, rateLimitScale: 1000 }) })
beforeEach(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(',')} CASCADE`)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('UX 2.0 preferences', () => {
  it('merges partial updates, is per-user, and rejects anything outside presentation', async () => {
    const t = await register('p@helm.test'); const t2 = await register('p2@helm.test')
    expect((await app.inject({ url: '/v1/preferences', headers: H(t) })).json()).toEqual({ preferences: {} })
    let r = await app.inject({ method: 'PUT', url: '/v1/preferences', headers: H(t), payload: { mode: 'pro', watchlist: ['btc', 'SOL'] } })
    expect(r.statusCode).toBe(200)
    r = await app.inject({ method: 'PUT', url: '/v1/preferences', headers: H(t), payload: { privacy: true, onboarding: { stage: 'gestures' } } })
    expect(r.json().preferences).toMatchObject({ mode: 'pro', watchlist: ['BTC', 'SOL'], privacy: true, onboarding: { stage: 'gestures' } })
    r = await app.inject({ method: 'PUT', url: '/v1/preferences', headers: H(t), payload: { lastOrder: { asset: 'eth', accountId: 'a1', product: 'spot', side: 'BUY' }, recentSizes: ['50', '25.5'] } })
    expect(r.json().preferences).toMatchObject({ lastOrder: { asset: 'ETH', product: 'spot' }, recentSizes: ['50', '25.5'] })
    for (const bad of [{ lastOrder: { asset: 'BTC', accountId: 'a', product: 'option', side: 'BUY' } }, { recentSizes: ['1', '2', '3', '4'] }, { lastOrder: { asset: 'BTC', accountId: 'a', product: 'spot', side: 'BUY', key: 'x' } }])
      expect((await app.inject({ method: 'PUT', url: '/v1/preferences', headers: H(t), payload: bad })).statusCode).toBe(400)
    expect((await app.inject({ url: '/v1/preferences', headers: H(t2) })).json().preferences).toEqual({})
    for (const bad of [{ maxOrderNotionalUsd: '999999' }, { mode: 'god' }, { watchlist: ['B T C'] }, { deckOrder: ['withdraw'] }]) {
      expect((await app.inject({ method: 'PUT', url: '/v1/preferences', headers: H(t), payload: bad })).statusCode).toBe(400)
    }
    expect((await app.inject({ url: '/v1/preferences' })).statusCode).toBe(401)
  })
})

describe('UX 2.0 markets', () => {
  it('watchlist carries the venue 24h change; unknown assets are null, never guessed', async () => {
    const t = await register('m@helm.test')
    const r = (await app.inject({ url: '/v1/markets/watchlist?assets=BTC,NOPE', headers: H(t) })).json()
    expect(r.items[0]).toMatchObject({ asset: 'BTC', price: '60000', change24hPct: '-1.23' })
    expect(r.items[1]).toMatchObject({ asset: 'NOPE', price: null, change24hPct: null })
  })
  it('snapshot uses verified hourly candles only, from the Binance Demo host', async () => {
    const t = await register('s@helm.test')
    const s = (await app.inject({ url: '/v1/markets/ETH/snapshot', headers: H(t) })).json()
    expect(s).toMatchObject({ asset: 'ETH', price: '3000', period: '24h', source: 'Binance Demo ticker' })
    expect(s.candles.closes).toHaveLength(24)
    expect(seen.filter(u => u.includes('/api/v3/')).every(u => u.startsWith('https://demo-api.binance.com/'))).toBe(true)
    const none = (await app.inject({ url: '/v1/markets/NOPE/snapshot', headers: H(t) })).json()
    expect(none.candles).toBeNull(); expect(none.price).toBeNull()
  })
  it('venue compare with a size adds impact and an estimated cost (fee assumption labelled)', async () => {
    const t = await register('v@helm.test')
    const r = (await app.inject({ url: '/v1/markets/BTC?product=spot&notional=1000', headers: H(t) })).json()
    expect(r.notionalUsd).toBe('1000')
    expect(r.feeNote).toMatch(/assumption/)
    const ok = r.venues.filter((v: { error?: string }) => !v.error)
    expect(ok.length).toBeGreaterThan(0)
    for (const v of ok) { expect(Number(v.impactBps)).toBeGreaterThan(0); expect(Number(v.estCostBps)).toBeGreaterThan(Number(v.impactBps)) }
    const huge = (await app.inject({ url: '/v1/markets/BTC?product=spot&notional=99999999', headers: H(t) })).json()
    expect(huge.venues.filter((v: { error?: string }) => !v.error).every((v: { impactBps: unknown }) => v.impactBps === null)).toBe(true) // too thin → null, not a guess
  })
})

describe('UX 2.0 portfolio holdings', () => {
  it('lists per-asset holdings and available cash per account', async () => {
    const t = await register('h@helm.test'); const acct = await simAccount(t)
    const p = (await app.inject({ url: '/v1/portfolio', headers: H(t) })).json().portfolio
    expect(Array.isArray(p.holdings)).toBe(true)
    expect(p.holdings.length).toBeGreaterThan(0)
    expect(p.holdings[0]).toHaveProperty('free')
    expect(p.accounts.find((a: { accountId: string }) => a.accountId === acct)).toHaveProperty('availableUsd')
  })
})

describe('UX 2.0 activity', () => {
  it('current shows an unprotected position; ack keeps it, dismiss hides it 4h; it resolves when protected', async () => {
    const t = await register('act@helm.test'); const acct = await simAccount(t)
    const entry = (await confirm(t, (await preview(t, { accountId: acct, asset: 'BTC', product: 'perp', side: 'BUY', quantity: '0.004', leverage: '2' })).json())).json().receipt
    let a = (await app.inject({ url: '/v1/activity', headers: H(t) })).json()
    const cur = a.current.find((x: { kind: string }) => x.kind === 'POSITION_UNPROTECTED')
    expect(cur).toBeTruthy()
    expect(cur.actions.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['protect', 'position', 'ack', 'dismiss']))
    expect(a.recent.some((x: { kind: string }) => x.kind === 'ORDER_FILLED')).toBe(true)
    expect((await app.inject({ method: 'POST', url: `/v1/activity/${encodeURIComponent(cur.id)}/ack`, headers: H(t), payload: {} })).json().ok).toBe(true)
    a = (await app.inject({ url: '/v1/activity', headers: H(t) })).json()
    expect(a.current.find((x: { id: string }) => x.id === cur.id).acknowledged).toBe(true)
    const d = (await app.inject({ method: 'POST', url: `/v1/activity/${encodeURIComponent(cur.id)}/dismiss`, headers: H(t), payload: {} })).json()
    expect(new Date(d.until).getTime() - Date.now()).toBeGreaterThan(3.9 * 3600_000)
    a = (await app.inject({ url: '/v1/activity', headers: H(t) })).json()
    expect(a.current.find((x: { id: string }) => x.id === cur.id)).toBeUndefined()
    // another user can't see or touch it
    const t2 = await register('act2@helm.test')
    expect((await app.inject({ url: '/v1/activity', headers: H(t2) })).json().current).toHaveLength(0)
    // protect → the unprotected condition is gone (current), stop is listed
    await prisma.activityMark.deleteMany({})
    const pp = (await app.inject({ method: 'POST', url: '/v1/protection/preview', headers: H(t), payload: { accountId: acct, instrumentId: entry.instrumentId, stopOffsetPercent: '3' } })).json()
    expect((await confirm(t, pp)).statusCode).toBe(200)
    a = (await app.inject({ url: '/v1/activity', headers: H(t) })).json()
    expect(a.current.some((x: { kind: string }) => x.kind === 'POSITION_UNPROTECTED')).toBe(false)
  })
  it('critical items cannot be dismissed; ids are validated', async () => {
    const t = await register('crit@helm.test')
    expect((await app.inject({ method: 'POST', url: '/v1/activity/cur%3Aliq%3Ax%7Cy/dismiss', headers: H(t), payload: {} })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/v1/activity/evil/dismiss', headers: H(t), payload: {} })).statusCode).toBe(400)
  })
})

describe('UX 2.0 contextual voice', () => {
  it('resolves against screen context and never executes', async () => {
    const t = await register('voice@helm.test'); const acct = await simAccount(t)
    const r = (await app.inject({ method: 'POST', url: '/v1/voice/command', headers: H(t), payload: { transcript: 'buy 50 dollars of ETH', context: { screen: 'account', accountId: acct } } })).json()
    expect(r.action.kind).toBe('propose')
    expect(r.action.ticket).toMatchObject({ accountId: acct, asset: 'ETH', side: 'BUY', notional: '50' })
    expect(typeof r.interpretation).toBe('string')
    expect(await prisma.order.count()).toBe(0)
    const w = (await app.inject({ method: 'POST', url: '/v1/voice/command', headers: H(t), payload: { transcript: 'withdraw all my USDT', context: { screen: 'home' } } })).json()
    expect(w.action.kind).toBe('reject')
    const legacy = (await app.inject({ method: 'POST', url: '/v1/voice/command', headers: H(t), payload: { transcript: 'show my positions' } })).json()
    expect(legacy.next).toBeTruthy(); expect(legacy.action).toBeTruthy()
  })
})

describe('guest cleanup', () => {
  it('deletes expired guests and everything they own, keeps fresh guests and real users', async () => {
    const g = (await app.inject({ method: 'POST', url: '/v1/auth/demo' })).json()
    const acct = g.accounts[0].accountId ?? g.accounts[0].id
    await confirm(g.token, (await preview(g.token, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '20' })).json())
    const real = await register('real@helm.test')
    expect(real).toBeTruthy()
    expect(await cleanupGuests(prisma)).toBe(0)
    await prisma.user.update({ where: { id: g.user.id }, data: { createdAt: new Date(Date.now() - 49 * 3600_000) } })
    expect(await cleanupGuests(prisma)).toBe(1)
    expect(await prisma.user.count({ where: { id: g.user.id } })).toBe(0)
    expect(await prisma.orderProposal.count({ where: { userId: g.user.id } })).toBe(0)
    expect(await prisma.user.count()).toBe(1)
  })
})
