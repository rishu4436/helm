import {
  BaseAdapter, Decimal, HelmError, SIMULATED_LABEL, dec, floorToStep, instrumentId, sum,
  type AccountEquity, type Balance, type CapabilityManifest, type ConnectionHealth, type Fill, type Instrument, type InstrumentId,
  type MarketSnapshot, type Order, type OrderBook, type OrderPreview, type OrderRequest, type Position, type SimVenue, type ValidationResult,
} from '@helm/shared'
import { nowIso } from '../http'

/**
 * HELM LOCAL SIMULATOR — environment `simulated`.
 *
 * Prices come from the venue's real public market data (order book). Fills are computed locally by
 * HELM by walking that book; nothing is ever sent to an exchange. Every Order/Fill carries
 * simulatedLocal: true and every UI labels it SIMULATED. This exists so the full HELM trade flow can be
 * exercised end-to-end before the user's demo keys arrive. It is never presented as a real fill.
 *
 * Simplifications (documented, deliberate):
 *  - Perps are quantity-in-base, one-way mode, linear USDT-settled, isolated margin = notional / leverage.
 *  - Fees: spot 0.10%, perp 0.05% taker (typical published retail tiers; assumption, not venue truth).
 *  - Resting LIMIT/STOP orders are evaluated against the current book whenever the account is read.
 */

export interface SimPosition { instrumentId: InstrumentId; qty: string; entry: string; leverage: string; margin: string; realized: string }
export interface SimOrder {
  id: string; clientOrderId: string; instrumentId: InstrumentId; side: 'BUY' | 'SELL'; type: Order['type']
  quantity: string | null; quoteQuantity: string | null; price: string | null; stopPrice: string | null; reduceOnly: boolean; leverage: string | null
  status: Order['status']; filledQty: string; avgPrice: string | null; createdAt: string; updatedAt: string; reason?: string
}
export interface SimFill { id: string; orderId: string; instrumentId: InstrumentId; side: 'BUY' | 'SELL'; price: string; qty: string; fee: string; feeAsset: string; at: string }
export interface SimLedgerState { venue: SimVenue; balances: Record<string, string>; locked: Record<string, string>; positions: SimPosition[]; orders: SimOrder[]; fills: SimFill[]; seq: number; seededAt: string }

export interface SimStore { load(): Promise<SimLedgerState | null>; save(s: SimLedgerState): Promise<void> }
export interface MarketSource { getOrderBook(id: InstrumentId, depth?: number): Promise<OrderBook> }

export const SIM_SEED_BALANCES: Record<string, string> = { USDT: '10000', BTC: '0.05', ETH: '0.8' }
export const SIM_FEES = { spot: dec('0.001'), perp: dec('0.0005') }
const ASSETS = ['BTC', 'ETH', 'SOL'] as const
const SPECS: Record<string, { lot: string; tick: string; minNotional: string }> = { BTC: { lot: '0.00001', tick: '0.01', minNotional: '5' }, ETH: { lot: '0.0001', tick: '0.01', minNotional: '5' }, SOL: { lot: '0.001', tick: '0.01', minNotional: '5' } }

export function simInstruments(venue: SimVenue): Instrument[] {
  const out: Instrument[] = []
  for (const a of ASSETS) {
    const s = SPECS[a]!
    for (const product of ['spot', 'perp'] as const) {
      const id = instrumentId({ provider: venue, product, base: a, quote: 'USDT', settle: product === 'perp' ? 'USDT' : undefined })
      const providerSymbol = venue === 'okx' ? (product === 'perp' ? `${a}-USDT-SWAP` : `${a}-USDT`) : `${a}USDT`
      out.push({ id, provider: venue, providerSymbol, product, base: a, quote: 'USDT', settle: product === 'perp' ? 'USDT' : undefined, contractMultiplier: dec(1), quantityUnit: 'base', lotSize: dec(s.lot), minQty: dec(s.lot), minNotional: dec(s.minNotional), tickSize: dec(s.tick), venue: `${venue} (simulated)`, currency: 'USDT', tradingHours: 'continuous', status: 'trading' })
    }
  }
  return out
}

