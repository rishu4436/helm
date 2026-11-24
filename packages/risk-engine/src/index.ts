import { z } from 'zod'
import {
  Decimal, dec, sum, type Instrument, type Order, type OrderPreview, type OrderRequest, type Position, type RiskAssessment, type RiskFinding, type RiskVerdict,
} from '@helm/shared'
import { baseOf, type Portfolio } from '@helm/portfolio'

// ======================= HELM SHIELD — policy =======================

const usd = z.string().regex(/^\d+(\.\d+)?$/)
export const RiskPolicySchema = z.object({
  maxSpotOrderUsd: usd, maxFuturesOrderUsd: usd, maxLeverage: usd, maxTotalNotionalUsd: usd, maxAssetExposureUsd: usd,
  maxExchangeExposurePct: usd, maxMarginUtilizationPct: usd, minReserveUsd: usd, maxSlippageBps: usd,
  allowedInstruments: z.array(z.string().max(64)).max(200), blockedInstruments: z.array(z.string().max(64)).max(200),
  maxOpenOrders: z.number().int().min(0).max(500), sessionBudgetUsd: usd.nullable(),
  /** Liquidation-distance threshold for "near risk" (percent from mark). */
  nearLiquidationPct: usd,
})
export type RiskPolicy = z.infer<typeof RiskPolicySchema>

export const DEFAULT_POLICY: RiskPolicy = {
  maxSpotOrderUsd: '1000', maxFuturesOrderUsd: '2000', maxLeverage: '5', maxTotalNotionalUsd: '25000', maxAssetExposureUsd: '15000',
  maxExchangeExposurePct: '80', maxMarginUtilizationPct: '50', minReserveUsd: '100', maxSlippageBps: '50',
  allowedInstruments: [], blockedInstruments: [], maxOpenOrders: 20, sessionBudgetUsd: null, nearLiquidationPct: '10',
}

export interface AssessContext {
  request: OrderRequest
  preview: OrderPreview
  portfolio: Portfolio
  /** True when this order can only reduce risk (reduce-only close, protective stop). */
  reducesRisk: boolean
  sessionSpentUsd?: Decimal
  now?: Date
}

const pct = (x: Decimal, of: Decimal) => (of.isZero() ? dec(0) : x.div(of).mul(100))

