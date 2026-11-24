/**
 * Recipes: saved, parameterised checklists of HELM steps (trade drafts, stress scenarios, safety checks).
 * Running a recipe NEVER places an order: trade steps come back as normal previews, each with its own
 * single-use 45 s confirm token, and must be confirmed one by one via /v1/trade/confirm.
 */
import type { FastifyPluginAsync } from 'fastify'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { dec, type ProviderId, type TradeIntent } from '@helm/shared'
import { SCENARIO_PRESETS, compass, multiScenario } from '@helm/risk-engine'
import { toJsonSafe } from '@helm/portfolio'
import { resolveAccount } from '@helm/voice-engine'
import { requireUser, requireUserOrDevice } from '../auth'
import { audit } from '../audit'
import type { AppCtx } from '../app'
import { instrumentIdFor } from '../engine/market'
import { cachedPortfolio, userPortfolio } from '../engine/portfolio'
import { policyFor, previewTrade } from '../engine/trade'
import { resolvable } from './engine'

const PH = /^\{\{(\w{1,24})\}\}$/
const val = (re: RegExp) => z.string().max(40).refine(v => PH.test(v) || re.test(v), 'value or {{param}}')
const DEC = /^-?\d+(\.\d+)?$/
const ASSET = /^[A-Za-z]{2,10}$/
const TradeStep = z.object({
  type: z.literal('trade'), label: z.string().max(60).optional(),
  accountId: z.string().max(40).optional(), provider: z.enum(['binance', 'bybit', 'okx', 'coinbase', 'alpaca']).optional(),
  product: z.enum(['spot', 'perp']), asset: val(ASSET), side: z.enum(['BUY', 'SELL']),
  notional: val(DEC).optional(), fraction: val(DEC).optional(), leverage: val(DEC).optional(), stopOffsetPercent: val(DEC).optional(), reduceOnly: z.boolean().optional(),
}).refine(s => s.notional || s.fraction, 'notional or fraction required')
const ScenarioStep = z.object({ type: z.literal('scenario'), label: z.string().max(60).optional(), preset: z.string().max(30).optional(), shocks: z.array(z.object({ asset: val(ASSET), shockPercent: val(DEC) })).max(8).optional() })
  .refine(s => s.preset || s.shocks?.length, 'preset or shocks required')
const CheckStep = z.object({ type: z.literal('check'), label: z.string().max(60).optional(), check: z.enum(['unprotected', 'exposure', 'emergency', 'policy']) })
const Step = z.union([TradeStep, ScenarioStep, CheckStep])
export const RecipeDefinition = z.object({
  description: z.string().max(240).optional(),
  params: z.record(z.string().regex(/^\w{1,24}$/), z.object({ label: z.string().max(40), kind: z.enum(['amount', 'percent', 'asset', 'account', 'fraction']), default: z.string().max(40).optional() })).optional(),
  steps: z.array(Step).min(1).max(8),
})
export type RecipeDefinitionT = z.infer<typeof RecipeDefinition>

