import { type Fill,
  BaseAdapter, Decimal, HelmError, dec, decOrNull, deriveConnectionHealth, instrumentId, parseInstrumentId, toProviderSymbol,
  type AccountEquity, type Balance, type CapabilityManifest, type ConnectionHealth, type HelmErrorCode, type Instrument, type InstrumentId,
  type MarketSnapshot, type Order, type OrderBook, type OrderRequest, type OrderStatus, type Position, type ValidationResult,
} from '@helm/shared'
import { ClockSync, GuardedHttp, nowIso, type FetchLike } from '../http'
import { validateAgainstInstrument } from '../validation'
import { signBybit } from './sign'

export const BYBIT_DEMO = 'https://api-demo.bybit.com'
export interface BybitCredentials { apiKey: string; apiSecret: string }
export interface BybitOptions { accountId: string; fetch?: FetchLike; baseUrl?: string; recvWindow?: number }

const ERRORS: Record<number, HelmErrorCode> = {
  10003: 'INVALID_CREDENTIALS', 10004: 'INVALID_CREDENTIALS', 33004: 'CONNECTION_EXPIRED', 10002: 'CONNECTION_EXPIRED',
  10005: 'INSUFFICIENT_PERMISSIONS', 10006: 'RATE_LIMITED', 10018: 'RATE_LIMITED', 10010: 'INSUFFICIENT_PERMISSIONS',
  110007: 'INSUFFICIENT_BALANCE', 110004: 'INSUFFICIENT_BALANCE', 110012: 'INSUFFICIENT_BALANCE', 110006: 'INSUFFICIENT_MARGIN',
  110001: 'ORDER_UNKNOWN', 170213: 'ORDER_UNKNOWN', 10001: 'INVALID_QUANTITY', 110017: 'ORDER_REJECTED', 170131: 'INSUFFICIENT_BALANCE',
  110003: 'INVALID_PRICE', 170121: 'INVALID_INSTRUMENT',
}
export function mapBybitError(code: number): HelmErrorCode { return ERRORS[code] ?? 'PROVIDER_ERROR' }

export function mapBybitStatus(s: string): OrderStatus {
  switch (s) {
    case 'New': case 'Untriggered': case 'Created': case 'Active': return 'ACCEPTED'
    case 'PartiallyFilled': return 'PARTIALLY_FILLED'
    case 'Filled': return 'FILLED'
    case 'Cancelled': case 'PartiallyFilledCanceled': case 'Deactivated': return 'CANCELED'
    case 'Rejected': return 'REJECTED'
    case 'Triggered': return 'ACCEPTED'
    default: return 'UNKNOWN'
  }
}

type Category = 'spot' | 'linear'
interface BybitEnvelope<T> { retCode: number; retMsg: string; result: T; time: number }
interface BybitOrder { orderId: string; orderLinkId: string; symbol: string; side: 'Buy' | 'Sell'; orderType: 'Market' | 'Limit'; price: string; qty: string; cumExecQty: string; avgPrice: string; orderStatus: string; timeInForce: string; reduceOnly: boolean; triggerPrice?: string; stopOrderType?: string; createdTime: string; updatedTime: string; marketUnit?: string }

export class BybitAdapter extends BaseAdapter {
  readonly provider = 'bybit' as const
  readonly http: GuardedHttp
  readonly clock: ClockSync
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  private readonly base: string
  private readonly recvWindow: string

  constructor(private readonly creds: BybitCredentials, private readonly opts: BybitOptions) {
    super()
    this.base = opts.baseUrl ?? BYBIT_DEMO
    this.recvWindow = String(opts.recvWindow ?? 5000)
    this.http = new GuardedHttp('bybit', opts.fetch)
    this.clock = new ClockSync(async () => Math.floor(Number((await this.publicGet<{ timeNano: string }>('/v5/market/time')).timeNano) / 1e6))
  }

