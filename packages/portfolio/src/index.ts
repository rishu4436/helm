import {
  Decimal, dec, parseInstrumentId, sum, type AssetValuation, type Balance, type Environment, type Order, type Position, type ProviderId,
} from '@helm/shared'

/**
 * HELM unified portfolio.
 *
 * Valuation method (documented):
 *  - USD-pegged stablecoins (USDT, USDC, FDUSD, USD) are valued at par 1:1 → method `stablecoin_par`.
 *    This is an assumption, surfaced in the UI, not a market rate.
 *  - Other assets use a provider mid price quoted in a stablecoin → method `cross_rate` (asset/USDT × par).
 *  - Without a fresh trusted price the asset is UNVALUED (value null). HELM never guesses.
 * Cash-equivalent value (net liquidation) counts balances + isolated margin + unrealised PnL of derivatives.
 * Derivative NOTIONAL is reported separately as gross exposure and is never added to value.
 */

export const STABLE_PAR = new Set(['USDT', 'USDC', 'FDUSD', 'USD', 'BUSD', 'TUSD'])
export const PRICE_MAX_AGE_MS = 60_000

export interface PriceQuote { asset: string; price: Decimal; source: string; timestamp: string }
export type PriceBook = Map<string, PriceQuote>

export interface AccountInput {
  account: { id: string; alias: string; provider: ProviderId; environment: Environment; state: string }
  balances: Balance[]
  positions: Position[]
  openOrders: Order[]
  /** Accounts whose reads failed are kept and flagged — never silently dropped from totals. */
  error?: string
}

export interface AccountSummary {
  accountId: string; alias: string; provider: ProviderId; environment: Environment; state: string
  valueUsd: Decimal; unvalued: string[]; derivativeNotionalUsd: Decimal; unrealizedPnlUsd: Decimal
  positions: number; openOrders: number; error?: string
}

export interface AssetExposure {
  asset: string
  spotUsd: Decimal
  derivativesNetUsd: Decimal
  /** spot + signed derivative notional (documented aggregate directional view). */
  netDirectionalUsd: Decimal
  grossUsd: Decimal
  byAccount: Array<{ accountId: string; alias: string; provider: ProviderId; kind: 'spot' | 'perp' | 'stock'; usd: Decimal; side: 'LONG' | 'SHORT' | 'HOLD' }>
}

export interface Portfolio {
  reportingCurrency: 'USD'
  netLiquidationUsd: Decimal
  grossDerivativeExposureUsd: Decimal
  unrealizedPnlUsd: Decimal
  accounts: AccountSummary[]
  exposures: AssetExposure[]
  valuations: Array<AssetValuation & { accountId: string }>
  unvaluedAssets: string[]
  positions: Position[]
  openOrders: Order[]
  asOf: string
  notes: string[]
}

export function valueAsset(asset: string, amount: Decimal, prices: PriceBook, now = new Date()): AssetValuation {
  const a = asset.toUpperCase()
  if (STABLE_PAR.has(a)) return { asset: a, amount, reportingCurrency: 'USD', value: amount, rate: dec(1), rateSource: 'stablecoin par (assumption)', rateTimestamp: null, method: 'stablecoin_par' }
  const q = prices.get(a)
  if (!q || now.getTime() - new Date(q.timestamp).getTime() > PRICE_MAX_AGE_MS) {
    return { asset: a, amount, reportingCurrency: 'USD', value: null, rate: null, rateSource: q ? `${q.source} (stale)` : null, rateTimestamp: q?.timestamp ?? null, method: 'unvalued' }
  }
  return { asset: a, amount, reportingCurrency: 'USD', value: amount.mul(q.price), rate: q.price, rateSource: q.source, rateTimestamp: q.timestamp, method: 'cross_rate' }
}

export function baseOf(instrumentId: string): string { return parseInstrumentId(instrumentId).base }

