import {
  BaseAdapter, Decimal, HelmError, dec, decOrNull, deriveConnectionHealth, instrumentId, parseInstrumentId, toProviderSymbol,
  type AccountEquity, type Balance, type CapabilityManifest, type ConnectionHealth, type HelmErrorCode, type Instrument, type InstrumentId,
  type Order, type OrderBook, type OrderRequest, type OrderStatus, type Position, type MarketSnapshot, type ValidationResult,
} from '@helm/shared'
import { ClockSync, GuardedHttp, nowIso, type FetchLike } from '../http'
import { validateAgainstInstrument } from '../validation'
import { signOkx } from './sign'

export const OKX_BASE = 'https://www.okx.com'
export const OKX_DEMO_HEADER = { 'x-simulated-trading': '1' } as const

export interface OkxCredentials { apiKey: string; apiSecret: string; passphrase: string }
export interface OkxOptions { accountId: string; fetch?: FetchLike; baseUrl?: string }

const ERRORS: Record<string, HelmErrorCode> = {
  '50111': 'INVALID_CREDENTIALS', '50113': 'INVALID_CREDENTIALS', '50105': 'INVALID_CREDENTIALS', '50104': 'INVALID_CREDENTIALS', '50100': 'INVALID_CREDENTIALS',
  '50101': 'ENVIRONMENT_MISMATCH', // "APIKey does not match current environment" — a live key used with the demo header
  '50102': 'CONNECTION_EXPIRED', '50112': 'CONNECTION_EXPIRED',
  '50011': 'RATE_LIMITED', '50061': 'RATE_LIMITED',
  '50120': 'INSUFFICIENT_PERMISSIONS', '50030': 'INSUFFICIENT_PERMISSIONS',
  '51001': 'INVALID_INSTRUMENT', '51000': 'PROVIDER_ERROR',
  '51008': 'INSUFFICIENT_BALANCE', '51004': 'INSUFFICIENT_MARGIN',
  '51603': 'ORDER_UNKNOWN', '51121': 'INVALID_QUANTITY', '51020': 'INVALID_QUANTITY', '51006': 'INVALID_PRICE',
  '51169': 'ORDER_REJECTED',
}
export function mapOkxError(code: string): HelmErrorCode { return ERRORS[code] ?? 'PROVIDER_ERROR' }

export function mapOkxState(s: string): OrderStatus {
  switch (s) {
    case 'live': return 'ACCEPTED'
    case 'partially_filled': return 'PARTIALLY_FILLED'
    case 'filled': return 'FILLED'
    case 'canceled': case 'mmp_canceled': return 'CANCELED'
    default: return 'UNKNOWN'
  }
}

interface OkxEnvelope<T> { code: string; msg: string; data: T[] }
interface OkxOrder { instId: string; ordId: string; clOrdId: string; px: string; sz: string; ordType: string; side: 'buy' | 'sell'; state: string; accFillSz: string; avgPx: string; reduceOnly?: string; cTime: string; uTime: string; tgtCcy?: string; slTriggerPx?: string }

export class OkxAdapter extends BaseAdapter {
  readonly provider = 'okx' as const
  readonly http: GuardedHttp
  readonly clock: ClockSync
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  private readonly base: string
  private posMode: 'long_short_mode' | 'net_mode' | null = null
  private acctLv: string | null = null

  constructor(private readonly creds: OkxCredentials, private readonly opts: OkxOptions) {
    super()
    this.base = opts.baseUrl ?? OKX_BASE
    this.http = new GuardedHttp('okx', opts.fetch)
    this.clock = new ClockSync(async () => Number((await this.publicGet<{ ts: string }>('/api/v5/public/time'))[0]!.ts))
  }

