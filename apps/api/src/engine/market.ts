import { dec, instrumentId, sum, type Decimal, type ExchangeAdapter, type Instrument, type InstrumentId, type OrderBook, type ProductType, type ProviderId } from '@helm/shared'
import { GuardedHttp, simInstruments, type FetchLike } from '@helm/connectors'
import type { PriceBook } from '@helm/portfolio'
import { publicMarket } from '../registry'

let marketFetch: FetchLike | undefined
/** Override the fetch used for public market data (tests, offline demo). */
export function setMarketFetch(f: FetchLike | undefined) { marketFetch = f; priceCache = null; tickerCache?.clear() }

const instCache = new Map<string, { at: number; inst: Instrument }>()
const TTL = 10 * 60_000

/** Coinbase static sandbox has no product endpoint; HELM uses documented spot specs, labelled. */
const COINBASE_STATIC: Instrument[] = ['BTC', 'ETH', 'SOL'].map(b => ({ id: instrumentId({ provider: 'coinbase', product: 'spot', base: b, quote: 'USD' }), provider: 'coinbase' as const, providerSymbol: `${b}-USD`, product: 'spot' as const, base: b, quote: 'USD', contractMultiplier: dec(1), quantityUnit: 'base' as const, lotSize: dec('0.00000001'), minQty: dec('0.00000001'), tickSize: dec('0.01'), venue: 'Coinbase static sandbox', currency: 'USD', tradingHours: 'continuous' as const, status: 'trading' as const }))

export function instrumentIdFor(provider: ProviderId, environment: string, asset: string, product: ProductType): InstrumentId {
  if (product === 'stock') return instrumentId({ provider, product: 'stock', base: asset, quote: 'USD' })
  const quote = provider === 'coinbase' ? 'USD' : 'USDT'
  return instrumentId({ provider, product, base: asset, quote, settle: product === 'perp' ? quote : undefined })
}

export async function resolveInstrument(adapter: ExchangeAdapter, environment: string, id: InstrumentId): Promise<Instrument | null> {
  const k = `${environment}|${id}`
  const c = instCache.get(k)
  if (c && Date.now() - c.at < TTL) return c.inst
  let inst: Instrument | null = null
  if (environment === 'simulated') inst = simInstruments(adapter.provider as 'binance').find(i => i.id === id) ?? null
  else if (adapter.provider === 'coinbase') inst = COINBASE_STATIC.find(i => i.id === id) ?? null
  else {
    const a = adapter as ExchangeAdapter & { getInstrument?: (id: InstrumentId) => Promise<Instrument | null> }
    if (a.getInstrument) inst = await a.getInstrument(id)
    else inst = (await adapter.getInstruments(id.includes(':perp:') ? 'perp' : id.includes(':stock:') ? 'stock' : 'spot')).find(i => i.id === id) ?? null
  }
  if (inst) instCache.set(k, { at: Date.now(), inst })
  return inst
}

export interface Leg { price: Decimal; quantity: Decimal }
export function walkBook(book: OrderBook, side: 'BUY' | 'SELL', qty?: Decimal, quote?: Decimal, lot?: Decimal): Leg[] {
  const levels = side === 'BUY' ? book.asks : book.bids
  const out: Leg[] = []
  let rq = qty ?? null, rn = quote ?? null
  for (const l of levels) {
    if ((rq && rq.lte(0)) || (rn && rn.lte(0))) break
    let take = l.quantity
    if (rq) take = take.lt(rq) ? take : rq
    if (rn) { let t = rn.div(l.price); if (lot) t = t.div(lot).floor().mul(lot); take = take.lt(t) ? take : t }
    if (take.lte(0)) break
    out.push({ price: l.price, quantity: take })
    if (rq) rq = rq.minus(take)
    if (rn) rn = rn.minus(take.mul(l.price))
  }
  return out
}
export const legsQty = (l: Leg[]) => sum(l.map(x => x.quantity))
export const legsNotional = (l: Leg[]) => sum(l.map(x => x.price.mul(x.quantity)))

