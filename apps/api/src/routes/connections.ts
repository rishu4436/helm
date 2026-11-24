import type { FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { fingerprint, seal, unseal, type SealedSecret } from '@helm/security'
import { HelmError, PROVIDER_INFO, type ExchangeAdapter, type ProviderId } from '@helm/shared'
import { requireUser } from '../auth'
import { audit } from '../audit'
import { CredentialSchemas, alpacaEnabled } from '../registry'
import type { AppCtx } from '../app'

const Create = z.object({
  provider: z.enum(['binance', 'okx', 'bybit', 'coinbase', 'ibkr', 'alpaca']),
  alias: z.string().min(1).max(40),
  credentials: z.record(z.string(), z.string()).default({}),
})

const accountTypeFor = (provider: ProviderId, creds: Record<string, string>) =>
  provider === 'binance' ? (creds.market === 'usdm' ? 'futures_usdm' : 'spot') : provider === 'coinbase' ? 'portfolio' : provider === 'ibkr' || provider === 'alpaca' ? 'brokerage' : 'unified'

export const connectionRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx
  const auth = requireUser(prisma)

  async function adapterFor(userId: string, connectionId: string): Promise<{ adapter: ExchangeAdapter; accountId: string }> {
    const conn = await prisma.exchangeConnection.findFirst({ where: { id: connectionId, userId, deletedAt: null }, include: { credential: true, accounts: true } })
    if (!conn) throw Object.assign(new Error('Connection not found'), { statusCode: 404 })
    const creds = conn.credential ? JSON.parse(unseal(ctx.key, conn.credential.sealed as unknown as SealedSecret, `${userId}:${conn.id}`)) as Record<string, string> : {}
    const accountId = conn.accounts[0]?.id ?? conn.id
    return { adapter: ctx.adapters(conn.provider as ProviderId, creds, accountId), accountId }
  }

  app.post('/v1/connections', { preHandler: auth, config: ctx.rl(20) }, async (req, reply) => {
    const b = Create.parse(req.body)
    if (b.provider === 'alpaca' && !alpacaEnabled()) throw new HelmError('UNSUPPORTED_OPERATION', 'Alpaca is disabled: not in the official Exchanges & Stocks track list', { provider: 'alpaca' })
    const creds = CredentialSchemas[b.provider].parse(b.credentials) as Record<string, string>
    const info = PROVIDER_INFO[b.provider]
    const conn = await prisma.exchangeConnection.create({ data: { userId: req.userId!, provider: b.provider, environment: info.hackathonEnvironment, alias: b.alias, state: 'RECONNECTING' } })
    const adapter = ctx.adapters(b.provider, creds, conn.id)
    const health = await adapter.connect()
    const manifest = adapter.getCapabilities()
    const failed = health.state === 'ERROR' || (health.state === 'DISCONNECTED' && b.provider !== 'ibkr')
    if (failed) {
      // Never keep credentials that failed validation.
      await prisma.exchangeConnection.update({ where: { id: conn.id }, data: { state: health.state, stateReasons: health.reasons, lastCheckedAt: new Date(), deletedAt: new Date() } })
      await audit(prisma, { userId: req.userId, actor: 'user', action: 'connection.failed', subject: conn.id, detail: { provider: b.provider, reasons: health.reasons } })
      return reply.code(422).send({ error: { code: 'CONNECTION_FAILED', message: 'Could not verify this connection', reasons: health.reasons }, health })
    }
    const apiKey = creds.apiKey ?? creds.keyId
    await prisma.$transaction(async tx => {
      await tx.exchangeConnection.update({ where: { id: conn.id }, data: { state: health.state, stateReasons: health.reasons, lastCheckedAt: new Date() } })
      if (Object.keys(creds).length > 0) {
        await tx.exchangeCredentialReference.create({ data: { connectionId: conn.id, keyFingerprint: apiKey ? fingerprint(apiKey) : '—', sealed: seal(ctx.key, JSON.stringify(creds), `${req.userId}:${conn.id}`) as unknown as Prisma.InputJsonValue, scopes: [manifest.permissions.read ? 'read' : '', manifest.permissions.trade ? 'trade' : ''].filter(Boolean) } })
      }
      const acct = await tx.tradingAccount.create({ data: { userId: req.userId!, connectionId: conn.id, provider: b.provider, environment: info.hackathonEnvironment, accountType: accountTypeFor(b.provider, creds), providerAccountId: `${b.provider}:${accountTypeFor(b.provider, creds)}`, alias: b.alias } })
      await tx.accountCapability.create({ data: { accountId: acct.id, manifest: JSON.parse(JSON.stringify(manifest)) } })
      await tx.providerHealth.create({ data: { connectionId: conn.id, state: health.state, reasons: health.reasons } })
    })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'connection.created', subject: conn.id, detail: { provider: b.provider, state: health.state } })
    return reply.code(201).send({ connection: await view(conn.id, req.userId!) })
  })

  async function view(id: string, userId: string) {
    const c = await prisma.exchangeConnection.findFirstOrThrow({ where: { id, userId }, include: { credential: { select: { keyFingerprint: true, scopes: true, createdAt: true } }, accounts: { include: { capabilities: { orderBy: { verifiedAt: 'desc' }, take: 1 } } } } })
    return {
      id: c.id, provider: c.provider, environment: c.environment, alias: c.alias, state: c.state, reasons: c.stateReasons, lastCheckedAt: c.lastCheckedAt, createdAt: c.createdAt,
      credential: c.credential, // fingerprint + scopes only — never the secret
      accounts: c.accounts.map(a => ({ id: a.id, alias: a.alias, accountType: a.accountType, isDefault: a.isDefault, capabilities: a.capabilities[0]?.manifest ?? null })),
    }
  }

  app.get('/v1/connections', { preHandler: auth }, async req => {
    const rows = await prisma.exchangeConnection.findMany({ where: { userId: req.userId!, deletedAt: null }, select: { id: true }, orderBy: { createdAt: 'asc' } })
    return { connections: await Promise.all(rows.map(r => view(r.id, req.userId!))) }
  })

  app.get<{ Params: { id: string } }>('/v1/connections/:id', { preHandler: auth }, async (req, reply) => {
    const c = await prisma.exchangeConnection.findFirst({ where: { id: req.params.id, userId: req.userId!, deletedAt: null } })
    if (!c) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Connection not found' } })
    return { connection: await view(c.id, req.userId!) }
  })

  app.post<{ Params: { id: string } }>('/v1/connections/:id/check', { preHandler: auth }, async req => {
    const { adapter } = await adapterFor(req.userId!, req.params.id)
    const started = Date.now()
    const h = await adapter.connect()
    await prisma.exchangeConnection.update({ where: { id: req.params.id }, data: { state: h.state, stateReasons: h.reasons, lastCheckedAt: new Date() } })
    await prisma.providerHealth.create({ data: { connectionId: req.params.id, state: h.state, reasons: h.reasons, latencyMs: Date.now() - started } })
    return { health: h }
  })

  app.get<{ Params: { id: string } }>('/v1/connections/:id/balances', { preHandler: auth }, async req => {
    const { adapter } = await adapterFor(req.userId!, req.params.id)
    const caps = adapter.getCapabilities()
    return { balances: await adapter.getBalances(), environment: caps.environment, simulation: caps.simulation, restrictions: caps.restrictions }
  })

  app.delete<{ Params: { id: string } }>('/v1/connections/:id', { preHandler: auth }, async (req, reply) => {
    const c = await prisma.exchangeConnection.findFirst({ where: { id: req.params.id, userId: req.userId!, deletedAt: null } })
    if (!c) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Connection not found' } })
    await prisma.$transaction([
      prisma.exchangeCredentialReference.deleteMany({ where: { connectionId: c.id } }),
      prisma.exchangeConnection.update({ where: { id: c.id }, data: { deletedAt: new Date(), state: 'DISCONNECTED' } }),
    ])
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'connection.deleted', subject: c.id, detail: { provider: c.provider } })
    return { ok: true, revokeAtExchange: `Also delete the API key in your ${PROVIDER_INFO[c.provider as ProviderId].name} account settings.` }
  })
}