  getCapabilities(): CapabilityManifest {
    return {
      provider: 'okx', environment: 'demo', accountTypes: ['unified'],
      permissions: { read: this.health.state !== 'ERROR', trade: this.health.state === 'CONNECTED', withdraw: false },
      products: ['spot', 'perp'], spot: true, futures: true, stocks: false,
      orderTypes: ['MARKET', 'LIMIT'], reduceOnly: true, hedgeMode: true, margin: true, cancelReplace: true,
      streaming: { market: true, account: true }, simulation: 'demo_matching_engine',
      operations: ['connect', 'disconnect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getEquity', 'getPositions', 'getOpenOrders',
        'getOrderBook', 'getMarketSnapshot', 'getInstruments', 'validateOrder', 'submitOrder', 'cancelOrder', 'amendOrder', 'reconcileOrder', 'setLeverage'],
      restrictions: [
        'OKX Demo Trading: every authenticated request carries x-simulated-trading: 1',
        this.acctLv ? `Account mode acctLv=${this.acctLv}` : 'Account mode not yet read',
        this.posMode ? `Position mode ${this.posMode}` : 'Position mode not yet read',
      ],
      verification: 'documented',
    }
  }
  getConnectionState() { return this.health }

  private async publicGet<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T[]> {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString()
    const r = await this.http.request({ method: 'GET', url: `${this.base}${path}${qs ? `?${qs}` : ''}`, authenticated: false })
    return this.unwrap<T>(r.status, r.body)
  }

  /** Builds headers for a signed request. Exposed for tests. */
  async signedHeaders(method: string, requestPath: string, body: string, timestamp?: string): Promise<Record<string, string>> {
    const ts = timestamp ?? new Date(await this.clock.now()).toISOString()
    return {
      'OK-ACCESS-KEY': this.creds.apiKey,
      'OK-ACCESS-SIGN': signOkx(ts, method, requestPath, body, this.creds.apiSecret),
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': this.creds.passphrase,
      'Content-Type': 'application/json',
      ...OKX_DEMO_HEADER,
    }
  }