/** Published standard taker tiers (assumption, labelled as an estimate everywhere). */
export const FEE_ASSUMPTION: Record<string, Decimal> = {
  'binance:spot': dec('0.001'), 'binance:perp': dec('0.0005'), 'okx:spot': dec('0.001'), 'okx:perp': dec('0.0005'),
  'bybit:spot': dec('0.001'), 'bybit:perp': dec('0.00055'), 'coinbase:spot': dec('0.006'), 'ibkr:stock': dec('0'), 'alpaca:stock': dec('0'),
}

// ---------- prices for valuation (public data, cached 10 s) ----------
let priceCache: { at: number; book: PriceBook } | null = null
export const VALUATION_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB']

export async function priceBook(fetchImpl?: FetchLike): Promise<PriceBook> {
  if (priceCache && Date.now() - priceCache.at < 10_000) return priceCache.book
  const src = publicMarket('binance', fetchImpl ?? marketFetch)
  const book: PriceBook = new Map()
  await Promise.all(VALUATION_ASSETS.map(async a => {
    try {
      const b = await src.getOrderBook(`binance:spot:${a}-USDT`, 5)
      const bid = b.bids[0]?.price, ask = b.asks[0]?.price
      if (bid && ask) book.set(a, { asset: a, price: bid.plus(ask).div(2), source: 'Binance Demo spot book mid (USDT at par)', timestamp: b.receivedAt })
    } catch { /* unvalued, never guessed */ }
  }))
  priceCache = { at: Date.now(), book }
  return book
}

// ---------- multi-venue comparison (public books only) ----------
export interface VenueQuote { venue: ProviderId; source: string; instrumentId: string; bid: string | null; ask: string | null; spreadBps: string | null; depthUsd10bps: string | null; ageMs: number | null; impactBps?: string | null; estCostBps?: string | null; error?: string }

/**
 * Public-book comparison. With `notionalUsd`, also walks the ask side for that size: impactBps = (avg fill − mid) / mid,
 * estCostBps = impact + the published standard taker fee (an assumption, labelled). Null when the book is too thin.
 */
export async function compareVenues(asset: string, product: 'spot' | 'perp' = 'spot', fetchImpl?: FetchLike, notionalUsd?: Decimal | null): Promise<VenueQuote[]> {
  const sources: Record<'binance' | 'okx' | 'bybit', string> = { binance: 'Binance Demo public book', okx: 'OKX public book (production market data)', bybit: 'Bybit Demo public book' }
  return Promise.all((['binance', 'okx', 'bybit'] as const).map(async v => {
    const id = instrumentIdFor(v, 'public', asset, product)
    try {
      const b = await publicMarket(v, fetchImpl ?? marketFetch).getOrderBook(id, 50)
      const bid = b.bids[0]?.price ?? null, ask = b.asks[0]?.price ?? null
      const mid = bid && ask ? bid.plus(ask).div(2) : null
      const depth = mid ? sum([...b.bids.filter(l => l.price.gte(mid.mul('0.999'))), ...b.asks.filter(l => l.price.lte(mid.mul('1.001')))].map(l => l.price.mul(l.quantity))) : null
      let impactBps: string | null = null, estCostBps: string | null = null
      if (notionalUsd && mid) {
        const legs = walkBook(b, 'BUY', undefined, notionalUsd)
        const filled = legsNotional(legs)
        if (filled.gte(notionalUsd.mul('0.999'))) {
          const avg = filled.div(legsQty(legs))
          const imp = avg.minus(mid).div(mid).mul(10000)
          impactBps = imp.toFixed(2)
          estCostBps = imp.plus((FEE_ASSUMPTION[`${v}:${product}`] ?? dec(0)).mul(10000)).toFixed(2)
        }
      }
      return { venue: v, source: sources[v], instrumentId: id, bid: bid?.toFixed() ?? null, ask: ask?.toFixed() ?? null, spreadBps: bid && ask && mid ? ask.minus(bid).div(mid).mul(10000).toFixed(2) : null, depthUsd10bps: depth?.toFixed(0) ?? null, ageMs: Date.now() - new Date(b.timestamp).getTime(), ...(notionalUsd ? { impactBps, estCostBps } : {}) }
    } catch (e) {
      return { venue: v, source: sources[v], instrumentId: id, bid: null, ask: null, spreadBps: null, depthUsd10bps: null, ageMs: null, error: (e as { code?: string }).code ?? 'UNAVAILABLE' }
    }
  }))
}

