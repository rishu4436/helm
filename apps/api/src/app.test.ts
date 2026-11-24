import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { makeAdapterFactory } from './registry'
import { buildApp } from './app'
import type { FetchLike } from '@helm/connectors'

const TEST_DB = process.env.HELM_TEST_DATABASE_URL ?? 'postgresql://helm@127.0.0.1:5444/helm_test'
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } })
let app: FastifyInstance

// Offline provider fakes (unit level). Real-endpoint checks live in scripts/live-public-check.ts.
const fakeFetch: FetchLike = async (url, init) => {
  const json = (b: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(b) })
  if (url.includes('api-sandbox.coinbase.com') && url.endsWith('/accounts')) return json({ accounts: [{ uuid: 'u', currency: 'USDC', available_balance: { value: '100' }, hold: { value: '0' } }] })
  if (url.includes('/api/v3/time')) return json({ serverTime: Date.now() })
  if (url.includes('/api/v3/account')) {
    const key = init.headers['X-MBX-APIKEY']
    if (key === 'bad-key-0000000000000') return json({ code: -2015, msg: 'Invalid API-key' }, 401)
    return json({ canTrade: true, canWithdraw: false, balances: [{ asset: 'USDT', free: '5000.00', locked: '0' }] })
  }
  return json({ error: 'unmocked' }, 404)
}

async function register(email: string) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: 'correct horse battery' } })
  expect(r.statusCode).toBe(201)
  return r.json().token as string
}
const authz = (t: string) => ({ authorization: `Bearer ${t}` })