  private async signed<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, submitsOrder = false): Promise<T[]> {
    let requestPath = path
    let body = ''
    if (method === 'GET') {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
      if (qs) requestPath += `?${qs}`
    } else {
      body = JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)))
    }
    const headers = await this.signedHeaders(method, requestPath, body)
    const r = await this.http.request({ method, url: `${this.base}${requestPath}`, headers, body: body || undefined, authenticated: true, submitsOrder })
    return this.unwrap<T>(r.status, r.body)
  }

  private unwrap<T>(status: number, body: unknown): T[] {
    const b = body as OkxEnvelope<T> | null
    if (!b || typeof b !== 'object' || typeof b.code !== 'string') {
      throw new HelmError('PROVIDER_ERROR', undefined, { provider: 'okx', providerCode: String(status), detail: 'non-envelope response' })
    }
    if (b.code !== '0') {
      // Order endpoints put the real error in data[0].sCode
      const first = (b.data?.[0] ?? {}) as { sCode?: string; sMsg?: string }
      const code = first.sCode && first.sCode !== '0' ? first.sCode : b.code
      throw new HelmError(mapOkxError(code), undefined, { provider: 'okx', providerCode: code, detail: first.sMsg || b.msg })
    }
    return b.data
  }

  async connect(): Promise<ConnectionHealth> {
    this.health = { state: 'RECONNECTING', reasons: [], checkedAt: nowIso() }
    try {
      await this.clock.sync()
      const [cfg] = await this.signed<{ uid: string; acctLv: string; posMode: 'long_short_mode' | 'net_mode'; perm: string }>('GET', '/api/v5/account/config')
      if (!cfg) throw new HelmError('PROVIDER_ERROR', 'empty account config', { provider: 'okx' })
      this.posMode = cfg.posMode
      this.acctLv = cfg.acctLv
      const perms = cfg.perm.split(',').map(s => s.trim())
      // Reaching here with x-simulated-trading: 1 proves a demo key (live keys fail with 50101).
      this.health = deriveConnectionHealth({ authenticatedReadOk: true, environmentVerified: true, canRead: perms.includes('read_only'), canTrade: perms.includes('trade'), excessivePermissions: perms.includes('withdraw') })
    } catch (e) {
      const he = e instanceof HelmError ? e : new HelmError('PROVIDER_ERROR', undefined, { provider: 'okx', cause: e })
      this.health = deriveConnectionHealth({ authenticatedReadOk: false, environmentVerified: false, canRead: false, canTrade: false, excessivePermissions: false, error: `${he.code}${he.providerCode ? ` (${he.providerCode})` : ''}` })
    }
    return this.health
  }

  async getBalances(): Promise<Balance[]> {
    const [acct] = await this.signed<{ details: Array<{ ccy: string; availBal: string; frozenBal: string; cashBal: string; eq: string }> }>('GET', '/api/v5/account/balance')
    const asOf = nowIso()
    return (acct?.details ?? []).map(d => ({ accountId: this.opts.accountId, asset: d.ccy, free: dec(d.availBal || '0'), locked: dec(d.frozenBal || '0'), total: dec(d.cashBal || d.eq || '0'), asOf, source: 'okx' as const }))
      .filter(b => !b.total.isZero())
  }

  async getEquity(): Promise<AccountEquity> {
    const [acct] = await this.signed<{ totalEq: string; adjEq: string; imr: string; availEq?: string }>('GET', '/api/v5/account/balance')
    return { accountId: this.opts.accountId, currency: 'USD', equity: decOrNull(acct?.totalEq), availableBalance: decOrNull(acct?.availEq ?? null), marginUsed: decOrNull(acct?.imr), asOf: nowIso() }
  }

  async getPositions(): Promise<Position[]> {
    const rows = await this.signed<{ instId: string; instType: string; posSide: 'long' | 'short' | 'net'; pos: string; avgPx: string; markPx: string; notionalUsd: string; upl: string; realizedPnl: string; lever: string; liqPx: string; mgnMode: 'cross' | 'isolated' }>('GET', '/api/v5/account/positions')
    return rows.filter(r => r.pos && !dec(r.pos).isZero()).map(r => {
      const [base, quote] = r.instId.split('-') as [string, string]
      const product = r.instType === 'SWAP' ? 'perp' as const : r.instType === 'FUTURES' ? 'future' as const : 'spot' as const
      return {
        accountId: this.opts.accountId, instrumentId: instrumentId({ provider: 'okx', product, base, quote, settle: quote === 'USD' ? base : quote }), provider: 'okx' as const, product,
        side: r.posSide === 'long' ? 'LONG' as const : r.posSide === 'short' ? 'SHORT' as const : 'NET' as const,
        quantity: dec(r.pos), entryPrice: decOrNull(r.avgPx), markPrice: decOrNull(r.markPx), notional: decOrNull(r.notionalUsd), unrealizedPnl: decOrNull(r.upl),
        realizedPnl: decOrNull(r.realizedPnl), leverage: decOrNull(r.lever), liquidationPrice: decOrNull(r.liqPx), marginMode: r.mgnMode,
        positionMode: r.posSide === 'net' ? 'one_way' as const : 'hedge' as const, asOf: nowIso(), raw: r,
      }
    })
  }

  private instIdOf(id: InstrumentId) { return toProviderSymbol(parseInstrumentId(id)) }

  async getOrderBook(id: InstrumentId, depth = 20): Promise<OrderBook> {
    const [b] = await this.publicGet<{ bids: string[][]; asks: string[][]; ts: string }>('/api/v5/market/books', { instId: this.instIdOf(id), sz: String(depth) })
    const lvl = (l: string[]) => ({ price: dec(l[0]!), quantity: dec(l[1]!) })
    return { provider: 'okx', instrumentId: id, bids: (b?.bids ?? []).map(lvl), asks: (b?.asks ?? []).map(lvl), timestamp: new Date(Number(b?.ts ?? Date.now())).toISOString(), receivedAt: nowIso() }
  }

  async getMarketSnapshot(id: InstrumentId): Promise<MarketSnapshot> {
    const [t] = await this.publicGet<{ bidPx: string; askPx: string; last: string; vol24h: string; ts: string }>('/api/v5/market/ticker', { instId: this.instIdOf(id) })
    return { provider: 'okx', instrumentId: id, bid: decOrNull(t?.bidPx), ask: decOrNull(t?.askPx), last: decOrNull(t?.last), volume24h: decOrNull(t?.vol24h), timestamp: new Date(Number(t?.ts ?? Date.now())).toISOString(), receivedAt: nowIso() }
  }

  async getInstruments(product: Instrument['product'] = 'spot'): Promise<Instrument[]> {
    const instType = product === 'perp' ? 'SWAP' : 'SPOT'
    const rows = await this.publicGet<{ instId: string; baseCcy: string; quoteCcy: string; settleCcy: string; ctVal: string; ctValCcy: string; lotSz: string; minSz: string; maxMktSz: string; tickSz: string; state: string; uly: string }>('/api/v5/public/instruments', { instType })
    return rows.map(r => parseOkxInstrument(r, product === 'perp' ? 'perp' : 'spot'))
  }

  async validateOrder(req: OrderRequest): Promise<ValidationResult> { return validateAgainstInstrument(req) }

  /** Build the OKX place-order body. Exposed for tests. */
  buildOrderBody(req: OrderRequest): Record<string, string | boolean | undefined> {
    if (req.type !== 'MARKET' && req.type !== 'LIMIT') throw new HelmError('UNSUPPORTED_OPERATION', `OKX ${req.type} uses the algo-order API (not enabled yet)`, { provider: 'okx' })
    const spot = req.instrument.product === 'spot'
    let sz: string | undefined
    let tgtCcy: string | undefined
    if (spot && req.type === 'MARKET' && req.quoteQuantity && !req.quantity) { sz = req.quoteQuantity.toFixed(); tgtCcy = 'quote_ccy' }
    else if (req.quantity) { sz = req.quantity.toFixed(); if (spot && req.type === 'MARKET') tgtCcy = 'base_ccy' }
    if (!sz) throw new HelmError('INVALID_QUANTITY', 'quantity required', { provider: 'okx' })
    const body: Record<string, string | boolean | undefined> = {
      instId: req.instrument.providerSymbol, tdMode: spot ? 'cash' : 'cross', side: req.side === 'BUY' ? 'buy' : 'sell',
      ordType: req.type === 'MARKET' ? 'market' : 'limit', sz, px: req.type === 'LIMIT' ? req.price?.toFixed() : undefined,
      clOrdId: req.clientOrderId, tgtCcy,
    }
    if (!spot) {
      if (this.posMode === 'long_short_mode') {
        if (!req.positionSide || req.positionSide === 'NET') throw new HelmError('INVALID_QUANTITY', 'OKX hedge mode requires LONG or SHORT position side', { provider: 'okx' })
        body.posSide = req.positionSide === 'LONG' ? 'long' : 'short'
      } else if (req.reduceOnly) {
        body.reduceOnly = true
      }
    }
    return body
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const v = validateAgainstInstrument(req)
    if (!v.ok) throw new HelmError('INVALID_QUANTITY', v.problems.join('; '), { provider: 'okx' })
    const [ack] = await this.signed<{ ordId: string; clOrdId: string; sCode: string; sMsg: string }>('POST', '/api/v5/trade/order', this.buildOrderBody(req), true)
    if (!ack) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'okx' })
    // The ack only means "accepted for processing" — query the real state.
    const truth = await this.reconcileOrder(req.instrument.id, { providerOrderId: ack.ordId })
    if (truth) return truth
    return { accountId: this.opts.accountId, provider: 'okx', instrumentId: req.instrument.id, providerOrderId: ack.ordId, clientOrderId: req.clientOrderId, side: req.side, type: req.type, timeInForce: null, quantity: req.quantity ?? null, quoteQuantity: req.quoteQuantity ?? null, price: req.price ?? null, stopPrice: null, reduceOnly: !!req.reduceOnly, status: 'RECONCILING', filledQuantity: new Decimal(0), avgFillPrice: null, createdAt: nowIso(), updatedAt: nowIso(), raw: ack }
  }

  async cancelOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order> {
    await this.signed('POST', '/api/v5/trade/cancel-order', { instId: this.instIdOf(id), ordId: ids.providerOrderId, clOrdId: ids.providerOrderId ? undefined : ids.clientOrderId })
    const o = await this.reconcileOrder(id, ids)
    if (!o) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'okx' })
    return o
  }

  async amendOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }, changes: { quantity?: Decimal; price?: Decimal }): Promise<Order> {
    await this.signed('POST', '/api/v5/trade/amend-order', { instId: this.instIdOf(id), ordId: ids.providerOrderId, clOrdId: ids.providerOrderId ? undefined : ids.clientOrderId, newSz: changes.quantity?.toFixed(), newPx: changes.price?.toFixed() })
    const o = await this.reconcileOrder(id, ids)
    if (!o) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'okx' })
    return o
  }

  async reconcileOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null> {
    try {
      const [o] = await this.signed<OkxOrder>('GET', '/api/v5/trade/order', { instId: this.instIdOf(id), ordId: ids.providerOrderId, clOrdId: ids.providerOrderId ? undefined : ids.clientOrderId })
      return o ? this.toOrder(o, id) : null
    } catch (e) {
      if (e instanceof HelmError && (e.providerCode === '51603')) return null // order does not exist
      throw e
    }
  }

  async getOpenOrders(id?: InstrumentId): Promise<Order[]> {
    const rows = await this.signed<OkxOrder>('GET', '/api/v5/trade/orders-pending', { instId: id ? this.instIdOf(id) : undefined })
    return rows.map(o => this.toOrder(o, id ?? okxIdFromInstId(o.instId)))
  }

  async setLeverage(id: InstrumentId, leverage: Decimal): Promise<void> {
    await this.signed('POST', '/api/v5/account/set-leverage', { instId: this.instIdOf(id), lever: leverage.toFixed(), mgnMode: 'cross' })
  }

  private toOrder(o: OkxOrder, id: InstrumentId): Order {
    const type: Order['type'] = o.ordType === 'market' ? 'MARKET' : 'LIMIT'
    return {
      accountId: this.opts.accountId, provider: 'okx', instrumentId: id, providerOrderId: o.ordId, clientOrderId: o.clOrdId, side: o.side === 'buy' ? 'BUY' : 'SELL', type,
      timeInForce: o.ordType === 'ioc' ? 'IOC' : o.ordType === 'fok' ? 'FOK' : type === 'LIMIT' ? 'GTC' : null,
      quantity: o.tgtCcy === 'quote_ccy' ? null : decOrNull(o.sz), quoteQuantity: o.tgtCcy === 'quote_ccy' ? decOrNull(o.sz) : null, price: decOrNull(o.px), stopPrice: decOrNull(o.slTriggerPx),
      reduceOnly: o.reduceOnly === 'true', status: mapOkxState(o.state), filledQuantity: dec(o.accFillSz || '0'), avgFillPrice: o.avgPx ? dec(o.avgPx) : null,
      createdAt: new Date(Number(o.cTime)).toISOString(), updatedAt: new Date(Number(o.uTime)).toISOString(), raw: o,
    }
  }
}

