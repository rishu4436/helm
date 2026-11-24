import {
  BaseAdapter, Decimal, HelmError, dec, decOrNull, instrumentId, type Balance, type CapabilityManifest, type ConnectionHealth, type InstrumentId,
  type Order, type OrderPreview, type OrderRequest, type OrderStatus,
} from '@helm/shared'
import { GuardedHttp, nowIso, type FetchLike } from '../http'

/**
 * Coinbase Advanced Trade — STATIC SANDBOX ONLY.
 * https://api-sandbox.coinbase.com/api/v3/brokerage — no auth, predefined mocked responses.
 * Every Order/Fill produced here carries simulatedStatic: true and must never be shown as a real fill.
 */
export const COINBASE_SANDBOX = 'https://api-sandbox.coinbase.com/api/v3/brokerage'
export const COINBASE_STATIC_LABEL = 'Coinbase static sandbox — predefined mock responses, not real executions'

export type CoinbaseSandboxScenario = 'PostOrder_insufficient_fund' | 'CancelOrders_failure' | 'EditOrder_failure' | 'PreviewEditOrder_failure' | 'PreviewOrder_insufficient_fund'

export function mapCoinbaseStatus(s: string): OrderStatus {
  switch (s) {
    case 'OPEN': case 'PENDING': case 'QUEUED': return 'ACCEPTED'
    case 'FILLED': return 'FILLED'
    case 'CANCELLED': case 'CANCEL_QUEUED': return 'CANCELED'
    case 'EXPIRED': return 'EXPIRED'
    case 'FAILED': return 'REJECTED'
    default: return 'UNKNOWN'
  }
}

export class CoinbaseSandboxAdapter extends BaseAdapter {
  readonly provider = 'coinbase' as const
  readonly http: GuardedHttp
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  private scenario: CoinbaseSandboxScenario | null = null

  constructor(private readonly opts: { accountId: string; fetch?: FetchLike; baseUrl?: string }) {
    super()
    this.http = new GuardedHttp('coinbase', opts.fetch)
  }

  /** Trigger one of the sandbox's documented error variants via the X-Sandbox header. */
  useScenario(s: CoinbaseSandboxScenario | null) { this.scenario = s }

