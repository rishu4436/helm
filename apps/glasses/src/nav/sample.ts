/**
 * SampleBackend — SIMULATED SAMPLE DATA computed locally (landing-page demo + onboarding practice).
 * It never calls the HELM API or any exchange; every account, preview and receipt is labelled SAMPLE / PRACTICE.
 */
import type { PreviewResp, Receipt, Ticket } from '../api'
import type { Acct, ActivityItem, ActivityPayload, PHolding, PortfolioPayload, POrder, PPosition, Prefs, Snapshot, VenueQuote, WatchItem } from '../ux/types'
import { DEFAULT_PREFS, withDefaults } from '../ux/types'
import { isLong, posKey, sym } from '../ux/model'
import type { HelmBackend, VoiceContext, VoiceResult } from './backend'
import { resolveVoiceLocally } from './voice-local'

export const SAMPLE_PX: Record<string, number> = { BTC: 59420, ETH: 1656, SOL: 92.4, BNB: 610 }
const LABEL = 'SIMULATED SAMPLE DATA · nothing is sent'

export class SampleBackend implements HelmBackend {
  readonly canExecute = true
  private seq = 0
  private prefsState: Prefs
  private accts: Acct[]
  private positions: PPosition[]
  private orders: POrder[]
  private holdings: PHolding[]
  private receiptsList: Receipt[] = []
  private acked = new Set<string>()
  private dismissed = new Set<string>()
  private previews = new Map<string, { p: PreviewResp; t: Ticket | null; used: boolean }>()

  constructor(readonly kind: 'sample' | 'practice' = 'sample', prefs?: Partial<Prefs>, private readonly clock: () => number = () => Date.now()) {
    const tag = kind === 'practice' ? 'practice' : 'sample'
    this.prefsState = withDefaults({ ...DEFAULT_PREFS, mode: 'beginner', onboarding: { completedAt: kind === 'sample' ? new Date(0).toISOString() : null, skippedAt: null, stage: null }, ...prefs })
    const mk = (id: string, alias: string, provider: string): Acct => ({ id, alias: `${alias} (${tag})`, provider, environment: 'simulated', environmentLabel: 'SAMPLE', state: 'CONNECTED', canTrade: true, products: ['spot', 'perp'], label: LABEL })
    this.accts = [mk('s-bin', 'Binance', 'binance'), mk('s-byb', 'Bybit', 'bybit'), mk('s-okx', 'OKX', 'okx')]
    const at = new Date(this.clock()).toISOString()
    this.positions = [
      { accountId: 's-byb', instrumentId: 'bybit:perp:BTC-USDT:USDT', product: 'perp', side: 'LONG', quantity: '0.004', entryPrice: '58900', markPrice: String(SAMPLE_PX.BTC), notional: String(0.004 * SAMPLE_PX.BTC!), unrealizedPnl: String(((SAMPLE_PX.BTC! - 58900) * 0.004).toFixed(2)), leverage: '2', liquidationPrice: '29800', marginMode: 'isolated', asOf: at },
      { accountId: 's-bin', instrumentId: 'binance:perp:ETH-USDT:USDT', product: 'perp', side: 'SHORT', quantity: '-0.2', entryPrice: '1690', markPrice: String(SAMPLE_PX.ETH), notional: String(-0.2 * SAMPLE_PX.ETH!), unrealizedPnl: String(((1690 - SAMPLE_PX.ETH!) * 0.2).toFixed(2)), leverage: '3', liquidationPrice: '2210', marginMode: 'cross', asOf: at },
    ]
    this.orders = [{ accountId: 's-bin', instrumentId: 'binance:perp:ETH-USDT:USDT', side: 'BUY', type: 'STOP_MARKET', quantity: '0.2', stopPrice: '1740', reduceOnly: true, status: 'ACCEPTED', providerOrderId: 'sample-stop-1' }]
    const h = (accountId: string, asset: string, total: number, free = total): PHolding => ({ accountId, asset, total: String(total), free: String(free), locked: String(Number((total - free).toFixed(8))), valueUsd: String((asset in SAMPLE_PX ? SAMPLE_PX[asset]! : 1) * total) })
    this.holdings = [h('s-bin', 'USDT', 4200), h('s-bin', 'BTC', 0.012), h('s-bin', 'ETH', 0.5), h('s-byb', 'USDT', 9800, 9682), h('s-byb', 'BTC', 0.008), h('s-okx', 'USDT', 2500), h('s-okx', 'BTC', 0.005), h('s-okx', 'SOL', 6)]
  }

