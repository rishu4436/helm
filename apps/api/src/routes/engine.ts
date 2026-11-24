import type { FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ENVIRONMENT_LABEL, dec, type ProviderId, type TradeIntent } from '@helm/shared'
import { RiskPolicySchema, compass, scenario } from '@helm/risk-engine'
import { rank, type PulseEventInput } from '@helm/pulse'
import { toJsonSafe } from '@helm/portfolio'
import { parseIntent, resolveAccount, sttFromEnv, type ResolvableAccount } from '@helm/voice-engine'
import { requireUser, requireUserOrDevice } from '../auth'
import { audit } from '../audit'
import type { AppCtx } from '../app'
import { listAccounts, type LoadedAccount } from '../engine/accounts'
import { compareVenues, instrumentIdFor, priceBook, VALUATION_ASSETS } from '../engine/market'
import { userPortfolio } from '../engine/portfolio'
import { cancelOrder, confirmTrade, policyFor, previewTrade, receipt, refreshOrder, simulationLabel } from '../engine/trade'

const dstr = z.string().regex(/^\d+(\.\d+)?$/).max(40)
const Ticket = z.object({
  accountId: z.string().min(1), instrumentId: z.string().min(3).max(80).optional(), asset: z.string().max(16).optional(), product: z.enum(['spot', 'perp', 'stock']).optional(),
  side: z.enum(['BUY', 'SELL']), type: z.enum(['MARKET', 'LIMIT']).optional(),
  quantity: dstr.nullish(), notional: dstr.nullish(), fraction: dstr.nullish(), limitPrice: dstr.nullish(), leverage: dstr.nullish(), stopOffsetPercent: dstr.nullish(),
  reduceOnly: z.boolean().optional(), intentId: z.string().nullish(),
}).refine(t => t.instrumentId || t.asset, 'instrumentId or asset required')
const Confirm = z.object({ proposalId: z.string().min(1), confirmToken: z.string().min(10), idempotencyKey: z.string().min(8).max(80), via: z.enum(['glasses', 'companion', 'voice']) })

const productsOf = (la: LoadedAccount) => la.account.accountType === 'futures_usdm' ? ['perp'] : la.account.accountType === 'spot' || la.account.accountType === 'portfolio' ? ['spot'] : la.account.accountType === 'brokerage' ? ['stock'] : ['spot', 'perp']
export const resolvable = (la: LoadedAccount): ResolvableAccount => ({ id: la.account.id, alias: la.account.alias, provider: la.account.provider, environment: la.account.environment, canTrade: la.canTrade, products: productsOf(la) })

