import {
  BaseAdapter, Decimal, HelmError, dec, decOrNull, deriveConnectionHealth, instrumentId, parseInstrumentId,
  type AccountEquity, type Balance, type CapabilityManifest, type ConnectionHealth, type HelmErrorCode, type InstrumentId, type Order, type OrderRequest, type OrderStatus, type Position,
} from '@helm/shared'
import { GuardedHttp, nowIso, type FetchLike } from '../http'

/**
 * Alpaca PAPER trading. NOTE: Alpaca is not in the official Exchanges & Stocks track list
 * (verified 2026-11-24). The registry keeps it disabled unless HELM_ENABLE_ALPACA=true.
 */
export const ALPACA_PAPER = 'https://paper-api.alpaca.markets'
export const ALPACA_DATA = 'https://data.alpaca.markets'

export function mapAlpacaStatus(s: string): OrderStatus {
  switch (s) {
    case 'new': case 'accepted': case 'pending_new': case 'accepted_for_bidding': case 'held': case 'calculated': case 'replaced': case 'pending_replace': return 'ACCEPTED'
    case 'partially_filled': return 'PARTIALLY_FILLED'
    case 'filled': return 'FILLED'
    case 'canceled': case 'pending_cancel': case 'done_for_day': return 'CANCELED'
    case 'rejected': case 'suspended': case 'stopped': return 'REJECTED'
    case 'expired': return 'EXPIRED'
    default: return 'UNKNOWN'
  }
}
function mapAlpacaError(status: number, msg: string): HelmErrorCode {
  if (status === 401) return 'INVALID_CREDENTIALS'
  if (status === 403) return /buying power|insufficient/i.test(msg) ? 'INSUFFICIENT_BALANCE' : 'INSUFFICIENT_PERMISSIONS'
  if (status === 404) return 'ORDER_UNKNOWN'
  if (status === 422) return /market.*closed|not tradable/i.test(msg) ? 'MARKET_CLOSED' : 'ORDER_REJECTED'
  return 'PROVIDER_ERROR'
}

interface AlpacaOrder { id: string; client_order_id: string; symbol: string; side: 'buy' | 'sell'; type: string; time_in_force: string; qty: string | null; notional: string | null; limit_price: string | null; stop_price: string | null; status: string; filled_qty: string; filled_avg_price: string | null; created_at: string; updated_at: string }

export class AlpacaPaperAdapter extends BaseAdapter {
  readonly provider = 'alpaca' as const
  readonly http: GuardedHttp
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  constructor(private readonly creds: { keyId: string; secretKey: string }, private readonly opts: { accountId: string; fetch?: FetchLike }) {
    super()
    this.http = new GuardedHttp('alpaca', opts.fetch)
  }

