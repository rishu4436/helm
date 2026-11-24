import { type Fill,
  BaseAdapter, Decimal, HelmError, dec, decOrNull, deriveConnectionHealth, instrumentId, parseInstrumentId, toProviderSymbol,
  type Balance, type CapabilityManifest, type ConnectionHealth, type Instrument, type InstrumentId, type Order, type OrderBook,
  type OrderRequest, type OrderStatus, type Position, type MarketSnapshot, type ValidationResult, type AccountEquity, type HelmErrorCode,
} from '@helm/shared'
import { ClockSync, GuardedHttp, nowIso, type FetchLike } from '../http'
import { buildQuery, signBinance } from './sign'
import { validateAgainstInstrument } from '../validation'

export const BINANCE_DEMO = {
  spot: 'https://demo-api.binance.com',
  usdm: 'https://demo-fapi.binance.com',
} as const

export type BinanceMarket = 'spot' | 'usdm'

export interface BinanceCredentials { apiKey: string; apiSecret: string }
export interface BinanceOptions { market: BinanceMarket; accountId: string; fetch?: FetchLike; baseUrl?: string; recvWindow?: number }

const ERROR_MAP: Array<[number[], HelmErrorCode]> = [
  [[-2014, -2015, -1022, -2008], 'INVALID_CREDENTIALS'],
  [[-1003, -1015], 'RATE_LIMITED'],
  [[-1121], 'INVALID_INSTRUMENT'],
  [[-1013, -1111, -4003, -4005], 'INVALID_QUANTITY'],
  [[-4014, -4015], 'INVALID_PRICE'],
  [[-2019], 'INSUFFICIENT_MARGIN'],
  [[-2013], 'ORDER_UNKNOWN'],
  [[-1021], 'CONNECTION_EXPIRED'],
]

export function mapBinanceError(code: number, msg: string): HelmErrorCode {
  if (/insufficient balance/i.test(msg)) return 'INSUFFICIENT_BALANCE'
  for (const [codes, helm] of ERROR_MAP) if (codes.includes(code)) return helm
  if (code === -2010 || code === -2011) return 'ORDER_REJECTED'
  return 'PROVIDER_ERROR'
}

export function mapBinanceStatus(s: string): OrderStatus {
  switch (s) {
    case 'NEW': case 'PENDING_NEW': return 'ACCEPTED'
    case 'PARTIALLY_FILLED': return 'PARTIALLY_FILLED'
    case 'FILLED': return 'FILLED'
    case 'CANCELED': case 'PENDING_CANCEL': return 'CANCELED'
    case 'REJECTED': return 'REJECTED'
    case 'EXPIRED': case 'EXPIRED_IN_MATCH': return 'EXPIRED'
    default: return 'UNKNOWN'
  }
}

interface BinanceOrderPayload {
  symbol: string; orderId: number; clientOrderId: string; price: string; origQty: string; executedQty: string
  cummulativeQuoteQty?: string; cumQuote?: string; avgPrice?: string; status: string; timeInForce?: string; type: string; side: 'BUY' | 'SELL'
  stopPrice?: string; reduceOnly?: boolean; transactTime?: number; updateTime?: number; time?: number
}

export class BinanceAdapter extends BaseAdapter {
  readonly provider = 'binance' as const
  readonly http: GuardedHttp
  readonly clock: ClockSync
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  private readonly base: string
  private readonly market: BinanceMarket
  private readonly accountId: string
  private readonly recvWindow: number

  constructor(private readonly creds: BinanceCredentials, opts: BinanceOptions) {
    super()
    this.market = opts.market
    this.accountId = opts.accountId
    this.base = opts.baseUrl ?? BINANCE_DEMO[opts.market]
    this.recvWindow = opts.recvWindow ?? 5000
    this.http = new GuardedHttp('binance', opts.fetch)
    this.clock = new ClockSync(async () => {
      const r = await this.publicGet<{ serverTime: number }>(this.market === 'spot' ? '/api/v3/time' : '/fapi/v1/time')
      return r.serverTime
    })
  }

  private get prefix() { return this.market === 'spot' ? '/api/v3' : '/fapi/v1' }
  private product() { return this.market === 'spot' ? 'spot' as const : 'perp' as const }

