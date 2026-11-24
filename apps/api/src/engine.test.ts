import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { FetchLike } from '@helm/connectors'
import { makeAdapterFactory } from './registry'
import { buildApp } from './app'

const TEST_DB = process.env.HELM_TEST_DATABASE_URL ?? 'postgresql://helm@127.0.0.1:5444/helm_test'
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } })
let app: FastifyInstance
const px: Record<string, number> = { BTC: 60000, ETH: 3000, SOL: 150, BNB: 600 }

// Offline public books (shape of Binance/Bybit public depth). Mid = px[asset].
const book = (mid: number) => ({ bids: [0, 1, 2, 3].map(i => [String(mid - 0.5 - i), '5']), asks: [0, 1, 2, 3].map(i => [String(mid + 0.5 + i), '5']) })
const fakeFetch: FetchLike = async url => {
  const json = (b: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(b) })
  const u = new URL(url)
  const sym = (u.searchParams.get('symbol') ?? '').replace(/USDT$/, '')
  if (u.pathname.endsWith('/depth')) return json({ ...book(px[sym] ?? 100), E: Date.now(), T: Date.now() })
  if (u.pathname === '/v5/market/orderbook') { const b = book(px[sym] ?? 100); return json({ retCode: 0, retMsg: 'OK', result: { b: b.bids, a: b.asks, ts: Date.now() }, time: Date.now() }) }
  return json({ error: 'unmocked' }, 404)
}

