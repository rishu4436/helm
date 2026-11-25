/**
 * UX 2.0 view models — pure functions from API payloads to what each screen needs.
 * No I/O, no SDK: shared by the G2 app, the companion Vision mirror and the landing demo, and unit-tested.
 */
import type { Graphic } from '../gfx/graphics'
import type { Acct, ActivityItem, PAccount, PHolding, PortfolioPayload, POrder, PPosition, Prefs, VenueQuote } from './types'

// ---------- environments & scopes ----------
export type ScopeId = 'exchange' | 'simulated' | 'sandbox'
/** Values from different environments are NEVER summed or compared in one allocation. */
export const scopeOf = (env: string): ScopeId => (env === 'demo' || env === 'paper' ? 'exchange' : env === 'simulated' ? 'simulated' : 'sandbox')
export const SCOPE_LABEL: Record<ScopeId, string> = { exchange: 'Exchange demo', simulated: 'HELM simulated', sandbox: 'Static sandbox' }
export const SCOPE_NOTE: Record<ScopeId, string> = {
  exchange: 'Exchange-reported demo values',
  simulated: 'Simulated: not exchange funds',
  sandbox: 'Static sandbox: not a balance',
}
export const ENV_TAG: Record<string, string> = { demo: 'DEMO', paper: 'PAPER', sandbox_static: 'SANDBOX', simulated: 'SIM' }
export const envTag = (env: string) => ENV_TAG[env] ?? env.toUpperCase()

export interface Scope { id: ScopeId; label: string; valueUsd: number; pnlUsd: number; accounts: PAccount[] }
export function scopesOf(p: PortfolioPayload): Scope[] {
  const order: ScopeId[] = ['exchange', 'simulated', 'sandbox']
  return order.map(id => {
    const accounts = p.accounts.filter(a => scopeOf(a.environment) === id)
    return { id, label: SCOPE_LABEL[id], accounts, valueUsd: accounts.reduce((t, a) => t + num(a.valueUsd), 0), pnlUsd: accounts.reduce((t, a) => t + num(a.unrealizedPnlUsd), 0) }
  }).filter(s => s.accounts.length > 0)
}
/** Default scope: exchange-reported if present, otherwise simulated, otherwise sandbox. */
export const primaryScope = (p: PortfolioPayload): ScopeId => scopesOf(p)[0]?.id ?? 'exchange'

export const num = (s: string | number | null | undefined) => (s === null || s === undefined || s === '' ? 0 : Number(s) || 0)
export const numOrNull = (s: string | number | null | undefined) => (s === null || s === undefined || s === '' || !Number.isFinite(Number(s)) ? null : Number(s))

export function allocationGraphic(p: PortfolioPayload, scope: ScopeId): Extract<Graphic, { kind: 'ribbon' }> {
  return { kind: 'ribbon', scope: SCOPE_LABEL[scope], segments: p.accounts.filter(a => scopeOf(a.environment) === scope).map(a => ({ label: shortAlias(a.alias), value: num(a.valueUsd) })).sort((a, b) => b.value - a.value) }
}
export const shortAlias = (a: string) => a.replace(/\s*\((sample|SIMULATED)\)/i, '').replace(/\s+Demo$/i, '').slice(0, 14)

// ---------- instruments ----------
export const sym = (id: string) => { const p = id.split(':'); const [b, q] = (p[2] ?? '').split('-'); return { provider: p[0] ?? '', base: b ?? '', quote: q ?? '', product: p[1] ?? '' } }
export const prodLabel = (p: string) => (p === 'perp' ? 'PERP' : p.toUpperCase())

// ---------- positions ----------
export const isLong = (p: Pick<PPosition, 'side' | 'quantity'>) => p.side === 'LONG' || ((p.side === 'NET' || p.side === 'BOTH') && Number(p.quantity) > 0)
/** Stable identity: account + instrument + side. Never a display string. */
export const posKey = (p: Pick<PPosition, 'accountId' | 'instrumentId' | 'side'>) => `${p.accountId}|${p.instrumentId}|${p.side}`