beforeAll(async () => {
  app = await buildApp({ prisma, credentialKey: randomBytes(32), adapterFactory: makeAdapterFactory(fakeFetch), rateLimitMax: 10_000, rateLimitScale: 1000 })
})
beforeEach(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(',')} CASCADE`)
})
afterAll(async () => { await app.close(); await prisma.$disconnect() })

describe('meta', () => {
  it('health reports DB and live trading off', async () => {
    const r = await app.inject({ url: '/health' })
    expect(r.json()).toMatchObject({ status: 'ok', db: 'ok', liveTrading: false })
  })
  it('provider catalog marks Alpaca ineligible and disabled', async () => {
    const p = (await app.inject({ url: '/v1/providers' })).json().providers
    expect(p.find((x: { id: string }) => x.id === 'alpaca')).toMatchObject({ trackEligible: false, enabled: false })
    expect(p.filter((x: { trackEligible: boolean }) => x.trackEligible).map((x: { id: string }) => x.id)).toEqual(['binance', 'okx', 'bybit', 'coinbase', 'ibkr'])
  })
  it('capability matrix never claims withdraw', async () => {
    const m = (await app.inject({ url: '/v1/capabilities' })).json().manifests
    expect(m).toHaveLength(7)
    for (const x of m) expect(x.permissions.withdraw).toBe(false)
  })
})

describe('auth', () => {
  it('registers, logs in, rejects bad passwords, revokes on logout', async () => {
    await register('a@helm.test')
    expect((await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'A@helm.test', password: 'correct horse battery' } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@helm.test', password: 'wrong password!' } })).statusCode).toBe(401)
    const t = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@helm.test', password: 'correct horse battery' } })).json().token
    expect((await app.inject({ url: '/v1/me', headers: authz(t) })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: authz(t) })
    expect((await app.inject({ url: '/v1/me', headers: authz(t) })).statusCode).toBe(401)
  })
  it('updates the display name and lists/revokes sessions', async () => {
    const t = await register('p@helm.test')
    const r = await app.inject({ method: 'PATCH', url: '/v1/me', headers: authz(t), payload: { displayName: '  Rishu ' } })
    expect(r.statusCode).toBe(200); expect(r.json().user.displayName).toBe('Rishu')
    expect((await app.inject({ method: 'PATCH', url: '/v1/me', headers: authz(t), payload: { displayName: 'x'.repeat(61) } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PATCH', url: '/v1/me', headers: authz(t), payload: { email: 'evil@x.y' } })).statusCode).toBe(400)
    const t2 = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'p@helm.test', password: 'correct horse battery' } })).json().token
    const ss = (await app.inject({ url: '/v1/sessions', headers: authz(t) })).json().sessions
    expect(ss.length).toBe(2); expect(ss.filter((s: { current: boolean }) => s.current).length).toBe(1)
    const other = ss.find((s: { current: boolean }) => !s.current)
    expect((await app.inject({ method: 'DELETE', url: `/v1/sessions/${other.id}`, headers: authz(t) })).statusCode).toBe(200)
    expect((await app.inject({ url: '/v1/me', headers: authz(t2) })).statusCode).toBe(401)
  })
  it('rejects missing/forged tokens and short passwords', async () => {
    expect((await app.inject({ url: '/v1/me' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/v1/me', headers: authz('forged') })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'b@helm.test', password: 'short' } })).statusCode).toBe(400)
  })
  it('stores only password and token hashes', async () => {
    const t = await register('c@helm.test')
    const u = await prisma.user.findFirstOrThrow()
    expect(u.passwordHash).toMatch(/^scrypt\$/)
    const s = await prisma.authSession.findFirstOrThrow()
    expect(s.tokenHash).not.toBe(t)
  })
})

describe('G2 pairing', () => {
  it('start → pending → approve → claim → device session; exchange secrets never included', async () => {
    const t = await register('p@helm.test')
    const start = (await app.inject({ method: 'POST', url: '/v1/pairing/start' })).json()
    expect(start.code).toMatch(/^[2-9A-HJKMNP-Z]{6}$/)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: start.pairingId, pollSecret: start.pollSecret } })).statusCode).toBe(202)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/approve', headers: authz(t), payload: { code: start.code.toLowerCase(), label: 'My G2' } })).statusCode).toBe(200)
    const claim = await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: start.pairingId, pollSecret: start.pollSecret } })
    expect(claim.json().status).toBe('PAIRED')
    const dt = claim.json().deviceToken
    const me = await app.inject({ url: '/v1/device/me', headers: authz(dt) })
    expect(me.statusCode).toBe(200)
    expect(me.json().device.label).toBe('My G2')
    expect(JSON.stringify(me.json())).not.toMatch(/secret|apiKey|sealed/i)
    // device token is not a user session
    expect((await app.inject({ url: '/v1/me', headers: authz(dt) })).statusCode).toBe(401)
  })
  it('prevents duplicate approval and duplicate claim; wrong poll secret is rejected', async () => {
    const t1 = await register('p1@helm.test')
    const t2 = await register('p2@helm.test')
    const s = (await app.inject({ method: 'POST', url: '/v1/pairing/start' })).json()
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/approve', headers: authz(t1), payload: { code: s.code } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/approve', headers: authz(t2), payload: { code: s.code } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: s.pairingId, pollSecret: 'x'.repeat(32) } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: s.pairingId, pollSecret: s.pollSecret } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: s.pairingId, pollSecret: s.pollSecret } })).statusCode).toBe(409)
  })
  it('expired codes cannot be approved', async () => {
    const t = await register('e@helm.test')
    const s = (await app.inject({ method: 'POST', url: '/v1/pairing/start' })).json()
    await prisma.devicePairing.update({ where: { id: s.pairingId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/approve', headers: authz(t), payload: { code: s.code } })).statusCode).toBe(410)
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: s.pairingId, pollSecret: s.pollSecret } })).statusCode).toBe(410)
  })
  it('revoked devices lose access; other users cannot revoke them', async () => {
    const t = await register('r@helm.test')
    const other = await register('r2@helm.test')
    const s = (await app.inject({ method: 'POST', url: '/v1/pairing/start' })).json()
    await app.inject({ method: 'POST', url: '/v1/pairing/approve', headers: authz(t), payload: { code: s.code } })
    const c = (await app.inject({ method: 'POST', url: '/v1/pairing/claim', payload: { pairingId: s.pairingId, pollSecret: s.pollSecret } })).json()
    expect((await app.inject({ method: 'DELETE', url: `/v1/devices/${c.deviceId}`, headers: authz(other) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/devices/${c.deviceId}`, headers: authz(t) })).statusCode).toBe(200)
    expect((await app.inject({ url: '/v1/device/me', headers: authz(c.deviceToken) })).statusCode).toBe(401)
  })
})