export function seedLedger(venue: SimVenue, now = nowIso()): SimLedgerState {
  return { venue, balances: { ...SIM_SEED_BALANCES }, locked: {}, positions: [], orders: [], fills: [], seq: 0, seededAt: now }
}

export class MemorySimStore implements SimStore {
  constructor(public state: SimLedgerState | null = null) {}
  async load() { return this.state ? structuredClone(this.state) : null }
  async save(s: SimLedgerState) { this.state = structuredClone(s) }
}

export class SimulatedAdapter extends BaseAdapter {
  readonly provider: SimVenue
  private health: ConnectionHealth = { state: 'DISCONNECTED', reasons: [], checkedAt: nowIso() }
  private readonly instruments: Instrument[]

  constructor(private readonly opts: { venue: SimVenue; accountId: string; market: MarketSource; store: SimStore; now?: () => Date }) {
    super()
    this.provider = opts.venue
    this.instruments = simInstruments(opts.venue)
  }

  private now() { return (this.opts.now ?? (() => new Date()))() }

  getCapabilities(): CapabilityManifest {
    return {
      provider: this.provider, environment: 'simulated', accountTypes: ['unified'],
      permissions: { read: true, trade: true, withdraw: false }, products: ['spot', 'perp'], spot: true, futures: true, stocks: false,
      orderTypes: ['MARKET', 'LIMIT', 'STOP_MARKET'], reduceOnly: true, hedgeMode: false, margin: true, cancelReplace: false,
      streaming: { market: false, account: false }, simulation: 'local_simulation',
      operations: ['connect', 'getConnectionState', 'getCapabilities', 'getBalances', 'getEquity', 'getPositions', 'getOpenOrders', 'getOrderHistory', 'getFills', 'getMarketSnapshot', 'getOrderBook', 'getInstruments', 'validateOrder', 'previewOrder', 'submitOrder', 'cancelOrder', 'reconcileOrder', 'setLeverage'],
      restrictions: [SIMULATED_LABEL, 'Perps: one-way, linear USDT, isolated margin model', 'Fees are assumed tiers, not venue truth'],
      verification: 'documented',
    }
  }
  getConnectionState() { return this.health }

  async connect(): Promise<ConnectionHealth> {
    try {
      await this.ledger()
      await this.opts.market.getOrderBook(this.instruments[0]!.id, 1)
      this.health = { state: 'LIMITED', reasons: [SIMULATED_LABEL], checkedAt: nowIso() }
    } catch (e) {
      this.health = { state: 'ERROR', reasons: [`Public market data unavailable: ${e instanceof HelmError ? e.code : 'PROVIDER_ERROR'}`], checkedAt: nowIso() }
    }
    return this.health
  }

  // ---------- ledger ----------
  private async ledger(): Promise<SimLedgerState> {
    const s = await this.opts.store.load()
    if (s) return s
    const seeded = seedLedger(this.opts.venue, this.now().toISOString())
    await this.opts.store.save(seeded)
    return seeded
  }
  private instrument(id: InstrumentId): Instrument {
    const i = this.instruments.find(x => x.id === id)
    if (!i) throw new HelmError('INVALID_INSTRUMENT', `Simulator does not list ${id}`, { provider: this.provider })
    return i
  }
  private nextId(s: SimLedgerState, p: string) { s.seq += 1; return `SIM-${p}-${String(s.seq).padStart(6, '0')}` }

  /** Evaluate resting LIMIT / STOP orders against the live book. Returns true if anything changed. */
  private async evaluateResting(s: SimLedgerState): Promise<boolean> {
    let changed = false
    for (const o of s.orders.filter(x => x.status === 'ACCEPTED')) {
      const book = await this.opts.market.getOrderBook(o.instrumentId, 20)
      const bid = book.bids[0]?.price, ask = book.asks[0]?.price
      if (!bid || !ask) continue
      if (o.type === 'LIMIT') {
        const px = dec(o.price!)
        const crosses = o.side === 'BUY' ? ask.lte(px) : bid.gte(px)
        if (crosses) { this.unlock(s, o); this.execute(s, o, [{ price: px, quantity: dec(o.quantity!) }]); changed = true }
      } else if (o.type === 'STOP_MARKET') {
        const sp = dec(o.stopPrice!)
        const triggered = o.side === 'SELL' ? bid.lte(sp) : ask.gte(sp)
        if (triggered) { this.walkAndExecute(s, o, book); changed = true }
      }
    }
    return changed
  }

