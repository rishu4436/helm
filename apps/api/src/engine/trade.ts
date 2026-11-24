import { randomBytes } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { hashToken, newOpaqueToken } from '@helm/security'
import {
  ENVIRONMENT_LABEL, HelmError, SIMULATED_LABEL, dec, floorToStep, roundToTick, supports,
  type Decimal, type Environment, type Instrument, type Order, type OrderBook, type OrderPreview, type OrderRequest, type OrderStatus, type OrderType, type ProtectionState, type RiskAssessment, type Side,
} from '@helm/shared'
import { DEFAULT_POLICY, RiskPolicySchema, assess, tradeImpact, type RiskPolicy } from '@helm/risk-engine'
import { toJsonSafe } from '@helm/portfolio'
import { TERMINAL, TRANSITIONS, ProtectionWorkflow, clientOrderIdFor, hashProposal, materialChange, protectiveQuantity, protectiveStopPrice } from '@helm/trading-core'
import type { AdapterFactory } from '../registry'
import { loadAccount, refreshHealth, type LoadedAccount } from './accounts'
import { FEE_ASSUMPTION, legsNotional, legsQty, resolveInstrument, walkBook } from './market'
import { userPortfolio } from './portfolio'
import { emitPulse } from './pulse'

export const PREVIEW_TTL_MS = 45_000
export const MAX_PRICE_MOVE_BPS = dec(50)

export interface EngineCtx { prisma: PrismaClient; key: Buffer; adapters: AdapterFactory }

export interface TicketInput {
  accountId: string
  instrumentId: string
  side: Side
  type?: 'MARKET' | 'LIMIT'
  quantity?: string | null
  notional?: string | null
  fraction?: string | null
  limitPrice?: string | null
  leverage?: string | null
  stopOffsetPercent?: string | null
  reduceOnly?: boolean
  intentId?: string | null
}

const httpErr = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { statusCode: status, helm: { code, message, ...extra } })

export function simulationLabel(env: Environment | string): string | null {
  if (env === 'simulated') return SIMULATED_LABEL
  if (env === 'sandbox_static') return 'COINBASE STATIC SANDBOX — canned responses, not real simulated fills'
  return null
}

export async function policyFor(prisma: PrismaClient, userId: string): Promise<{ policy: RiskPolicy; version: number }> {
  const r = await prisma.riskPolicy.findFirst({ where: { userId }, orderBy: { version: 'desc' } })
  if (!r) return { policy: DEFAULT_POLICY, version: 0 }
  return { policy: RiskPolicySchema.parse(r.limits), version: r.version }
}

// ---------- request building ----------
interface Built { request: OrderRequest; notes: string[] }

async function buildRequest(la: LoadedAccount, inst: Instrument, t: TicketInput, book: OrderBook | null, proposalId: string): Promise<Built> {
  const notes: string[] = []
  const type: OrderType = t.type ?? (t.limitPrice ? 'LIMIT' : 'MARKET')
  const ref = t.side === 'BUY' ? book?.asks[0]?.price : book?.bids[0]?.price
  const req: OrderRequest = { accountId: la.account.id, instrument: inst, side: t.side, type, clientOrderId: clientOrderIdFor(proposalId, 'e') }
  if (type === 'LIMIT') {
    if (!t.limitPrice) throw new HelmError('INVALID_PRICE', 'Limit price required')
    req.price = roundToTick(dec(t.limitPrice), inst.tickSize, t.side)
    req.timeInForce = 'GTC'
  }
  if (t.leverage) req.leverage = dec(t.leverage)
  if (t.reduceOnly && inst.product !== 'spot') req.reduceOnly = true
  if (t.fraction) {
    const f = dec(t.fraction)
    if (f.lte(0) || f.gt(1)) throw new HelmError('INVALID_QUANTITY', 'Fraction must be in (0, 1]')
    if (inst.product === 'spot') {
      const bal = (await la.adapter.getBalances()).find(b => b.asset === inst.base)
      req.quantity = floorToStep((bal?.free ?? dec(0)).mul(f), inst.lotSize)
      notes.push(`Quantity = ${f.mul(100).toFixed()}% of free ${inst.base}`)
    } else {
      const p = (await la.adapter.getPositions()).find(x => x.instrumentId === inst.id && !x.quantity.isZero())
      if (!p) throw new HelmError('INVALID_QUANTITY', 'No open position on this instrument')
      req.quantity = floorToStep(p.quantity.abs().mul(f), inst.lotSize)
      // NET (one-way) positions carry the direction in the sign of quantity.
      const long = p.side === 'LONG' || (p.side === 'NET' && p.quantity.isPositive())
      req.side = long ? 'SELL' : 'BUY'
      req.reduceOnly = true
      notes.push(`Closes ${f.mul(100).toFixed()}% of the ${long ? 'LONG' : 'SHORT'} position (reduce-only)`)
    }
  } else if (t.quantity) {
    req.quantity = floorToStep(dec(t.quantity), inst.lotSize)
  } else if (t.notional) {
    const n = dec(t.notional)
    if (inst.product === 'spot' && type === 'MARKET' && t.side === 'BUY' && la.account.provider !== 'coinbase') {
      req.quoteQuantity = n
      notes.push(`Spends ${n.toFixed()} ${inst.quote} (quote-sized market order)`)
    } else {
      const px = req.price ?? ref
      if (!px) throw new HelmError('EXCHANGE_UNAVAILABLE', 'No price available to size this order')
      req.quantity = floorToStep(n.div(px.mul(inst.contractMultiplier ?? 1)), inst.lotSize)
      notes.push(`Quantity = ${n.toFixed()} / ${px.toFixed()} floored to lot ${inst.lotSize.toFixed()}`)
    }
  } else throw new HelmError('INVALID_QUANTITY', 'Quantity, notional or fraction required')
  if (req.quantity && req.quantity.lt(inst.minQty)) throw new HelmError('INVALID_QUANTITY', `Below minimum ${inst.minQty.toFixed()} ${inst.base}`)
  return { request: req, notes }
}

