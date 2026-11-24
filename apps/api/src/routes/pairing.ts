import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hashToken, newOpaqueToken, newPairingCode, normalisePairingCode, tokenMatches } from '@helm/security'
import { DEVICE_TTL_MS, requireDevice, requireUser } from '../auth'
import { audit } from '../audit'
import type { AppCtx } from '../app'

export const PAIRING_TTL_MS = 5 * 60 * 1000

const Approve = z.object({ code: z.string().min(4).max(12).transform(normalisePairingCode), label: z.string().min(1).max(40).default('Even G2') })
const Claim = z.object({ pairingId: z.string().min(10).max(40), pollSecret: z.string().min(20).max(100) })

/**
 * G2 pairing: glasses start → show short code → user approves in the companion → glasses claim
 * an exchange-independent device token. Exchange secrets never reach the glasses.
 */
export const pairingRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx

  app.post('/v1/pairing/start', { config: ctx.rl(10) }, async (_req, reply) => {
    const pollSecret = newOpaqueToken(24)
    for (let i = 0; i < 5; i++) {
      const code = newPairingCode()
      try {
        const p = await prisma.devicePairing.create({ data: { code, pollSecretHash: hashToken(pollSecret), expiresAt: new Date(Date.now() + PAIRING_TTL_MS) } })
        return reply.code(201).send({ pairingId: p.id, code, pollSecret, expiresAt: p.expiresAt })
      } catch { /* code collision → retry */ }
    }
    return reply.code(503).send({ error: { code: 'PAIRING_UNAVAILABLE', message: 'Try again' } })
  })

  app.post('/v1/pairing/approve', { preHandler: requireUser(prisma), config: ctx.rl(20) }, async (req, reply) => {
    const b = Approve.parse(req.body)
    const p = await prisma.devicePairing.findUnique({ where: { code: b.code } })
    if (!p) return reply.code(404).send({ error: { code: 'PAIRING_NOT_FOUND', message: 'No glasses are showing that code' } })
    if (p.expiresAt < new Date()) return reply.code(410).send({ error: { code: 'PAIRING_EXPIRED', message: 'That code expired — restart pairing on the glasses' } })
    if (p.approvedAt) return reply.code(409).send({ error: { code: 'PAIRING_ALREADY_APPROVED', message: 'That code was already used' } })
    // Atomic guard against double approval (race between two companions)
    const r = await prisma.devicePairing.updateMany({ where: { id: p.id, approvedAt: null, expiresAt: { gt: new Date() } }, data: { userId: req.userId!, approvedAt: new Date(), label: b.label } })
    if (r.count !== 1) return reply.code(409).send({ error: { code: 'PAIRING_ALREADY_APPROVED', message: 'That code was already used' } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'device.pairing_approved', subject: p.id, detail: { label: b.label } })
    return { ok: true, pairingId: p.id }
  })

  app.post('/v1/pairing/claim', { config: ctx.rl(60) }, async (req, reply) => {
    const b = Claim.parse(req.body)
    const p = await prisma.devicePairing.findUnique({ where: { id: b.pairingId } })
    if (!p || !tokenMatches(b.pollSecret, p.pollSecretHash)) return reply.code(404).send({ error: { code: 'PAIRING_NOT_FOUND', message: 'Unknown pairing' } })
    if (p.claimedAt) return reply.code(409).send({ error: { code: 'PAIRING_ALREADY_CLAIMED', message: 'This pairing was already completed' } })
    if (!p.approvedAt || !p.userId) {
      if (p.expiresAt < new Date()) return reply.code(410).send({ error: { code: 'PAIRING_EXPIRED', message: 'Code expired' } })
      return reply.code(202).send({ status: 'PENDING', expiresAt: p.expiresAt })
    }
    const claimed = await prisma.devicePairing.updateMany({ where: { id: p.id, claimedAt: null }, data: { claimedAt: new Date() } })
    if (claimed.count !== 1) return reply.code(409).send({ error: { code: 'PAIRING_ALREADY_CLAIMED', message: 'This pairing was already completed' } })
    const token = newOpaqueToken()
    const label = p.label ?? 'Even G2'
    const d = await prisma.device.create({ data: { userId: p.userId, label, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DEVICE_TTL_MS) } })
    await prisma.devicePairing.update({ where: { id: p.id }, data: { deviceId: d.id } })
    await audit(prisma, { userId: p.userId, actor: 'device', action: 'device.paired', subject: d.id })
    return { status: 'PAIRED', deviceToken: token, deviceId: d.id, expiresAt: d.expiresAt }
  })

  // ---- companion device manager ----
  app.get('/v1/devices', { preHandler: requireUser(prisma) }, async req => {
    const devices = await prisma.device.findMany({ where: { userId: req.userId! }, select: { id: true, label: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, activeAccountId: true }, orderBy: { createdAt: 'desc' } })
    return { devices }
  })
  app.delete<{ Params: { id: string } }>('/v1/devices/:id', { preHandler: requireUser(prisma) }, async (req, reply) => {
    const r = await prisma.device.updateMany({ where: { id: req.params.id, userId: req.userId!, revokedAt: null }, data: { revokedAt: new Date() } })
    if (r.count === 0) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Device not found' } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'device.revoked', subject: req.params.id })
    return { ok: true }
  })

  // ---- glasses-side ----
  app.get('/v1/device/me', { preHandler: requireDevice(prisma) }, async req => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { displayName: true, email: true } })
    const accounts = await prisma.tradingAccount.findMany({ where: { userId: req.userId!, connection: { deletedAt: null } }, select: { id: true, alias: true, provider: true, environment: true, accountType: true, connection: { select: { state: true } } } })
    const device = await prisma.device.findUniqueOrThrow({ where: { id: req.deviceId! }, select: { id: true, label: true, activeAccountId: true, expiresAt: true } })
    return { user: { name: user.displayName ?? user.email.split('@')[0] }, device, accounts: accounts.map(a => ({ id: a.id, alias: a.alias, provider: a.provider, environment: a.environment, accountType: a.accountType, state: a.connection.state })) }
  })

  app.post('/v1/device/active-account', { preHandler: requireDevice(prisma) }, async (req, reply) => {
    const { accountId } = z.object({ accountId: z.string().min(1).max(40) }).parse(req.body)
    const acct = await prisma.tradingAccount.findFirst({ where: { id: accountId, userId: req.userId! } })
    if (!acct) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Account not found' } })
    await prisma.device.update({ where: { id: req.deviceId! }, data: { activeAccountId: acct.id } })
    return { ok: true, activeAccountId: acct.id }
  })

  app.post('/v1/device/refresh', { preHandler: requireDevice(prisma) }, async req => {
    const token = newOpaqueToken()
    const d = await prisma.device.update({ where: { id: req.deviceId! }, data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + DEVICE_TTL_MS) } })
    return { deviceToken: token, expiresAt: d.expiresAt }
  })
}