  private unlock(s: SimLedgerState, o: SimOrder) {
    const i = this.instrument(o.instrumentId)
    if (i.product !== 'spot' || o.type !== 'LIMIT') return
    const asset = o.side === 'BUY' ? i.quote : i.base
    const amt = o.side === 'BUY' ? dec(o.quantity!).mul(o.price!).mul(dec(1).plus(SIM_FEES.spot)) : dec(o.quantity!)
    s.locked[asset] = dec(s.locked[asset] ?? '0').minus(amt).toFixed()
    s.balances[asset] = dec(s.balances[asset] ?? '0').plus(amt).toFixed()
  }

  private walk(book: OrderBook, side: 'BUY' | 'SELL', i: Instrument, qty?: Decimal, quote?: Decimal): Array<{ price: Decimal; quantity: Decimal }> {
    const levels = side === 'BUY' ? book.asks : book.bids
    const out: Array<{ price: Decimal; quantity: Decimal }> = []
    let remQty = qty ?? null, remQuote = quote ?? null
    for (const l of levels) {
      if ((remQty && remQty.lte(0)) || (remQuote && remQuote.lte(0))) break
      let take = l.quantity
      if (remQty) take = Decimal.min(take, remQty)
      if (remQuote) take = Decimal.min(take, floorToStep(remQuote.div(l.price), i.lotSize))
      if (take.lte(0)) break
      out.push({ price: l.price, quantity: take })
      if (remQty) remQty = remQty.minus(take)
      if (remQuote) remQuote = remQuote.minus(take.mul(l.price))
    }
    const filled = sum(out.map(x => x.quantity))
    if (qty && filled.lt(qty)) throw new HelmError('EXCHANGE_UNAVAILABLE', 'Not enough public book depth to simulate this fill', { provider: this.provider })
    return out
  }

  private walkAndExecute(s: SimLedgerState, o: SimOrder, book: OrderBook) {
    const i = this.instrument(o.instrumentId)
    try {
      const legs = this.walk(book, o.side, i, o.quantity ? dec(o.quantity) : undefined, o.quoteQuantity ? dec(o.quoteQuantity).div(dec(1).plus(i.product === 'spot' ? SIM_FEES.spot : SIM_FEES.perp)) : undefined)
      this.execute(s, o, legs)
    } catch (e) {
      o.status = 'REJECTED'; o.reason = e instanceof HelmError ? e.code : 'PROVIDER_ERROR'; o.updatedAt = this.now().toISOString()
    }
  }