const PROTECTIVE = new Set(['STOP_MARKET', 'STOP_LIMIT'])
/** Same rule as the risk engine's hasProtection: a venue-listed stop on the closing side. */
export function stopFor(p: PPosition, orders: POrder[] = []): POrder | null {
  const closing = isLong(p) ? 'SELL' : 'BUY'
  return orders.find(o => o.accountId === p.accountId && o.instrumentId === p.instrumentId && PROTECTIVE.has(o.type) && (o.reduceOnly || p.product === 'spot') && o.side === closing) ?? null
}
/** A reduce-only LIMIT on the closing side beyond the current price in the profit direction = take profit. */
export function takeProfitFor(p: PPosition, orders: POrder[] = []): POrder | null {
  const long = isLong(p), mark = numOrNull(p.markPrice)
  return orders.find(o => o.accountId === p.accountId && o.instrumentId === p.instrumentId && o.type === 'LIMIT' && o.reduceOnly && o.side === (long ? 'SELL' : 'BUY') && o.price && (mark === null || (long ? Number(o.price) > mark : Number(o.price) < mark))) ?? null
}

export interface PositionRow { key: string; pos: PPosition; alias: string; env: string; long: boolean; base: string; product: string; stop: POrder | null; tp: POrder | null; notionalUsd: number | null; pnl: number | null }
export function positionRows(p: PortfolioPayload, filter: { accountId?: string; asset?: string; scope?: ScopeId } = {}): PositionRow[] {
  const acc = new Map(p.accounts.map(a => [a.accountId, a]))
  return p.positions
    .filter(x => Number(x.quantity) !== 0)
    .filter(x => !filter.accountId || x.accountId === filter.accountId)
    .filter(x => !filter.asset || sym(x.instrumentId).base === filter.asset)
    .filter(x => !filter.scope || scopeOf(acc.get(x.accountId)?.environment ?? '') === filter.scope)
    .map(x => {
      const s = sym(x.instrumentId), a = acc.get(x.accountId)
      const notional = numOrNull(x.notional) ?? (numOrNull(x.markPrice) !== null ? Math.abs(Number(x.quantity)) * Number(x.markPrice) : null)
      return { key: posKey(x), pos: x, alias: a?.alias ?? 'account', env: a?.environment ?? '', long: isLong(x), base: s.base, product: s.product, stop: stopFor(x, p.openOrders), tp: takeProfitFor(x, p.openOrders), notionalUsd: notional === null ? null : Math.abs(notional), pnl: numOrNull(x.unrealizedPnl) }
    })
    // Positions without a stop first (they need attention), then largest notional.
    .sort((a, b) => Number(!!a.stop) - Number(!!b.stop) || (b.notionalUsd ?? 0) - (a.notionalUsd ?? 0))
}

export interface FocusModel {
  row: PositionRow
  qty: number; entry: number | null; mark: number | null; liq: number | null; liqDistancePct: number | null
  notional: number | null; leverage: number | null; margin: number | null; marginMode: string | null
  stopPrice: number | null; tpPrice: number | null
  range: Extract<Graphic, { kind: 'range' }>
}
export function focusModel(row: PositionRow): FocusModel {
  const x = row.pos
  const mark = numOrNull(x.markPrice), liq = numOrNull(x.liquidationPrice), entry = numOrNull(x.entryPrice)
  const usableLiq = liq !== null && liq > 0 ? liq : null // venues report 0 / empty when there is no liquidation price
  const lev = numOrNull(x.leverage)
  const notional = row.notionalUsd
  return {
    row, qty: Math.abs(Number(x.quantity)), entry, mark, liq: usableLiq,
    liqDistancePct: usableLiq !== null && mark ? (Math.abs(mark - usableLiq) / mark) * 100 : null,
    notional, leverage: lev, margin: numOrNull(x.isolatedMargin) ?? (notional !== null && lev ? notional / lev : null), marginMode: x.marginMode ?? null,
    stopPrice: numOrNull(row.stop?.stopPrice ?? null), tpPrice: numOrNull(row.tp?.price ?? null),
    range: { kind: 'range', side: row.long ? 'LONG' : 'SHORT', markers: [
      { kind: 'LIQ', price: usableLiq }, { kind: 'STOP', price: numOrNull(row.stop?.stopPrice ?? null) }, { kind: 'ENTRY', price: entry },
      { kind: 'MARK', price: mark }, { kind: 'TP', price: numOrNull(row.tp?.price ?? null) },
    ] },
  }
}