  getCapabilities(): CapabilityManifest {
    const spot = this.market === 'spot'
    return {
      provider: 'binance', environment: 'demo', accountTypes: [spot ? 'spot' : 'futures_usdm'],
      permissions: { read: this.health.state !== 'ERROR', trade: this.health.state === 'CONNECTED', withdraw: false },
      products: [this.product()], spot, futures: !spot, stocks: false,
      orderTypes: spot ? ['MARKET', 'LIMIT', 'STOP_LIMIT', 'TAKE_PROFIT_LIMIT'] : ['MARKET', 'LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_MARKET'],
      reduceOnly: !spot, hedgeMode: !spot, margin: !spot, cancelReplace: spot,
      streaming: { market: true, account: true }, simulation: 'demo_matching_engine',
      operations: ['connect', 'disconnect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getEquity', 'getOpenOrders', 'getOrderHistory', 'getFills',
        'getOrderBook', 'getMarketSnapshot', 'getInstruments', 'validateOrder', 'submitOrder', 'cancelOrder', 'reconcileOrder',
        ...(spot ? [] : ['getPositions', 'setLeverage'] as const)],
      restrictions: ['Binance Demo Trading only; production hosts are blocked by the environment guard'],
      verification: 'documented',
    }
  }

  getConnectionState(): ConnectionHealth { return this.health }