  /** Apply fills to balances/positions. Throws nothing: rejects the order on insufficient funds. */
  private execute(s: SimLedgerState, o: SimOrder, legs: Array<{ price: Decimal; quantity: Decimal }>) {
    const i = this.instrument(o.instrumentId)
    const qty = sum(legs.map(l => l.quantity))
    if (qty.lte(0)) { o.status = 'REJECTED'; o.reason = 'INVALID_QUANTITY'; return }
    const notional = sum(legs.map(l => l.price.mul(l.quantity)))
    const avg = notional.div(qty)
    const feeRate = i.product === 'spot' ? SIM_FEES.spot : SIM_FEES.perp
    const fee = notional.mul(feeRate)
    const bal = (a: string) => dec(s.balances[a] ?? '0')
    const at = this.now().toISOString()

    if (i.product === 'spot') {
      if (o.side === 'BUY') {
        if (bal(i.quote).lt(notional.plus(fee))) { o.status = 'REJECTED'; o.reason = 'INSUFFICIENT_BALANCE'; o.updatedAt = at; return }
        s.balances[i.quote] = bal(i.quote).minus(notional).minus(fee).toFixed()
        s.balances[i.base] = bal(i.base).plus(qty).toFixed()
      } else {
        if (bal(i.base).lt(qty)) { o.status = 'REJECTED'; o.reason = 'INSUFFICIENT_BALANCE'; o.updatedAt = at; return }
        s.balances[i.base] = bal(i.base).minus(qty).toFixed()
        s.balances[i.quote] = bal(i.quote).plus(notional).minus(fee).toFixed()
      }
    } else {
      const lev = dec(o.leverage ?? '2')
      const signed = o.side === 'BUY' ? qty : qty.neg()
      let p = s.positions.find(x => x.instrumentId === i.id)
      const cur = p ? dec(p.qty) : dec(0)
      if (o.reduceOnly && (cur.isZero() || cur.isPositive() === signed.isPositive() || qty.gt(cur.abs()))) {
        o.status = 'REJECTED'; o.reason = 'Reduce-only order would increase or flip the position'; o.updatedAt = at; return
      }
      const reducing = !cur.isZero() && cur.isPositive() !== signed.isPositive()
      if (reducing) {
        const closeQty = Decimal.min(qty, cur.abs())
        const entry = dec(p!.entry)
        const pnl = cur.isPositive() ? avg.minus(entry).mul(closeQty) : entry.minus(avg).mul(closeQty)
        const release = dec(p!.margin).mul(closeQty).div(cur.abs())
        s.balances.USDT = bal('USDT').plus(release).plus(pnl).minus(fee).toFixed()
        const left = cur.plus(signed)
        if (left.isZero() || left.isPositive() !== cur.isPositive()) {
          // Flip beyond zero is impossible here for reduceOnly; for plain orders open the remainder.
          s.positions = s.positions.filter(x => x !== p)
          if (!left.isZero()) {
            const m = left.abs().mul(avg).div(lev)
            if (bal('USDT').lt(m)) { o.status = 'REJECTED'; o.reason = 'INSUFFICIENT_MARGIN'; o.updatedAt = at; return }
            s.balances.USDT = bal('USDT').minus(m).toFixed()
            s.positions.push({ instrumentId: i.id, qty: left.toFixed(), entry: avg.toFixed(), leverage: lev.toFixed(), margin: m.toFixed(), realized: pnl.toFixed() })
          }
        } else {
          p!.qty = left.toFixed(); p!.margin = dec(p!.margin).minus(release).toFixed(); p!.realized = dec(p!.realized).plus(pnl).toFixed()
        }
      } else {
        const m = notional.div(lev)
        if (bal('USDT').lt(m.plus(fee))) { o.status = 'REJECTED'; o.reason = 'INSUFFICIENT_MARGIN'; o.updatedAt = at; return }
        s.balances.USDT = bal('USDT').minus(m).minus(fee).toFixed()
        if (p) {
          const nq = cur.plus(signed)
          p.entry = dec(p.entry).mul(cur.abs()).plus(avg.mul(qty)).div(nq.abs()).toFixed()
          p.qty = nq.toFixed(); p.margin = dec(p.margin).plus(m).toFixed()
        } else {
          p = { instrumentId: i.id, qty: signed.toFixed(), entry: avg.toFixed(), leverage: lev.toFixed(), margin: m.toFixed(), realized: '0' }
          s.positions.push(p)
        }
      }
    }
    for (const l of legs) {
      s.fills.push({ id: this.nextId(s, 'T'), orderId: o.id, instrumentId: i.id, side: o.side, price: l.price.toFixed(), qty: l.quantity.toFixed(), fee: l.price.mul(l.quantity).mul(feeRate).toFixed(), feeAsset: 'USDT', at })
    }
    o.status = 'FILLED'; o.filledQty = qty.toFixed(); o.avgPrice = avg.toFixed(); o.updatedAt = at
  }