  getCapabilities(): CapabilityManifest {
    return {
      provider: 'bybit', environment: 'demo', accountTypes: ['unified'],
      permissions: { read: this.health.state !== 'ERROR', trade: this.health.state === 'CONNECTED', withdraw: false },
      products: ['spot', 'perp'], spot: true, futures: true, stocks: false,
      orderTypes: ['MARKET', 'LIMIT', 'STOP_MARKET'], reduceOnly: true, hedgeMode: true, margin: true, cancelReplace: true,
      streaming: { market: true, account: true }, simulation: 'demo_matching_engine',
      operations: ['connect', 'disconnect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getEquity', 'getPositions', 'getOpenOrders', 'getOrderHistory', 'getFills',
        'getOrderBook', 'getMarketSnapshot', 'getInstruments', 'validateOrder', 'submitOrder', 'cancelOrder', 'amendOrder', 'reconcileOrder', 'setLeverage'],
      restrictions: ['Bybit Demo Trading (api-demo.bybit.com): not every V5 endpoint is available; WS trading unsupported; demo orders kept 7 days'],
      verification: 'documented',
    }
  }
  getConnectionState() { return this.health }

  private async publicGet<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString()
    const r = await this.http.request({ method: 'GET', url: `${this.base}${path}${qs ? `?${qs}` : ''}`, authenticated: false })
    return this.unwrap<T>(r.status, r.body)
  }

  async signedHeaders(payload: string, timestamp?: string): Promise<Record<string, string>> {
    const ts = timestamp ?? String(await this.clock.now())
    return {
      'X-BAPI-API-KEY': this.creds.apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': this.recvWindow,
      'X-BAPI-SIGN': signBybit(ts, this.creds.apiKey, this.recvWindow, payload, this.creds.apiSecret),
      'Content-Type': 'application/json',
    }
  }

  private async signed<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, submitsOrder = false): Promise<T> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
    let url = `${this.base}${path}`
    let payload = ''
    if (method === 'GET') {
      payload = new URLSearchParams(Object.entries(clean).map(([k, v]) => [k, String(v)])).toString()
      if (payload) url += `?${payload}`
    } else {
      payload = JSON.stringify(clean)
    }
    this.http.preflight({ method, url, authenticated: true })
    const headers = await this.signedHeaders(payload)
    const r = await this.http.request({ method, url, headers, body: method === 'POST' ? payload : undefined, authenticated: true, submitsOrder })
    return this.unwrap<T>(r.status, r.body)
  }

  private unwrap<T>(status: number, body: unknown): T {
    const b = body as BybitEnvelope<T> | null
    if (!b || typeof b !== 'object' || typeof b.retCode !== 'number') throw new HelmError('PROVIDER_ERROR', undefined, { provider: 'bybit', providerCode: String(status), detail: 'non-envelope response' })
    if (b.retCode !== 0) throw new HelmError(mapBybitError(b.retCode), undefined, { provider: 'bybit', providerCode: String(b.retCode), detail: b.retMsg })
    return b.result
  }

  async connect(): Promise<ConnectionHealth> {
    this.health = { state: 'RECONNECTING', reasons: [], checkedAt: nowIso() }
    try {
      await this.clock.sync()
      const info = await this.signed<{ unifiedMarginStatus: number; marginMode: string }>('GET', '/v5/account/info')
      const ok = typeof info.unifiedMarginStatus === 'number'
      // Permission inspection: /v5/user/query-api reports readOnly + permission groups (incl. Wallet withdraw).
      let canTrade = true, excessive = false, partial = false
      try {
        const k = await this.signed<{ readOnly: number; permissions: Record<string, string[]> }>('GET', '/v5/user/query-api')
        canTrade = k.readOnly === 0
        excessive = (k.permissions?.Wallet ?? []).some(p => /withdraw/i.test(p))
      } catch {
        partial = true // not available on every demo key; trading permission confirmed on first order instead
      }
      this.health = deriveConnectionHealth({ authenticatedReadOk: ok, environmentVerified: this.base === BYBIT_DEMO, canRead: ok, canTrade, excessivePermissions: excessive, partial })
    } catch (e) {
      const he = e instanceof HelmError ? e : new HelmError('PROVIDER_ERROR', undefined, { provider: 'bybit', cause: e })
      this.health = deriveConnectionHealth({ authenticatedReadOk: false, environmentVerified: false, canRead: false, canTrade: false, excessivePermissions: false, error: `${he.code}${he.providerCode ? ` (${he.providerCode})` : ''}` })
    }
    return this.health
  }

  async getBalances(): Promise<Balance[]> {
    const r = await this.signed<{ list: Array<{ coin: Array<{ coin: string; walletBalance: string; locked: string; equity: string; totalPositionIM?: string; totalOrderIM?: string }> }> }>('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })
    const asOf = nowIso()
    return (r.list[0]?.coin ?? []).map(c => {
      const total = dec(c.walletBalance || '0')
      const locked = dec(c.locked || '0')
      return { accountId: this.opts.accountId, asset: c.coin, free: total.minus(locked), locked, total, asOf, source: 'bybit' as const }
    }).filter(b => !b.total.isZero())
  }

  async getEquity(): Promise<AccountEquity> {
    const r = await this.signed<{ list: Array<{ totalEquity: string; totalAvailableBalance: string; totalInitialMargin: string }> }>('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })
    const a = r.list[0]
    return { accountId: this.opts.accountId, currency: 'USD', equity: decOrNull(a?.totalEquity), availableBalance: decOrNull(a?.totalAvailableBalance), marginUsed: decOrNull(a?.totalInitialMargin), asOf: nowIso() }
  }

  async getPositions(): Promise<Position[]> {
    const r = await this.signed<{ list: Array<{ symbol: string; side: 'Buy' | 'Sell' | ''; size: string; avgPrice: string; markPrice: string; positionValue: string; unrealisedPnl: string; cumRealisedPnl: string; leverage: string; liqPrice: string; tradeMode: number; positionIdx: number }> }>('GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' })
    return r.list.filter(p => p.size && !dec(p.size).isZero()).map(p => ({
      accountId: this.opts.accountId, instrumentId: instrumentId({ provider: 'bybit', product: 'perp', base: p.symbol.replace(/USDT$/, ''), quote: 'USDT', settle: 'USDT' }),
      provider: 'bybit' as const, product: 'perp' as const, side: p.side === 'Buy' ? 'LONG' as const : 'SHORT' as const,
      quantity: dec(p.size), entryPrice: decOrNull(p.avgPrice), markPrice: decOrNull(p.markPrice), notional: decOrNull(p.positionValue), unrealizedPnl: decOrNull(p.unrealisedPnl),
      realizedPnl: decOrNull(p.cumRealisedPnl), leverage: decOrNull(p.leverage), liquidationPrice: p.liqPrice ? dec(p.liqPrice) : null,
      marginMode: p.tradeMode === 1 ? 'isolated' as const : 'cross' as const, positionMode: p.positionIdx === 0 ? 'one_way' as const : 'hedge' as const, asOf: nowIso(), raw: p,
    }))
  }

  private category(id: InstrumentId): Category { return parseInstrumentId(id).product === 'perp' ? 'linear' : 'spot' }
  private symbolOf(id: InstrumentId) { return toProviderSymbol(parseInstrumentId(id)) }

  async getOrderBook(id: InstrumentId, depth = 25): Promise<OrderBook> {
    const r = await this.publicGet<{ b: string[][]; a: string[][]; ts: number }>('/v5/market/orderbook', { category: this.category(id), symbol: this.symbolOf(id), limit: String(depth) })
    const lvl = (l: string[]) => ({ price: dec(l[0]!), quantity: dec(l[1]!) })
    return { provider: 'bybit', instrumentId: id, bids: r.b.map(lvl), asks: r.a.map(lvl), timestamp: new Date(r.ts).toISOString(), receivedAt: nowIso() }
  }

  async getMarketSnapshot(id: InstrumentId): Promise<MarketSnapshot> {
    const r = await this.publicGet<{ list: Array<{ bid1Price: string; ask1Price: string; lastPrice: string; volume24h: string }> }>('/v5/market/tickers', { category: this.category(id), symbol: this.symbolOf(id) })
    const t = r.list[0]
    return { provider: 'bybit', instrumentId: id, bid: decOrNull(t?.bid1Price), ask: decOrNull(t?.ask1Price), last: decOrNull(t?.lastPrice), volume24h: decOrNull(t?.volume24h), timestamp: nowIso(), receivedAt: nowIso() }
  }

  async getInstruments(product: Instrument['product'] = 'spot'): Promise<Instrument[]> {
    const category: Category = product === 'perp' ? 'linear' : 'spot'
    const r = await this.publicGet<{ list: Array<{ symbol: string; baseCoin: string; quoteCoin: string; settleCoin?: string; status: string; contractType?: string; lotSizeFilter: { basePrecision?: string; qtyStep?: string; minOrderQty: string; maxOrderQty?: string; maxMktOrderQty?: string; minOrderAmt?: string; minNotionalValue?: string }; priceFilter: { tickSize: string } }> }>('/v5/market/instruments-info', { category })
    return r.list.filter(s => category === 'spot' || s.contractType === 'LinearPerpetual').map(s => ({
      id: instrumentId({ provider: 'bybit', product: category === 'spot' ? 'spot' : 'perp', base: s.baseCoin, quote: s.quoteCoin, settle: category === 'linear' ? s.settleCoin : undefined }),
      provider: 'bybit' as const, providerSymbol: s.symbol, product: category === 'spot' ? 'spot' as const : 'perp' as const, base: s.baseCoin, quote: s.quoteCoin, settle: category === 'linear' ? s.settleCoin : undefined,
      contractMultiplier: new Decimal(1), quantityUnit: 'base' as const, lotSize: dec(s.lotSizeFilter.qtyStep ?? s.lotSizeFilter.basePrecision ?? '0.000001'),
      minQty: dec(s.lotSizeFilter.minOrderQty), maxQty: s.lotSizeFilter.maxOrderQty ? dec(s.lotSizeFilter.maxOrderQty) : undefined,
      minNotional: s.lotSizeFilter.minOrderAmt ? dec(s.lotSizeFilter.minOrderAmt) : s.lotSizeFilter.minNotionalValue ? dec(s.lotSizeFilter.minNotionalValue) : undefined,
      tickSize: dec(s.priceFilter.tickSize), venue: category === 'spot' ? 'Bybit Spot (Demo)' : 'Bybit USDT Perpetual (Demo)', currency: s.quoteCoin, tradingHours: 'continuous' as const,
      status: s.status === 'Trading' ? 'trading' as const : 'unknown' as const, raw: s,
    }))
  }

  async validateOrder(req: OrderRequest): Promise<ValidationResult> { return validateAgainstInstrument(req) }

  buildOrderBody(req: OrderRequest): Record<string, string | boolean | number | undefined> {
    if (req.type !== 'MARKET' && req.type !== 'LIMIT' && req.type !== 'STOP_MARKET') throw new HelmError('UNSUPPORTED_OPERATION', `Bybit ${req.type} not enabled in HELM yet`, { provider: 'bybit' })
    const category = this.category(req.instrument.id)
    const body: Record<string, string | boolean | number | undefined> = {
      category, symbol: req.instrument.providerSymbol, side: req.side === 'BUY' ? 'Buy' : 'Sell', orderType: req.type === 'LIMIT' ? 'Limit' : 'Market',
      orderLinkId: req.clientOrderId, price: req.type === 'LIMIT' ? req.price?.toFixed() : undefined, timeInForce: req.type === 'LIMIT' ? (req.timeInForce ?? 'GTC') : undefined,
    }
    if (category === 'spot' && req.type === 'MARKET' && req.quoteQuantity && !req.quantity) { body.qty = req.quoteQuantity.toFixed(); body.marketUnit = 'quoteCoin' }
    else if (req.quantity) { body.qty = req.quantity.toFixed(); if (category === 'spot' && req.type === 'MARKET') body.marketUnit = 'baseCoin' }
    else throw new HelmError('INVALID_QUANTITY', 'quantity required', { provider: 'bybit' })
    if (req.type === 'STOP_MARKET') {
      if (!req.stopPrice) throw new HelmError('INVALID_QUANTITY', 'stop price required', { provider: 'bybit' })
      // Conditional market order. SELL stop triggers when price FALLS to trigger (2); BUY stop when it RISES (1).
      body.triggerPrice = req.stopPrice.toFixed(); body.triggerDirection = req.side === 'SELL' ? 2 : 1
      if (category === 'linear') { body.triggerBy = 'MarkPrice'; body.orderFilter = undefined } else { body.orderFilter = 'StopOrder'; body.marketUnit = 'baseCoin' }
    }
    if (category === 'linear') {
      if (req.reduceOnly) body.reduceOnly = true
      body.positionIdx = req.positionSide === 'LONG' ? 1 : req.positionSide === 'SHORT' ? 2 : 0
    }
    return body
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const v = validateAgainstInstrument(req)
    if (!v.ok) throw new HelmError('INVALID_QUANTITY', v.problems.join('; '), { provider: 'bybit' })
    const ack = await this.signed<{ orderId: string; orderLinkId: string }>('POST', '/v5/order/create', this.buildOrderBody(req), true)
    const truth = await this.reconcileOrder(req.instrument.id, { providerOrderId: ack.orderId })
    if (truth) return truth
    return { accountId: this.opts.accountId, provider: 'bybit', instrumentId: req.instrument.id, providerOrderId: ack.orderId, clientOrderId: req.clientOrderId, side: req.side, type: req.type, timeInForce: null, quantity: req.quantity ?? null, quoteQuantity: req.quoteQuantity ?? null, price: req.price ?? null, stopPrice: null, reduceOnly: !!req.reduceOnly, status: 'RECONCILING', filledQuantity: new Decimal(0), avgFillPrice: null, createdAt: nowIso(), updatedAt: nowIso(), raw: ack }
  }

  async cancelOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order> {
    await this.signed('POST', '/v5/order/cancel', { category: this.category(id), symbol: this.symbolOf(id), orderId: ids.providerOrderId, orderLinkId: ids.providerOrderId ? undefined : ids.clientOrderId })
    const o = await this.reconcileOrder(id, ids)
    if (!o) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'bybit' })
    return o
  }

  async amendOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }, changes: { quantity?: Decimal; price?: Decimal }): Promise<Order> {
    await this.signed('POST', '/v5/order/amend', { category: this.category(id), symbol: this.symbolOf(id), orderId: ids.providerOrderId, orderLinkId: ids.providerOrderId ? undefined : ids.clientOrderId, qty: changes.quantity?.toFixed(), price: changes.price?.toFixed() })
    const o = await this.reconcileOrder(id, ids)
    if (!o) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'bybit' })
    return o
  }

  async reconcileOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null> {
    const q = { category: this.category(id), symbol: this.symbolOf(id), orderId: ids.providerOrderId, orderLinkId: ids.providerOrderId ? undefined : ids.clientOrderId }
    const open = await this.signed<{ list: BybitOrder[] }>('GET', '/v5/order/realtime', q)
    let o = open.list[0]
    if (!o && q.category === 'spot') o = (await this.signed<{ list: BybitOrder[] }>('GET', '/v5/order/realtime', { ...q, orderFilter: 'StopOrder' })).list[0]
    if (!o) o = (await this.signed<{ list: BybitOrder[] }>('GET', '/v5/order/history', q)).list[0]
    return o ? this.toOrder(o, id) : null
  }

  async getOpenOrders(id?: InstrumentId): Promise<Order[]> {
    const category = id ? this.category(id) : 'linear'
    const r = await this.signed<{ list: BybitOrder[] }>('GET', '/v5/order/realtime', { category, symbol: id ? this.symbolOf(id) : undefined, settleCoin: id ? undefined : 'USDT' })
    return r.list.map(o => this.toOrder(o, id ?? instrumentId({ provider: 'bybit', product: 'perp', base: o.symbol.replace(/USDT$/, ''), quote: 'USDT', settle: 'USDT' })))
  }

  async getOrderHistory(id: InstrumentId, limit = 50): Promise<Order[]> {
    const r = await this.signed<{ list: BybitOrder[] }>('GET', '/v5/order/history', { category: this.category(id), symbol: this.symbolOf(id), limit })
    return r.list.map(o => this.toOrder(o, id))
  }

  /** Exchange-reported executions (/v5/execution/list). */
  async getFills(id: InstrumentId, limit = 50): Promise<Fill[]> {
    const r = await this.signed<{ list: Array<{ orderId: string; execId: string; side: 'Buy' | 'Sell'; execPrice: string; execQty: string; execFee: string; feeCurrency?: string; isMaker: boolean; execTime: string }> }>('GET', '/v5/execution/list', { category: this.category(id), symbol: this.symbolOf(id), limit })
    return r.list.map(e => ({ accountId: this.opts.accountId, provider: 'bybit' as const, instrumentId: id, providerOrderId: e.orderId, providerTradeId: e.execId, side: e.side === 'Buy' ? 'BUY' as const : 'SELL' as const, price: dec(e.execPrice), quantity: dec(e.execQty), fee: decOrNull(e.execFee), feeAsset: e.feeCurrency ?? null, isMaker: e.isMaker, timestamp: new Date(Number(e.execTime)).toISOString(), raw: e }))
  }

  async setLeverage(id: InstrumentId, leverage: Decimal): Promise<void> {
    if (this.category(id) !== 'linear') return this.unsupported('setLeverage (spot)')
    try { await this.signed('POST', '/v5/position/set-leverage', { category: 'linear', symbol: this.symbolOf(id), buyLeverage: leverage.toFixed(), sellLeverage: leverage.toFixed() }) }
    catch (e) { if (!(e instanceof HelmError && e.providerCode === '110043')) throw e } // 110043 = leverage not modified (already set)
  }

  private toOrder(o: BybitOrder, id: InstrumentId): Order {
    const quoteUnit = o.marketUnit === 'quoteCoin'
    return {
      accountId: this.opts.accountId, provider: 'bybit', instrumentId: id, providerOrderId: o.orderId, clientOrderId: o.orderLinkId, side: o.side === 'Buy' ? 'BUY' : 'SELL',
      type: o.triggerPrice && !dec(o.triggerPrice).isZero() && o.orderType === 'Market' ? 'STOP_MARKET' : o.orderType === 'Market' ? 'MARKET' : 'LIMIT', timeInForce: (['GTC', 'IOC', 'FOK'].includes(o.timeInForce) ? o.timeInForce : null) as Order['timeInForce'],
      quantity: quoteUnit ? null : decOrNull(o.qty), quoteQuantity: quoteUnit ? decOrNull(o.qty) : null, price: o.price && !dec(o.price).isZero() ? dec(o.price) : null,
      stopPrice: o.triggerPrice && !dec(o.triggerPrice).isZero() ? dec(o.triggerPrice) : null, reduceOnly: o.reduceOnly, status: mapBybitStatus(o.orderStatus),
      filledQuantity: dec(o.cumExecQty || '0'), avgFillPrice: o.avgPrice && !dec(o.avgPrice).isZero() ? dec(o.avgPrice) : null,
      createdAt: new Date(Number(o.createdTime)).toISOString(), updatedAt: new Date(Number(o.updatedTime)).toISOString(), raw: o,
    }
  }
}