  getCapabilities(): CapabilityManifest {
    return {
      provider: 'alpaca', environment: 'paper', accountTypes: ['brokerage'],
      permissions: { read: this.health.state !== 'ERROR', trade: this.health.state === 'CONNECTED', withdraw: false },
      products: ['stock'], spot: false, futures: false, stocks: true, orderTypes: ['MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT'],
      reduceOnly: false, hedgeMode: false, margin: true, cancelReplace: true, streaming: { market: true, account: true }, simulation: 'paper_broker',
      operations: ['connect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getEquity', 'getPositions', 'getOpenOrders', 'submitOrder', 'cancelOrder', 'reconcileOrder'],
      restrictions: ['Not in official track list — disabled by default', 'US market hours apply; fractional orders must be DAY market/limit'],
      verification: 'documented',
    }
  }
  getConnectionState() { return this.health }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, submitsOrder = false): Promise<T> {
    const r = await this.http.request({ method, url: `${ALPACA_PAPER}${path}`, headers: { 'APCA-API-KEY-ID': this.creds.keyId, 'APCA-API-SECRET-KEY': this.creds.secretKey, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, authenticated: true, submitsOrder })
    if (r.status >= 400) {
      const msg = (r.body as { message?: string } | null)?.message ?? ''
      throw new HelmError(mapAlpacaError(r.status, msg), undefined, { provider: 'alpaca', providerCode: String(r.status), detail: msg })
    }
    return r.body as T
  }

  async connect(): Promise<ConnectionHealth> {
    try {
      const a = await this.call<{ account_number: string; status: string; trading_blocked: boolean }>('GET', '/v2/account')
      const ok = typeof a.account_number === 'string'
      this.health = deriveConnectionHealth({ authenticatedReadOk: ok, environmentVerified: ok && a.account_number.startsWith('PA'), canRead: ok, canTrade: a.status === 'ACTIVE' && !a.trading_blocked, excessivePermissions: false })
    } catch (e) {
      this.health = deriveConnectionHealth({ authenticatedReadOk: false, environmentVerified: false, canRead: false, canTrade: false, excessivePermissions: false, error: e instanceof HelmError ? e.code : 'PROVIDER_ERROR' })
    }
    return this.health
  }

  async getBalances(): Promise<Balance[]> {
    const a = await this.call<{ cash: string; currency: string }>('GET', '/v2/account')
    return [{ accountId: this.opts.accountId, asset: a.currency ?? 'USD', free: dec(a.cash), locked: new Decimal(0), total: dec(a.cash), asOf: nowIso(), source: 'alpaca' }]
  }
  async getEquity(): Promise<AccountEquity> {
    const a = await this.call<{ equity: string; buying_power: string; initial_margin: string }>('GET', '/v2/account')
    return { accountId: this.opts.accountId, currency: 'USD', equity: dec(a.equity), availableBalance: dec(a.buying_power), marginUsed: decOrNull(a.initial_margin), asOf: nowIso() }
  }
  async getPositions(): Promise<Position[]> {
    const rows = await this.call<Array<{ symbol: string; qty: string; side: 'long' | 'short'; avg_entry_price: string; current_price: string; market_value: string; unrealized_pl: string }>>('GET', '/v2/positions')
    return rows.map(p => ({ accountId: this.opts.accountId, instrumentId: instrumentId({ provider: 'alpaca', product: 'stock', base: p.symbol, quote: 'USD' }), provider: 'alpaca' as const, product: 'stock' as const, side: p.side === 'long' ? 'LONG' as const : 'SHORT' as const, quantity: dec(p.qty), entryPrice: decOrNull(p.avg_entry_price), markPrice: decOrNull(p.current_price), notional: decOrNull(p.market_value), unrealizedPnl: decOrNull(p.unrealized_pl), realizedPnl: null, leverage: null, liquidationPrice: null, marginMode: null, positionMode: null, asOf: nowIso(), raw: p }))
  }

  buildOrderBody(req: OrderRequest) {
    const typeMap = { MARKET: 'market', LIMIT: 'limit', STOP_MARKET: 'stop', STOP_LIMIT: 'stop_limit' } as const
    const t = typeMap[req.type as keyof typeof typeMap]
    if (!t) throw new HelmError('UNSUPPORTED_OPERATION', `Alpaca ${req.type} not supported`, { provider: 'alpaca' })
    const fractional = (req.quantity && !req.quantity.isInteger()) || (!!req.quoteQuantity && !req.quantity)
    if (fractional && t !== 'market' && t !== 'limit') throw new HelmError('INVALID_QUANTITY', 'Alpaca fractional orders must be market or limit', { provider: 'alpaca' })
    return {
      symbol: parseInstrumentId(req.instrument.id).base, side: req.side === 'BUY' ? 'buy' : 'sell', type: t,
      time_in_force: fractional ? 'day' : (req.timeInForce ?? 'DAY').toLowerCase(),
      qty: req.quantity?.toFixed(), notional: req.quantity ? undefined : req.quoteQuantity?.toFixed(),
      limit_price: req.price?.toFixed(), stop_price: req.stopPrice?.toFixed(), client_order_id: req.clientOrderId,
    }
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    return this.toOrder(await this.call<AlpacaOrder>('POST', '/v2/orders', this.buildOrderBody(req), true), req.instrument.id)
  }
  async cancelOrder(id: InstrumentId, ids: { providerOrderId?: string }): Promise<Order> {
    if (!ids.providerOrderId) throw new HelmError('ORDER_UNKNOWN', 'Alpaca cancel requires order id', { provider: 'alpaca' })
    await this.call('DELETE', `/v2/orders/${encodeURIComponent(ids.providerOrderId)}`)
    const o = await this.reconcileOrder(id, ids)
    if (!o) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'alpaca' })
    return o
  }
  async reconcileOrder(id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null> {
    try {
      const o = ids.providerOrderId
        ? await this.call<AlpacaOrder>('GET', `/v2/orders/${encodeURIComponent(ids.providerOrderId)}`)
        : await this.call<AlpacaOrder>('GET', `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(ids.clientOrderId ?? '')}`)
      return this.toOrder(o, id)
    } catch (e) { if (e instanceof HelmError && e.code === 'ORDER_UNKNOWN') return null; throw e }
  }
  async getOpenOrders(): Promise<Order[]> {
    const rows = await this.call<AlpacaOrder[]>('GET', '/v2/orders?status=open')
    return rows.map(o => this.toOrder(o, instrumentId({ provider: 'alpaca', product: 'stock', base: o.symbol, quote: 'USD' })))
  }

  private toOrder(o: AlpacaOrder, id: InstrumentId): Order {
    const tm: Record<string, Order['type']> = { market: 'MARKET', limit: 'LIMIT', stop: 'STOP_MARKET', stop_limit: 'STOP_LIMIT' }
    return { accountId: this.opts.accountId, provider: 'alpaca', instrumentId: id, providerOrderId: o.id, clientOrderId: o.client_order_id, side: o.side === 'buy' ? 'BUY' : 'SELL', type: tm[o.type] ?? 'MARKET', timeInForce: o.time_in_force.toUpperCase() as Order['timeInForce'], quantity: decOrNull(o.qty), quoteQuantity: decOrNull(o.notional), price: decOrNull(o.limit_price), stopPrice: decOrNull(o.stop_price), reduceOnly: false, status: mapAlpacaStatus(o.status), filledQuantity: dec(o.filled_qty || '0'), avgFillPrice: decOrNull(o.filled_avg_price), createdAt: o.created_at, updatedAt: o.updated_at, raw: o }
  }
}