  private toOrder(o: SimOrder): Order {
    return {
      accountId: this.opts.accountId, provider: this.provider, instrumentId: o.instrumentId, providerOrderId: o.id, clientOrderId: o.clientOrderId,
      side: o.side, type: o.type, timeInForce: o.type === 'MARKET' ? 'IOC' : 'GTC', quantity: o.quantity ? dec(o.quantity) : null, quoteQuantity: o.quoteQuantity ? dec(o.quoteQuantity) : null,
      price: o.price ? dec(o.price) : null, stopPrice: o.stopPrice ? dec(o.stopPrice) : null, reduceOnly: o.reduceOnly, status: o.status, filledQuantity: dec(o.filledQty),
      avgFillPrice: o.avgPrice ? dec(o.avgPrice) : null, createdAt: o.createdAt, updatedAt: o.updatedAt, simulatedLocal: true, raw: { simulated: true, reason: o.reason ?? null },
    }
  }

  // ---------- reads ----------
  async getInstruments(product?: Instrument['product']) { return this.instruments.filter(i => !product || i.product === product) }
  async getOrderBook(id: InstrumentId, depth = 20) { this.instrument(id); return this.opts.market.getOrderBook(id, depth) }
  async getMarketSnapshot(id: InstrumentId): Promise<MarketSnapshot> {
    const b = await this.getOrderBook(id, 5)
    const bid = b.bids[0]?.price ?? null, ask = b.asks[0]?.price ?? null
    return { provider: this.provider, instrumentId: id, bid, ask, last: bid && ask ? bid.plus(ask).div(2) : null, volume24h: null, timestamp: b.timestamp, receivedAt: b.receivedAt }
  }

  private async read(): Promise<SimLedgerState> {
    const s = await this.ledger()
    if (await this.evaluateResting(s)) await this.opts.store.save(s)
    return s
  }

  async getBalances(): Promise<Balance[]> {
    const s = await this.read()
    const asOf = nowIso()
    const assets = new Set([...Object.keys(s.balances), ...Object.keys(s.locked)])
    return [...assets].map(a => {
      const free = dec(s.balances[a] ?? '0'), locked = dec(s.locked[a] ?? '0')
      return { accountId: this.opts.accountId, asset: a, free, locked, total: free.plus(locked), asOf, source: this.provider }
    }).filter(b => !b.total.isZero())
  }

  async getPositions(): Promise<Position[]> {
    const s = await this.read()
    const out: Position[] = []
    for (const p of s.positions) {
      const snap = await this.getMarketSnapshot(p.instrumentId)
      const q = dec(p.qty), entry = dec(p.entry), mark = snap.last
      const upnl = mark ? mark.minus(entry).mul(q) : null
      const lev = dec(p.leverage)
      // Isolated linear, maintenance margin ignored → indicative only; labelled as estimate in previews.
      const liq = q.isPositive() ? entry.mul(dec(1).minus(dec(1).div(lev))) : entry.mul(dec(1).plus(dec(1).div(lev)))
      out.push({ accountId: this.opts.accountId, instrumentId: p.instrumentId, provider: this.provider, product: 'perp', side: q.isPositive() ? 'LONG' : 'SHORT', quantity: q, entryPrice: entry, markPrice: mark, notional: mark ? mark.mul(q.abs()) : null, unrealizedPnl: upnl, realizedPnl: dec(p.realized), leverage: lev, liquidationPrice: liq, marginMode: 'isolated', positionMode: 'one_way', isolatedMargin: dec(p.margin), asOf: nowIso(), raw: { simulated: true } })
    }
    return out
  }

  async getEquity(): Promise<AccountEquity> {
    const s = await this.read()
    const positions = await this.getPositions()
    const usdt = dec(s.balances.USDT ?? '0')
    const margin = sum(s.positions.map(p => dec(p.margin)))
    const upnl = sum(positions.map(p => p.unrealizedPnl ?? dec(0)))
    return { accountId: this.opts.accountId, currency: 'USDT', equity: usdt.plus(margin).plus(upnl), availableBalance: usdt, marginUsed: margin, asOf: nowIso() }
  }