  // ---------- transport ----------
  private async publicGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = buildQuery(params)
    const r = await this.http.request({ method: 'GET', url: `${this.base}${path}${qs ? `?${qs}` : ''}`, authenticated: false })
    return this.unwrap<T>(r.status, r.body)
  }

  /** Exposed for tests: builds the exact signed URL Binance expects. */
  async buildSigned(params: Record<string, string | number | boolean | undefined>): Promise<string> {
    const ts = await this.clock.now()
    const qs = buildQuery({ ...params, recvWindow: this.recvWindow, timestamp: ts })
    return `${qs}&signature=${signBinance(qs, this.creds.apiSecret)}`
  }

  private async signed<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number | boolean | undefined>, submitsOrder = false): Promise<T> {
    const qs = await this.buildSigned(params)
    const r = await this.http.request({ method, url: `${this.base}${path}?${qs}`, headers: { 'X-MBX-APIKEY': this.creds.apiKey }, authenticated: true, submitsOrder })
    return this.unwrap<T>(r.status, r.body)
  }

  private unwrap<T>(status: number, body: unknown): T {
    if (status >= 400 || (body && typeof body === 'object' && 'code' in body && typeof (body as { code: unknown }).code === 'number' && (body as { code: number }).code < 0)) {
      const b = (body ?? {}) as { code?: number; msg?: string }
      const code = b.code ?? status
      throw new HelmError(mapBinanceError(code, b.msg ?? ''), undefined, { provider: 'binance', providerCode: String(code), detail: b.msg })
    }
    return body as T
  }

  /** API-key scope (Binance SAPI). Returns null when the environment does not offer the endpoint. */
  async getKeyRestrictions(): Promise<{ enableWithdrawals?: boolean; enableInternalTransfer?: boolean; permitsUniversalTransfer?: boolean; enableSpotAndMarginTrading?: boolean; enableFutures?: boolean; enableReading?: boolean; ipRestrict?: boolean } | null> {
    if (this.market !== 'spot') return null
    try { return await this.signed('GET', '/sapi/v1/account/apiRestrictions', {}) } catch (e) {
      if (e instanceof HelmError && (e.code === 'INVALID_CREDENTIALS' || e.code === 'INSUFFICIENT_PERMISSIONS')) throw e
      return null
    }
  }

  // ---------- connection ----------
  async connect(): Promise<ConnectionHealth> {
    this.health = { state: 'RECONNECTING', reasons: [], checkedAt: nowIso() }
    try {
      await this.clock.sync()
      if (this.market === 'spot') {
        const acct = await this.signed<{ canTrade: boolean; canWithdraw: boolean; canDeposit: boolean; accountType: string; balances: unknown[] }>('GET', '/api/v3/account', { omitZeroBalances: true })
        const ok = Array.isArray(acct.balances) && typeof acct.canTrade === 'boolean'
        // NOTE: account.canWithdraw is an ACCOUNT capability, not the API key's scope. Key scope comes from
        // /sapi/v1/account/apiRestrictions when the environment offers it (verified live 2026-11-24).
        const kr = await this.getKeyRestrictions()
        this.health = deriveConnectionHealth({ authenticatedReadOk: ok, environmentVerified: this.base.startsWith('https://demo-'), canRead: ok, canTrade: acct.canTrade && (kr ? kr.enableSpotAndMarginTrading !== false : true), excessivePermissions: kr?.enableWithdrawals === true || kr?.enableInternalTransfer === true || kr?.permitsUniversalTransfer === true, error: ok ? undefined : 'Unexpected account payload' })
        if (!kr && this.health.state === 'CONNECTED') this.health.reasons.push('Key withdrawal scope not inspectable in this environment (no apiRestrictions); Demo Trading funds are not withdrawable')
      } else {
        const acct = await this.signed<{ canTrade: boolean; canWithdraw?: boolean; assets: unknown[] }>('GET', '/fapi/v3/account', {})
        const ok = Array.isArray(acct.assets)
        this.health = deriveConnectionHealth({ authenticatedReadOk: ok, environmentVerified: this.base.startsWith('https://demo-'), canRead: ok, canTrade: acct.canTrade !== false, excessivePermissions: acct.canWithdraw === true, error: ok ? undefined : 'Unexpected futures account payload' })
      }
    } catch (e) {
      const he = e instanceof HelmError ? e : new HelmError('PROVIDER_ERROR', undefined, { provider: 'binance', cause: e })
      this.health = deriveConnectionHealth({ authenticatedReadOk: false, environmentVerified: false, canRead: false, canTrade: false, excessivePermissions: false, error: `${he.code}${he.providerCode ? ` (${he.providerCode})` : ''}` })
    }
    return this.health
  }

  // ---------- account ----------
  async getBalances(): Promise<Balance[]> {
    const asOf = nowIso()
    if (this.market === 'spot') {
      const acct = await this.signed<{ balances: Array<{ asset: string; free: string; locked: string }> }>('GET', '/api/v3/account', { omitZeroBalances: true })
      return acct.balances.map(b => ({ accountId: this.accountId, asset: b.asset, free: dec(b.free), locked: dec(b.locked), total: dec(b.free).plus(dec(b.locked)), asOf, source: 'binance' as const }))
        .filter(b => !b.total.isZero())
    }
    const rows = await this.signed<Array<{ asset: string; balance: string; availableBalance: string }>>('GET', '/fapi/v3/balance', {})
    return rows.map(r => ({ accountId: this.accountId, asset: r.asset, free: dec(r.availableBalance), locked: dec(r.balance).minus(dec(r.availableBalance)), total: dec(r.balance), asOf, source: 'binance' as const }))
      .filter(b => !b.total.isZero())
  }

  async getEquity(): Promise<AccountEquity> {
    if (this.market === 'spot') return this.unsupported('getEquity (spot equity requires valuation via portfolio service)')
    const a = await this.signed<{ totalMarginBalance: string; availableBalance: string; totalInitialMargin: string }>('GET', '/fapi/v3/account', {})
    return { accountId: this.accountId, currency: 'USDT', equity: dec(a.totalMarginBalance), availableBalance: dec(a.availableBalance), marginUsed: dec(a.totalInitialMargin), asOf: nowIso() }
  }

  async getPositions(): Promise<Position[]> {
    if (this.market === 'spot') return this.unsupported('getPositions (spot has holdings, not positions)')
    const rows = await this.signed<Array<{ symbol: string; positionSide: string; positionAmt: string; entryPrice: string; markPrice: string; unRealizedProfit: string; liquidationPrice: string; notional: string; marginType?: string; leverage?: string }>>('GET', '/fapi/v3/positionRisk', {})
    return rows.filter(r => !dec(r.positionAmt).isZero()).map(r => {
      const qty = dec(r.positionAmt)
      const side = r.positionSide === 'LONG' ? 'LONG' as const : r.positionSide === 'SHORT' ? 'SHORT' as const : 'NET' as const
      const quote = r.symbol.endsWith('USDC') ? 'USDC' : 'USDT'
      return {
        accountId: this.accountId, instrumentId: instrumentId({ provider: 'binance', product: 'perp', base: r.symbol.slice(0, -quote.length), quote, settle: quote }),
        provider: 'binance' as const, product: 'perp' as const, side, quantity: qty, entryPrice: decOrNull(r.entryPrice), markPrice: decOrNull(r.markPrice),
        notional: decOrNull(r.notional), unrealizedPnl: decOrNull(r.unRealizedProfit), realizedPnl: null, leverage: decOrNull(r.leverage),
        liquidationPrice: dec(r.liquidationPrice).isZero() ? null : dec(r.liquidationPrice), marginMode: r.marginType === 'isolated' ? 'isolated' as const : r.marginType ? 'cross' as const : null,
        positionMode: side === 'NET' ? 'one_way' as const : 'hedge' as const, asOf: nowIso(), raw: r,
      }
    })
  }

  // ---------- market ----------
  private symbolOf(id: InstrumentId): string { return toProviderSymbol(parseInstrumentId(id)) }

  async getOrderBook(id: InstrumentId, depth = 20): Promise<OrderBook> {
    const receivedAt = nowIso()
    const r = await this.publicGet<{ bids: [string, string][]; asks: [string, string][]; E?: number; T?: number }>(`${this.prefix}/depth`, { symbol: this.symbolOf(id), limit: depth })
    const lvl = (l: [string, string]) => ({ price: dec(l[0]), quantity: dec(l[1]) })
    return { provider: 'binance', instrumentId: id, bids: r.bids.map(lvl), asks: r.asks.map(lvl), timestamp: r.E ? new Date(r.E).toISOString() : receivedAt, receivedAt }
  }

  async getMarketSnapshot(id: InstrumentId): Promise<MarketSnapshot> {
    const r = await this.publicGet<{ bidPrice: string; askPrice: string; lastPrice: string; volume: string; closeTime: number }>(`${this.prefix}/ticker/24hr`, { symbol: this.symbolOf(id) })
    return { provider: 'binance', instrumentId: id, bid: decOrNull(r.bidPrice), ask: decOrNull(r.askPrice), last: decOrNull(r.lastPrice), volume24h: decOrNull(r.volume), timestamp: new Date(r.closeTime).toISOString(), receivedAt: nowIso() }
  }

  async getInstruments(): Promise<Instrument[]> {
    const r = await this.publicGet<{ symbols: Array<{ symbol: string; status: string; baseAsset: string; quoteAsset: string; marginAsset?: string; contractType?: string; filters: Array<Record<string, string>> }> }>(`${this.prefix}/exchangeInfo`)
    return r.symbols.filter(s => this.market === 'spot' || s.contractType === 'PERPETUAL').map(s => parseBinanceSymbol(s, this.market))
  }

  // ---------- orders ----------
  async validateOrder(req: OrderRequest): Promise<ValidationResult> {
    return validateAgainstInstrument(req)
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const v = validateAgainstInstrument(req)
    if (!v.ok) throw new HelmError('INVALID_QUANTITY', v.problems.join('; '), { provider: 'binance' })
    const params: Record<string, string | undefined> = {
      symbol: req.instrument.providerSymbol, side: req.side, type: binanceType(req.type, this.market),
      newClientOrderId: req.clientOrderId,
      quantity: req.quantity?.toFixed(), price: req.price?.toFixed(), stopPrice: req.stopPrice?.toFixed(),
      timeInForce: req.type === 'LIMIT' || req.type === 'STOP_LIMIT' || req.type === 'TAKE_PROFIT_LIMIT' ? (req.timeInForce ?? 'GTC') : undefined,
      newOrderRespType: this.market === 'spot' ? 'FULL' : 'RESULT',
    }
    if (this.market === 'spot' && req.type === 'MARKET' && req.quoteQuantity && !req.quantity) params.quoteOrderQty = req.quoteQuantity.toFixed()
    if (this.market === 'usdm' && isAlgoType(req.type)) return this.submitAlgo(req)
    if (this.market === 'usdm') {
      if (req.reduceOnly) params.reduceOnly = 'true'
      if (req.positionSide && req.positionSide !== 'NET') { params.positionSide = req.positionSide; delete params.reduceOnly } // hedge mode forbids reduceOnly
    }
    const r = await this.signed<BinanceOrderPayload>('POST', `${this.prefix}/order`, params, true)
    return this.toOrder(r, req.instrument.id)
  }

  /**
   * USDⓈ-M conditional orders (STOP_MARKET / TAKE_PROFIT_MARKET) go through the Algo Order API:
   * since 2025-12-09 the classic /fapi/v1/order rejects them with -4120 (confirmed live on Demo 2026-11-24).
   */
  private async submitAlgo(req: OrderRequest): Promise<Order> {
    const params: Record<string, string | undefined> = {
      algoType: 'CONDITIONAL', symbol: req.instrument.providerSymbol, side: req.side, type: binanceType(req.type, this.market),
      quantity: req.quantity?.toFixed(), triggerPrice: req.stopPrice?.toFixed(), workingType: 'MARK_PRICE', clientAlgoId: req.clientOrderId.slice(0, 36), newOrderRespType: 'RESULT',
    }
    if (req.reduceOnly) params.reduceOnly = 'true'
    if (req.positionSide && req.positionSide !== 'NET') { params.positionSide = req.positionSide; delete params.reduceOnly }
    const r = await this.signed<BinanceAlgoPayload>('POST', '/fapi/v1/algoOrder', params, true)
    return this.algoToOrder(r, req.instrument.id)
  }

  private isAlgoIds(ids: { providerOrderId?: string; clientOrderId?: string }) { return this.market === 'usdm' && (ids.providerOrderId?.startsWith('algo:') || (!ids.providerOrderId && ids.clientOrderId?.startsWith('helmst'))) }
  private algoParams(ids: { providerOrderId?: string; clientOrderId?: string }) {
    return ids.providerOrderId?.startsWith('algo:') ? { algoId: ids.providerOrderId.slice(5) } : { clientAlgoId: ids.clientOrderId }
  }

  private algoToOrder(r: BinanceAlgoPayload, id: InstrumentId): Order {
    const ts = new Date(r.updateTime ?? r.createTime ?? Date.now()).toISOString()
    const st = r.algoStatus
    // TRIGGERED/FINISHED = converted into a real order (actualOrderId): HELM then reconciles that order for fills.
    const status: Order['status'] = st === 'NEW' || st === 'TRIGGERING' ? 'ACCEPTED' : st === 'CANCELED' || st === 'CANCELLED' ? 'CANCELED' : st === 'REJECTED' ? 'REJECTED' : st === 'EXPIRED' ? 'EXPIRED' : st === 'TRIGGERED' || st === 'FINISHED' ? 'RECONCILING' : 'UNKNOWN'
    return {
      accountId: this.accountId, provider: 'binance', instrumentId: id, providerOrderId: `algo:${r.algoId}`, clientOrderId: r.clientAlgoId,
      side: r.side, type: fromBinanceType(r.orderType), timeInForce: (r.timeInForce as Order['timeInForce']) ?? null, quantity: decOrNull(r.quantity), quoteQuantity: null,
      price: r.price && !dec(r.price).isZero() ? dec(r.price) : null, stopPrice: decOrNull(r.triggerPrice), reduceOnly: r.reduceOnly === true || r.reduceOnly === 'true',
      status, filledQuantity: new Decimal(0), avgFillPrice: null, createdAt: ts, updatedAt: ts, raw: r,
    }
  }

  async cancelOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order> {
    if (this.isAlgoIds(ids)) return this.algoToOrder({ ...(await this.signed<BinanceAlgoPayload>('DELETE', '/fapi/v1/algoOrder', this.algoParams(ids))), algoStatus: 'CANCELED' } as BinanceAlgoPayload, id)
    const r = await this.signed<BinanceOrderPayload>('DELETE', `${this.prefix}/order`, { symbol: this.symbolOf(id), orderId: ids.providerOrderId, origClientOrderId: ids.providerOrderId ? undefined : ids.clientOrderId })
    return this.toOrder(r, id)
  }

  async reconcileOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null> {
    if (this.isAlgoIds(ids)) {
      try {
        const a = this.algoToOrder(await this.signed<BinanceAlgoPayload>('GET', '/fapi/v1/algoOrder', this.algoParams(ids)), id)
        const actual = (a.raw as BinanceAlgoPayload).actualOrderId
        if (a.status === 'RECONCILING' && actual) { const o = await this.reconcileOrder(id, { providerOrderId: String(actual) }); return o ? { ...o, raw: { algo: a.raw, order: o.raw } } : a }
        return a
      } catch (e) { if (e instanceof HelmError && (e.providerCode === '-2013' || e.providerCode === '-2011')) return null; throw e }
    }
    try {
      const r = await this.signed<BinanceOrderPayload>('GET', `${this.prefix}/order`, { symbol: this.symbolOf(id), orderId: ids.providerOrderId, origClientOrderId: ids.providerOrderId ? undefined : ids.clientOrderId })
      return this.toOrder(r, id)
    } catch (e) {
      if (e instanceof HelmError && e.providerCode === '-2013') return null // order does not exist → safe to treat as never accepted
      throw e
    }
  }

  async getOpenOrders(id?: InstrumentId): Promise<Order[]> {
    const rows = await this.signed<BinanceOrderPayload[]>('GET', `${this.prefix}/openOrders`, { symbol: id ? this.symbolOf(id) : undefined })
    const out = rows.map(r => this.toOrder(r, id ?? this.idFromSymbol(r.symbol)))
    if (this.market === 'usdm') {
      const algos = await this.signed<BinanceAlgoPayload[]>('GET', '/fapi/v1/openAlgoOrders', { symbol: id ? this.symbolOf(id) : undefined })
      out.push(...(Array.isArray(algos) ? algos : []).map(a => this.algoToOrder(a, id ?? this.idFromSymbol(a.symbol))))
    }
    return out
  }

  async getOrderHistory(id: InstrumentId, limit = 50): Promise<Order[]> {
    const rows = await this.signed<BinanceOrderPayload[]>('GET', `${this.prefix}/allOrders`, { symbol: this.symbolOf(id), limit })
    return rows.map(r => this.toOrder(r, id))
  }

  /** Exchange-reported trades: spot /api/v3/myTrades, USDⓈ-M /fapi/v1/userTrades. */
  async getFills(id: InstrumentId, limit = 50): Promise<Fill[]> {
    const rows = await this.signed<Array<{ id: number; orderId: number; price: string; qty: string; commission: string; commissionAsset: string; time: number; isMaker?: boolean; maker?: boolean; isBuyer?: boolean; buyer?: boolean; side?: 'BUY' | 'SELL' }>>('GET', this.market === 'spot' ? '/api/v3/myTrades' : '/fapi/v1/userTrades', { symbol: this.symbolOf(id), limit })
    return rows.map(t => ({
      accountId: this.accountId, provider: 'binance' as const, instrumentId: id, providerOrderId: String(t.orderId), providerTradeId: String(t.id),
      side: t.side ?? ((t.isBuyer ?? t.buyer) ? 'BUY' as const : 'SELL' as const), price: dec(t.price), quantity: dec(t.qty), fee: dec(t.commission), feeAsset: t.commissionAsset,
      isMaker: t.isMaker ?? t.maker ?? null, timestamp: new Date(t.time).toISOString(), raw: t,
    }))
  }

  async setLeverage(id: InstrumentId, leverage: Decimal): Promise<void> {
    if (this.market === 'spot') return this.unsupported('setLeverage')
    if (!leverage.isInteger() || leverage.lt(1)) throw new HelmError('INVALID_QUANTITY', 'Binance leverage must be a whole number ≥ 1', { provider: 'binance' })
    await this.signed('POST', '/fapi/v1/leverage', { symbol: this.symbolOf(id), leverage: leverage.toFixed() })
  }

  private idFromSymbol(symbol: string): InstrumentId {
    const quote = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BNB'].find(q => symbol.endsWith(q)) ?? 'USDT'
    return instrumentId({ provider: 'binance', product: this.product(), base: symbol.slice(0, -quote.length), quote, settle: this.market === 'usdm' ? quote : undefined })
  }

  private toOrder(r: BinanceOrderPayload, id: InstrumentId): Order {
    const executed = dec(r.executedQty ?? '0')
    const quote = r.cummulativeQuoteQty ?? r.cumQuote
    const avg = r.avgPrice && !dec(r.avgPrice).isZero() ? dec(r.avgPrice) : quote && executed.gt(0) ? dec(quote).div(executed) : null
    const ts = new Date(r.updateTime ?? r.transactTime ?? r.time ?? Date.now()).toISOString()
    return {
      accountId: this.accountId, provider: 'binance', instrumentId: id, providerOrderId: String(r.orderId), clientOrderId: r.clientOrderId,
      side: r.side, type: fromBinanceType(r.type), timeInForce: (r.timeInForce as Order['timeInForce']) ?? null,
      quantity: decOrNull(r.origQty), quoteQuantity: null, price: decOrNull(r.price) && !dec(r.price).isZero() ? dec(r.price) : null,
      stopPrice: r.stopPrice && !dec(r.stopPrice).isZero() ? dec(r.stopPrice) : null, reduceOnly: r.reduceOnly === true,
      status: mapBinanceStatus(r.status), filledQuantity: executed, avgFillPrice: avg, createdAt: ts, updatedAt: ts, raw: r,
    }
  }
}