export const BUILTIN_RECIPES: Array<{ id: string; name: string; definition: RecipeDefinitionT }> = [
  { id: 'builtin:protected-entry', name: 'Protected entry', definition: {
    description: 'Open a perp position and attach a reduce-only stop sized from the actual fill (Trade-to-Protect).',
    params: { asset: { label: 'Asset', kind: 'asset', default: 'BTC' }, notional: { label: 'Amount (USD)', kind: 'amount', default: '100' }, stop: { label: 'Stop distance %', kind: 'percent', default: '3' }, account: { label: 'Account', kind: 'account' } },
    steps: [{ type: 'check', check: 'policy' }, { type: 'trade', label: 'Entry with stop', product: 'perp', asset: '{{asset}}', side: 'BUY', notional: '{{notional}}', leverage: '2', stopOffsetPercent: '{{stop}}' }] } },
  { id: 'builtin:pre-sleep', name: 'Pre-sleep check', definition: {
    description: 'Before you go offline: anything unprotected, where the exposure sits, and what a −30% wick would do.',
    steps: [{ type: 'check', check: 'unprotected' }, { type: 'check', check: 'exposure' }, { type: 'scenario', preset: 'flash-wick' }] } },
  { id: 'builtin:trim-half', name: 'Trim half', definition: {
    description: 'Reduce-only close of half a perp position. Protective stops stay; a later full close cancels them.',
    params: { asset: { label: 'Asset', kind: 'asset', default: 'BTC' }, account: { label: 'Account', kind: 'account' } },
    steps: [{ type: 'trade', label: 'Reduce 50%', product: 'perp', asset: '{{asset}}', side: 'SELL', fraction: '0.5', reduceOnly: true }] } },
  { id: 'builtin:spot-buy', name: 'Spot buy', definition: {
    description: 'Plain spot market buy of a fixed USD amount.',
    params: { asset: { label: 'Asset', kind: 'asset', default: 'BTC' }, notional: { label: 'Amount (USD)', kind: 'amount', default: '50' }, account: { label: 'Account', kind: 'account' } },
    steps: [{ type: 'trade', product: 'spot', asset: '{{asset}}', side: 'BUY', notional: '{{notional}}' }] } },
  { id: 'builtin:stress-pack', name: 'Stress pack', definition: {
    description: 'Crypto crash and short squeeze side by side, with and without your venue-listed stops.',
    steps: [{ type: 'scenario', preset: 'crypto-crash' }, { type: 'scenario', preset: 'squeeze' }, { type: 'check', check: 'unprotected' }] } },
]

function substitute<T>(v: T, params: Record<string, string>, missing: Set<string>): T {
  if (typeof v === 'string') { const m = v.match(PH); if (!m) return v; const r = params[m[1]!]; if (r === undefined) { missing.add(m[1]!); return v } return r as T }
  if (Array.isArray(v)) return v.map(x => substitute(x, params, missing)) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, params, missing)])) as T
  return v
}

