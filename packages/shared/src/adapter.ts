import { CapabilityError } from './errors'
import type { CapabilityManifest, AdapterOperation } from './capabilities'
import type { ConnectionHealth } from './connection'
import type { Balance, Fill, MarketSnapshot, Order, OrderBook, OrderPreview, OrderRequest, Position } from './domain'
import type { Instrument, InstrumentId } from './instruments'
import type { ProviderId } from './providers'
import type { Decimal } from './decimal'

export interface AccountEquity { accountId: string; currency: string; equity: Decimal | null; availableBalance: Decimal | null; marginUsed: Decimal | null; asOf: string }
export interface ValidationResult { ok: boolean; problems: string[]; adjusted?: Partial<OrderRequest> }
export interface Unsubscribe { (): void }

/**
 * The unified HELM adapter contract. Each provider implements what it genuinely supports;
 * everything else throws CapabilityError (never a silent substitute).
 */
export interface ExchangeAdapter {
  readonly provider: ProviderId
  connect(): Promise<ConnectionHealth>
  disconnect(): Promise<void>
  getConnectionState(): ConnectionHealth
  getCapabilities(): CapabilityManifest

  getBalances(): Promise<Balance[]>
  getEquity(): Promise<AccountEquity>
  getPositions(): Promise<Position[]>
  getOpenOrders(instrumentId?: InstrumentId): Promise<Order[]>
  getOrderHistory(instrumentId: InstrumentId, limit?: number): Promise<Order[]>
  getFills(instrumentId: InstrumentId, limit?: number): Promise<Fill[]>

  getMarketSnapshot(instrumentId: InstrumentId): Promise<MarketSnapshot>
  getOrderBook(instrumentId: InstrumentId, depth?: number): Promise<OrderBook>
  getInstruments(product?: Instrument['product']): Promise<Instrument[]>

  validateOrder(req: OrderRequest): Promise<ValidationResult>
  previewOrder(req: OrderRequest): Promise<OrderPreview>
  submitOrder(req: OrderRequest): Promise<Order>
  cancelOrder(instrumentId: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order>
  amendOrder(instrumentId: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }, changes: { quantity?: Decimal; price?: Decimal }): Promise<Order>
  /** Query provider truth for an order (used after timeouts before any retry). */
  reconcileOrder(instrumentId: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null>
  setLeverage(instrumentId: InstrumentId, leverage: Decimal): Promise<void>

  subscribeAccount(onEvent: (e: unknown) => void): Promise<Unsubscribe>
  subscribeMarket(instrumentIds: InstrumentId[], onEvent: (e: MarketSnapshot) => void): Promise<Unsubscribe>
}

/** Base class: every operation is unsupported until a connector overrides it. */
export abstract class BaseAdapter implements ExchangeAdapter {
  abstract readonly provider: ProviderId
  abstract getCapabilities(): CapabilityManifest
  abstract connect(): Promise<ConnectionHealth>
  abstract getConnectionState(): ConnectionHealth

  protected unsupported(op: AdapterOperation | string): never {
    throw new CapabilityError(this.provider, op)
  }

  async disconnect(): Promise<void> { /* stateless REST by default */ }
  async getBalances(): Promise<Balance[]> { return this.unsupported('getBalances') }
  async getEquity(): Promise<AccountEquity> { return this.unsupported('getEquity') }
  async getPositions(): Promise<Position[]> { return this.unsupported('getPositions') }
  async getOpenOrders(_i?: InstrumentId): Promise<Order[]> { return this.unsupported('getOpenOrders') }
  async getOrderHistory(_i: InstrumentId, _l?: number): Promise<Order[]> { return this.unsupported('getOrderHistory') }
  async getFills(_i: InstrumentId, _l?: number): Promise<Fill[]> { return this.unsupported('getFills') }
  async getMarketSnapshot(_i: InstrumentId): Promise<MarketSnapshot> { return this.unsupported('getMarketSnapshot') }
  async getOrderBook(_i: InstrumentId, _d?: number): Promise<OrderBook> { return this.unsupported('getOrderBook') }
  async getInstruments(_p?: Instrument['product']): Promise<Instrument[]> { return this.unsupported('getInstruments') }
  async validateOrder(_r: OrderRequest): Promise<ValidationResult> { return this.unsupported('validateOrder') }
  async previewOrder(_r: OrderRequest): Promise<OrderPreview> { return this.unsupported('previewOrder') }
  async submitOrder(_r: OrderRequest): Promise<Order> { return this.unsupported('submitOrder') }
  async cancelOrder(_i: InstrumentId, _ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order> { return this.unsupported('cancelOrder') }
  async amendOrder(_i: InstrumentId, _ids: { providerOrderId?: string; clientOrderId?: string }, _c: { quantity?: Decimal; price?: Decimal }): Promise<Order> { return this.unsupported('amendOrder') }
  async reconcileOrder(_i: InstrumentId, _ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null> { return this.unsupported('reconcileOrder') }
  async setLeverage(_i: InstrumentId, _l: Decimal): Promise<void> { return this.unsupported('setLeverage') }
  async subscribeAccount(_cb: (e: unknown) => void): Promise<Unsubscribe> { return this.unsupported('subscribeAccount') }
  async subscribeMarket(_ids: InstrumentId[], _cb: (e: MarketSnapshot) => void): Promise<Unsubscribe> { return this.unsupported('subscribeMarket') }
}