  private now() { return new Date(this.clock()).toISOString() }
  async accounts() { return this.accts }
  async portfolio() {
    const accounts = this.accts.map(a => {
      const hs = this.holdings.filter(x => x.accountId === a.id)
      const ps = this.positions.filter(x => x.accountId === a.id)
      const upnl = ps.reduce((t, p) => t + Number(p.unrealizedPnl ?? 0), 0)
      const value = hs.reduce((t, x) => t + Number(x.valueUsd ?? 0), 0) + upnl
      const avail = hs.filter(x => x.asset === 'USDT').reduce((t, x) => t + Number(x.free), 0)
      return { accountId: a.id, alias: a.alias, provider: a.provider, environment: a.environment, state: a.state, valueUsd: value.toFixed(2), unrealizedPnlUsd: upnl.toFixed(2), positions: ps.length, openOrders: this.orders.filter(o => o.accountId === a.id).length, availableUsd: avail.toFixed(2), unvalued: [], derivativeNotionalUsd: '0' }
    })
    const total = accounts.reduce((t, a) => t + Number(a.valueUsd), 0)
    const p: PortfolioPayload = { netLiquidationUsd: total.toFixed(2), unrealizedPnlUsd: accounts.reduce((t, a) => t + Number(a.unrealizedPnlUsd), 0).toFixed(2), accounts, exposures: [], positions: this.positions, openOrders: this.orders, holdings: this.holdings, asOf: this.now() }
    return { portfolio: p, accountErrors: [] }
  }
  async activity(): Promise<ActivityPayload> {
    const current: ActivityItem[] = this.positions.filter(p => !this.orders.some(o => o.accountId === p.accountId && o.instrumentId === p.instrumentId && o.type === 'STOP_MARKET')).map(p => {
      const a = this.accts.find(x => x.id === p.accountId)!
      return { id: `cur:unprot:${posKey(p)}`, kind: 'POSITION_UNPROTECTED', severity: 4, title: `${sym(p.instrumentId).base} ${isLong(p) ? 'LONG' : 'SHORT'} on ${a.alias.split(' ')[0]} has no stop`, detail: 'No venue-listed protective stop for this position.', accountId: p.accountId, account: a.alias, instrumentId: p.instrumentId, asset: sym(p.instrumentId).base, at: this.now(), state: 'current', relevant: true, acknowledged: this.acked.has(`cur:unprot:${posKey(p)}`), actions: [{ kind: 'position', label: 'Open position', accountId: p.accountId, instrumentId: p.instrumentId }, { kind: 'protect', label: 'Add protection', accountId: p.accountId, instrumentId: p.instrumentId }, { kind: 'ack', label: 'Acknowledge' }] }
    })
    const recent: ActivityItem[] = this.receiptsList.slice(0, 8).map(r => ({ id: `rcpt:${r.orderId}`, kind: 'ORDER_FILLED', severity: 1, title: `${r.side} ${r.filledQuantity} ${sym(r.instrumentId).base} filled`, detail: `${r.account} · SAMPLE receipt`, accountId: null, account: r.account, instrumentId: r.instrumentId, asset: sym(r.instrumentId).base, at: this.now(), state: 'recent', relevant: false, actions: [{ kind: 'receipt', label: 'View receipt', orderId: r.orderId }] }))
    const resolved: ActivityItem[] = [{ id: 'res:eth', kind: 'POSITION_UNPROTECTED', severity: 4, title: 'ETH SHORT on Binance had no stop', detail: 'Resolved: a stop at 1,740 is now listed.', account: 'Binance (sample)', accountId: 's-bin', instrumentId: 'binance:perp:ETH-USDT:USDT', asset: 'ETH', at: new Date(this.clock() - 3600_000).toISOString(), state: 'resolved', relevant: false, actions: [{ kind: 'position', label: 'Open position', accountId: 's-bin', instrumentId: 'binance:perp:ETH-USDT:USDT' }] }]
    return { current: current.filter(c => !this.dismissed.has(c.id)), recent, resolved, asOf: this.now() }
  }
  async ackEvent(id: string) { this.acked.add(id) }
  async dismissEvent(id: string) { this.dismissed.add(id) }
  async watchlist(assets: string[]): Promise<WatchItem[]> { return assets.map(a => ({ asset: a, price: SAMPLE_PX[a] ? String(SAMPLE_PX[a]) : null, change24hPct: SAMPLE_PX[a] ? (a === 'BTC' ? '-1.24' : a === 'ETH' ? '-3.08' : '0.42') : null, at: this.now() })) }
  async snapshot(asset: string): Promise<Snapshot> {
    const px = SAMPLE_PX[asset]
    const closes = px ? Array.from({ length: 24 }, (_, i) => String((px * (1 + 0.012 * Math.sin(i / 3.2) - 0.0005 * i)).toFixed(2))) : []
    return { asset, price: px ? String(px) : null, change24hPct: px ? '-1.24' : null, period: '24h', candles: px ? { interval: '1h', closes, source: 'sample' } : null, source: 'SAMPLE data', at: this.now() }
  }
  async venues(asset: string): Promise<VenueQuote[]> {
    const px = SAMPLE_PX[asset] ?? 100
    return [['binance', 0.2], ['bybit', 0.6], ['okx', 0.4]].map(([v, bp]) => ({ venue: String(v), bid: String(px * (1 - Number(bp) / 20000)), ask: String(px * (1 + Number(bp) / 20000)), spreadBps: Number(bp).toFixed(2), ageMs: 400, depthUsd10bps: '250000', source: 'sample' }))
  }
  async preview(t: Ticket): Promise<PreviewResp> {
    const a = this.accts.find(x => x.id === t.accountId)!
    const asset = t.asset, px = SAMPLE_PX[asset] ?? 100
    const instrument = t.instrumentId ?? `${a.provider}:${t.product}:${asset}-USDT${t.product === 'perp' ? ':USDT' : ''}`
    let qty: number, notional: number
    const pos = this.positions.find(p => p.accountId === a.id && p.instrumentId === instrument)
    if (t.fraction && t.product === 'perp') { if (!pos) throw Object.assign(new Error('No open position on this instrument'), { code: 'INVALID_QUANTITY' }); qty = Math.abs(Number(pos.quantity)) * Number(t.fraction); notional = qty * px }
    else if (t.fraction) { const h = this.holdings.find(x => x.accountId === a.id && x.asset === asset); qty = Number(h?.free ?? 0) * Number(t.fraction); notional = qty * px }
    else { notional = Number(t.notional ?? 0); qty = notional / px }
    const side = t.fraction && t.product === 'perp' && pos ? (isLong(pos) ? 'SELL' : 'BUY') : t.side
    const cur = this.positions.filter(p => sym(p.instrumentId).base === asset).reduce((s, p) => s + Number(p.notional ?? 0), 0) + this.holdings.filter(h => h.asset === asset).reduce((s, h) => s + Number(h.valueUsd ?? 0), 0)
    const delta = side === 'BUY' ? notional : -notional
    const verdict: 'ALLOW' | 'WARN' | 'BLOCK' = notional > 2000 ? 'BLOCK' : notional > 1000 ? 'WARN' : 'ALLOW'
    const id = `${this.kind}-${++this.seq}`
    const p: PreviewResp = {
      proposalId: id, confirmToken: verdict === 'BLOCK' ? null : `${id}-token`, expiresAt: new Date(this.clock() + 45000).toISOString(), canConfirm: verdict !== 'BLOCK', label: LABEL,
      account: { id: a.id, alias: a.alias, provider: a.provider, environmentLabel: 'SAMPLE', connectionState: 'CONNECTED' },
      order: { instrument, side, type: 'MARKET', quantity: qty.toPrecision(4), reduceOnly: t.reduceOnly, leverage: t.product === 'perp' && !t.reduceOnly ? (t.leverage ?? '2') : undefined },
      preview: { estimatedPrice: String(px), estimatedNotional: notional.toFixed(2), estimatedFee: (notional * 0.0005).toFixed(3), estimatedSlippageBps: '0.6', requiredMargin: t.product === 'perp' && !t.reduceOnly ? (notional / Number(t.leverage ?? 2)).toFixed(2) : null, remainingBuyingPower: '4200', estimateNotes: ['Sample estimate computed in the browser'],
        impact: { asset, currentExposureUsd: cur.toFixed(2), proposedExposureUsd: (cur + delta).toFixed(2), currentPositionQty: '0', proposedPositionQty: '0', spreadBps: '0.4', liquidation: { current: null, proposed: null, note: '' } },
        protection: t.stopOffsetPercent && !t.reduceOnly ? { stopOffsetPercent: t.stopOffsetPercent, estimatedStopPrice: String(px * (1 + (side === 'BUY' ? -1 : 1) * Number(t.stopOffsetPercent) / 100)), supported: true, note: '' } : null,
        willCancel: t.fraction === '1' && t.product === 'perp' ? this.orders.filter(o => o.accountId === a.id && o.instrumentId === instrument).map(o => ({ type: o.type, stopPrice: o.stopPrice ?? null })) : undefined },
      risk: { verdict, findings: verdict === 'ALLOW' ? [] : [{ rule: 'max_notional', verdict, message: verdict === 'BLOCK' ? 'Above the $2,000 per-order limit' : 'Above your $1,000 per-order comfort limit' }], policyVersion: 1 },
    }
    this.previews.set(id, { p, t, used: false })
    return p
  }
  async protectPreview(b: { accountId: string; instrumentId: string; stopOffsetPercent: string }): Promise<PreviewResp> {
    const pos = this.positions.find(p => p.accountId === b.accountId && p.instrumentId === b.instrumentId)!
    const a = this.accts.find(x => x.id === b.accountId)!
    const mark = Number(pos.markPrice), long = isLong(pos)
    const stop = mark * (1 + (long ? -1 : 1) * Number(b.stopOffsetPercent) / 100)
    const id = `${this.kind}-${++this.seq}`
    const p: PreviewResp = {
      kind: 'protect_existing', proposalId: id, confirmToken: `${id}-token`, expiresAt: new Date(this.clock() + 45000).toISOString(), canConfirm: true, label: LABEL,
      account: { id: a.id, alias: a.alias, provider: a.provider, environmentLabel: 'SAMPLE', connectionState: 'CONNECTED' },
      order: { instrument: pos.instrumentId, side: long ? 'SELL' : 'BUY', type: 'STOP_MARKET', quantity: String(Math.abs(Number(pos.quantity))), stopPrice: stop.toFixed(1), reduceOnly: true },
      preview: { estimatedPrice: null, estimatedNotional: null, estimatedFee: null, estimatedSlippageBps: null, requiredMargin: null, remainingBuyingPower: null, estimateNotes: [`If triggered: about ${b.stopOffsetPercent}% move from now`], recovery: { positionQty: pos.quantity, positionSide: long ? 'LONG' : 'SHORT', entryPrice: pos.entryPrice ?? null, markPrice: pos.markPrice ?? null, referencePrice: String(mark), stopOffsetPercent: b.stopOffsetPercent },
        impact: { asset: sym(pos.instrumentId).base, currentExposureUsd: '0', proposedExposureUsd: '0', currentPositionQty: pos.quantity, proposedPositionQty: pos.quantity, spreadBps: null, liquidation: { current: null, proposed: null, note: '' } }, protection: null },
      risk: { verdict: 'ALLOW', findings: [], policyVersion: 1 },
    }
    this.previews.set(id, { p, t: null, used: false })
    return p
  }
  async confirm(p: PreviewResp, _key: string): Promise<{ receipt: Receipt }> {
    const rec = this.previews.get(p.proposalId)
    if (!rec || rec.used) throw Object.assign(new Error('Confirm token already used'), { code: 'STALE_PROPOSAL' })
    if (Date.parse(rec.p.expiresAt) < this.clock()) throw Object.assign(new Error('Preview expired'), { code: 'STALE_PROPOSAL' })
    rec.used = true
    const s = sym(p.order.instrument)
    const qty = p.order.quantity ?? '0'
    if (p.kind === 'protect_existing') this.orders.push({ accountId: p.account.id, instrumentId: p.order.instrument, side: p.order.side, type: 'STOP_MARKET', quantity: qty, stopPrice: p.order.stopPrice ?? null, reduceOnly: true, status: 'ACCEPTED', providerOrderId: `sample-stop-${this.seq}` })
    else this.apply(p)
    const r: Receipt = { orderId: `${this.kind}-order-${this.seq}`, account: p.account.alias, provider: p.account.provider, environmentLabel: 'SAMPLE', label: `SIMULATED ${this.kind} — no order exists`, instrumentId: p.order.instrument, side: p.order.side, type: p.order.type, status: p.kind === 'protect_existing' ? 'ACCEPTED' : 'FILLED', providerOrderId: null, quantity: qty, quoteQuantity: null, filledQuantity: p.kind === 'protect_existing' ? '0' : qty, avgFillPrice: p.preview.estimatedPrice, fills: p.kind === 'protect_existing' ? [] : [{ price: p.preview.estimatedPrice ?? '0', qty, fee: p.preview.estimatedFee, feeAsset: 'USDT' }], protection: p.kind === 'protect_existing' ? { state: 'PROTECTED (sample)', stopPrice: p.order.stopPrice ?? null, protectedQuantity: qty } : p.preview.protection ? { state: 'PROTECTED (sample)', stopPrice: p.preview.protection.estimatedStopPrice, protectedQuantity: qty } : null, fillTruth: 'sample', events: [] }
    this.receiptsList.unshift(r)
    void s
    return { receipt: r }
  }
  private apply(p: PreviewResp) {
    const s = sym(p.order.instrument), q = Number(p.order.quantity ?? 0), px = Number(p.preview.estimatedPrice ?? 0)
    if (s.product === 'spot') {
      const h = this.holdings.find(x => x.accountId === p.account.id && x.asset === s.base)
      const d = p.order.side === 'BUY' ? q : -q
      if (h) { h.total = String(Number(h.total) + d); h.free = String(Number(h.free) + d); h.valueUsd = String(Number(h.total) * px) }
      else if (d > 0) this.holdings.push({ accountId: p.account.id, asset: s.base, total: String(d), free: String(d), locked: '0', valueUsd: String(d * px) })
      // Cash leg: a buy spends USDT (plus fee), a sale returns it (minus fee). Net value only moves by the fee.
      const cash = this.holdings.find(x => x.accountId === p.account.id && x.asset === 'USDT')
      const fee = Number(p.preview.estimatedFee ?? 0), dc = -d * px - fee
      if (cash) { cash.total = String(Number(cash.total) + dc); cash.free = String(Number(cash.free) + dc); cash.valueUsd = cash.total }
      return
    }
    const pos = this.positions.find(x => x.accountId === p.account.id && x.instrumentId === p.order.instrument)
    if (p.order.reduceOnly && pos) {
      const left = Math.abs(Number(pos.quantity)) - q
      if (left <= 1e-9) { this.positions = this.positions.filter(x => x !== pos); this.orders = this.orders.filter(o => !(o.accountId === pos.accountId && o.instrumentId === pos.instrumentId)) }
      else { pos.quantity = String((isLong(pos) ? 1 : -1) * left); pos.notional = String(Number(pos.quantity) * px) }
      return
    }
    const signed = p.order.side === 'BUY' ? q : -q
    if (pos) { pos.quantity = String(Number(pos.quantity) + signed); pos.notional = String(Number(pos.quantity) * px) }
    else this.positions.push({ accountId: p.account.id, instrumentId: p.order.instrument, product: 'perp', side: signed > 0 ? 'LONG' : 'SHORT', quantity: String(signed), entryPrice: String(px), markPrice: String(px), notional: String(signed * px), unrealizedPnl: '0', leverage: p.order.leverage ?? '2', liquidationPrice: String(px * (signed > 0 ? 0.52 : 1.48)), marginMode: 'isolated', asOf: this.now() })
    if (p.preview.protection) this.orders.push({ accountId: p.account.id, instrumentId: p.order.instrument, side: signed > 0 ? 'SELL' : 'BUY', type: 'STOP_MARKET', quantity: String(q), stopPrice: p.preview.protection.estimatedStopPrice, reduceOnly: true, status: 'ACCEPTED' })
  }
  async refreshOrder(orderId: string) { return this.receiptsList.find(r => r.orderId === orderId)! }
  async receipts() { return this.receiptsList }
  async compass() { return { compass: { largestDirectional: { asset: 'BTC', direction: 'LONG', netUsd: '1660' }, largestExchange: { accountId: 's-byb', alias: 'Bybit (sample)', sharePct: '58' }, unprotected: this.positions.filter(p => !this.orders.some(o => o.instrumentId === p.instrumentId && o.accountId === p.accountId)).map(p => ({ accountId: p.accountId, instrumentId: p.instrumentId, side: p.side, notionalUsd: p.notional ?? null })), nearRisk: [], marginWarnings: [], rose: [{ asset: 'BTC', sharePct: '74', direction: 'LONG' }, { asset: 'ETH', sharePct: '26', direction: 'SHORT' }] }, netLiquidationUsd: '17000' } }
  async policy() { return { policy: { maxSpotOrderUsd: '1000', maxFuturesOrderUsd: '2000', maxLeverage: '5', maxExchangeExposurePct: '80', maxMarginUtilizationPct: '50', nearLiquidationPct: '10' }, version: 1 } }
  async emergency() { return [...this.orders.map(o => ({ kind: 'CANCEL_ORDER', accountId: o.accountId, instrumentId: o.instrumentId, detail: `${o.side} ${o.type} ${o.quantity} at ${o.stopPrice ?? o.price}` })), ...this.positions.map(p => ({ kind: 'CLOSE_POSITION', accountId: p.accountId, instrumentId: p.instrumentId, detail: `${p.side} ${Math.abs(Number(p.quantity))} (reduce-only close, needs its own preview + confirm)` }))] }
  async recipes() { return [{ id: 'builtin:protected-entry', name: 'Protected entry', summary: 'Perp entry + reduce-only stop sized from the fill' }, { id: 'builtin:pre-sleep', name: 'Pre-sleep check', summary: 'Unprotected positions, exposure, a -30% wick' }] }
  async prefs() { return this.prefsState }
  async savePrefs(patch: Partial<Prefs>) { this.prefsState = withDefaults({ ...this.prefsState, ...patch }); return this.prefsState }
  async setActive() { /* sample: nothing persisted */ }
  async voice(input: { transcript?: string }, ctx: VoiceContext): Promise<VoiceResult> {
    const { portfolio } = await this.portfolio()
    return resolveVoiceLocally(input.transcript ?? '', ctx, this.accts, portfolio, { sttProvider: 'typed', sttLabel: 'typed (sample)' })
  }
}