function engineEstimate(req: OrderRequest, book: OrderBook | null, provider: string): OrderPreview {
  const now = new Date()
  const base: OrderPreview = { id: '', request: req, estimatedPrice: null, estimatedNotional: null, estimatedFee: null, estimatedSlippageBps: null, requiredMargin: null, remainingBuyingPower: null, estimateNotes: [], createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString() }
  if (!book) { base.estimateNotes.push('No order book available — no price estimate'); return base }
  const feeRate = FEE_ASSUMPTION[`${provider}:${req.instrument.product}`] ?? dec('0.001')
  if (req.type === 'LIMIT' && req.price) {
    const q = req.quantity ?? dec(0)
    base.estimatedPrice = req.price; base.estimatedNotional = req.price.mul(q); base.estimatedFee = base.estimatedNotional.mul(feeRate)
  } else {
    const legs = walkBook(book, req.side, req.quantity, req.quoteQuantity, req.instrument.lotSize)
    const q = legsQty(legs)
    if (q.isZero()) { base.estimateNotes.push('Book too thin for an estimate'); return base }
    const n = legsNotional(legs)
    const top = req.side === 'BUY' ? book.asks[0]!.price : book.bids[0]!.price
    base.estimatedPrice = n.div(q).toDecimalPlaces(8); base.estimatedNotional = n; base.estimatedFee = n.mul(feeRate)
    base.estimatedSlippageBps = base.estimatedPrice.minus(top).abs().div(top).mul(10000)
  }
  if (req.instrument.product !== 'spot' && base.estimatedNotional) base.requiredMargin = base.estimatedNotional.div(req.leverage ?? 1)
  base.estimateNotes.push(`HELM estimate: walked the public book; fee assumes ${feeRate.mul(100).toFixed()}% taker`)
  return base
}

async function bookFor(la: LoadedAccount, id: string): Promise<OrderBook | null> {
  if (!supports(la.manifest, 'getOrderBook')) return null
  try { return await la.adapter.getOrderBook(id, 50) } catch { return null }
}

/** Buying power from the account's own balances/equity (provider-reported), never assumed. */
async function withBuyingPower(la: LoadedAccount, p: OrderPreview): Promise<OrderPreview> {
  if (p.remainingBuyingPower !== null) return p
  const r = p.request
  try {
    if (r.instrument.product === 'spot') {
      const bals = await la.adapter.getBalances()
      const quote = bals.find(b => b.asset === r.instrument.quote)?.free ?? dec(0)
      if (r.side === 'BUY') { p.remainingBuyingPower = quote.minus((p.estimatedNotional ?? dec(0)).plus(p.estimatedFee ?? 0)); p.estimateNotes.push(`Buying power: free ${r.instrument.quote} reported by the account`) }
      else {
        const base = bals.find(b => b.asset === r.instrument.base)?.free ?? dec(0)
        p.remainingBuyingPower = r.quantity && base.lt(r.quantity) ? dec(-1) : quote
        p.estimateNotes.push(`Sell checked against free ${r.instrument.base} ${base.toFixed()}`)
      }
    } else if (supports(la.manifest, 'getEquity')) {
      const e = await la.adapter.getEquity()
      if (e.availableBalance) { p.remainingBuyingPower = r.reduceOnly ? e.availableBalance : e.availableBalance.minus(p.requiredMargin ?? 0).minus(p.estimatedFee ?? 0); p.estimateNotes.push('Buying power: available margin reported by the account') }
    }
  } catch { p.estimateNotes.push('Buying power unavailable from the account') }
  return p
}