// ---------- 24h ticker + verified candles (Binance Demo public spot data) ----------
const BINANCE_DEMO = 'https://demo-api.binance.com'
const tickerCache = new Map<string, { at: number; v: { price: string | null; change24hPct: string | null; at: string | null } }>()
const cleanAsset = (a: string) => a.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
async function publicGet(path: string, fetchImpl?: FetchLike): Promise<unknown> {
  const http = new GuardedHttp('binance', fetchImpl ?? marketFetch ?? (globalThis.fetch as unknown as FetchLike), 8000)
  const r = await http.request({ method: 'GET', url: `${BINANCE_DEMO}${path}`, authenticated: false })
  if (r.status >= 400) throw Object.assign(new Error(`HTTP ${r.status}`), { code: 'UNAVAILABLE' })
  return r.body
}
/** Last price + venue-reported 24h change for each asset (USDT pair). Unknown assets → nulls, never guessed. */
export async function tickers(assets: string[], fetchImpl?: FetchLike) {
  const want = [...new Set(assets.map(cleanAsset).filter(Boolean))].slice(0, 12)
  const stale = want.filter(a => { const c = tickerCache.get(a); return !c || Date.now() - c.at > 10_000 })
  await Promise.all(stale.map(async a => {
    if (a === 'USDT') { tickerCache.set(a, { at: Date.now(), v: { price: '1', change24hPct: null, at: new Date().toISOString() } }); return }
    try {
      const t = (await publicGet(`/api/v3/ticker/24hr?symbol=${a}USDT`, fetchImpl)) as { lastPrice?: string; priceChangePercent?: string; closeTime?: number }
      tickerCache.set(a, { at: Date.now(), v: { price: t.lastPrice ? dec(t.lastPrice).toFixed() : null, change24hPct: t.priceChangePercent ? dec(t.priceChangePercent).toFixed(2) : null, at: t.closeTime ? new Date(t.closeTime).toISOString() : null } })
    } catch { tickerCache.set(a, { at: Date.now(), v: { price: null, change24hPct: null, at: null } }) }
  }))
  return want.map(a => ({ asset: a, ...tickerCache.get(a)!.v }))
}
/** Market snapshot: ticker + the last 24 hourly closes. The sparkline uses only these verified candles. */
export async function snapshot(asset: string, fetchImpl?: FetchLike) {
  const a = cleanAsset(asset)
  const [t] = await tickers([a], fetchImpl)
  let candles: { interval: string; closes: string[]; source: string } | null = null
  try {
    const k = (await publicGet(`/api/v3/klines?symbol=${a}USDT&interval=1h&limit=24`, fetchImpl)) as Array<[number, string, string, string, string]>
    const closes = Array.isArray(k) ? k.map(r => r[4]).filter(x => typeof x === 'string' && Number.isFinite(Number(x))) : []
    if (closes.length >= 2) candles = { interval: '1h', closes, source: 'Binance Demo klines' }
  } catch { /* no candles → no chart */ }
  return { asset: a, price: t?.price ?? null, change24hPct: t?.change24hPct ?? null, period: '24h', candles, source: 'Binance Demo ticker', at: t?.at ?? null }
}