export const recipeRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx
  const any = requireUserOrDevice(prisma)
  const user = requireUser(prisma)
  const ectx = { prisma, key: ctx.key, adapters: ctx.adapters }
  const send = (v: unknown) => toJsonSafe(v)
  const view = (r: { id: string; name: string; version: number; enabled: boolean; definition: unknown; updatedAt: Date }) => ({ id: r.id, name: r.name, version: r.version, enabled: r.enabled, builtin: false, definition: r.definition, updatedAt: r.updatedAt })
  const Body = z.object({ name: z.string().min(1).max(60), definition: RecipeDefinition, enabled: z.boolean().optional() })

  app.get('/v1/recipes', { preHandler: any }, async req => {
    const mine = await prisma.recipe.findMany({ where: { userId: req.userId! }, orderBy: { updatedAt: 'desc' } })
    return { builtins: BUILTIN_RECIPES.map(b => ({ ...b, builtin: true, enabled: true, version: 1 })), recipes: mine.map(view), scenarioPresets: SCENARIO_PRESETS }
  })
  app.post('/v1/recipes', { preHandler: user, config: ctx.rl(30) }, async (req, reply) => {
    const b = Body.parse(req.body)
    if (await prisma.recipe.count({ where: { userId: req.userId! } }) >= 50) throw Object.assign(new Error('Recipe limit reached (50)'), { statusCode: 409 })
    const r = await prisma.recipe.create({ data: { userId: req.userId!, name: b.name, definition: b.definition as Prisma.InputJsonValue, enabled: b.enabled ?? true } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'recipe.created', subject: r.id, detail: { name: b.name } })
    reply.code(201); return view(r)
  })
  const own = async (userId: string, id: string) => {
    const r = await prisma.recipe.findFirst({ where: { id, userId } })
    if (!r) throw Object.assign(new Error('Recipe not found'), { statusCode: 404 })
    return r
  }
  app.put<{ Params: { id: string } }>('/v1/recipes/:id', { preHandler: user }, async req => {
    const b = Body.parse(req.body); const cur = await own(req.userId!, req.params.id)
    const r = await prisma.recipe.update({ where: { id: cur.id }, data: { name: b.name, definition: b.definition as Prisma.InputJsonValue, enabled: b.enabled ?? cur.enabled, version: cur.version + 1 } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'recipe.updated', subject: r.id, detail: { version: r.version } })
    return view(r)
  })
  app.delete<{ Params: { id: string } }>('/v1/recipes/:id', { preHandler: user }, async req => {
    const cur = await own(req.userId!, req.params.id)
    await prisma.recipe.delete({ where: { id: cur.id } })
    await audit(prisma, { userId: req.userId, actor: 'user', action: 'recipe.deleted', subject: cur.id, detail: { name: cur.name } })
    return { deleted: true }
  })

  app.post<{ Params: { id: string } }>('/v1/recipes/:id/run', { preHandler: any, config: ctx.rl(30) }, async req => {
    const b = z.object({ params: z.record(z.string().max(24), z.string().max(40)).default({}), preview: z.boolean().default(true) }).parse(req.body ?? {})
    const builtin = BUILTIN_RECIPES.find(x => x.id === req.params.id)
    const rec = builtin ? { id: builtin.id, name: builtin.name, definition: builtin.definition, enabled: true } : await own(req.userId!, req.params.id)
    if (!rec.enabled) throw Object.assign(new Error('Recipe is disabled'), { statusCode: 409 })
    const def = RecipeDefinition.parse(rec.definition)
    const params: Record<string, string> = { ...Object.fromEntries(Object.entries(def.params ?? {}).filter(([, p]) => p.default !== undefined).map(([k, p]) => [k, p.default!])), ...b.params }
    const missing = new Set<string>()
    const steps = substitute(def.steps, params, missing)
    const { portfolio, accounts } = await userPortfolio(prisma, ctx.key, ctx.adapters, req.userId!)
    const out: Array<Record<string, unknown>> = []
    for (const [index, st] of steps.entries()) {
      const label = st.label ?? null
      if (st.type === 'check') {
        if (st.check === 'policy') { const { policy, version } = await policyFor(prisma, req.userId!); out.push({ index, type: 'check', check: st.check, label, status: 'ok', result: { version, policy } }); continue }
        const c = compass(portfolio)
        if (st.check === 'unprotected') out.push({ index, type: 'check', check: st.check, label, status: c.unprotected.length ? 'attention' : 'ok', result: { unprotected: c.unprotected } })
        else if (st.check === 'exposure') out.push({ index, type: 'check', check: st.check, label, status: c.nearRisk.length || c.marginWarnings.length ? 'attention' : 'ok', result: { rose: c.rose, nearRisk: c.nearRisk, marginWarnings: c.marginWarnings, netLiquidationUsd: portfolio.netLiquidationUsd } })
        else out.push({ index, type: 'check', check: st.check, label, status: portfolio.openOrders.length || portfolio.positions.some(p => !p.quantity.isZero()) ? 'attention' : 'ok', result: { openOrders: portfolio.openOrders.length, openPositions: portfolio.positions.filter(p => !p.quantity.isZero()).length, note: 'Review item by item in Emergency; HELM never broadcasts close-everything.' } })
        continue
      }
      if (st.type === 'scenario') {
        const preset = st.preset ? SCENARIO_PRESETS.find(p => p.id === st.preset) : undefined
        const shocks = (st.shocks ?? preset?.shocks ?? []).filter(x => DEC.test(x.shockPercent))
        if (!shocks.length) { out.push({ index, type: 'scenario', label, status: 'error', error: `Unknown preset ${st.preset}` }); continue }
        out.push({ index, type: 'scenario', label: label ?? preset?.name ?? 'Custom scenario', status: 'ok', result: multiScenario(portfolio, shocks.map(x => ({ asset: x.asset, shockPct: dec(x.shockPercent) })), preset?.name ?? null) })
        continue
      }
      // trade step
      const stillMissing = [...missing].filter(m => JSON.stringify(st).includes(`{{${m}}}`))
      if (stillMissing.length) { out.push({ index, type: 'trade', label, status: 'needs_params', missing: stillMissing }); continue }
      const accountId = st.accountId ?? params.account
      const intent = { intent: 'PLACE_ORDER', provider: st.provider ?? null, accountId: accountId ?? null, product: st.product } as unknown as TradeIntent
      const res = resolveAccount(intent, accounts.map(resolvable))
      const draft = { asset: st.asset.toUpperCase(), product: st.product, side: st.side, notional: st.notional ?? null, fraction: st.fraction ?? null, leverage: st.leverage ?? null, stopOffsetPercent: st.stopOffsetPercent ?? null, reduceOnly: st.reduceOnly ?? false }
      if (res.status === 'clarify') { out.push({ index, type: 'trade', label, status: 'needs_account', question: res.question, options: res.options.map(o => ({ id: o.id, alias: o.alias, environment: o.environment })), draft }); continue }
      if (res.status === 'none') { out.push({ index, type: 'trade', label, status: 'no_account', message: res.message, draft }); continue }
      const acct = accounts.find(a => a.account.id === res.account.id)!
      const ticket = { accountId: res.account.id, ...draft, instrumentId: instrumentIdFor(acct.account.provider as ProviderId, acct.account.environment, draft.asset, st.product) }
      if (!b.preview) { out.push({ index, type: 'trade', label, status: 'draft', account: { id: res.account.id, alias: res.account.alias }, draft: ticket }); continue }
      try {
        const p = await previewTrade(ectx, req.userId!, ticket)
        const verdict = (p.risk as { verdict: string }).verdict
        out.push({ index, type: 'trade', label, status: verdict === 'BLOCK' ? 'blocked' : 'previewed', account: { id: res.account.id, alias: res.account.alias }, draft: ticket, preview: p })
      } catch (e) {
        out.push({ index, type: 'trade', label, status: 'error', account: { id: res.account.id, alias: res.account.alias }, draft: ticket, error: (e as { helm?: { code?: string; message?: string } }).helm ?? { message: (e as Error).message } })
      }
    }
    await audit(prisma, { userId: req.userId, actor: req.deviceId ? 'device' : 'user', action: 'recipe.run', subject: rec.id, detail: { steps: out.map(s => `${s.type}:${s.status}`) } })
    return send({ recipe: { id: rec.id, name: rec.name }, params, steps: out, ordersPlaced: 0, note: 'Nothing was submitted. Each trade step is a preview with its own single-use confirm token; confirm them one at a time.' })
  })

  // Multi-asset scenario analysis (presets or custom shocks), stop-aware.
  app.get('/v1/shield/scenario/presets', { preHandler: any }, async () => ({ presets: SCENARIO_PRESETS }))
  app.post('/v1/shield/scenarios', { preHandler: any, config: ctx.rl(60) }, async req => {
    const b = z.object({ preset: z.string().max(30).optional(), name: z.string().max(60).optional(), shocks: z.array(z.object({ asset: z.string().regex(ASSET), shockPercent: z.string().regex(DEC).refine(v => Math.abs(Number(v)) <= 99, 'shock must be within ±99%') })).max(8).optional() })
      .refine(x => x.preset || x.shocks?.length, 'preset or shocks required').parse(req.body)
    const preset = b.preset ? SCENARIO_PRESETS.find(p => p.id === b.preset) : undefined
    if (b.preset && !preset) throw Object.assign(new Error('Unknown preset'), { statusCode: 404 })
    const shocks = b.shocks ?? preset!.shocks
    const { portfolio } = await cachedPortfolio(prisma, ctx.key, ctx.adapters, req.userId!)
    return send({ scenario: multiScenario(portfolio, shocks.map(x => ({ asset: x.asset, shockPct: dec(x.shockPercent) })), b.name ?? preset?.name ?? null) })
  })
}
