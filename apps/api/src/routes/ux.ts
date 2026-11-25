/** UX 2.0 routes: presentation preferences and Activity & Alerts. None of these can change trading limits. */
import type { FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { compass } from '@helm/risk-engine'
import { toJsonSafe } from '@helm/portfolio'
import { requireUserOrDevice } from '../auth'
import type { AppCtx } from '../app'
import { listAccounts } from '../engine/accounts'
import { buildActivity, DISMISS_COOLDOWN_MS } from '../engine/activity'
import { cachedPortfolio } from '../engine/portfolio'
import { policyFor } from '../engine/trade'

const asset = z.string().regex(/^[A-Za-z0-9]{1,12}$/).transform(s => s.toUpperCase())
const DECK = ['portfolio', 'positions', 'allocation', 'watchlist', 'largest', 'risk', 'activity', 'voice'] as const
/** Presentation preferences only: there is deliberately no field here that touches Shield limits or execution. */
export const PrefsPatch = z.object({
  mode: z.enum(['beginner', 'pro']),
  homeMode: z.enum(['auto', 'spot', 'futures', 'multi']),
  reportingCurrency: z.literal('USD'),
  preferredExchange: z.string().max(80).nullable(),
  watchlist: z.array(asset).max(12),
  metrics: z.array(z.enum(['value', 'pnl', 'positions', 'health'])).max(4),
  alertSensitivity: z.enum(['all', 'normal', 'critical']),
  privacy: z.boolean(),
  deckOrder: z.array(z.enum(DECK)).max(8),
  deckFavorites: z.array(z.enum(DECK)).max(8),
  sizePresets: z.array(z.string().regex(/^\d{1,7}(\.\d{1,2})?$/)).min(1).max(6),
  onboarding: z.object({ completedAt: z.string().max(40).nullable(), skippedAt: z.string().max(40).nullable(), stage: z.string().max(40).nullable() }).partial(),
  companionDraft: z.object({ asset, notional: z.string().regex(/^\d{1,9}(\.\d+)?$/), accountId: z.string().max(80).nullish(), expiresAt: z.string().max(40) }).nullable(),
  lastOrder: z.object({ asset, accountId: z.string().max(80), product: z.enum(['spot', 'perp']), side: z.enum(['BUY', 'SELL']) }).strict().nullable(),
  recentSizes: z.array(z.string().regex(/^\d{1,7}(\.\d{1,2})?$/)).max(3),
}).partial().strict()

export const uxRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx
  const any = requireUserOrDevice(prisma)

  const readPrefs = async (userId: string) => ((await prisma.userPreference.findUnique({ where: { userId } }))?.data ?? {}) as Record<string, unknown>
  app.get('/v1/preferences', { preHandler: any }, async req => ({ preferences: await readPrefs(req.userId!) }))
  app.put('/v1/preferences', { preHandler: any, config: ctx.rl(60) }, async req => {
    const patch = PrefsPatch.parse(req.body)
    const cur = await readPrefs(req.userId!)
    const next = { ...cur, ...patch, ...(patch.onboarding ? { onboarding: { ...(cur.onboarding as object ?? {}), ...patch.onboarding } } : {}) }
    await prisma.userPreference.upsert({ where: { userId: req.userId! }, create: { userId: req.userId!, data: next as Prisma.InputJsonValue }, update: { data: next as Prisma.InputJsonValue } })
    return { preferences: next }
  })

  const activity = async (userId: string) => {
    const [{ portfolio }, { policy }, accts, unknown, pulse, marks] = await Promise.all([
      cachedPortfolio(prisma, ctx.key, ctx.adapters, userId), policyFor(prisma, userId), listAccounts(prisma, ctx.key, ctx.adapters, userId),
      prisma.order.findMany({ where: { userId, status: { in: ['UNKNOWN', 'RECONCILING'] } }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, accountId: true, instrumentId: true, side: true, status: true, createdAt: true } }),
      prisma.pulseEvent.findMany({ where: { userId, createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { createdAt: 'desc' }, take: 60 }),
      prisma.activityMark.findMany({ where: { userId } }),
    ])
    return buildActivity({
      portfolio, compass: compass(portfolio, policy), accounts: accts.map(a => ({ id: a.account.id, alias: a.account.alias, state: a.connection.state })),
      unknownOrders: unknown.map(o => ({ orderId: o.id, accountId: o.accountId, instrumentId: o.instrumentId, side: o.side, status: o.status, createdAt: o.createdAt })),
      pulse: pulse.map(e => ({ id: e.id, kind: e.kind, severity: e.severity, accountId: e.accountId, instrumentId: e.instrumentId, reason: e.reason, createdAt: e.createdAt, dismissedAt: e.dismissedAt, acknowledgedAt: e.acknowledgedAt, dedupeKey: e.dedupeKey })),
      marks,
    })
  }
  app.get('/v1/activity', { preHandler: any, config: ctx.rl(60) }, async req => toJsonSafe(await activity(req.userId!)))

  const Id = z.string().min(5).max(240).regex(/^(cur|pulse):/)
  app.post<{ Params: { id: string } }>('/v1/activity/:id/ack', { preHandler: any }, async req => {
    const id = Id.parse(req.params.id)
    if (id.startsWith('pulse:')) return { ok: (await prisma.pulseEvent.updateMany({ where: { id: id.slice(6), userId: req.userId! }, data: { acknowledgedAt: new Date() } })).count === 1 }
    await prisma.activityMark.upsert({ where: { userId_itemId: { userId: req.userId!, itemId: id } }, create: { userId: req.userId!, itemId: id, acknowledgedAt: new Date() }, update: { acknowledgedAt: new Date() } })
    return { ok: true }
  })
  app.post<{ Params: { id: string } }>('/v1/activity/:id/dismiss', { preHandler: any }, async (req, reply) => {
    const id = Id.parse(req.params.id)
    if (id.startsWith('pulse:')) return { ok: (await prisma.pulseEvent.updateMany({ where: { id: id.slice(6), userId: req.userId! }, data: { dismissedAt: new Date() } })).count === 1 }
    if (id.startsWith('cur:liq:') || id.startsWith('cur:unknown:')) return reply.code(409).send({ error: { code: 'NOT_DISMISSIBLE', message: 'Critical items can be acknowledged but not dismissed while they are true' } })
    const until = new Date(Date.now() + DISMISS_COOLDOWN_MS)
    await prisma.activityMark.upsert({ where: { userId_itemId: { userId: req.userId!, itemId: id } }, create: { userId: req.userId!, itemId: id, dismissedUntil: until }, update: { dismissedUntil: until } })
    return { ok: true, until: until.toISOString() }
  })
}