  async getOpenOrders(id?: InstrumentId) { const s = await this.read(); return s.orders.filter(o => o.status === 'ACCEPTED' && (!id || o.instrumentId === id)).map(o => this.toOrder(o)) }
  async getOrderHistory(id?: InstrumentId, limit = 50) { const s = await this.read(); return s.orders.filter(o => !id || o.instrumentId === id).slice(-limit).reverse().map(o => this.toOrder(o)) }
  async getFills(id?: InstrumentId, limit = 50): Promise<Fill[]> {
    const s = await this.read()
    return s.fills.filter(f => !id || f.instrumentId === id).slice(-limit).reverse().map(f => ({ accountId: this.opts.accountId, provider: this.provider, instrumentId: f.instrumentId, providerOrderId: f.orderId, providerTradeId: f.id, side: f.side, price: dec(f.price), quantity: dec(f.qty), fee: dec(f.fee), feeAsset: f.feeAsset, isMaker: false, timestamp: f.at, simulatedLocal: true }))
  }

  // ---------- trading ----------
  async validateOrder(req: OrderRequest): Promise<ValidationResult> {
    const problems: string[] = []
    const i = this.instrument(req.instrument.id)
    if (!this.getCapabilities().orderTypes.includes(req.type)) problems.push(`${req.type} is not supported by the simulator`)
    if (req.quantity && !floorToStep(req.quantity, i.lotSize).eq(req.quantity)) problems.push(`Quantity must be a multiple of ${i.lotSize.toFixed()}`)
    if (req.quantity && req.quantity.lt(i.minQty)) problems.push(`Minimum quantity ${i.minQty.toFixed()}`)
    if (req.price && !floorToStep(req.price, i.tickSize).eq(req.price)) problems.push(`Price must be a multiple of ${i.tickSize.toFixed()}`)
    if (!req.quantity && !req.quoteQuantity) problems.push('Quantity or notional required')
    if (req.quoteQuantity && i.product !== 'spot') problems.push('Notional orders are spot-only in the simulator; HELM converts perps to quantity')
    if (req.reduceOnly && i.product === 'spot') problems.push('Reduce-only applies to perps only')
    return { ok: problems.length === 0, problems }
  }

