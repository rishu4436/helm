import {
  BaseAdapter, Decimal, HelmError, dec, decOrNull, deriveConnectionHealth, instrumentId,
  type AccountEquity, type Balance, type CapabilityManifest, type ConnectionHealth, type InstrumentId, type Order, type OrderRequest, type OrderStatus, type Position,
} from '@helm/shared'
import { GuardedHttp, nowIso, type FetchLike } from '../http'

/**
 * Interactive Brokers via the Client Portal Gateway running on the user's own machine
 * (https://localhost:5000). The user logs in to the gateway's own page with a PAPER account;
 * HELM never sees the brokerage password. The env guard only permits loopback hosts.
 */
export const IBKR_GATEWAY = 'https://localhost:5000/v1/api'

export function mapIbkrStatus(s: string): OrderStatus {
  switch (s) {
    case 'PendingSubmit': case 'PreSubmitted': case 'Submitted': case 'ApiPending': return 'ACCEPTED'
    case 'Filled': return 'FILLED'
    case 'Cancelled': case 'ApiCancelled': case 'PendingCancel': return 'CANCELED'
    case 'Inactive': return 'REJECTED'
    default: return 'UNKNOWN'
  }
}

/** Paper accounts at IBKR use the "DU" prefix (live individual accounts use "U"). */
export function isIbkrPaperAccountId(id: string): boolean {
  return /^DU\d+$/.test(id)
}

export interface IbkrReplyPrompt { replyId: string; messages: string[] }

export class IbkrGatewayAdapter extends BaseAdapter {
  readonly provider = 'ibkr' as const
  readonly http: GuardedHttp
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  private ibAccountId: string | null = null

  constructor(private readonly opts: { accountId: string; fetch?: FetchLike; baseUrl?: string }) {
    super()
    this.http = new GuardedHttp('ibkr', opts.fetch, 15_000)
  }