async function register(email: string) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'correct horse battery' } })
  return r.json().token as string
}
const H = (t: string) => ({ authorization: `Bearer ${t}` })
async function simAccount(t: string, provider = 'binance', alias = 'Binance · SIM') {
  const r = await app.inject({ method: 'POST', url: '/v1/connections', headers: H(t), payload: { provider, alias, simulated: true } })
  expect(r.statusCode).toBe(201)
  return r.json().connection.accounts[0].id as string
}
const preview = (t: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/trade/preview', headers: H(t), payload })
const confirm = (t: string, p: { proposalId: string; confirmToken: string }, key = randomBytes(8).toString('hex')) => app.inject({ method: 'POST', url: '/v1/trade/confirm', headers: H(t), payload: { proposalId: p.proposalId, confirmToken: p.confirmToken, idempotencyKey: key, via: 'glasses' } })

beforeAll(async () => { app = await buildApp({ prisma, credentialKey: randomBytes(32), adapterFactory: makeAdapterFactory(fakeFetch), marketFetch: fakeFetch, rateLimitMax: 10_000, rateLimitScale: 1000 }) })
beforeEach(async () => {
  px.BTC = 60000
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(',')} CASCADE`)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('trade engine: preview → confirm → simulated submit → receipt', () => {
  it('runs the core flow and labels the fill as SIMULATED (never a real fill)', async () => {
    const t = await register('a@helm.test'); const acct = await simAccount(t)
    const p = await preview(t, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '100' })
    expect(p.statusCode).toBe(200)
    const pv = p.json()
    expect(pv.canConfirm).toBe(true)
    expect(pv.account.environmentLabel).toBe('SIMULATED')
    expect(pv.label).toMatch(/SIMULATED by HELM/)
    expect(pv.risk.verdict).not.toBe('BLOCK')
    const c = await confirm(t, pv)
    expect(c.statusCode).toBe(200)
    const r = c.json().receipt
    expect(r.status).toBe('FILLED')
    expect(r.label).toMatch(/SIMULATED/)
    expect(r.fillTruth).toMatch(/computed locally/)
    expect(Number(r.filledQuantity)).toBeGreaterThan(0)
    expect(r.events.map((e: { to: string }) => e.to)).toEqual(expect.arrayContaining(['DRAFT', 'VALIDATED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'SUBMITTING', 'FILLED']))
    expect(r.events.find((e: { to: string }) => e.to === 'CONFIRMED').actor).toBe('user')
    const pulse = (await app.inject({ method: 'GET', url: '/v1/pulse', headers: H(t) })).json()
    expect(pulse.events.some((e: { kind: string }) => e.kind === 'ORDER_FILLED')).toBe(true)
  })

  it('idempotency: the same key replays the same order; a used token cannot submit again', async () => {
    const t = await register('b@helm.test'); const acct = await simAccount(t)
    const pv = (await preview(t, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '50' })).json()
    const c1 = await confirm(t, pv, 'idem-key-0001')
    const c2 = await confirm(t, pv, 'idem-key-0001')
    expect(c2.statusCode).toBe(200)
    expect(c2.json().replayed).toBe(true)
    expect(c2.json().receipt.orderId).toBe(c1.json().receipt.orderId)
    const c3 = await confirm(t, pv, 'idem-key-0002')
    expect(c3.statusCode).toBe(409)
    expect(c3.json().error.code).toBe('ALREADY_USED')
    expect(await prisma.order.count()).toBe(1)
  })

  it('rejects a wrong token, an expired preview, and another user', async () => {
    const t = await register('c@helm.test'); const acct = await simAccount(t)
    const pv = (await preview(t, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '20' })).json()
    expect((await confirm(t, { proposalId: pv.proposalId, confirmToken: 'x'.repeat(32) })).statusCode).toBe(403)
    const t2 = await register('d@helm.test')
    expect((await confirm(t2, pv)).statusCode).toBe(404)
    expect((await preview(t2, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '20' })).statusCode).toBe(404)
    await prisma.orderProposal.update({ where: { id: pv.proposalId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const e = await confirm(t, pv)
    expect(e.statusCode).toBe(410)
    expect(e.json().error.code).toBe('STALE_PROPOSAL')
    expect(await prisma.order.count()).toBe(0)
  })

  it('blocks on Shield policy (no token issued) and on a material price move at confirm', async () => {
    const t = await register('e@helm.test'); const acct = await simAccount(t)
    const big = (await preview(t, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '5000' })).json()
    expect(big.canConfirm).toBe(false)
    expect(big.confirmToken).toBeNull()
    expect(big.risk.verdict).toBe('BLOCK')
    const pv = (await preview(t, { accountId: acct, asset: 'BTC', product: 'spot', side: 'BUY', notional: '50' })).json()
    px.BTC = 61500 // +2.5% ⇒ > 50 bps
    const c = await confirm(t, pv)
    expect(c.statusCode).toBe(409)
    expect(c.json().error.code).toBe('STALE_PROPOSAL')
    expect(await prisma.order.count()).toBe(0)
  })

  it('Trade-to-Protect: perp entry then a reduce-only stop sized from actual fills; PROTECTED only once listed', async () => {
    const t = await register('f@helm.test'); const acct = await simAccount(t)
    const pv = (await preview(t, { accountId: acct, asset: 'BTC', product: 'perp', side: 'BUY', notional: '300', leverage: '2', stopOffsetPercent: '3' })).json()
    expect(pv.preview.protection.supported).toBe(true)
    const r = (await confirm(t, pv)).json().receipt
    expect(r.status).toBe('FILLED')
    expect(r.protection.state).toBe('PROTECTED')
    expect(r.protection.protectedQuantity).toBe(r.filledQuantity)
    expect(Number(r.protection.stopPrice)).toBeLessThan(Number(r.avgFillPrice))
    const stop = await prisma.order.findFirst({ where: { type: 'STOP_MARKET' } })
    expect(stop?.reduceOnly).toBe(true)
    expect(stop?.status).toBe('ACCEPTED')
    const em = (await app.inject({ method: 'GET', url: '/v1/emergency', headers: H(t) })).json()
    expect(em.items.some((i: { kind: string }) => i.kind === 'CLOSE_POSITION')).toBe(true)
    expect(em.note).toMatch(/never broadcasts/)
  })

  it('voice: ambiguous "Buy 100 dollars of BTC" with two venues asks "Which exchange?"', async () => {
    const t = await register('g@helm.test'); await simAccount(t); await simAccount(t, 'bybit', 'Bybit · SIM')
    const v = (await app.inject({ method: 'POST', url: '/v1/voice/command', headers: H(t), payload: { transcript: 'Buy 100 dollars of BTC' } })).json()
    expect(v.next.screen).toBe('clarify_account')
    expect(v.resolution.question).toBe('Which exchange?')
    const v2 = (await app.inject({ method: 'POST', url: '/v1/voice/command', headers: H(t), payload: { transcript: 'Buy 100 dollars of BTC on Bybit' } })).json()
    expect(v2.next.screen).toBe('ticket')
    expect(v2.resolution.account.provider).toBe('bybit')
  })
})

describe('orphaned protective orders', () => {
  it('a partial reduce-only close keeps the stop; a full close cancels it at the venue and closes the plan', async () => {
    const t = await register('o@helm.test'); const acct = await simAccount(t)
    const pv = (await preview(t, { accountId: acct, asset: 'BTC', product: 'perp', side: 'BUY', quantity: '0.004', leverage: '2', stopOffsetPercent: '3' })).json()
    const entry = (await confirm(t, pv)).json().receipt
    expect(entry.protection.state).toBe('PROTECTED')
    const half = (await preview(t, { accountId: acct, asset: 'BTC', product: 'perp', side: 'SELL', fraction: '0.5', reduceOnly: true })).json()
    expect(half.preview.willCancel).toEqual([])
    const r1 = (await confirm(t, half)).json().receipt
    expect(r1.status).toBe('FILLED')
    expect(r1.orphanCleanup).toBeNull()
    expect((await prisma.order.findFirst({ where: { type: 'STOP_MARKET' } }))?.status).toBe('ACCEPTED')
    const full = (await preview(t, { accountId: acct, asset: 'BTC', product: 'perp', side: 'SELL', fraction: '1', reduceOnly: true })).json()
    expect(full.preview.willCancel).toHaveLength(1)
    expect(full.preview.estimateNotes.join(' ')).toMatch(/will also cancel 1 protective order/)
    const r2 = (await confirm(t, full)).json().receipt
    expect(r2.status).toBe('FILLED')
    expect(r2.orphanCleanup).toEqual([expect.objectContaining({ type: 'STOP_MARKET', result: 'CANCELED' })])
    const stop = await prisma.order.findFirst({ where: { type: 'STOP_MARKET' }, include: { events: true } })
    expect(stop?.status).toBe('CANCELED')
    expect(stop?.events.some(e => e.reason?.startsWith('orphaned: position flat'))).toBe(true)
    expect((await prisma.protectionPlan.findFirst())?.state).toBe('CANCELED')
    const em = (await app.inject({ method: 'GET', url: '/v1/emergency', headers: H(t) })).json()
    expect(em.items).toEqual([])
  })
})

describe('recipes + multi-asset scenarios', () => {
  it('CRUD with validation, versioning and owner isolation', async () => {
    const t = await register('r@helm.test'); const other = await register('r2@helm.test')
    const list = (await app.inject({ method: 'GET', url: '/v1/recipes', headers: H(t) })).json()
    expect(list.builtins.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining(['builtin:protected-entry', 'builtin:pre-sleep', 'builtin:trim-half']))
    expect(list.recipes).toEqual([])
    const bad = await app.inject({ method: 'POST', url: '/v1/recipes', headers: H(t), payload: { name: 'x', definition: { steps: [{ type: 'trade', product: 'perp', asset: 'BTC', side: 'BUY' }] } } })
    expect(bad.statusCode).toBe(400)
    const def = { params: { amt: { label: 'Amount', kind: 'amount', default: '25' } }, steps: [{ type: 'trade', product: 'spot', asset: 'ETH', side: 'BUY', notional: '{{amt}}' }] }
    const c = await app.inject({ method: 'POST', url: '/v1/recipes', headers: H(t), payload: { name: 'ETH nibble', definition: def } })
    expect(c.statusCode).toBe(201)
    const id = c.json().id
    const u = (await app.inject({ method: 'PUT', url: `/v1/recipes/${id}`, headers: H(t), payload: { name: 'ETH nibble v2', definition: def } })).json()
    expect(u.version).toBe(2)
    expect((await app.inject({ method: 'PUT', url: `/v1/recipes/${id}`, headers: H(other), payload: { name: 'hijack', definition: def } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/v1/recipes/${id}/run`, headers: H(other), payload: {} })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/recipes/${id}`, headers: H(t) })).json()).toEqual({ deleted: true })
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: 'recipe.' } } })).toBe(3)
  })

  it('running a recipe only previews (no orders); each preview confirms on its own; ambiguous venue asks Which exchange?', async () => {
    const t = await register('rr@helm.test'); const acct = await simAccount(t)
    const run = (await app.inject({ method: 'POST', url: '/v1/recipes/builtin:protected-entry/run', headers: H(t), payload: { params: { notional: '240', stop: '3' } } })).json()
    expect(run.ordersPlaced).toBe(0)
    expect(run.steps.map((s: { type: string; status: string }) => `${s.type}:${s.status}`)).toEqual(['check:ok', 'trade:previewed'])
    const pv = run.steps[1].preview
    expect(pv.confirmToken).toBeTruthy()
    expect(await prisma.order.count()).toBe(0)
    const r = (await confirm(t, pv)).json().receipt
    expect(r.status).toBe('FILLED'); expect(r.protection.state).toBe('PROTECTED')
    // stop-aware stress: long BTC with a 3% stop under a −15% crash
    const sc = (await app.inject({ method: 'POST', url: '/v1/shield/scenarios', headers: H(t), payload: { preset: 'crypto-crash' } })).json().scenario
    expect(Number(sc.totalPnlUsd)).toBeLessThan(0)
    expect(sc.stopsCounted).toHaveLength(1)
    expect(Number(sc.totalPnlWithStopsUsd)).toBeGreaterThan(Number(sc.totalPnlUsd))
    const q = Number(r.filledQuantity)
    // loss capped at the stop: saved = linear loss (−15%) − loss down to the stop trigger (marks ≈ 60000 in this test)
    expect(Number(sc.stopsCounted[0].savedUsd)).toBeCloseTo(q * 60000 * 0.15 - q * (60000 - Number(r.protection.stopPrice)), 0)
    expect(Number(sc.totalPnlWithStopsUsd) - Number(sc.totalPnlUsd)).toBeCloseTo(Number(sc.stopsCounted[0].savedUsd), 6)
    expect(sc.disclaimer).toMatch(/not a prediction/)
    const custom = await app.inject({ method: 'POST', url: '/v1/shield/scenarios', headers: H(t), payload: { shocks: [{ asset: 'BTC', shockPercent: '-150' }] } })
    expect(custom.statusCode).toBe(400)
    const sleep = (await app.inject({ method: 'POST', url: '/v1/recipes/builtin:pre-sleep/run', headers: H(t), payload: {} })).json()
    expect(sleep.steps.map((s: { status: string }) => s.status)).toEqual(['ok', expect.any(String), 'ok'])
    await simAccount(t, 'bybit', 'Bybit · SIM')
    const amb = (await app.inject({ method: 'POST', url: '/v1/recipes/builtin:spot-buy/run', headers: H(t), payload: {} })).json()
    expect(amb.steps[0]).toMatchObject({ status: 'needs_account', question: 'Which exchange?' })
    const chosen = (await app.inject({ method: 'POST', url: '/v1/recipes/builtin:spot-buy/run', headers: H(t), payload: { params: { account: acct } } })).json()
    expect(chosen.steps[0].status).toBe('previewed')
  })
})