interface BinanceAlgoPayload { algoId: number | string; clientAlgoId: string; algoType: string; orderType: string; symbol: string; side: 'BUY' | 'SELL'; positionSide?: string; timeInForce?: string; quantity?: string; algoStatus: string; triggerPrice?: string; price?: string; reduceOnly?: boolean | string; createTime?: number; updateTime?: number; actualOrderId?: string | number | null }
const isAlgoType = (t: OrderRequest['type']) => t === 'STOP_MARKET' || t === 'TAKE_PROFIT_MARKET'

function binanceType(t: OrderRequest['type'], market: BinanceMarket): string {
  if (market === 'spot') {
    if (t === 'STOP_LIMIT') return 'STOP_LOSS_LIMIT'
    if (t === 'MARKET' || t === 'LIMIT' || t === 'TAKE_PROFIT_LIMIT') return t
  } else {
    if (t === 'STOP_MARKET' || t === 'TAKE_PROFIT_MARKET' || t === 'MARKET' || t === 'LIMIT') return t
  }
  throw new HelmError('UNSUPPORTED_OPERATION', `Binance ${market} does not support ${t} via HELM`, { provider: 'binance' })
}

function fromBinanceType(t: string): Order['type'] {
  switch (t) {
    case 'STOP_LOSS_LIMIT': case 'STOP': return 'STOP_LIMIT'
    case 'STOP_MARKET': case 'STOP_LOSS': return 'STOP_MARKET'
    case 'TAKE_PROFIT': return 'TAKE_PROFIT_LIMIT'
    case 'LIMIT_MAKER': return 'LIMIT'
    default: return t as Order['type']
  }
}

