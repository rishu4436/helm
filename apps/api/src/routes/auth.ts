import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { hashToken } from '@helm/security'
import { createSession, hashPassword, requireUser, verifyPassword } from '../auth'
import { audit } from '../audit'
import type { AppCtx } from '../app'
import { DEMO_SIM_ACCOUNTS, GUEST_EMAIL_DOMAIN, isGuestEmail, provisionSimulatedAccount } from '../engine/provision-sim'
import { randomBytes } from 'node:crypto'

const Register = z.object({ email: z.string().email().max(200).transform(s => s.toLowerCase()), password: z.string().min(10).max(200), displayName: z.string().max(60).optional() })
const Login = z.object({ email: z.string().email().transform(s => s.toLowerCase()), password: z.string().min(1).max(200) })

export const authRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx
  app.post('/v1/auth/register', { config: ctx.rl(8, '10 minutes') }, async (req, reply) => {
    const b = Register.parse(req.body)
    const exists = await prisma.user.findUnique({ where: { email: b.email } })
    if (exists) return reply.code(409).send({ error: { code: 'EMAIL_TAKEN', message: 'An account with this email exists' } })
    const user = await prisma.user.create({ data: { email: b.email, passwordHash: await hashPassword(b.password), displayName: b.displayName } })
    const s = await createSession(prisma, user.id, req.headers['user-agent'])
    await audit(prisma, { userId: user.id, actor: 'user', action: 'auth.register', ip: req.ip })
    return reply.code(201).send({ user: { id: user.id, email: user.email, displayName: user.displayName }, token: s.token, expiresAt: s.expiresAt })
  })

  app.post('/v1/auth/login', { config: ctx.rl(10) }, async (req, reply) => {
    const b = Login.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email: b.email } })
    const ok = user ? await verifyPassword(b.password, user.passwordHash) : false
    if (!user || !ok) {
      await audit(prisma, { userId: user?.id, actor: 'anonymous', action: 'auth.login_failed', ip: req.ip })
      return reply.code(401).send({ error: { code: 'INVALID_LOGIN', message: 'Email or password is incorrect' } })
    }
    const s = await createSession(prisma, user.id, req.headers['user-agent'])
    await audit(prisma, { userId: user.id, actor: 'user', action: 'auth.login', ip: req.ip })
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, token: s.token, expiresAt: s.expiresAt }
  })

  app.post('/v1/auth/demo', { config: ctx.rl(5, '10 minutes') }, async (req, reply) => {
    const email = `demo-${randomBytes(6).toString('hex')}${GUEST_EMAIL_DOMAIN}`
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(randomBytes(24).toString('base64url')), displayName: 'Demo visitor' } })
    const s = await createSession(prisma, user.id, req.headers['user-agent'])
    const accounts = []
    const failed = []
    for (const a of DEMO_SIM_ACCOUNTS) {
      try { accounts.push(await provisionSimulatedAccount(ctx, user.id, a.provider, a.alias)) }
      catch (e) { failed.push({ provider: a.provider, alias: a.alias, message: e instanceof Error ? e.message : 'failed' }) }
    }
    await audit(prisma, { userId: user.id, actor: 'user', action: 'auth.demo', ip: req.ip, detail: { accounts: accounts.map(a => a.provider), failed } })
    return reply.code(201).send({
      user: { id: user.id, email: user.email, displayName: user.displayName, guest: true },
      token: s.token, expiresAt: s.expiresAt,
      accounts, failed,
      label: 'SIMULATED by HELM — live public prices, fills computed locally, nothing sent to any exchange',
    })
  })

    app.post('/v1/auth/logout', { preHandler: requireUser(prisma) }, async req => {
    await prisma.authSession.update({ where: { id: req.sessionId! }, data: { revokedAt: new Date() } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'auth.logout' })
    return { ok: true }
  })

  app.get('/v1/me', { preHandler: requireUser(prisma) }, async req => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! }, select: { id: true, email: true, displayName: true, reportingCurrency: true, createdAt: true } })
    return { user: { ...u, guest: isGuestEmail(u.email) } }
  })

  app.patch('/v1/me', { preHandler: requireUser(prisma) }, async (req, reply) => {
    const b = z.object({ displayName: z.string().trim().min(1).max(60).nullable().optional() }).strict().safeParse(req.body ?? {})
    if (!b.success) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Display name must be 1–60 characters', reasons: b.error.issues.map(i => i.message) } })
    const u = await prisma.user.update({ where: { id: req.userId! }, data: { displayName: b.data.displayName ?? null }, select: { id: true, email: true, displayName: true, reportingCurrency: true, createdAt: true } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'user.profile_updated' })
    return { user: { ...u, guest: isGuestEmail(u.email) } }
  })

  app.get('/v1/sessions', { preHandler: requireUser(prisma) }, async req => {
    const sessions = await prisma.authSession.findMany({ where: { userId: req.userId!, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userAgent: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: 'desc' } })
    return { sessions: sessions.map(s => ({ ...s, current: s.id === req.sessionId })) }
  })

  app.delete<{ Params: { id: string } }>('/v1/sessions/:id', { preHandler: requireUser(prisma) }, async (req, reply) => {
    const r = await prisma.authSession.updateMany({ where: { id: req.params.id, userId: req.userId! }, data: { revokedAt: new Date() } })
    if (r.count === 0) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Session not found' } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'auth.session_revoked', subject: req.params.id })
    return { ok: true }
  })

  void hashToken
}