/** Deterministic, server-side policy evaluation. BLOCK wins over WARN wins over ALLOW. */
export function assess(policy: RiskPolicy, ctx: AssessContext, version = 1): RiskAssessment {
  const f: RiskFinding[] = []
  const add = (rule: string, verdict: RiskVerdict, message: string, limit?: string, actual?: string) => f.push({ rule, verdict, message, limit, actual })
  const { request: r, preview: p, portfolio } = ctx
  const i = r.instrument
  const notional = p.estimatedNotional ?? dec(0)
  const isDeriv = i.product === 'perp' || i.product === 'future'

  if (policy.blockedInstruments.includes(i.id) || policy.blockedInstruments.includes(i.base)) add('blocked_instrument', 'BLOCK', `${i.base} is on your blocked list`)
  if (policy.allowedInstruments.length > 0 && !policy.allowedInstruments.includes(i.id) && !policy.allowedInstruments.includes(i.base)) add('allowed_instruments', 'BLOCK', `${i.base} is not on your allowed list`)
  if (p.estimatedNotional === null) add('valuation', 'BLOCK', 'Order value could not be estimated from live data')

  if (!ctx.reducesRisk) {
    const lim = dec(isDeriv ? policy.maxFuturesOrderUsd : policy.maxSpotOrderUsd)
    if (notional.gt(lim)) add(isDeriv ? 'max_futures_order' : 'max_spot_order', 'BLOCK', `Order $${notional.toFixed(2)} exceeds your ${isDeriv ? 'futures' : 'spot'} limit`, lim.toFixed(), notional.toFixed(2))
    if (isDeriv && r.leverage && r.leverage.gt(policy.maxLeverage)) add('max_leverage', 'BLOCK', `Leverage ${r.leverage.toFixed()}x exceeds ${policy.maxLeverage}x`, policy.maxLeverage, r.leverage.toFixed())
    if (isDeriv) {
      const total = portfolio.grossDerivativeExposureUsd.plus(notional)
      if (total.gt(policy.maxTotalNotionalUsd)) add('max_total_notional', 'BLOCK', 'Total derivative notional would exceed your limit', policy.maxTotalNotionalUsd, total.toFixed(2))
    }
    const e = portfolio.exposures.find(x => x.asset === i.base)
    const cur = e ? e.grossUsd : dec(0)
    if (cur.plus(notional).gt(policy.maxAssetExposureUsd)) add('max_asset_exposure', 'BLOCK', `${i.base} exposure would exceed $${policy.maxAssetExposureUsd}`, policy.maxAssetExposureUsd, cur.plus(notional).toFixed(2))
    const acct = portfolio.accounts.find(a => a.accountId === r.accountId)
    if (acct && portfolio.netLiquidationUsd.gt(0)) {
      const share = pct(acct.valueUsd, portfolio.netLiquidationUsd)
      if (share.gt(policy.maxExchangeExposurePct)) add('exchange_concentration', 'WARN', `${acct.alias} holds ${share.toFixed(0)}% of your portfolio`, policy.maxExchangeExposurePct, share.toFixed(1))
    }
    if (p.remainingBuyingPower !== null) {
      if (p.remainingBuyingPower.lt(0)) add('buying_power', 'BLOCK', 'Insufficient available balance for this order', '0', p.remainingBuyingPower.toFixed(2))
      else if (p.remainingBuyingPower.lt(policy.minReserveUsd)) add('min_reserve', 'BLOCK', `Would leave less than your $${policy.minReserveUsd} reserve`, policy.minReserveUsd, p.remainingBuyingPower.toFixed(2))
    } else add('buying_power', 'WARN', 'Provider did not report buying power; cannot verify reserve')
    if (ctx.sessionSpentUsd && policy.sessionBudgetUsd && ctx.sessionSpentUsd.plus(notional).gt(policy.sessionBudgetUsd)) add('session_budget', 'BLOCK', 'Session trading budget exhausted', policy.sessionBudgetUsd, ctx.sessionSpentUsd.plus(notional).toFixed(2))
    if (portfolio.openOrders.length >= policy.maxOpenOrders) add('max_open_orders', 'BLOCK', `You already have ${portfolio.openOrders.length} open orders`, String(policy.maxOpenOrders), String(portfolio.openOrders.length))
    if (isDeriv && p.requiredMargin && acct) {
      const usedPct = pct(sum(portfolio.positions.filter(x => x.accountId === r.accountId).map(x => x.isolatedMargin ?? dec(0))).plus(p.requiredMargin), acct.valueUsd)
      if (usedPct.gt(policy.maxMarginUtilizationPct)) add('margin_utilization', 'BLOCK', `Margin use would reach ${usedPct.toFixed(0)}%`, policy.maxMarginUtilizationPct, usedPct.toFixed(1))
    }
  }
  if (p.estimatedSlippageBps && p.estimatedSlippageBps.gt(policy.maxSlippageBps)) add('max_slippage', ctx.reducesRisk ? 'WARN' : 'BLOCK', `Estimated slippage ${p.estimatedSlippageBps.toFixed(1)} bps`, policy.maxSlippageBps, p.estimatedSlippageBps.toFixed(1))
  if (f.length === 0) add('all_checks', 'ALLOW', 'Within all Shield limits')
  const verdict: RiskVerdict = f.some(x => x.verdict === 'BLOCK') ? 'BLOCK' : f.some(x => x.verdict === 'WARN') ? 'WARN' : 'ALLOW'
  return { verdict, findings: f, policyVersion: version, assessedAt: (ctx.now ?? new Date()).toISOString() }
}