async function estimate(la: LoadedAccount, req: OrderRequest, book: OrderBook | null): Promise<OrderPreview> {
  return withBuyingPower(la, await estimateRaw(la, req, book))
}
async function estimateRaw(la: LoadedAccount, req: OrderRequest, book: OrderBook | null): Promise<OrderPreview> {
  const eng = engineEstimate(req, book, la.account.provider)
  if (!supports(la.manifest, 'previewOrder')) return eng
  try {
    const p = await la.adapter.previewOrder(req)
    return { ...eng, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined)), estimateNotes: [...(p.estimateNotes ?? []), ...eng.estimateNotes] } as OrderPreview
  } catch (e) { eng.estimateNotes.push(`Provider preview unavailable (${(e as { code?: string }).code ?? 'error'})`); return eng }
}

const reqToJson = (r: OrderRequest) => toJsonSafe({ ...r, instrument: r.instrument.id }) as Record<string, unknown>
function reqFromJson(j: Record<string, unknown>, inst: Instrument): OrderRequest {
  const d = (k: string) => (j[k] === undefined || j[k] === null ? undefined : dec(j[k] as string))
  return { accountId: j.accountId as string, instrument: inst, side: j.side as Side, type: j.type as OrderType, quantity: d('quantity'), quoteQuantity: d('quoteQuantity'), price: d('price'), stopPrice: d('stopPrice'), timeInForce: j.timeInForce as OrderRequest['timeInForce'], reduceOnly: j.reduceOnly as boolean | undefined, leverage: d('leverage'), clientOrderId: j.clientOrderId as string }
}

// ---------- PREVIEW ----------
export async function previewTrade(ctx: EngineCtx, userId: string, t: TicketInput) {
  const la = await loadAccount(ctx.prisma, ctx.key, ctx.adapters, userId, t.accountId)
  const inst = await resolveInstrument(la.adapter, la.account.environment, t.instrumentId)
  if (!inst) throw new HelmError('INVALID_INSTRUMENT')
  const proposalId = `p${randomBytes(10).toString('hex')}`
  const book = await bookFor(la, inst.id)
  const { request, notes } = await buildRequest(la, inst, t, book, proposalId)
  const preview = await estimate(la, request, book)
  preview.id = proposalId
  preview.estimateNotes.unshift(...notes)
  const { portfolio } = await userPortfolio(ctx.prisma, ctx.key, ctx.adapters, userId)
  const { policy, version } = await policyFor(ctx.prisma, userId)
  const risk = assess(policy, { request, preview, portfolio, reducesRisk: !!request.reduceOnly }, version)
  if (!la.canTrade) risk.findings.unshift({ rule: 'connection', verdict: 'BLOCK', message: `Connection is ${la.connection.state}; orders cannot be submitted` }), (risk.verdict = 'BLOCK')
  const impact = tradeImpact({ request, preview, portfolio, bid: book?.bids[0]?.price ?? null, ask: book?.asks[0]?.price ?? null })
  let protection: Record<string, unknown> | null = null
  if (t.stopOffsetPercent && !request.reduceOnly) {
    const off = dec(t.stopOffsetPercent)
    const supported = la.manifest.orderTypes.includes('STOP_MARKET')
    protection = { stopOffsetPercent: off.toFixed(), estimatedStopPrice: preview.estimatedPrice ? protectiveStopPrice(preview.estimatedPrice, request.side, off, inst.tickSize).toFixed() : null, supported, note: supported ? 'Stop is sized from ACTUAL fills after entry, and only shown PROTECTED once the exchange lists it' : 'This account cannot place stop orders — position would stay UNPROTECTED' }
    if (!supported) risk.findings.push({ rule: 'protection', verdict: 'WARN', message: 'Protective stop not supported on this account' }), risk.verdict === 'ALLOW' && (risk.verdict = 'WARN')
  }
  const blocked = risk.verdict === 'BLOCK'
  const token = blocked ? null : newOpaqueToken(24)
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS)
  const reqJson = reqToJson(request)
  const previewJson = toJsonSafe({ ...preview, request: undefined, protection, impact, label: simulationLabel(la.account.environment) }) as Record<string, unknown>
  await ctx.prisma.orderProposal.create({ data: {
    id: proposalId, userId, accountId: la.account.id, intentId: t.intentId ?? null, request: reqJson as Prisma.InputJsonValue, preview: previewJson as Prisma.InputJsonValue, risk: toJsonSafe(risk) as Prisma.InputJsonValue,
    proposalHash: hashProposal({ reqJson, est: previewJson.estimatedPrice ?? null }), tokenHash: token ? hashToken(token) : null, status: blocked ? 'BLOCKED' : 'OPEN', expiresAt,
  } })
  return {
    proposalId, confirmToken: token, expiresAt: expiresAt.toISOString(), canConfirm: !blocked,
    account: { id: la.account.id, alias: la.account.alias, provider: la.account.provider, environment: la.account.environment, environmentLabel: (ENVIRONMENT_LABEL as Record<string, string>)[la.account.environment], connectionState: la.connection.state },
    label: simulationLabel(la.account.environment),
    order: reqJson, preview: previewJson, risk: toJsonSafe(risk),
  }
}