export type PositionAction = { id: 'protect' | 'review-stop' | 'review-tp' | 'reduce25' | 'reduce50' | 'reduce75' | 'close' | 'increase' | 'risk' | 'fills' | 'voice' | 'market' | 'buy' | 'sell'; label: string; fraction?: string }
/** Only actions this position actually supports appear (spot holdings have no reduce-only / leverage actions). */
export function positionActions(f: FocusModel, canTrade: boolean): PositionAction[] {
  const a: PositionAction[] = []
  const perp = f.row.product !== 'spot' && f.row.product !== 'stock'
  if (perp && !f.row.stop && canTrade) a.push({ id: 'protect', label: 'Add protection (stop)' })
  if (f.row.stop) a.push({ id: 'review-stop', label: `Review stop ${fmtPrice(f.stopPrice)}` })
  if (f.row.tp) a.push({ id: 'review-tp', label: `Review take profit ${fmtPrice(f.tpPrice)}` })
  if (perp && canTrade) a.push({ id: 'reduce25', label: 'Reduce 25%', fraction: '0.25' }, { id: 'reduce50', label: 'Reduce 50%', fraction: '0.5' }, { id: 'reduce75', label: 'Reduce 75%', fraction: '0.75' }, { id: 'close', label: 'Close position', fraction: '1' }, { id: 'increase', label: `Increase ${f.row.long ? 'LONG' : 'SHORT'}` })
  a.push({ id: 'risk', label: 'Position risk' }, { id: 'fills', label: 'Related fills' }, { id: 'voice', label: 'Voice: say what to do' })
  return a
}

// ---------- holdings ----------
export const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'USD', 'BUSD', 'TUSD'])
export interface HoldingAgg { asset: string; scope: ScopeId; qty: number; valueUsd: number | null; share: number | null; rows: Array<PHolding & { alias: string; env: string }> }
/**
 * Spot holdings grouped by EXACT asset symbol within one environment scope. Quantities are only summed for the
 * same symbol (BTC with BTC); nothing implies funds can move between exchanges.
 */
export function holdingsByAsset(p: PortfolioPayload, scope: ScopeId, accountId?: string): HoldingAgg[] {
  const acc = new Map(p.accounts.map(a => [a.accountId, a]))
  const hs = (p.holdings ?? []).filter(h => Number(h.total) !== 0 && scopeOf(acc.get(h.accountId)?.environment ?? '') === scope && (!accountId || h.accountId === accountId))
  const by = new Map<string, HoldingAgg>()
  for (const h of hs) {
    const a = acc.get(h.accountId)
    const g = by.get(h.asset) ?? { asset: h.asset, scope, qty: 0, valueUsd: 0, share: null, rows: [] }
    g.qty += Number(h.total)
    g.valueUsd = g.valueUsd === null || h.valueUsd === null ? null : g.valueUsd + Number(h.valueUsd)
    g.rows.push({ ...h, alias: a?.alias ?? 'account', env: a?.environment ?? '' })
    by.set(h.asset, g)
  }
  const out = [...by.values()]
  const total = out.reduce((t, g) => t + (g.valueUsd ?? 0), 0)
  for (const g of out) { g.share = g.valueUsd !== null && total > 0 ? g.valueUsd / total : null; g.rows.sort((a, b) => num(b.valueUsd) - num(a.valueUsd)) }
  return out.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || a.asset.localeCompare(b.asset))
}

// ---------- pagination (no silent truncation: every row stays reachable) ----------
export const PAGE_SIZE = 17
export interface Page<T> { rows: T[]; page: number; pages: number; total: number }
export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const pg = Math.min(Math.max(0, page), pages - 1)
  return { rows: items.slice(pg * size, pg * size + size), page: pg, pages, total: items.length }
}