describe('exchange connections', () => {
  it('connects the Coinbase static sandbox without credentials and labels it', async () => {
    const t = await register('cb@helm.test')
    const r = await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'coinbase', alias: 'Coinbase Sandbox' } })
    expect(r.statusCode).toBe(201)
    expect(r.json().connection).toMatchObject({ provider: 'coinbase', environment: 'sandbox_static', state: 'LIMITED' })
    expect(r.json().connection.reasons[0]).toMatch(/static sandbox/)
  })
  it('stores Binance demo credentials encrypted and only exposes a fingerprint', async () => {
    const t = await register('bn@helm.test')
    const r = await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'binance', alias: 'My Binance', credentials: { apiKey: 'AAAAkey-demo-1234567890ZZZZ', apiSecret: 'secret-demo-abcdefghijklmnop' } } })
    expect(r.statusCode).toBe(201)
    const body = JSON.stringify(r.json())
    expect(body).not.toContain('secret-demo')
    expect(body).not.toContain('AAAAkey-demo-1234567890ZZZZ')
    expect(r.json().connection.credential.keyFingerprint).toBe('AAAA…ZZZZ')
    expect(r.json().connection.state).toBe('CONNECTED')
    const row = await prisma.exchangeCredentialReference.findFirstOrThrow()
    expect(JSON.stringify(row.sealed)).not.toContain('secret-demo')
    const bal = await app.inject({ url: `/v1/connections/${r.json().connection.id}/balances`, headers: authz(t) })
    expect(bal.json().balances[0]).toMatchObject({ asset: 'USDT', total: '5000' })
  })
  it('rejects invalid keys without storing them', async () => {
    const t = await register('bad@helm.test')
    const r = await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'binance', alias: 'x', credentials: { apiKey: 'bad-key-0000000000000', apiSecret: 'secret-demo-abcdefghijklmnop' } } })
    expect(r.statusCode).toBe(422)
    expect(r.json().error.reasons[0]).toBe('INVALID_CREDENTIALS (-2015)')
    expect(await prisma.exchangeCredentialReference.count()).toBe(0)
    expect((await app.inject({ url: '/v1/connections', headers: authz(t) })).json().connections).toHaveLength(0)
  })
  it('denies cross-user access to connections and balances', async () => {
    const a = await register('ua@helm.test')
    const b = await register('ub@helm.test')
    const c = (await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(a), payload: { provider: 'coinbase', alias: 'A' } })).json().connection
    expect((await app.inject({ url: `/v1/connections/${c.id}`, headers: authz(b) })).statusCode).toBe(404)
    expect((await app.inject({ url: `/v1/connections/${c.id}/balances`, headers: authz(b) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/connections/${c.id}`, headers: authz(b) })).statusCode).toBe(404)
    expect((await app.inject({ url: '/v1/connections', headers: authz(b) })).json().connections).toHaveLength(0)
  })
  it('refuses passwords and unknown fields in provider credential forms', async () => {
    const t = await register('pw@helm.test')
    const r = await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'coinbase', alias: 'x', credentials: { password: 'hunter2' } } })
    expect(r.statusCode).toBe(400)
    const ib = await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'ibkr', alias: 'x', credentials: { username: 'u', password: 'p' } } })
    expect(ib.statusCode).toBe(400)
  })
  it('blocks Alpaca while it is not track-eligible', async () => {
    const t = await register('al@helm.test')
    const r = await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'alpaca', alias: 'x', credentials: { keyId: 'PKXXXXXXXXXX', secretKey: 'x'.repeat(20) } } })
    expect(r.statusCode).toBe(422)
    expect(r.json().error.code).toBe('UNSUPPORTED_OPERATION')
  })
  it('deleting a connection removes its stored credential', async () => {
    const t = await register('del@helm.test')
    const c = (await app.inject({ method: 'POST', url: '/v1/connections', headers: authz(t), payload: { provider: 'binance', alias: 'B', credentials: { apiKey: 'AAAAkey-demo-1234567890ZZZZ', apiSecret: 'secret-demo-abcdefghijklmnop' } } })).json().connection
    expect(await prisma.exchangeCredentialReference.count()).toBe(1)
    const d = await app.inject({ method: 'DELETE', url: `/v1/connections/${c.id}`, headers: authz(t) })
    expect(d.json().revokeAtExchange).toMatch(/Binance/)
    expect(await prisma.exchangeCredentialReference.count()).toBe(0)
  })
})

describe('rate limiting', () => {
  it('throttles login brute force at the default limit', async () => {
    const strict = await buildApp({ prisma, credentialKey: randomBytes(32), adapterFactory: makeAdapterFactory(fakeFetch) })
    const codes: number[] = []
    for (let i = 0; i < 12; i++) codes.push((await strict.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@helm.test', password: 'guess' + i } })).statusCode)
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true)
    expect(codes.slice(10)).toEqual([429, 429])
    await strict.close()
  })
})