export function okxIdFromInstId(instId: string): InstrumentId {
  const p = instId.split('-')
  if (p.length === 3 && p[2] === 'SWAP') return instrumentId({ provider: 'okx', product: 'perp', base: p[0]!, quote: p[1]!, settle: p[1] === 'USD' ? p[0]! : p[1]! })
  return instrumentId({ provider: 'okx', product: 'spot', base: p[0]!, quote: p[1]! })
}

export function parseOkxInstrument(r: { instId: string; baseCcy: string; quoteCcy: string; settleCcy: string; ctVal: string; ctValCcy: string; lotSz: string; minSz: string; maxMktSz?: string; tickSz: string; state: string; uly?: string }, product: 'spot' | 'perp'): Instrument {
  const [base, quote] = product === 'spot' ? [r.baseCcy, r.quoteCcy] : (r.uly ?? r.instId).split('-') as [string, string]
  return {
    id: instrumentId({ provider: 'okx', product, base, quote, settle: product === 'perp' ? r.settleCcy : undefined }), provider: 'okx', providerSymbol: r.instId, product,
    base, quote, settle: product === 'perp' ? r.settleCcy : undefined,
    contractMultiplier: product === 'perp' ? dec(r.ctVal) : new Decimal(1), quantityUnit: product === 'perp' ? 'contracts' : 'base',
    lotSize: dec(r.lotSz), minQty: dec(r.minSz), tickSize: dec(r.tickSz), venue: product === 'spot' ? 'OKX Spot (Demo)' : 'OKX Swap (Demo)', currency: quote,
    tradingHours: 'continuous', status: r.state === 'live' ? 'trading' : r.state === 'suspend' ? 'halted' : 'unknown', raw: r,
  }
}