export function aggregate(inputs: AccountInput[], prices: PriceBook, now = new Date()): Portfolio {
  const valuations: Portfolio['valuations'] = []
  const accounts: AccountSummary[] = []
  const exp = new Map<string, AssetExposure>()
  const touch = (asset: string) => {
    let e = exp.get(asset)
    if (!e) { e = { asset, spotUsd: dec(0), derivativesNetUsd: dec(0), netDirectionalUsd: dec(0), grossUsd: dec(0), byAccount: [] }; exp.set(asset, e) }
    return e
  }
  for (const inp of inputs) {
    const a = inp.account
    let value = dec(0), notional = dec(0), upnl = dec(0)
    const unvalued: string[] = []
    for (const b of inp.balances) {
      if (b.total.isZero()) continue
      const v = valueAsset(b.asset, b.total, prices, now)
      valuations.push({ ...v, accountId: a.id })
      if (v.value === null) { unvalued.push(b.asset); continue }
      value = value.plus(v.value)
      if (!STABLE_PAR.has(v.asset)) {
        const e = touch(v.asset)
        e.spotUsd = e.spotUsd.plus(v.value)
        e.byAccount.push({ accountId: a.id, alias: a.alias, provider: a.provider, kind: a.provider === 'ibkr' || a.provider === 'alpaca' ? 'stock' : 'spot', usd: v.value, side: 'HOLD' })
      }
    }
    for (const p of inp.positions) {
      const pu = p.unrealizedPnl ?? dec(0)
      upnl = upnl.plus(pu)
      if (p.isolatedMargin) value = value.plus(p.isolatedMargin).plus(pu)
      if (p.product === 'stock') {
        const v = p.markPrice ? p.markPrice.mul(p.quantity.abs()) : null
        const e = touch(baseOf(p.instrumentId))
        if (v) { e.spotUsd = e.spotUsd.plus(v); e.byAccount.push({ accountId: a.id, alias: a.alias, provider: a.provider, kind: 'stock', usd: v, side: 'HOLD' }) }
        continue
      }
      const n = p.notional ?? (p.markPrice ? p.markPrice.mul(p.quantity.abs()) : null)
      if (!n) { unvalued.push(p.instrumentId); continue }
      notional = notional.plus(n.abs())
      const signed = p.side === 'SHORT' || (p.side === 'NET' && p.quantity.isNegative()) ? n.abs().neg() : n.abs()
      const e = touch(baseOf(p.instrumentId))
      e.derivativesNetUsd = e.derivativesNetUsd.plus(signed)
      e.byAccount.push({ accountId: a.id, alias: a.alias, provider: a.provider, kind: 'perp', usd: signed, side: signed.isNegative() ? 'SHORT' : 'LONG' })
    }
    accounts.push({ accountId: a.id, alias: a.alias, provider: a.provider, environment: a.environment, state: a.state, valueUsd: value, unvalued, derivativeNotionalUsd: notional, unrealizedPnlUsd: upnl, positions: inp.positions.length, openOrders: inp.openOrders.length, error: inp.error })
  }
  for (const e of exp.values()) {
    e.netDirectionalUsd = e.spotUsd.plus(e.derivativesNetUsd)
    e.grossUsd = sum(e.byAccount.map(x => x.usd.abs()))
  }
  const exposures = [...exp.values()].sort((x, y) => y.grossUsd.comparedTo(x.grossUsd))
  return {
    reportingCurrency: 'USD',
    netLiquidationUsd: sum(accounts.map(a => a.valueUsd)),
    grossDerivativeExposureUsd: sum(accounts.map(a => a.derivativeNotionalUsd)),
    unrealizedPnlUsd: sum(accounts.map(a => a.unrealizedPnlUsd)),
    accounts, exposures, valuations,
    unvaluedAssets: [...new Set(accounts.flatMap(a => a.unvalued))],
    positions: inputs.flatMap(i => i.positions), openOrders: inputs.flatMap(i => i.openOrders),
    asOf: now.toISOString(),
    notes: [
      'Stablecoins valued at par (assumption). Other assets at provider mid price.',
      'Derivative notional is gross exposure, not added to value.',
      'Offsetting positions on different exchanges do not net out liquidation or counterparty risk: margin stays isolated per venue.',
    ],
  }
}

/** Serialise Decimals for JSON transport. */
export function toJsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (Decimal.isDecimal(x) ? (x as Decimal).toFixed() : x)))
}