  getCapabilities(): CapabilityManifest {
    return {
      provider: 'coinbase', environment: 'sandbox_static', accountTypes: ['portfolio'],
      permissions: { read: true, trade: false, withdraw: false }, products: ['spot'], spot: true, futures: false, stocks: false,
      orderTypes: ['MARKET', 'LIMIT'], reduceOnly: false, hedgeMode: false, margin: false, cancelReplace: true,
      streaming: { market: false, account: false }, simulation: 'static_responses',
      operations: ['connect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getOrderHistory', 'getFills', 'previewOrder', 'submitOrder', 'cancelOrder', 'reconcileOrder'],
      restrictions: [COINBASE_STATIC_LABEL, 'Live Coinbase order broadcasting is disabled', 'Only Accounts and Orders endpoints exist in the sandbox'],
      verification: 'documented',
    }
  }
  getConnectionState() { return this.health }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.scenario) headers['X-Sandbox'] = this.scenario
    const r = await this.http.request({ method, url: `${this.opts.baseUrl ?? COINBASE_SANDBOX}${path}`, headers, body: body ? JSON.stringify(body) : undefined, authenticated: false })
    const b = r.body as { error?: string; message?: string; success?: boolean; error_response?: { error?: string; message?: string } } | null
    if (r.status >= 400 || b?.error) throw new HelmError(b?.error === 'INSUFFICIENT_FUND' ? 'INSUFFICIENT_BALANCE' : 'PROVIDER_ERROR', undefined, { provider: 'coinbase', providerCode: b?.error ?? String(r.status), detail: b?.message })
    return r.body as T
  }

  async connect(): Promise<ConnectionHealth> {
    try {
      const r = await this.call<{ accounts: unknown[] }>('GET', '/accounts')
      const ok = Array.isArray(r.accounts)
      // Static sandbox: there is no authenticated identity, so the best honest state is LIMITED.
      this.health = { state: ok ? 'LIMITED' : 'ERROR', reasons: ok ? [COINBASE_STATIC_LABEL] : ['Unexpected sandbox payload'], checkedAt: nowIso() }
    } catch (e) {
      this.health = { state: 'ERROR', reasons: [e instanceof HelmError ? e.code : 'PROVIDER_ERROR'], checkedAt: nowIso() }
    }
    return this.health
  }

  async getBalances(): Promise<Balance[]> {
    const r = await this.call<{ accounts: Array<{ currency: string; available_balance: { value: string }; hold: { value: string } }> }>('GET', '/accounts')
    const asOf = nowIso()
    return r.accounts.map(a => {
      const free = dec(a.available_balance.value), locked = dec(a.hold?.value ?? '0')
      return { accountId: this.opts.accountId, asset: a.currency, free, locked, total: free.plus(locked), asOf, source: 'coinbase' as const }
    })
  }

  async previewOrder(req: OrderRequest): Promise<OrderPreview> {
    const r = await this.call<{ order_total?: string; commission_total?: string; slippage?: string; quote_size?: string; base_size?: string; best_ask?: string; best_bid?: string; errs?: unknown[] }>('POST', '/orders/preview', { product_id: req.instrument.providerSymbol, side: req.side, order_configuration: coinbaseConfig(req) })
    const now = new Date()
    return {
      id: `cb-preview-${now.getTime()}`, request: req, estimatedPrice: decOrNull(req.side === 'BUY' ? r.best_ask : r.best_bid), estimatedNotional: decOrNull(r.order_total),
      estimatedFee: decOrNull(r.commission_total), estimatedSlippageBps: r.slippage ? dec(r.slippage).mul(10000) : null, requiredMargin: null, remainingBuyingPower: null,
      estimateNotes: [COINBASE_STATIC_LABEL], createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30_000).toISOString(), providerPreview: r,
    }
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const r = await this.call<{ success: boolean; success_response?: { order_id: string; client_order_id: string }; failure_reason?: string }>('POST', '/orders', { client_order_id: req.clientOrderId, product_id: req.instrument.providerSymbol, side: req.side, order_configuration: coinbaseConfig(req) })
    if (!r.success) throw new HelmError('ORDER_REJECTED', undefined, { provider: 'coinbase', providerCode: r.failure_reason })
    return {
      accountId: this.opts.accountId, provider: 'coinbase', instrumentId: req.instrument.id, providerOrderId: r.success_response?.order_id ?? null, clientOrderId: req.clientOrderId,
      side: req.side, type: req.type, timeInForce: null, quantity: req.quantity ?? null, quoteQuantity: req.quoteQuantity ?? null, price: req.price ?? null, stopPrice: null, reduceOnly: false,
      // A static sandbox "success" is a canned response: record it as ACCEPTED-static, never FILLED.
      status: 'ACCEPTED', filledQuantity: new Decimal(0), avgFillPrice: null, createdAt: nowIso(), updatedAt: nowIso(), simulatedStatic: true, raw: r,
    }
  }

  async getOrderHistory(_id: InstrumentId, limit = 50): Promise<Order[]> {
    const r = await this.call<{ orders: Array<{ order_id: string; client_order_id: string; product_id: string; side: 'BUY' | 'SELL'; status: string; filled_size: string; average_filled_price: string; created_time: string; order_type?: string }> }>('GET', `/orders/historical/batch?limit=${limit}`)
    return r.orders.map(o => {
      const [base, quote] = o.product_id.split('-') as [string, string]
      return {
        accountId: this.opts.accountId, provider: 'coinbase' as const, instrumentId: instrumentId({ provider: 'coinbase', product: 'spot', base, quote }), providerOrderId: o.order_id, clientOrderId: o.client_order_id,
        side: o.side, type: o.order_type === 'LIMIT' ? 'LIMIT' as const : 'MARKET' as const, timeInForce: null, quantity: null, quoteQuantity: null, price: null, stopPrice: null, reduceOnly: false,
        status: mapCoinbaseStatus(o.status), filledQuantity: dec(o.filled_size || '0'), avgFillPrice: decOrNull(o.average_filled_price), createdAt: o.created_time, updatedAt: o.created_time, simulatedStatic: true, raw: o,
      }
    })
  }

  async cancelOrder(id: InstrumentId, ids: { providerOrderId?: string }): Promise<Order> {
    const r = await this.call<{ results: Array<{ success: boolean; failure_reason: string; order_id: string }> }>('POST', '/orders/batch_cancel', { order_ids: [ids.providerOrderId] })
    const res = r.results[0]
    if (!res?.success) throw new HelmError('ORDER_REJECTED', undefined, { provider: 'coinbase', providerCode: res?.failure_reason })
    return { accountId: this.opts.accountId, provider: 'coinbase', instrumentId: id, providerOrderId: res.order_id, clientOrderId: '', side: 'BUY', type: 'LIMIT', timeInForce: null, quantity: null, quoteQuantity: null, price: null, stopPrice: null, reduceOnly: false, status: 'CANCELED', filledQuantity: new Decimal(0), avgFillPrice: null, createdAt: nowIso(), updatedAt: nowIso(), simulatedStatic: true, raw: r }
  }
}

function coinbaseConfig(req: OrderRequest): Record<string, unknown> {
  if (req.type === 'MARKET') {
    return { market_market_ioc: req.quoteQuantity && !req.quantity ? { quote_size: req.quoteQuantity.toFixed() } : { base_size: req.quantity?.toFixed() } }
  }
  if (req.type === 'LIMIT') return { limit_limit_gtc: { base_size: req.quantity?.toFixed(), limit_price: req.price?.toFixed(), post_only: false } }
  throw new HelmError('UNSUPPORTED_OPERATION', `Coinbase sandbox ${req.type} not enabled`, { provider: 'coinbase' })
}