// ---------- glance / adaptive home ----------
export type HomeMode = 'empty' | 'disconnected' | 'risk' | 'futures' | 'multi' | 'spot'
export interface Glance {
  mode: HomeMode
  scopes: Scope[]
  primary: Scope | null
  positions: number
  unprotected: number
  healthOk: number; healthTotal: number; healthBad: string[]
  topAlert: ActivityItem | null
  ageSec: number | null
}
const OK_STATES = new Set(['CONNECTED', 'READ_ONLY'])
export function glance(p: PortfolioPayload | null, accts: Acct[], alerts: ActivityItem[], prefs: Pick<Prefs, 'homeMode' | 'alertSensitivity'>, now = Date.now()): Glance {
  const scopes = p ? scopesOf(p) : []
  const primary = scopes[0] ?? null
  const rows = p ? positionRows(p) : []
  const bad = accts.filter(a => !OK_STATES.has(a.state))
  const minSev = prefs.alertSensitivity === 'critical' ? 4 : prefs.alertSensitivity === 'all' ? 1 : 3
  const top = alerts.filter(a => a.state === 'current' && a.severity >= minSev && !a.acknowledged).sort((a, b) => b.severity - a.severity)[0] ?? null
  let mode: HomeMode
  if (!accts.length) mode = 'empty'
  else if (bad.length === accts.length) mode = 'disconnected'
  else if (top && top.severity >= 4) mode = 'risk'
  else if (prefs.homeMode !== 'auto') mode = prefs.homeMode
  else if (rows.some(r => r.product === 'perp')) mode = 'futures'
  else if ((primary?.accounts.length ?? 0) > 1) mode = 'multi'
  else mode = 'spot'
  return {
    mode, scopes, primary, positions: rows.length, unprotected: rows.filter(r => r.product === 'perp' && !r.stop).length,
    healthOk: accts.length - bad.length, healthTotal: accts.length, healthBad: bad.map(a => a.alias),
    topAlert: top, ageSec: p?.asOf ? Math.max(0, Math.round((now - Date.parse(p.asOf)) / 1000)) : null,
  }
}

// ---------- venue compass ----------
export const QUOTE_FRESH_MS = 5000
export interface VenueModel { rows: Array<VenueQuote & { fresh: boolean; complete: boolean }>; label: string | null; leader: string | null; graphic: Extract<Graphic, { kind: 'bars' }> }
/**
 * Bars show the observed bid/ask spread in basis points (lower = tighter). A venue is only singled out when EVERY
 * quote is fresh and complete — and then only as "Lowest observed spread" (or lowest est. cost for the selected size
 * when depth + fee assumptions are available), never "best".
 */
export function venueModel(quotes: VenueQuote[], sizeUsd?: number | null): VenueModel {
  const rows = quotes.map(q => ({ ...q, fresh: q.ageMs !== null && q.ageMs !== undefined && q.ageMs >= 0 && q.ageMs < QUOTE_FRESH_MS, complete: !q.error && q.bid !== null && q.ask !== null && q.spreadBps !== null }))
  const allOk = rows.length > 1 && rows.every(r => r.fresh && r.complete)
  let label: string | null = null, leader: string | null = null
  if (allOk) {
    if (sizeUsd && rows.every(r => r.estCostBps !== null && r.estCostBps !== undefined)) {
      const m = [...rows].sort((a, b) => Number(a.estCostBps) - Number(b.estCostBps))[0]!
      leader = m.venue; label = `Lowest est. cost for $${sizeUsd} (incl. assumed taker fee)`
    } else {
      const m = [...rows].sort((a, b) => Number(a.spreadBps) - Number(b.spreadBps))[0]!
      leader = m.venue; label = 'Lowest observed spread'
    }
  }
  return {
    rows, label, leader,
    graphic: { kind: 'bars', title: 'Bid/ask spread, basis points (lower = tighter)', unit: 'bp', rows: rows.map(r => ({ label: venueName(r.venue), value: r.complete ? Number(r.spreadBps) : null, note: r.error ? 'unavailable' : 'n/a' })) },
  }
}
export const venueName = (v: string) => (v === 'okx' ? 'OKX' : v.charAt(0).toUpperCase() + v.slice(1))

