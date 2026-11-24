import type { Decimal } from './decimal'
import type { ProviderId } from './providers'

export type ProductType = 'spot' | 'perp' | 'future' | 'stock' | 'option'

/**
 * Canonical instrument id. Provider-qualified on purpose: BTCUSDT on Binance spot,
 * BTC-USDT-SWAP on OKX and BTC-USD on Coinbase are different instruments.
 *   crypto: `${provider}:${product}:${BASE}-${QUOTE}` (+ `:${SETTLE}` for derivatives)
 *   stock:  `${provider}:stock:${SYMBOL}:${CURRENCY}`
 */
export type InstrumentId = string

export interface InstrumentKey {
  provider: ProviderId
  product: ProductType
  base: string
  quote: string
  settle?: string
}

export function instrumentId(k: InstrumentKey): InstrumentId {
  const base = k.base.toUpperCase()
  const quote = k.quote.toUpperCase()
  if (k.product === 'stock') return `${k.provider}:stock:${base}:${quote}`
  const core = `${k.provider}:${k.product}:${base}-${quote}`
  return k.settle && k.product !== 'spot' ? `${core}:${k.settle.toUpperCase()}` : core
}

export function parseInstrumentId(id: InstrumentId): InstrumentKey {
  const parts = id.split(':')
  const [provider, product, pair, extra] = parts
  if (!provider || !product || !pair) throw new TypeError(`Bad instrument id ${id}`)
  if (product === 'stock') {
    return { provider: provider as ProviderId, product: 'stock', base: pair, quote: extra ?? 'USD' }
  }
  const [base, quote] = pair.split('-')
  if (!base || !quote) throw new TypeError(`Bad instrument id ${id}`)
  return { provider: provider as ProviderId, product: product as ProductType, base, quote, settle: extra }
}

export interface Instrument {
  id: InstrumentId
  provider: ProviderId
  /** Exactly what the provider calls it (e.g. BTCUSDT, BTC-USDT-SWAP, AAPL, conid 265598). */
  providerSymbol: string
  product: ProductType
  base: string
  quote: string
  settle?: string
  /** Contract multiplier / face value (1 for spot and stock). */
  contractMultiplier: Decimal
  /** Quantity is in base units, contracts, or shares. */
  quantityUnit: 'base' | 'contracts' | 'shares'
  lotSize: Decimal
  minQty: Decimal
  maxQty?: Decimal
  minNotional?: Decimal
  tickSize: Decimal
  venue: string
  currency: string
  tradingHours?: 'continuous' | 'exchange_session'
  status: 'trading' | 'halted' | 'closed' | 'unknown'
  raw?: unknown
}

// ---------- Provider symbol mapping ----------

/** Quote assets we try (longest first) when a provider concatenates base+quote (Binance, Bybit). */
const CONCAT_QUOTES = ['FDUSD', 'USDT', 'USDC', 'TUSD', 'BUSD', 'EUR', 'TRY', 'BTC', 'ETH', 'BNB', 'USD'] as const

export function splitConcatSymbol(symbol: string): { base: string; quote: string } {
  const s = symbol.toUpperCase()
  for (const q of CONCAT_QUOTES) {
    if (s.endsWith(q) && s.length > q.length) return { base: s.slice(0, -q.length), quote: q }
  }
  throw new TypeError(`Cannot split symbol ${symbol}; use provider exchangeInfo instead`)
}

export function toProviderSymbol(k: InstrumentKey): string {
  const b = k.base.toUpperCase()
  const q = k.quote.toUpperCase()
  switch (k.provider) {
    case 'binance':
    case 'bybit':
      if (k.product === 'spot' || k.product === 'perp') return `${b}${q}`
      break
    case 'okx':
      if (k.product === 'spot') return `${b}-${q}`
      if (k.product === 'perp') return `${b}-${q}-SWAP`
      break
    case 'coinbase':
      if (k.product === 'spot') return `${b}-${q}`
      if (k.product === 'perp') return `${b}-PERP-INTX`
      break
    case 'alpaca':
    case 'ibkr':
      if (k.product === 'stock') return b
      break
  }
  throw new TypeError(`No ${k.provider} symbol mapping for ${k.product} ${b}/${q}`)
}

/**
 * Best-effort reverse mapping. Production code should prefer the provider's instrument list,
 * which carries authoritative base/quote/settle; this is used for parsing payload symbols.
 */
export function fromProviderSymbol(provider: ProviderId, product: ProductType, symbol: string): InstrumentKey {
  const s = symbol.toUpperCase()
  switch (provider) {
    case 'binance':
    case 'bybit': {
      const { base, quote } = splitConcatSymbol(s)
      return product === 'perp' ? { provider, product, base, quote, settle: quote } : { provider, product, base, quote }
    }
    case 'okx': {
      const parts = s.split('-')
      if (product === 'spot' && parts.length === 2) return { provider, product, base: parts[0]!, quote: parts[1]! }
      if (product === 'perp' && parts.length === 3 && parts[2] === 'SWAP') {
        // OKX linear swaps settle in quote (USDT/USDC); inverse swaps (BTC-USD-SWAP) settle in base
        const settle = parts[1] === 'USD' ? parts[0]! : parts[1]!
        return { provider, product, base: parts[0]!, quote: parts[1]!, settle }
      }
      break
    }
    case 'coinbase': {
      const parts = s.split('-')
      if (product === 'spot' && parts.length === 2) return { provider, product, base: parts[0]!, quote: parts[1]! }
      if (product === 'perp' && parts[1] === 'PERP') return { provider, product, base: parts[0]!, quote: 'USDC', settle: 'USDC' }
      break
    }
    case 'alpaca':
    case 'ibkr':
      if (product === 'stock') return { provider, product, base: s, quote: 'USD' }
      break
  }
  throw new TypeError(`Cannot map ${provider} ${product} symbol ${symbol}`)
}

/**
 * Two instruments are comparable across venues only if they share product type, base, quote
 * and settlement asset. (BTC-USD spot on Coinbase is NOT comparable to BTCUSDT on Binance.)
 */
export function areComparable(a: InstrumentKey, b: InstrumentKey): boolean {
  return a.product === b.product && a.base === b.base && a.quote === b.quote && (a.settle ?? '') === (b.settle ?? '')
}