  getCapabilities(): CapabilityManifest {
    return {
      provider: 'ibkr', environment: 'paper', accountTypes: ['brokerage'],
      permissions: { read: this.health.state !== 'ERROR', trade: this.health.state === 'CONNECTED', withdraw: false },
      products: ['stock'], spot: false, futures: false, stocks: true, orderTypes: ['MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT'],
      reduceOnly: false, hedgeMode: false, margin: true, cancelReplace: true, streaming: { market: true, account: true }, simulation: 'paper_broker',
      operations: ['connect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getEquity', 'getPositions', 'getOpenOrders', 'submitOrder', 'cancelOrder', 'reconcileOrder'],
      restrictions: ['Requires the IBKR Client Portal Gateway running locally with a paper login', 'Gateway sessions expire; HELM keeps them alive with /tickle', 'Market data requires IBKR subscriptions', 'Order warnings (reply prompts) are shown to the user, never auto-confirmed'],
      verification: 'documented',
    }
  }
  getConnectionState() { return this.health }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, submitsOrder = false): Promise<T> {
    const r = await this.http.request({ method, url: `${this.opts.baseUrl ?? IBKR_GATEWAY}${path}`, headers: { 'Content-Type': 'application/json', 'User-Agent': 'HELM/0.1' }, body: body ? JSON.stringify(body) : undefined, authenticated: true, submitsOrder })
    if (r.status === 401) throw new HelmError('CONNECTION_EXPIRED', undefined, { provider: 'ibkr', providerCode: '401' })
    if (r.status >= 400) {
      const err = (r.body as { error?: string } | null)?.error ?? ''
      throw new HelmError(/insufficient/i.test(err) ? 'INSUFFICIENT_BALANCE' : 'PROVIDER_ERROR', undefined, { provider: 'ibkr', providerCode: String(r.status), detail: err })
    }
    return r.body as T
  }

  async connect(): Promise<ConnectionHealth> {
    try {
      const s = await this.call<{ authenticated: boolean; connected: boolean; competing: boolean }>('POST', '/iserver/auth/status')
      if (!s.authenticated) {
        this.health = { state: 'EXPIRED', reasons: ['Gateway is running but not logged in — open https://localhost:5000 and log in with your PAPER account'], checkedAt: nowIso() }
        return this.health
      }
      const accts = await this.call<{ accounts: string[]; isPaper?: boolean; selectedAccount?: string }>('GET', '/iserver/accounts')
      const ids = accts.accounts ?? []
      const allPaper = ids.length > 0 && ids.every(isIbkrPaperAccountId) && accts.isPaper !== false
      this.ibAccountId = accts.selectedAccount ?? ids[0] ?? null
      this.health = deriveConnectionHealth({ authenticatedReadOk: ids.length > 0, environmentVerified: allPaper, canRead: true, canTrade: !s.competing, excessivePermissions: false, error: allPaper ? undefined : 'Gateway session is not a paper account' })
      if (s.competing) this.health.reasons.push('Another session is competing for this login')
    } catch (e) {
      const code = e instanceof HelmError ? e.code : 'PROVIDER_ERROR'
      this.health = code === 'EXCHANGE_UNAVAILABLE'
        ? { state: 'DISCONNECTED', reasons: ['IBKR Client Portal Gateway not reachable on localhost:5000'], checkedAt: nowIso() }
        : deriveConnectionHealth({ authenticatedReadOk: false, environmentVerified: false, canRead: false, canTrade: false, excessivePermissions: false, error: code })
    }
    return this.health
  }

  /** Keep the gateway session alive (IBKR docs recommend ~1/min). */
  async tickle(): Promise<boolean> {
    const r = await this.call<{ iserver?: { authStatus?: { authenticated: boolean } } }>('POST', '/tickle')
    return r.iserver?.authStatus?.authenticated === true
  }

  private requirePaper(): string {
    if (!this.ibAccountId || !isIbkrPaperAccountId(this.ibAccountId)) throw new HelmError('ENVIRONMENT_MISMATCH', 'IBKR account is not a verified paper account', { provider: 'ibkr' })
    return this.ibAccountId
  }

  async getEquity(): Promise<AccountEquity> {
    const id = this.requirePaper()
    const s = await this.call<Record<string, { amount: number | string; currency?: string }>>('GET', `/portfolio/${id}/summary`)
    const v = (k: string) => (s[k] ? dec(String(s[k]!.amount)) : null)
    return { accountId: this.opts.accountId, currency: s.netliquidation?.currency ?? 'USD', equity: v('netliquidation'), availableBalance: v('buyingpower'), marginUsed: v('initmarginreq'), asOf: nowIso() }
  }

  async getBalances(): Promise<Balance[]> {
    const id = this.requirePaper()
    const s = await this.call<Record<string, { amount: number | string; currency?: string }>>('GET', `/portfolio/${id}/summary`)
    const cash = s.totalcashvalue
    return cash ? [{ accountId: this.opts.accountId, asset: cash.currency ?? 'USD', free: dec(String(cash.amount)), locked: new Decimal(0), total: dec(String(cash.amount)), asOf: nowIso(), source: 'ibkr' }] : []
  }

  async getPositions(): Promise<Position[]> {
    const id = this.requirePaper()
    const rows = await this.call<Array<{ conid: number; contractDesc: string; position: number; avgPrice: number; mktPrice: number; mktValue: number; unrealizedPnl: number; realizedPnl: number; currency: string; assetClass: string }>>('GET', `/portfolio/${id}/positions/0`)
    // IBKR returns JSON numbers; convert via String() immediately to avoid float arithmetic downstream.
    return rows.filter(p => p.assetClass === 'STK' && p.position !== 0).map(p => ({
      accountId: this.opts.accountId, instrumentId: instrumentId({ provider: 'ibkr', product: 'stock', base: p.contractDesc, quote: p.currency }), provider: 'ibkr' as const, product: 'stock' as const,
      side: p.position > 0 ? 'LONG' as const : 'SHORT' as const, quantity: dec(String(p.position)), entryPrice: dec(String(p.avgPrice)), markPrice: dec(String(p.mktPrice)), notional: dec(String(p.mktValue)),
      unrealizedPnl: dec(String(p.unrealizedPnl)), realizedPnl: dec(String(p.realizedPnl)), leverage: null, liquidationPrice: null, marginMode: null, positionMode: null, asOf: nowIso(), raw: p,
    }))
  }

  buildOrderBody(req: OrderRequest & { conid: number }) {
    const t = { MARKET: 'MKT', LIMIT: 'LMT', STOP_MARKET: 'STP', STOP_LIMIT: 'STOP_LIMIT' }[req.type as 'MARKET']
    if (!t) throw new HelmError('UNSUPPORTED_OPERATION', `IBKR ${req.type} not enabled`, { provider: 'ibkr' })
    if (!req.quantity) throw new HelmError('INVALID_QUANTITY', 'IBKR orders need a share quantity', { provider: 'ibkr' })
    return { orders: [{ conid: req.conid, orderType: t, side: req.side, quantity: Number(req.quantity.toFixed()), price: req.price ? Number(req.price.toFixed()) : undefined, auxPrice: req.stopPrice ? Number(req.stopPrice.toFixed()) : undefined, tif: req.timeInForce ?? 'DAY', cOID: req.clientOrderId }] }
  }

  /**
   * Submits a paper order. If IBKR answers with warning prompts, the order is returned as
   * AWAITING_CONFIRMATION with the prompts; only an explicit user action may call confirmReply.
   */
  async submitOrder(req: OrderRequest & { conid?: number }): Promise<Order> {
    const acct = this.requirePaper()
    const conid = req.conid ?? Number((req.instrument.raw as { conid?: number } | undefined)?.conid)
    if (!conid) throw new HelmError('INVALID_INSTRUMENT', 'IBKR conid required', { provider: 'ibkr' })
    const r = await this.call<Array<{ order_id?: string; order_status?: string; id?: string; message?: string[] }>>('POST', `/iserver/account/${acct}/orders`, this.buildOrderBody({ ...req, conid }), true)
    return this.handleOrderReply(r, req)
  }

  async confirmReply(replyId: string, req: OrderRequest): Promise<Order> {
    const r = await this.call<Array<{ order_id?: string; order_status?: string; id?: string; message?: string[] }>>('POST', `/iserver/reply/${encodeURIComponent(replyId)}`, { confirmed: true }, true)
    return this.handleOrderReply(r, req)
  }

  private handleOrderReply(r: Array<{ order_id?: string; order_status?: string; id?: string; message?: string[] }>, req: OrderRequest): Order {
    const first = r[0]
    const base: Order = { accountId: this.opts.accountId, provider: 'ibkr', instrumentId: req.instrument.id, providerOrderId: null, clientOrderId: req.clientOrderId, side: req.side, type: req.type, timeInForce: req.timeInForce ?? 'DAY', quantity: req.quantity ?? null, quoteQuantity: null, price: req.price ?? null, stopPrice: req.stopPrice ?? null, reduceOnly: false, status: 'UNKNOWN', filledQuantity: new Decimal(0), avgFillPrice: null, createdAt: nowIso(), updatedAt: nowIso(), raw: r }
    if (first?.id && first.message) return { ...base, status: 'AWAITING_CONFIRMATION', raw: { prompt: { replyId: first.id, messages: first.message } satisfies IbkrReplyPrompt } }
    if (first?.order_id) return { ...base, providerOrderId: first.order_id, status: mapIbkrStatus(first.order_status ?? '') }
    throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'ibkr' })
  }

  async cancelOrder(id: InstrumentId, ids: { providerOrderId?: string }): Promise<Order> {
    const acct = this.requirePaper()
    if (!ids.providerOrderId) throw new HelmError('ORDER_UNKNOWN', 'order id required', { provider: 'ibkr' })
    await this.call('DELETE', `/iserver/account/${acct}/order/${encodeURIComponent(ids.providerOrderId)}`)
    const o = await this.reconcileOrder(id, ids)
    if (!o) throw new HelmError('ORDER_UNKNOWN', undefined, { provider: 'ibkr' })
    return o
  }

  async reconcileOrder(id: InstrumentId, ids: { providerOrderId?: string }): Promise<Order | null> {
    if (!ids.providerOrderId) return null
    const s = await this.call<{ order_id: number; order_status: string; side: 'BUY' | 'SELL'; size: string; cum_fill: string; average_price?: string; order_type: string; limit_price?: string }>('GET', `/iserver/account/order/status/${encodeURIComponent(ids.providerOrderId)}`)
    if (!s?.order_id) return null
    return { accountId: this.opts.accountId, provider: 'ibkr', instrumentId: id, providerOrderId: String(s.order_id), clientOrderId: '', side: s.side, type: s.order_type === 'LIMIT' ? 'LIMIT' : 'MARKET', timeInForce: null, quantity: decOrNull(s.size), quoteQuantity: null, price: decOrNull(s.limit_price), stopPrice: null, reduceOnly: false, status: mapIbkrStatus(s.order_status), filledQuantity: dec(s.cum_fill || '0'), avgFillPrice: decOrNull(s.average_price), createdAt: nowIso(), updatedAt: nowIso(), raw: s }
  }

  async getOpenOrders(): Promise<Order[]> {
    const r = await this.call<{ orders: Array<{ orderId: number; ticker: string; side: 'BUY' | 'SELL'; totalSize: number; filledQuantity: number; status: string; orderType: string; price?: string }> }>('GET', '/iserver/account/orders')
    return (r.orders ?? []).map(o => ({ accountId: this.opts.accountId, provider: 'ibkr' as const, instrumentId: instrumentId({ provider: 'ibkr', product: 'stock', base: o.ticker, quote: 'USD' }), providerOrderId: String(o.orderId), clientOrderId: '', side: o.side, type: o.orderType === 'Limit' ? 'LIMIT' as const : 'MARKET' as const, timeInForce: null, quantity: dec(String(o.totalSize)), quoteQuantity: null, price: decOrNull(o.price), stopPrice: null, reduceOnly: false, status: mapIbkrStatus(o.status), filledQuantity: dec(String(o.filledQuantity)), avgFillPrice: null, createdAt: nowIso(), updatedAt: nowIso(), raw: o }))
  }
}