// ---------- trade builder ----------
export interface Draft {
  asset?: string; accountId?: string; product?: 'spot' | 'perp'; side?: 'BUY' | 'SELL'; orderType: 'MARKET'
  notional?: string; quantity?: string; fraction?: string; leverage?: string; stopOffsetPercent?: string | null; reduceOnly?: boolean
  instrumentId?: string; origin: 'manual' | 'position' | 'market' | 'voice' | 'companion' | 'holding'
  /** Fields the user explicitly answered (so later steps never silently re-ask or overwrite them). */
  answered: Array<'asset' | 'account' | 'product' | 'side' | 'size' | 'leverage' | 'protection'>
}
export type BuilderStep = 'asset' | 'account' | 'product' | 'side' | 'size' | 'leverage' | 'protection' | 'review'
export const eligibleAccounts = (accts: Acct[], d: Pick<Draft, 'product'>) => accts.filter(a => a.canTrade && (!d.product || a.products.includes(d.product)) && (a.products.includes('spot') || a.products.includes('perp')))
/** Context-aware: questions that are already answered or have exactly one valid answer are skipped. */
export function nextStep(d: Draft, accts: Acct[]): BuilderStep {
  if (!d.asset) return 'asset'
  if (!d.accountId) return 'account'
  const a = accts.find(x => x.id === d.accountId)
  if (!d.product) return a && a.products.filter(p => p === 'spot' || p === 'perp').length === 1 ? 'side' : 'product'
  if (!d.side) return 'side'
  if (!d.notional && !d.quantity && !d.fraction) return 'size'
  if (d.product === 'perp' && !d.reduceOnly && !d.leverage) return 'leverage'
  if (!d.reduceOnly && !d.answered.includes('protection')) return 'protection'
  return 'review'
}
/** Order eligible accounts: last used, then the saved default, then most free balance. Ordering only — the user still picks. */
export function orderAccounts<A extends { id: string }>(el: A[], o: { last: string | null; preferred: string | null; freeUsd: (id: string) => number | null }): A[] {
  const rank = (a: A) => (a.id === o.last ? 0 : a.id === o.preferred ? 1 : 2)
  return [...el].sort((a, b) => rank(a) - rank(b) || (o.freeUsd(b.id) ?? -1) - (o.freeUsd(a.id) ?? -1))
}
/** Fill in the single obvious answer (one eligible account, one product) without guessing anything else. */
export function autoResolve(d: Draft, accts: Acct[]): Draft {
  const out = { ...d }
  if (!out.accountId) { const el = eligibleAccounts(accts, out); if (el.length === 1) out.accountId = el[0]!.id }
  if (out.accountId && !out.product) { const a = accts.find(x => x.id === out.accountId); const ps = (a?.products ?? []).filter((p): p is 'spot' | 'perp' => p === 'spot' || p === 'perp'); if (ps.length === 1) out.product = ps[0] }
  return out
}
/** Gesture stepper increments for custom size: coarser steps as the amount grows. */
export function stepSize(v: number) { return v < 50 ? 5 : v < 200 ? 10 : v < 500 ? 25 : 50 }
export function stepAmount(v: number, dir: 1 | -1, min = 5, max = 1000) {
  const s = stepSize(dir > 0 ? v : Math.max(min, v - 1))
  return Math.max(min, Math.min(max, Math.round((v + dir * s) / s) * s))
}

// ---------- fast path ----------
export interface ReviewLike { kind?: string; canConfirm: boolean; expiresAt: string; account: { connectionState: string }; preview: { estimatedPrice: string | null; estimatedNotional: string | null }; risk: { verdict: 'ALLOW' | 'WARN' | 'BLOCK' } }
/** The concise one-screen review is used only when every condition holds; otherwise the full risk step is mandatory. */
export function fastPathEligible(p: ReviewLike, now = Date.now()): { ok: boolean; reasons: string[] } {
  const r: string[] = []
  if (p.risk.verdict !== 'ALLOW') r.push(p.risk.verdict === 'WARN' ? 'risk findings need review' : 'order blocked')
  if (!p.canConfirm) r.push('cannot confirm')
  if (p.account.connectionState !== 'CONNECTED') r.push(`account ${p.account.connectionState}`)
  // A protective stop has no fill estimate by nature; new orders need a complete price estimate.
  if (p.kind !== 'protect_existing' && (!p.preview.estimatedPrice || !p.preview.estimatedNotional)) r.push('price estimate incomplete')
  if (Date.parse(p.expiresAt) - now < 10_000) r.push('preview about to expire')
  return { ok: r.length === 0, reasons: r }
}

// ---------- formatting ----------
export const fmtPrice = (v: number | null) => (v === null ? 'n/a' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(Number(v.toPrecision(4))))
export const fmtQty = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? 'n/a' : String(Number(Number(v).toPrecision(6))))
export const ageLabel = (sec: number | null) => (sec === null ? 'age n/a' : sec < 60 ? `${sec}s ago` : sec < 3600 ? `${Math.round(sec / 60)}m ago` : `${Math.round(sec / 3600)}h ago`)