  async previewOrder(req: OrderRequest): Promise<OrderPreview> {
    const i = this.instrument(req.instrument.id)
    const book = await this.opts.market.getOrderBook(i.id, 50)
    const feeRate = i.product === 'spot' ? SIM_FEES.spot : SIM_FEES.perp
    let legs: Array<{ price: Decimal; quantity: Decimal }> = []
    const notes = [SIMULATED_LABEL, `Fee assumption ${feeRate.mul(100).toFixed()}% taker`]
    if (req.type === 'MARKET') legs = this.walk(book, req.side, i, req.quantity, req.quoteQuantity?.div(dec(1).plus(feeRate)))
    else if (req.quantity && req.price) legs = [{ price: req.price, quantity: req.quantity }]
    const qty = sum(legs.map(l => l.quantity))
    const notional = sum(legs.map(l => l.price.mul(l.quantity)))
    const avg = qty.gt(0) ? notional.div(qty) : null
    const top = req.side === 'BUY' ? book.asks[0]?.price : book.bids[0]?.price
    const slip = avg && top ? avg.minus(top).abs().div(top).mul(10000) : null
    const eq = await this.getEquity()
    const lev = req.leverage ?? dec(2)
    const margin = i.product === 'perp' ? notional.div(lev) : null
    const fee = notional.mul(feeRate)
    const now = this.now()
    notes.push(`Book snapshot ${book.timestamp} (${book.asks.length} ask / ${book.bids.length} bid levels)`)
    return {
      id: `sim-preview-${now.getTime()}`, request: { ...req, quantity: req.quantity ?? (qty.gt(0) ? qty : undefined) }, estimatedPrice: avg, estimatedNotional: notional, estimatedFee: fee, estimatedSlippageBps: slip,
      requiredMargin: margin, remainingBuyingPower: eq.availableBalance ? eq.availableBalance.minus(margin ?? (req.side === 'BUY' ? notional.plus(fee) : dec(0))) : null,
      estimateNotes: notes, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 45_000).toISOString(), providerPreview: { simulated: true, legs: legs.map(l => ({ price: l.price.toFixed(), qty: l.quantity.toFixed() })) },
    }
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const s = await this.ledger()
    const dup = s.orders.find(o => o.clientOrderId === req.clientOrderId)
    if (dup) return this.toOrder(dup) // idempotent on clientOrderId, like real venues
    const v = await this.validateOrder(req)
    const at = this.now().toISOString()
    const o: SimOrder = {
      id: this.nextId(s, 'O'), clientOrderId: req.clientOrderId, instrumentId: req.instrument.id, side: req.side, type: req.type,
      quantity: req.quantity?.toFixed() ?? null, quoteQuantity: req.quoteQuantity?.toFixed() ?? null, price: req.price?.toFixed() ?? null, stopPrice: req.stopPrice?.toFixed() ?? null,
      reduceOnly: !!req.reduceOnly, leverage: req.leverage?.toFixed() ?? null, status: 'ACCEPTED', filledQty: '0', avgPrice: null, createdAt: at, updatedAt: at,
    }
    s.orders.push(o)
    if (!v.ok) { o.status = 'REJECTED'; o.reason = v.problems.join('; ') }
    else if (req.type === 'MARKET') this.walkAndExecute(s, o, await this.opts.market.getOrderBook(req.instrument.id, 50))
    else if (req.type === 'LIMIT' && this.instrument(req.instrument.id).product === 'spot') {
      const i = this.instrument(req.instrument.id)
      const asset = req.side === 'BUY' ? i.quote : i.base
      const amt = req.side === 'BUY' ? req.quantity!.mul(req.price!).mul(dec(1).plus(SIM_FEES.spot)) : req.quantity!
      if (dec(s.balances[asset] ?? '0').lt(amt)) { o.status = 'REJECTED'; o.reason = 'INSUFFICIENT_BALANCE' }
      else { s.balances[asset] = dec(s.balances[asset] ?? '0').minus(amt).toFixed(); s.locked[asset] = dec(s.locked[asset] ?? '0').plus(amt).toFixed() }
    } else if (req.type === 'STOP_MARKET') {
      const p = s.positions.find(x => x.instrumentId === req.instrument.id)
      const i = this.instrument(req.instrument.id)
      if (i.product === 'perp' && (!p || !req.reduceOnly)) { o.status = 'REJECTED'; o.reason = 'Simulator stops must be reduce-only protection for an open perp position' }
      if (i.product === 'spot' && (req.side !== 'SELL' || dec(s.balances[i.base] ?? '0').lt(req.quantity!))) { o.status = 'REJECTED'; o.reason = 'Spot stop must be a SELL covered by free balance' }
    }
    await this.opts.store.save(s)
    return this.toOrder(o)
  }

  async cancelOrder(_id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order> {
    const s = await this.ledger()
    const o = s.orders.find(x => (ids.providerOrderId && x.id === ids.providerOrderId) || (ids.clientOrderId && x.clientOrderId === ids.clientOrderId))
    if (!o) throw new HelmError('ORDER_REJECTED', 'Unknown order', { provider: this.provider, providerCode: 'NOT_FOUND' })
    if (o.status !== 'ACCEPTED') throw new HelmError('ORDER_REJECTED', `Order is ${o.status}`, { provider: this.provider })
    this.unlock(s, o)
    o.status = 'CANCELED'; o.updatedAt = this.now().toISOString()
    await this.opts.store.save(s)
    return this.toOrder(o)
  }

  async reconcileOrder(_id: InstrumentId, ids: { providerOrderId?: string; clientOrderId?: string }): Promise<Order | null> {
    const s = await this.read()
    const o = s.orders.find(x => (ids.providerOrderId && x.id === ids.providerOrderId) || (ids.clientOrderId && x.clientOrderId === ids.clientOrderId))
    return o ? this.toOrder(o) : null
  }

  async setLeverage(id: InstrumentId, leverage: Decimal): Promise<void> {
    if (this.instrument(id).product !== 'perp') throw new HelmError('UNSUPPORTED_OPERATION', 'Leverage applies to perps', { provider: this.provider })
    if (!leverage.isInteger() || leverage.lt(1) || leverage.gt(20)) throw new HelmError('INVALID_QUANTITY', 'Simulator leverage must be a whole number 1–20', { provider: this.provider })
  }
}