export const engineRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx
  const any = requireUserOrDevice(prisma)
  const user = requireUser(prisma)
  const ectx = { prisma, key: ctx.key, adapters: ctx.adapters }
  const send = (v: unknown) => toJsonSafe(v)

  app.get('/v1/accounts', { preHandler: any }, async req => {
    const accts = await listAccounts(prisma, ctx.key, ctx.adapters, req.userId!)
    return { accounts: accts.map(a => ({ ...resolvable(a), state: a.connection.state, reasons: a.connection.reasons, environmentLabel: (ENVIRONMENT_LABEL as Record<string, string>)[a.account.environment], label: simulationLabel(a.account.environment) })) }
  })

  app.get('/v1/portfolio', { preHandler: any, config: ctx.rl(60) }, async req => {
    const { portfolio, inputs } = await userPortfolio(prisma, ctx.key, ctx.adapters, req.userId!)
    return send({ portfolio, accountErrors: inputs.filter(i => i.error).map(i => ({ accountId: i.account.id, error: i.error })) })
  })

  app.get<{ Querystring: { assets?: string } }>('/v1/markets/watchlist', { preHandler: any }, async req => {
    const assets = (req.query.assets ?? VALUATION_ASSETS.join(',')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 12)
    const book = await priceBook()
    return send({ source: 'Binance Demo public spot books (mid, USDT at par)', items: assets.map(a => ({ asset: a, price: book.get(a)?.price ?? null, at: book.get(a)?.timestamp ?? null })) })
  })

  app.get<{ Params: { asset: string }; Querystring: { product?: 'spot' | 'perp' } }>('/v1/markets/:asset', { preHandler: any, config: ctx.rl(60) }, async req => {
    const asset = req.params.asset.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    return { asset, product: req.query.product ?? 'spot', venues: await compareVenues(asset, req.query.product ?? 'spot') }
  })

  app.post('/v1/trade/preview', { preHandler: any, config: ctx.rl(60) }, async req => {
    const t = Ticket.parse(req.body)
    let instrumentId = t.instrumentId
    if (!instrumentId) {
      const a = await prisma.tradingAccount.findFirst({ where: { id: t.accountId, userId: req.userId! } })
      if (!a) throw Object.assign(new Error('Account not found'), { statusCode: 404 })
      instrumentId = instrumentIdFor(a.provider as ProviderId, a.environment, t.asset!.toUpperCase(), t.product ?? (a.accountType === 'futures_usdm' ? 'perp' : 'spot'))
    }
    const r = await previewTrade(ectx, req.userId!, { ...t, instrumentId })
    await audit(prisma, { userId: req.userId, actor: req.deviceId ? 'device' : 'user', action: 'trade.previewed', subject: r.proposalId, detail: { verdict: (r.risk as { verdict: string }).verdict } })
    return send(r)
  })

  app.post('/v1/trade/confirm', { preHandler: any, config: ctx.rl(30) }, async req => {
    const c = Confirm.parse(req.body)
    const r = await confirmTrade(ectx, req.userId!, c)
    await audit(prisma, { userId: req.userId, actor: req.deviceId ? 'device' : 'user', action: 'trade.confirmed', subject: c.proposalId, detail: { orderId: r.receipt.orderId, status: r.receipt.status } })
    return send(r)
  })

  app.get<{ Querystring: { limit?: string } }>('/v1/orders', { preHandler: any }, async req => {
    const rows = await prisma.order.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit ?? 50) || 50, 200), select: { id: true } })
    return send({ orders: (await Promise.all(rows.map(r => receipt(ectx, req.userId!, r.id)))).map(r => r.receipt) })
  })
  app.get<{ Params: { id: string } }>('/v1/orders/:id', { preHandler: any }, async req => send(await refreshOrder(ectx, req.userId!, req.params.id)))
  app.post<{ Params: { id: string } }>('/v1/orders/:id/cancel', { preHandler: any, config: ctx.rl(30) }, async req => {
    z.object({ confirm: z.literal(true) }).parse(req.body) // explicit confirmation required
    return send(await cancelOrder(ectx, req.userId!, req.params.id))
  })
  app.get('/v1/receipts', { preHandler: any }, async req => {
    const rows = await prisma.order.findMany({ where: { userId: req.userId!, status: { in: ['FILLED', 'PARTIALLY_FILLED', 'CANCELED', 'REJECTED', 'ACCEPTED', 'UNKNOWN', 'RECONCILING'] } }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true } })
    return send({ receipts: (await Promise.all(rows.map(r => receipt(ectx, req.userId!, r.id)))).map(r => r.receipt) })
  })

  // ----- Shield -----
  app.get('/v1/shield/policy', { preHandler: any }, async req => send(await policyFor(prisma, req.userId!)))
  app.put('/v1/shield/policy', { preHandler: user }, async req => {
    const limits = RiskPolicySchema.parse(req.body)
    const { version } = await policyFor(prisma, req.userId!)
    await prisma.riskPolicy.create({ data: { userId: req.userId!, version: version + 1, limits: limits as unknown as Prisma.InputJsonValue } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'shield.policy.updated', subject: String(version + 1), detail: {} })
    return send({ policy: limits, version: version + 1 })
  })
  app.get('/v1/shield/compass', { preHandler: any }, async req => {
    const { portfolio } = await userPortfolio(prisma, ctx.key, ctx.adapters, req.userId!)
    const { policy } = await policyFor(prisma, req.userId!)
    return send({ compass: compass(portfolio, policy), netLiquidationUsd: portfolio.netLiquidationUsd, asOf: portfolio.asOf })
  })
  app.post('/v1/shield/scenario', { preHandler: any }, async req => {
    const b = z.object({ asset: z.string().max(12), shockPercent: z.string().regex(/^-?\d+(\.\d+)?$/) }).parse(req.body)
    const { portfolio } = await userPortfolio(prisma, ctx.key, ctx.adapters, req.userId!)
    return send({ scenario: scenario(portfolio, b.asset, dec(b.shockPercent)) })
  })

  // ----- Pulse -----
  app.get('/v1/pulse', { preHandler: any }, async req => {
    const rows = await prisma.pulseEvent.findMany({ where: { userId: req.userId!, dismissedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 })
    const evs: Array<PulseEventInput & { id: string }> = rows.map(r => ({ id: r.id, kind: r.kind as PulseEventInput['kind'], severity: r.severity as PulseEventInput['severity'], provider: r.provider, accountId: r.accountId, instrumentId: r.instrumentId, reason: r.reason, context: r.context as Record<string, unknown>, createdAt: r.createdAt.toISOString(), dedupeKey: r.dedupeKey }))
    return { events: rank(evs).slice(0, 30) }
  })
  app.post<{ Params: { id: string } }>('/v1/pulse/:id/dismiss', { preHandler: any }, async req => {
    const r = await prisma.pulseEvent.updateMany({ where: { id: req.params.id, userId: req.userId! }, data: { dismissedAt: new Date() } })
    return { ok: r.count === 1 }
  })

  // ----- Emergency review (itemized; nothing is ever broadcast from here) -----
  app.get('/v1/emergency', { preHandler: any }, async req => {
    const { portfolio } = await userPortfolio(prisma, ctx.key, ctx.adapters, req.userId!)
    const c = compass(portfolio)
    const items = [
      ...portfolio.openOrders.map(o => ({ kind: 'CANCEL_ORDER', accountId: o.accountId, instrumentId: o.instrumentId, detail: `${o.side} ${o.type} ${o.quantity?.toFixed() ?? ''} @ ${o.price?.toFixed() ?? o.stopPrice?.toFixed() ?? 'mkt'}`, providerOrderId: o.providerOrderId })),
      ...portfolio.positions.filter(p => !p.quantity.isZero()).map(p => ({ kind: 'CLOSE_POSITION', accountId: p.accountId, instrumentId: p.instrumentId, detail: `${p.side} ${p.quantity.abs().toFixed()} (reduce-only close, needs its own preview + confirm)`, unprotected: c.unprotected.some(u => u.accountId === p.accountId && u.instrumentId === p.instrumentId) })),
    ]
    return send({ items, note: 'Every item needs its own preview and explicit confirmation. HELM never broadcasts "close everything".' })
  })

  // ----- Voice -----
  app.post('/v1/voice/command', { preHandler: any, config: ctx.rl(30) }, async req => {
    const b = z.object({ transcript: z.string().max(500).optional(), audioBase64: z.string().max(4_000_000).optional(), sampleRate: z.number().int().optional() }).refine(x => x.transcript || x.audioBase64).parse(req.body)
    let transcript = b.transcript ?? '', sttProvider = 'typed', sttLabel: string | null = null, confidence: number | null = null
    if (!b.transcript) {
      const stt = sttFromEnv()
      if (!stt) throw Object.assign(new Error('No speech-to-text provider configured'), { statusCode: 422 })
      const t = await stt.transcribe(Buffer.from(b.audioBase64!, 'base64'), { sampleRate: b.sampleRate ?? 16000 })
      transcript = t.text; sttProvider = t.provider; sttLabel = t.label ?? null; confidence = t.confidence
    }
    const { intent, parser } = await parseIntent(transcript)
    const accounts = (await listAccounts(prisma, ctx.key, ctx.adapters, req.userId!)).map(resolvable)
    const res = resolveAccount(intent as TradeIntent, accounts)
    const next = nextScreen(intent as TradeIntent, res)
    await prisma.voiceCommand.create({ data: { userId: req.userId!, transcript, sttProvider, confidence: confidence ?? undefined, intent: intent as unknown as Prisma.InputJsonValue, outcome: next.screen } })
    return { transcript, sttProvider, sttLabel, parser, intent, resolution: res, next }
  })
}