// ---------- order persistence helpers ----------
async function transition(prisma: PrismaClient, orderId: string, from: OrderStatus | null, to: OrderStatus, actor: 'user' | 'system' | 'provider', reason?: string, data: Prisma.OrderUpdateInput = {}) {
  if (from && from !== to && !TRANSITIONS[from].includes(to) && !(from === 'SUBMITTING' && to === 'RECONCILING')) throw new HelmError('ORDER_REJECTED', `Illegal order transition ${from} → ${to}`)
  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { status: to, ...data } }),
    prisma.orderEvent.create({ data: { orderId, from, to, actor, reason } }),
  ])
  return to
}

const orderData = (o: Order): Prisma.OrderUpdateInput => ({ providerOrderId: o.providerOrderId, filledQuantity: o.filledQuantity.toFixed(), avgFillPrice: o.avgFillPrice?.toFixed() ?? null, raw: toJsonSafe(o.raw ?? null) as Prisma.InputJsonValue })

async function applyProvider(prisma: PrismaClient, orderId: string, cur: OrderStatus, o: Order): Promise<OrderStatus> {
  if (o.status === cur && o.status !== 'PARTIALLY_FILLED') { await prisma.order.update({ where: { id: orderId }, data: orderData(o) }); return cur }
  let s = cur
  if (s === 'UNKNOWN') s = await transition(prisma, orderId, s, 'RECONCILING', 'system', 'reconcile before any further action')
  if (TRANSITIONS[s].includes(o.status)) return transition(prisma, orderId, s, o.status, 'provider', 'provider state', orderData(o))
  await prisma.order.update({ where: { id: orderId }, data: orderData(o) })
  return s
}