// ======================= HELM VISION — Trade Impact Preview =======================

export interface TradeImpact {
  instrumentId: string; asset: string
  currentExposureUsd: Decimal; proposedExposureUsd: Decimal
  currentPositionQty: Decimal; proposedPositionQty: Decimal
  estimatedPrice: Decimal | null; estimatedNotional: Decimal | null; estimatedFee: Decimal | null
  spreadBps: Decimal | null; slippageBps: Decimal | null
  requiredCapital: Decimal | null; remainingBuyingPower: Decimal | null
  liquidation: { current: Decimal | null; proposed: Decimal | null; note: string }
  existingProtection: Array<{ providerOrderId: string | null; type: string; stopPrice: Decimal | null; quantity: Decimal | null }>
  estimateNotes: string[]
}

export function tradeImpact(args: { request: OrderRequest; preview: OrderPreview; portfolio: Portfolio; bid: Decimal | null; ask: Decimal | null }): TradeImpact {
  const { request: r, preview: p, portfolio, bid, ask } = args
  const i: Instrument = r.instrument
  const e = portfolio.exposures.find(x => x.asset === i.base)
  const signedNotional = (p.estimatedNotional ?? dec(0)).mul(r.side === 'BUY' ? 1 : -1)
  const pos = portfolio.positions.find(x => x.accountId === r.accountId && x.instrumentId === i.id)
  const curQty = pos ? (pos.side === 'SHORT' && pos.quantity.isPositive() ? pos.quantity.neg() : pos.quantity) : dec(0)
  const reqQty = p.request.quantity ?? r.quantity ?? (p.estimatedPrice && r.quoteQuantity ? r.quoteQuantity.div(p.estimatedPrice) : dec(0))
  const proposedQty = i.product === 'spot' ? curQty : curQty.plus(r.side === 'BUY' ? reqQty : reqQty.neg())
  const spreadBps = bid && ask && bid.gt(0) ? ask.minus(bid).div(bid.plus(ask).div(2)).mul(10000) : null
  const protections = portfolio.openOrders.filter(o => o.accountId === r.accountId && o.instrumentId === i.id && (o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT') && o.reduceOnly !== false)
  const liqNote = i.product === 'spot' ? 'Spot: no liquidation' : pos?.liquidationPrice ? 'Provider-reported current liquidation; post-trade value is not calculable without provider margin tiers' : 'Liquidation not calculable from available provider data'
  return {
    instrumentId: i.id, asset: i.base,
    currentExposureUsd: e?.netDirectionalUsd ?? dec(0), proposedExposureUsd: (e?.netDirectionalUsd ?? dec(0)).plus(signedNotional),
    currentPositionQty: curQty, proposedPositionQty: proposedQty,
    estimatedPrice: p.estimatedPrice, estimatedNotional: p.estimatedNotional, estimatedFee: p.estimatedFee,
    spreadBps, slippageBps: p.estimatedSlippageBps, requiredCapital: p.requiredMargin ?? (r.side === 'BUY' && p.estimatedNotional ? p.estimatedNotional.plus(p.estimatedFee ?? 0) : null),
    remainingBuyingPower: p.remainingBuyingPower,
    liquidation: { current: pos?.liquidationPrice ?? null, proposed: null, note: liqNote },
    existingProtection: protections.map(o => ({ providerOrderId: o.providerOrderId, type: o.type, stopPrice: o.stopPrice, quantity: o.quantity })),
    estimateNotes: ['All values are estimates from a live book snapshot at preview time', ...p.estimateNotes],
  }
}

// ======================= EXPOSURE COMPASS =======================

export interface Compass {
  largestDirectional: { asset: string; netUsd: Decimal; direction: 'LONG' | 'SHORT' | 'FLAT' } | null
  largestExchange: { accountId: string; alias: string; sharePct: Decimal } | null
  nearRisk: Array<{ accountId: string; instrumentId: string; distancePct: Decimal }>
  unprotected: Array<{ accountId: string; instrumentId: string; side: string; notionalUsd: Decimal | null }>
  marginWarnings: Array<{ accountId: string; alias: string; utilizationPct: Decimal }>
  pendingOrderDeltaUsd: Decimal
  /** 8 compass points for the G2 rose: share of gross exposure per top asset. */
  rose: Array<{ asset: string; sharePct: Decimal; direction: 'LONG' | 'SHORT' | 'FLAT' }>
}

export function hasProtection(p: Position, open: Order[]): boolean {
  return open.some(o => o.accountId === p.accountId && o.instrumentId === p.instrumentId && (o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT') && (o.reduceOnly || p.product === 'spot') && o.side === (p.side === 'SHORT' || p.quantity.isNegative() ? 'BUY' : 'SELL'))
}

export function compass(portfolio: Portfolio, policy: RiskPolicy = DEFAULT_POLICY): Compass {
  const dir = (n: Decimal) => (n.isZero() ? 'FLAT' as const : n.isNegative() ? 'SHORT' as const : 'LONG' as const)
  const ex = [...portfolio.exposures].sort((a, b) => b.netDirectionalUsd.abs().comparedTo(a.netDirectionalUsd.abs()))
  const top = ex[0]
  const accts = [...portfolio.accounts].sort((a, b) => b.valueUsd.comparedTo(a.valueUsd))
  const gross = sum(portfolio.exposures.map(e => e.grossUsd))
  const nearRisk = portfolio.positions.flatMap(p => {
    if (!p.liquidationPrice || !p.markPrice || p.markPrice.isZero()) return []
    const d = p.markPrice.minus(p.liquidationPrice).abs().div(p.markPrice).mul(100)
    return d.lte(policy.nearLiquidationPct) ? [{ accountId: p.accountId, instrumentId: p.instrumentId, distancePct: d }] : []
  })
  const marginWarnings = portfolio.accounts.flatMap(a => {
    const used = sum(portfolio.positions.filter(p => p.accountId === a.accountId).map(p => p.isolatedMargin ?? dec(0)))
    const u = a.valueUsd.isZero() ? dec(0) : used.div(a.valueUsd).mul(100)
    return u.gt(policy.maxMarginUtilizationPct) ? [{ accountId: a.accountId, alias: a.alias, utilizationPct: u }] : []
  })
  const pendingOrderDeltaUsd = sum(portfolio.openOrders.filter(o => o.type === 'LIMIT' && !o.reduceOnly).map(o => (o.price && o.quantity ? o.price.mul(o.quantity).mul(o.side === 'BUY' ? 1 : -1) : dec(0))))
  return {
    largestDirectional: top ? { asset: top.asset, netUsd: top.netDirectionalUsd, direction: dir(top.netDirectionalUsd) } : null,
    largestExchange: accts[0] && portfolio.netLiquidationUsd.gt(0) ? { accountId: accts[0].accountId, alias: accts[0].alias, sharePct: accts[0].valueUsd.div(portfolio.netLiquidationUsd).mul(100) } : null,
    nearRisk,
    unprotected: portfolio.positions.filter(p => p.product !== 'spot' && p.product !== 'stock' && !hasProtection(p, portfolio.openOrders)).map(p => ({ accountId: p.accountId, instrumentId: p.instrumentId, side: p.side, notionalUsd: p.notional })),
    marginWarnings, pendingOrderDeltaUsd,
    rose: ex.slice(0, 8).map(e => ({ asset: e.asset, sharePct: gross.isZero() ? dec(0) : e.grossUsd.div(gross).mul(100), direction: dir(e.netDirectionalUsd) })),
  }
}

// ======================= SCENARIO (stress test, not a prediction) =======================

export interface ScenarioResult {
  asset: string; shockPct: Decimal
  totalPnlUsd: Decimal
  legs: Array<{ accountId: string; alias: string; kind: string; pnlUsd: Decimal; breachesLiquidation: boolean | null }>
  disclaimer: string
}

/** Linear model: pnl = exposure × shock. Liquidation breach only when provider liquidation price is known. */
export function scenario(portfolio: Portfolio, asset: string, shockPct: Decimal): ScenarioResult {
  const e = portfolio.exposures.find(x => x.asset === asset.toUpperCase())
  const legs = (e?.byAccount ?? []).map(l => {
    const p = portfolio.positions.find(x => x.accountId === l.accountId && baseOf(x.instrumentId) === e!.asset && l.kind === 'perp')
    let breach: boolean | null = null
    if (p?.liquidationPrice && p.markPrice) {
      const shocked = p.markPrice.mul(dec(1).plus(shockPct.div(100)))
      breach = l.side === 'LONG' ? shocked.lte(p.liquidationPrice) : shocked.gte(p.liquidationPrice)
    }
    return { accountId: l.accountId, alias: l.alias, kind: l.kind, pnlUsd: l.usd.mul(shockPct).div(100), breachesLiquidation: breach }
  })
  return { asset: asset.toUpperCase(), shockPct, totalPnlUsd: sum(legs.map(l => l.pnlUsd)), legs, disclaimer: 'Stress test using a linear model on current exposure. Not a market prediction; ignores funding, fees, and margin tier changes.' }
}

export interface MultiScenarioResult {
  name: string | null
  shocks: Array<{ asset: string; shockPct: Decimal }>
  totalPnlUsd: Decimal
  /** Same shocks, but perp legs with a venue-listed reduce-only stop lose at most down to the stop trigger. */
  totalPnlWithStopsUsd: Decimal
  netLiquidationUsd: Decimal
  pnlPctOfNetLiq: Decimal | null
  perAsset: Array<ScenarioResult & { pnlWithStopsUsd: Decimal }>
  byAccount: Array<{ accountId: string; alias: string; pnlUsd: Decimal; pnlWithStopsUsd: Decimal }>
  liquidationBreaches: Array<{ accountId: string; alias: string; asset: string }>
  stopsCounted: Array<{ accountId: string; instrumentId: string; stopPrice: Decimal; savedUsd: Decimal }>
  unprotectedLegs: Array<{ accountId: string; instrumentId: string }>
  disclaimer: string
}

export const SCENARIO_PRESETS: Array<{ id: string; name: string; shocks: Array<{ asset: string; shockPercent: string }> }> = [
  { id: 'btc-10', name: 'BTC −10%', shocks: [{ asset: 'BTC', shockPercent: '-10' }] },
  { id: 'crypto-crash', name: 'Crypto crash (BTC −15, ETH −20, SOL −25)', shocks: [{ asset: 'BTC', shockPercent: '-15' }, { asset: 'ETH', shockPercent: '-20' }, { asset: 'SOL', shockPercent: '-25' }] },
  { id: 'flash-wick', name: 'Flash wick (all −30%)', shocks: [{ asset: 'BTC', shockPercent: '-30' }, { asset: 'ETH', shockPercent: '-30' }, { asset: 'SOL', shockPercent: '-30' }] },
  { id: 'squeeze', name: 'Short squeeze (BTC +12, ETH +15)', shocks: [{ asset: 'BTC', shockPercent: '12' }, { asset: 'ETH', shockPercent: '15' }] },
  { id: 'eth-underperform', name: 'ETH/BTC unwind (BTC −3, ETH −12)', shocks: [{ asset: 'BTC', shockPercent: '-3' }, { asset: 'ETH', shockPercent: '-12' }] },
]

/** Several simultaneous shocks. Linear on current exposure; optionally caps perp losses at venue-listed protective stops. */
export function multiScenario(portfolio: Portfolio, shocks: Array<{ asset: string; shockPct: Decimal }>, name: string | null = null): MultiScenarioResult {
  const stopsCounted: MultiScenarioResult['stopsCounted'] = []
  const unprotectedLegs: MultiScenarioResult['unprotectedLegs'] = []
  const perAsset = shocks.map(sh => {
    const r = scenario(portfolio, sh.asset, sh.shockPct)
    let withStops = dec(0)
    for (const leg of r.legs) {
      const p = leg.kind === 'perp' ? portfolio.positions.find(x => x.accountId === leg.accountId && baseOf(x.instrumentId) === r.asset && x.product === 'perp' && !x.quantity.isZero()) : undefined
      if (!p || !p.markPrice) { withStops = withStops.plus(leg.pnlUsd); continue }
      const long = !(p.side === 'SHORT' || p.quantity.isNegative())
      const stop = portfolio.openOrders.find(o => o.accountId === p.accountId && o.instrumentId === p.instrumentId && (o.type === 'STOP_MARKET' || o.type === 'STOP_LIMIT') && o.reduceOnly && o.side === (long ? 'SELL' : 'BUY') && o.stopPrice)
      if (!stop) { unprotectedLegs.push({ accountId: p.accountId, instrumentId: p.instrumentId }); withStops = withStops.plus(leg.pnlUsd); continue }
      const shocked = p.markPrice.mul(dec(1).plus(sh.shockPct.div(100)))
      const hit = long ? shocked.lte(stop.stopPrice!) : shocked.gte(stop.stopPrice!)
      if (!hit || leg.pnlUsd.gte(0)) { withStops = withStops.plus(leg.pnlUsd); continue }
      const qty = p.quantity.abs()
      const capped = (long ? stop.stopPrice!.minus(p.markPrice) : p.markPrice.minus(stop.stopPrice!)).mul(qty)
      const legWith = Decimal.max(leg.pnlUsd, capped)
      stopsCounted.push({ accountId: p.accountId, instrumentId: p.instrumentId, stopPrice: stop.stopPrice!, savedUsd: legWith.minus(leg.pnlUsd) })
      withStops = withStops.plus(legWith)
    }
    return { ...r, pnlWithStopsUsd: withStops }
  })
  const acc = new Map<string, { accountId: string; alias: string; pnlUsd: Decimal; pnlWithStopsUsd: Decimal }>()
  for (const a of perAsset) for (const l of a.legs) {
    const cur = acc.get(l.accountId) ?? { accountId: l.accountId, alias: l.alias, pnlUsd: dec(0), pnlWithStopsUsd: dec(0) }
    cur.pnlUsd = cur.pnlUsd.plus(l.pnlUsd)
    const saved = stopsCounted.filter(x => x.accountId === l.accountId && baseOf(x.instrumentId) === a.asset).reduce((t, x) => t.plus(x.savedUsd), dec(0))
    cur.pnlWithStopsUsd = cur.pnlWithStopsUsd.plus(l.pnlUsd).plus(l.kind === 'perp' ? saved : 0)
    acc.set(l.accountId, cur)
  }
  const total = sum(perAsset.map(a => a.totalPnlUsd))
  const totalWith = sum(perAsset.map(a => a.pnlWithStopsUsd))
  const nl = portfolio.netLiquidationUsd
  return {
    name, shocks: shocks.map(x => ({ asset: x.asset.toUpperCase(), shockPct: x.shockPct })), totalPnlUsd: total, totalPnlWithStopsUsd: totalWith,
    netLiquidationUsd: nl, pnlPctOfNetLiq: nl.isZero() ? null : total.div(nl).mul(100),
    perAsset, byAccount: [...acc.values()].sort((a, b) => a.pnlUsd.comparedTo(b.pnlUsd)),
    liquidationBreaches: perAsset.flatMap(a => a.legs.filter(l => l.breachesLiquidation).map(l => ({ accountId: l.accountId, alias: l.alias, asset: a.asset }))),
    stopsCounted, unprotectedLegs,
    disclaimer: 'Stress test, not a prediction. Linear model on current exposure; ignores funding, fees, correlation changes and margin tiers. "With stops" assumes each venue-listed stop fills at its trigger — real gaps and slippage can be worse.',
  }
}

export { Decimal }