export function parseBinanceSymbol(s: { symbol: string; status: string; baseAsset: string; quoteAsset: string; marginAsset?: string; filters: Array<Record<string, string>> }, market: BinanceMarket): Instrument {
  const f = (t: string) => s.filters.find(x => x.filterType === t)
  const lot = f('LOT_SIZE'), px = f('PRICE_FILTER'), notional = f('NOTIONAL') ?? f('MIN_NOTIONAL')
  const product = market === 'spot' ? 'spot' as const : 'perp' as const
  return {
    id: instrumentId({ provider: 'binance', product, base: s.baseAsset, quote: s.quoteAsset, settle: market === 'usdm' ? (s.marginAsset ?? s.quoteAsset) : undefined }),
    provider: 'binance', providerSymbol: s.symbol, product, base: s.baseAsset, quote: s.quoteAsset, settle: market === 'usdm' ? (s.marginAsset ?? s.quoteAsset) : undefined,
    contractMultiplier: new Decimal(1), quantityUnit: 'base', lotSize: dec(lot?.stepSize ?? '0.00000001'), minQty: dec(lot?.minQty ?? '0'),
    maxQty: lot?.maxQty ? dec(lot.maxQty) : undefined, minNotional: notional ? dec(notional.minNotional ?? notional.notional ?? '0') : undefined,
    tickSize: dec(px?.tickSize ?? '0.00000001'), venue: market === 'spot' ? 'Binance Spot (Demo)' : 'Binance USDⓈ-M (Demo)', currency: s.quoteAsset,
    tradingHours: 'continuous', status: s.status === 'TRADING' ? 'trading' : s.status === 'BREAK' || s.status === 'HALT' ? 'halted' : 'unknown', raw: s,
  }
}