export function nextScreen(i: TradeIntent, r: ReturnType<typeof resolveAccount>): { screen: string; message?: string } {
  if (i.intent === 'UNKNOWN') return { screen: 'not_understood', message: i.rejectedReason ?? 'Say it again, for example “buy 100 dollars of BTC on Binance”' }
  const trading = ['PLACE_ORDER', 'CLOSE_POSITION', 'REDUCE_POSITION', 'CANCEL_ORDER', 'PREPARE_PROTECTION'].includes(i.intent)
  if (trading && r.status === 'clarify') return { screen: 'clarify_account', message: r.question }
  if (r.status === 'none' && trading) return { screen: 'no_account', message: r.message }
  if (trading && i.clarificationNeeded.length) return { screen: 'clarify', message: `Missing: ${i.clarificationNeeded.join(', ')}` }
  const map: Record<string, string> = { PLACE_ORDER: 'ticket', CLOSE_POSITION: 'ticket', REDUCE_POSITION: 'ticket', CANCEL_ORDER: 'orders', PREPARE_PROTECTION: 'ticket', QUERY_POSITIONS: 'positions', QUERY_BALANCE: 'overview', QUERY_PORTFOLIO: 'overview', QUERY_EXPOSURE: 'compass', QUERY_UNPROTECTED: 'compass', QUERY_ORDERS: 'orders', STRESS_TEST: 'scenario', COMPARE_VENUES: 'market', EMERGENCY_REVIEW: 'emergency' }
  return { screen: map[i.intent] ?? 'overview' }
}