async function storeFills(prisma: PrismaClient, la: LoadedAccount, orderId: string, o: Order) {
  if (!o.providerOrderId || o.filledQuantity.isZero() || !supports(la.manifest, 'getFills')) return []
  try {
    const fills = (await la.adapter.getFills(o.instrumentId, 50)).filter(f => f.providerOrderId === o.providerOrderId)
    for (const f of fills) await prisma.fill.upsert({ where: { orderId_providerTradeId: { orderId, providerTradeId: f.providerTradeId } }, create: { orderId, providerTradeId: f.providerTradeId, price: f.price.toFixed(), quantity: f.quantity.toFixed(), fee: f.fee?.toFixed() ?? null, feeAsset: f.feeAsset, isMaker: f.isMaker ?? null, timestamp: new Date(f.timestamp) }, update: {} })
    return fills
  } catch { return [] }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------- CONFIRM ----------
export interface ConfirmInput { proposalId: string; confirmToken: string; idempotencyKey: string; via: 'glasses' | 'companion' | 'voice' }

export async function confirmTrade(ctx: EngineCtx, userId: string, c: ConfirmInput) {
  const { prisma } = ctx
  // Idempotency: the same key always returns the same order; never a second submission.
  const existing = await prisma.idempotencyKey.findUnique({ where: { key: c.idempotencyKey } })
  if (existing) {
    if (existing.userId !== userId) throw httpErr(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used')
    if (existing.orderId) return { replayed: true, ...(await receipt(ctx, userId, existing.orderId)) }
    throw httpErr(409, 'IN_PROGRESS', 'This confirmation is already being processed')
  }
  try { await prisma.idempotencyKey.create({ data: { key: c.idempotencyKey, userId } }) }
  catch { throw httpErr(409, 'IN_PROGRESS', 'This confirmation is already being processed') }

  const p = await prisma.orderProposal.findFirst({ where: { id: c.proposalId, userId } })
  if (!p) throw httpErr(404, 'NOT_FOUND', 'Preview not found')
  if (!p.tokenHash || hashToken(c.confirmToken) !== p.tokenHash) throw httpErr(403, 'CONFIRMATION_INVALID', 'Confirmation token does not match this preview')
  const used = await prisma.orderProposal.updateMany({ where: { id: p.id, usedAt: null, status: 'OPEN', expiresAt: { gt: new Date() } }, data: { usedAt: new Date(), status: 'CONFIRMING' } })
  if (used.count === 0) {
    if (p.expiresAt <= new Date()) { await prisma.orderProposal.update({ where: { id: p.id }, data: { status: 'EXPIRED' } }); throw httpErr(410, 'STALE_PROPOSAL', 'Preview expired — review a fresh preview') }
    throw httpErr(409, 'ALREADY_USED', 'This preview was already confirmed or closed')
  }
  const fail = async (status: string, code: string, msg: string, extra: Record<string, unknown> = {}, http = 409) => { await prisma.orderProposal.update({ where: { id: p.id }, data: { status } }); throw httpErr(http, code, msg, extra) }

  // Recheck connection + market + risk with fresh data (never trust the preview blindly).
  const la = await loadAccount(prisma, ctx.key, ctx.adapters, userId, p.accountId)
  await refreshHealth(prisma, la).catch(() => null)
  if (!la.canTrade) await fail('FAILED', 'CONNECTION_NOT_READY', `Connection is ${la.connection.state}`)
  const rj = p.request as Record<string, unknown>
  const inst = await resolveInstrument(la.adapter, la.account.environment, rj.instrument as string)
  if (!inst) return fail('FAILED', 'INVALID_INSTRUMENT', 'Instrument unavailable')
  const request = reqFromJson(rj, inst)
  const pv = p.preview as Record<string, unknown>
  const book = await bookFor(la, inst.id)
  const fresh = await withBuyingPower(la, engineEstimate(request, book, la.account.provider))
  const prevPx = pv.estimatedPrice ? dec(pv.estimatedPrice as string) : null
  if (prevPx && request.type === 'MARKET') {
    const mc = materialChange(prevPx, fresh.estimatedPrice, MAX_PRICE_MOVE_BPS)
    if (mc.material) await fail('STALE', 'STALE_PROPOSAL', 'Price moved since the preview — review again', { movedBps: mc.movedBps?.toFixed(1) ?? null })
  }
  const { portfolio } = await userPortfolio(prisma, ctx.key, ctx.adapters, userId)
  const { policy, version } = await policyFor(prisma, userId)
  const risk: RiskAssessment = assess(policy, { request, preview: { ...fresh, id: p.id }, portfolio, reducesRisk: !!request.reduceOnly }, version)
  if (risk.verdict === 'BLOCK') await fail('BLOCKED', 'RISK_POLICY_VIOLATION', 'Blocked by HELM Shield on recheck', { risk: toJsonSafe(risk) }, 422)

  // Persist the order BEFORE anything leaves the process.
  const env = la.account.environment
  const order = await prisma.order.create({ data: {
    userId, accountId: la.account.id, provider: la.account.provider, environment: env as never, instrumentId: inst.id, clientOrderId: request.clientOrderId,
    side: request.side, type: request.type, quantity: request.quantity?.toFixed() ?? null, quoteQuantity: request.quoteQuantity?.toFixed() ?? null, price: request.price?.toFixed() ?? null, reduceOnly: !!request.reduceOnly,
    status: 'DRAFT', simulatedLocal: env === 'simulated', simulatedStatic: env === 'sandbox_static', proposalId: p.id,
    events: { create: [{ from: null, to: 'DRAFT', actor: 'system' }] },
  } })
  let s: OrderStatus = 'DRAFT'
  s = await transition(prisma, order.id, s, 'VALIDATED', 'system', `risk ${risk.verdict} (policy v${version})`)
  s = await transition(prisma, order.id, s, 'AWAITING_CONFIRMATION', 'system')
  s = await transition(prisma, order.id, s, 'CONFIRMED', 'user', `confirmed via ${c.via}`)
  await prisma.tradeConfirmation.create({ data: { orderId: order.id, proposalId: p.id, tokenHash: p.tokenHash, confirmedVia: c.via, expiresAt: p.expiresAt, usedAt: new Date() } })
  await prisma.idempotencyKey.update({ where: { key: c.idempotencyKey }, data: { orderId: order.id } })
  await prisma.orderProposal.update({ where: { id: p.id }, data: { status: 'USED' } })

  if (request.leverage && inst.product !== 'spot') {
    const a = la.adapter as typeof la.adapter & { setLeverage?: (id: string, l: Decimal) => Promise<void> }
    if (a.setLeverage) await a.setLeverage(inst.id, request.leverage).catch(() => null)
  }
  const attempt = await prisma.executionAttempt.create({ data: { orderId: order.id, attempt: 1, outcome: 'PENDING' } })
  s = await transition(prisma, order.id, s, 'SUBMITTING', 'system')
  let ack: Order | null = null
  try {
    ack = await la.adapter.submitOrder(request)
    await prisma.executionAttempt.update({ where: { id: attempt.id }, data: { outcome: 'ACKNOWLEDGED', finishedAt: new Date() } })
    s = await applyProvider(prisma, order.id, s, ack)
  } catch (e) {
    const he = e as HelmError
    await prisma.executionAttempt.update({ where: { id: attempt.id }, data: { outcome: he.code === 'ORDER_UNKNOWN' ? 'UNKNOWN' : 'REJECTED', errorCode: he.code ?? 'ERROR', providerRaw: toJsonSafe({ providerCode: he.providerCode ?? null }) as Prisma.InputJsonValue, finishedAt: new Date() } })
    if (he.code === 'ORDER_UNKNOWN') {
      s = await transition(prisma, order.id, s, 'UNKNOWN', 'system', 'no definitive response — never retried blindly')
      await emitPulse(prisma, { userId, kind: 'EXECUTION_UNKNOWN', severity: 4, provider: la.account.provider, accountId: la.account.id, instrumentId: inst.id, reason: 'Order state unknown — reconciling with the exchange', dedupeKey: `unknown:${order.id}` })
    } else {
      s = await transition(prisma, order.id, s, 'REJECTED', 'provider', `${he.code ?? 'ERROR'}${he.providerCode ? ` (${he.providerCode})` : ''}: ${he.message}`)
      await emitPulse(prisma, { userId, kind: 'ORDER_REJECTED', severity: 3, provider: la.account.provider, accountId: la.account.id, instrumentId: inst.id, reason: `${inst.base} ${request.side} rejected: ${he.code}`, dedupeKey: `rej:${order.id}` })
      return receipt(ctx, userId, order.id)
    }
  }
  // Reconcile (provider truth). For market orders give the venue a moment to fill.
  for (let k = 0; k < (request.type === 'MARKET' ? 8 : 1) && !TERMINAL.has(s) && !(request.type === 'LIMIT' && s === 'ACCEPTED'); k++) {
    try {
      const r = await la.adapter.reconcileOrder(inst.id, ack?.providerOrderId ? { providerOrderId: ack.providerOrderId } : { clientOrderId: request.clientOrderId })
      if (r) { ack = r; s = await applyProvider(prisma, order.id, s, r) }
      else if (s === 'UNKNOWN') s = await transition(prisma, order.id, s, 'RECONCILING', 'system', 'not found yet at venue')
    } catch { /* keep state; never resubmit */ }
    if (!TERMINAL.has(s)) await sleep(400)
  }
  if (ack) {
    const fills = await storeFills(prisma, la, order.id, ack)
    // Some venues ack FILLED with avgPrice 0 — fetch provider truth again, else use the venue's own trade list.
    if (!ack.filledQuantity.isZero() && (!ack.avgFillPrice || ack.avgFillPrice.isZero())) {
      const r = await la.adapter.reconcileOrder(inst.id, ack.providerOrderId ? { providerOrderId: ack.providerOrderId } : { clientOrderId: request.clientOrderId }).catch(() => null)
      if (r?.avgFillPrice && !r.avgFillPrice.isZero()) ack = { ...ack, avgFillPrice: r.avgFillPrice }
      else if (fills.length) { const q = fills.reduce((a, f) => a.plus(f.quantity), dec(0)); if (!q.isZero()) ack = { ...ack, avgFillPrice: fills.reduce((a, f) => a.plus(f.price.mul(f.quantity)), dec(0)).div(q) } }
      if (ack.avgFillPrice && !ack.avgFillPrice.isZero()) await prisma.order.update({ where: { id: order.id }, data: { avgFillPrice: ack.avgFillPrice.toFixed() } })
    }
  }
  if (s === 'FILLED' || s === 'PARTIALLY_FILLED') await emitPulse(prisma, { userId, kind: s === 'FILLED' ? 'ORDER_FILLED' : 'ORDER_PARTIALLY_FILLED', severity: 1, provider: la.account.provider, accountId: la.account.id, instrumentId: inst.id, reason: `${request.side} ${ack?.filledQuantity.toFixed()} ${inst.base} @ ${ack?.avgFillPrice?.toFixed() ?? '—'}${env === 'simulated' ? ' (SIMULATED)' : ''}`, dedupeKey: `fill:${order.id}` })

  // Trade-to-Protect.
  const prot = pv.protection as { stopOffsetPercent?: string; supported?: boolean } | null
  if (prot?.stopOffsetPercent && ack && !ack.filledQuantity.isZero()) await protect(ctx, userId, la, inst, order.id, request, ack, dec(prot.stopOffsetPercent))
  return receipt(ctx, userId, order.id)
}

async function protect(ctx: EngineCtx, userId: string, la: LoadedAccount, inst: Instrument, orderId: string, entry: OrderRequest, filled: Order, offset: Decimal) {
  const { prisma } = ctx
  const wf = new ProtectionWorkflow('ENTRY_SUBMITTED')
  wf.to(filled.status === 'FILLED' ? 'ENTRY_FILLED' : 'ENTRY_PARTIAL', `filled ${filled.filledQuantity.toFixed()}`)
  const plan = await prisma.protectionPlan.create({ data: { userId, accountId: la.account.id, instrumentId: inst.id, entryOrderId: orderId, stopOffsetPercent: offset.toFixed(), state: wf.state, history: toJsonSafe(wf.history) as Prisma.InputJsonValue } })
  await prisma.order.update({ where: { id: orderId }, data: { protectionPlanId: plan.id } })
  const save = (extra: Prisma.ProtectionPlanUpdateInput = {}) => prisma.protectionPlan.update({ where: { id: plan.id }, data: { state: wf.state, history: toJsonSafe(wf.history) as Prisma.InputJsonValue, ...extra } })
  const unprotected = async (why: string) => {
    wf.to('UNPROTECTED', why); await save()
    await emitPulse(prisma, { userId, kind: 'PROTECTION_FAILED', severity: 4, provider: la.account.provider, accountId: la.account.id, instrumentId: inst.id, reason: `${inst.base} position is UNPROTECTED: ${why}`, dedupeKey: `prot:${plan.id}` })
  }
  if (!la.manifest.orderTypes.includes('STOP_MARKET')) return unprotected('stop orders not supported on this account')
  if (!filled.avgFillPrice || filled.avgFillPrice.isZero()) return unprotected('no fill price reported')
  let baseFee = dec(0), free: Decimal | null = null
  if (inst.product === 'spot') {
    const fills = await prisma.fill.findMany({ where: { orderId } })
    baseFee = fills.filter(f => f.feeAsset === inst.base).reduce((a, f) => a.plus(f.fee?.toString() ?? '0'), dec(0))
    free = (await la.adapter.getBalances().catch(() => [])).find(b => b.asset === inst.base)?.free ?? null
  }
  const qty = protectiveQuantity({ filledQty: filled.filledQuantity, baseFee, freeBase: free, instrument: inst })
  if (qty.isZero()) return unprotected('filled quantity below the minimum stop size')
  const stopPrice = protectiveStopPrice(filled.avgFillPrice, entry.side, offset, inst.tickSize)
  wf.to('PROTECTION_SUBMITTED', `stop ${stopPrice.toFixed()} for ${qty.toFixed()}`)
  await save({ stopPrice: stopPrice.toFixed() })
  const sreq: OrderRequest = { accountId: la.account.id, instrument: inst, side: entry.side === 'BUY' ? 'SELL' : 'BUY', type: 'STOP_MARKET', quantity: qty, stopPrice, reduceOnly: inst.product !== 'spot', clientOrderId: clientOrderIdFor(filled.clientOrderId.replace(/^helmen/, ''), 's') }
  const sOrder = await prisma.order.create({ data: { userId, accountId: la.account.id, provider: la.account.provider, environment: la.account.environment as never, instrumentId: inst.id, clientOrderId: sreq.clientOrderId, side: sreq.side, type: 'STOP_MARKET', quantity: qty.toFixed(), stopPrice: stopPrice.toFixed(), reduceOnly: !!sreq.reduceOnly, status: 'CONFIRMED', simulatedLocal: la.account.environment === 'simulated', protectionPlanId: plan.id, events: { create: [{ from: null, to: 'CONFIRMED', actor: 'user', reason: 'part of the confirmed Trade-to-Protect plan' }] } } })
  let s: OrderStatus = await transition(prisma, sOrder.id, 'CONFIRMED', 'SUBMITTING', 'system')
  try {
    const ack = await la.adapter.submitOrder(sreq)
    s = await applyProvider(prisma, sOrder.id, s, ack)
    // PROTECTED only when the venue itself lists the stop as live.
    const open = await la.adapter.getOpenOrders(inst.id)
    const live = open.find(o => (ack.providerOrderId && o.providerOrderId === ack.providerOrderId) || o.clientOrderId === sreq.clientOrderId)
    if (live && live.status === 'ACCEPTED') { wf.to('PROTECTED', `venue lists stop ${live.providerOrderId}`); await save({ protectionOrderId: sOrder.id, protectedQuantity: qty.toFixed() }); await emitPulse(prisma, { userId, kind: 'PROTECTION_ACTIVE', severity: 1, provider: la.account.provider, accountId: la.account.id, instrumentId: inst.id, reason: `${inst.base} stop ${stopPrice.toFixed()} live at venue`, dedupeKey: `protok:${plan.id}` }) }
    else await unprotected('stop not visible in the venue’s open orders')
  } catch (e) {
    const he = e as HelmError
    if (he.code === 'ORDER_UNKNOWN') await transition(prisma, sOrder.id, s, 'UNKNOWN', 'system', 'stop submit timed out')
    else await transition(prisma, sOrder.id, s, 'REJECTED', 'provider', `${he.code}${he.providerCode ? ` (${he.providerCode})` : ''}`)
    await unprotected(`stop ${he.code === 'ORDER_UNKNOWN' ? 'state unknown' : 'rejected'}: ${he.code}`)
  }
}

// ---------- RECEIPT / ORDERS ----------
export async function receipt(ctx: EngineCtx, userId: string, orderId: string) {
  const o = await ctx.prisma.order.findFirst({ where: { id: orderId, userId }, include: { fills: true, events: { orderBy: { at: 'asc' } }, account: { select: { alias: true } }, confirmation: { select: { confirmedVia: true } } } })
  if (!o) throw httpErr(404, 'NOT_FOUND', 'Order not found')
  const plan = o.protectionPlanId ? await ctx.prisma.protectionPlan.findUnique({ where: { id: o.protectionPlanId } }) : null
  const label = o.simulatedLocal ? SIMULATED_LABEL : o.simulatedStatic ? simulationLabel('sandbox_static') : null
  return {
    receipt: {
      orderId: o.id, account: o.account.alias, provider: o.provider, environment: o.environment, environmentLabel: (ENVIRONMENT_LABEL as Record<string, string>)[o.environment], label,
      instrumentId: o.instrumentId, side: o.side, type: o.type, status: o.status, clientOrderId: o.clientOrderId, providerOrderId: o.providerOrderId,
      quantity: o.quantity?.toString() ?? null, quoteQuantity: o.quoteQuantity?.toString() ?? null, price: o.price?.toString() ?? null, reduceOnly: o.reduceOnly,
      filledQuantity: o.filledQuantity.toString(), avgFillPrice: o.avgFillPrice?.toString() ?? null,
      fills: o.fills.map(f => ({ id: f.providerTradeId, price: f.price.toString(), qty: f.quantity.toString(), fee: f.fee?.toString() ?? null, feeAsset: f.feeAsset })),
      events: o.events.map(e => ({ from: e.from, to: e.to, actor: e.actor, reason: e.reason, at: e.at })),
      confirmedVia: o.confirmation?.confirmedVia ?? null, createdAt: o.createdAt, updatedAt: o.updatedAt,
      protection: plan ? { state: plan.state as ProtectionState, stopPrice: plan.stopPrice?.toString() ?? null, protectedQuantity: plan.protectedQuantity.toString(), history: plan.history } : null,
      fillTruth: o.simulatedLocal ? 'Fill computed locally by the HELM simulator from live public prices' : o.simulatedStatic ? 'Static sandbox response — not a fill' : 'Reported by the exchange demo environment',
    },
  }
}

export async function refreshOrder(ctx: EngineCtx, userId: string, orderId: string) {
  const o = await ctx.prisma.order.findFirst({ where: { id: orderId, userId } })
  if (!o) throw httpErr(404, 'NOT_FOUND', 'Order not found')
  if (!TERMINAL.has(o.status as OrderStatus)) {
    const la = await loadAccount(ctx.prisma, ctx.key, ctx.adapters, userId, o.accountId)
    const r = await la.adapter.reconcileOrder(o.instrumentId, o.providerOrderId ? { providerOrderId: o.providerOrderId } : { clientOrderId: o.clientOrderId }).catch(() => null)
    if (r) { await applyProvider(ctx.prisma, o.id, o.status as OrderStatus, r); await storeFills(ctx.prisma, la, o.id, r) }
  }
  return receipt(ctx, userId, orderId)
}

export async function cancelOrder(ctx: EngineCtx, userId: string, orderId: string) {
  const o = await ctx.prisma.order.findFirst({ where: { id: orderId, userId } })
  if (!o) throw httpErr(404, 'NOT_FOUND', 'Order not found')
  if (TERMINAL.has(o.status as OrderStatus)) throw httpErr(409, 'TERMINAL', `Order already ${o.status}`)
  const la = await loadAccount(ctx.prisma, ctx.key, ctx.adapters, userId, o.accountId)
  const r = await la.adapter.cancelOrder(o.instrumentId, o.providerOrderId ? { providerOrderId: o.providerOrderId } : { clientOrderId: o.clientOrderId })
  let s = o.status as OrderStatus
  if (r.status === 'CANCELED' && TRANSITIONS[s].includes('CANCELED')) s = await transition(ctx.prisma, o.id, s, 'CANCELED', 'user', 'cancel confirmed by venue', orderData(r))
  else s = await applyProvider(ctx.prisma, o.id, s, r)
  if (s === 'CANCELED' && o.protectionPlanId) {
    const plan = await ctx.prisma.protectionPlan.findUnique({ where: { id: o.protectionPlanId } })
    if (plan?.protectionOrderId === o.id && plan.state === 'PROTECTED') {
      const wf = new ProtectionWorkflow('PROTECTED', plan.history as never); wf.to('UNPROTECTED', 'protective stop canceled by user')
      await ctx.prisma.protectionPlan.update({ where: { id: plan.id }, data: { state: wf.state, history: toJsonSafe(wf.history) as Prisma.InputJsonValue } })
    }
  }
  return receipt(ctx, userId, o.id)
}
