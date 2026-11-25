/**
 * UX 2.0 Activity & Alerts: CURRENT (still true right now, recomputed from live state), RECENT (what happened),
 * RESOLVED (warnings that are no longer true). Pure — the route feeds it portfolio/compass/orders/pulse/marks.
 * Critical items (near liquidation, unknown order state) can be acknowledged but not dismissed.
 */
import type { Compass } from '@helm/risk-engine'
import type { Portfolio } from '@helm/portfolio'

export interface ActivityAction { kind: 'position' | 'protect' | 'receipt' | 'account' | 'reconcile' | 'market' | 'ack' | 'dismiss'; label: string; accountId?: string; instrumentId?: string; orderId?: string; asset?: string }
export interface ActivityItem {
  id: string; kind: string; severity: number; title: string; detail: string
  accountId?: string | null; account?: string | null; instrumentId?: string | null; asset?: string | null
  at: string; state: 'current' | 'recent' | 'resolved'; relevant: boolean; count?: number; acknowledged?: boolean; dismissible: boolean
  actions: ActivityAction[]
}
export interface PulseRow { id: string; kind: string; severity: number; accountId: string | null; instrumentId: string | null; reason: string; createdAt: Date; dismissedAt: Date | null; acknowledgedAt: Date | null; dedupeKey: string }
export interface Mark { itemId: string; acknowledgedAt: Date | null; dismissedUntil: Date | null }
export interface AccountState { id: string; alias: string; state: string }
export interface OpenUnknown { orderId: string; accountId: string; instrumentId: string; side: string; status: string; createdAt: Date }

export const DISMISS_COOLDOWN_MS = 4 * 3600_000
const base = (id: string) => (id.split(':')[2] ?? '').split('-')[0] ?? ''
const WARN_KINDS = new Set(['POSITION_UNPROTECTED', 'PROTECTION_FAILED', 'EXECUTION_UNKNOWN', 'MARGIN_THRESHOLD', 'CONNECTION_LOST'])

export function buildActivity(i: { portfolio: Portfolio; compass: Compass; accounts: AccountState[]; unknownOrders: OpenUnknown[]; pulse: PulseRow[]; marks: Mark[]; now?: Date }) {
  const now = i.now ?? new Date()
  const alias = new Map(i.accounts.map(a => [a.id, a.alias]))
  const marks = new Map(i.marks.map(m => [m.itemId, m]))
  const current: ActivityItem[] = []
  const add = (x: Omit<ActivityItem, 'state' | 'relevant' | 'at' | 'acknowledged'> & { at?: string }) => {
    const m = marks.get(x.id)
    if (x.dismissible && m?.dismissedUntil && m.dismissedUntil > now) return
    const actions = [...x.actions, { kind: 'ack' as const, label: 'Acknowledge (keep watching)' }, ...(x.dismissible ? [{ kind: 'dismiss' as const, label: 'Dismiss for 4 hours' }] : [])]
    current.push({ ...x, actions, at: x.at ?? now.toISOString(), state: 'current', relevant: true, acknowledged: !!m?.acknowledgedAt })
  }
  const pos = (accountId: string, instrumentId: string) => i.portfolio.positions.find(p => p.accountId === accountId && p.instrumentId === instrumentId)
  for (const n of i.compass.nearRisk) {
    const p = pos(n.accountId, n.instrumentId)
    add({ id: `cur:liq:${n.accountId}|${n.instrumentId}`, kind: 'NEAR_LIQUIDATION', severity: 5, title: `${base(n.instrumentId)} ${n.distancePct.toFixed(1)}% from liquidation`, detail: `${p?.side ?? ''} on ${alias.get(n.accountId) ?? 'account'} · venue-reported liquidation price`, accountId: n.accountId, account: alias.get(n.accountId) ?? null, instrumentId: n.instrumentId, asset: base(n.instrumentId), dismissible: false, actions: [{ kind: 'position', label: 'Open position', accountId: n.accountId, instrumentId: n.instrumentId }] })
  }
  for (const u of i.unknownOrders) add({ id: `cur:unknown:${u.orderId}`, kind: 'EXECUTION_UNKNOWN', severity: 5, title: `${base(u.instrumentId)} ${u.side} order: verifying with exchange`, detail: 'The outcome is not confirmed yet. Do not resubmit: check the receipt.', accountId: u.accountId, account: alias.get(u.accountId) ?? null, instrumentId: u.instrumentId, asset: base(u.instrumentId), at: u.createdAt.toISOString(), dismissible: false, actions: [{ kind: 'reconcile', label: 'Open receipt / verify', orderId: u.orderId }] })
  for (const u of i.compass.unprotected) {
    const failures = i.pulse.filter(e => e.kind === 'PROTECTION_FAILED' && e.accountId === u.accountId && e.instrumentId === u.instrumentId).length
    add({ id: `cur:unprot:${u.accountId}|${u.instrumentId}`, kind: 'POSITION_UNPROTECTED', severity: 4, title: `${base(u.instrumentId)} ${u.side === 'SHORT' ? 'SHORT' : 'LONG'} on ${(alias.get(u.accountId) ?? 'account').replace(/\s+Demo$/, '')} has no stop`, detail: `No venue-listed protective stop${failures ? ` · ${failures} protection attempt${failures === 1 ? '' : 's'} failed` : ''}.`, accountId: u.accountId, account: alias.get(u.accountId) ?? null, instrumentId: u.instrumentId, asset: base(u.instrumentId), count: failures || undefined, dismissible: true, actions: [{ kind: 'protect', label: 'Add protection (stop)', accountId: u.accountId, instrumentId: u.instrumentId }, { kind: 'position', label: 'Open position', accountId: u.accountId, instrumentId: u.instrumentId }] })
  }
  for (const m of i.compass.marginWarnings) add({ id: `cur:margin:${m.accountId}`, kind: 'MARGIN_HIGH', severity: 4, title: `${m.alias}: margin use ${m.utilizationPct.toFixed(0)}%`, detail: 'Above your configured margin-utilisation limit.', accountId: m.accountId, account: m.alias, dismissible: true, actions: [{ kind: 'account', label: 'Open account', accountId: m.accountId }] })
  for (const a of i.accounts.filter(a => !['CONNECTED', 'READ_ONLY'].includes(a.state))) add({ id: `cur:conn:${a.id}`, kind: 'ACCOUNT_DISCONNECTED', severity: 3, title: `${a.alias}: ${a.state.toLowerCase().replace(/_/g, ' ')}`, detail: 'Values from this account may be stale. Reconnect in the companion.', accountId: a.id, account: a.alias, dismissible: true, actions: [{ kind: 'account', label: 'Open account', accountId: a.id }] })
  current.sort((a, b) => b.severity - a.severity || Number(!!a.acknowledged) - Number(!!b.acknowledged))

  const stillTrue = (e: PulseRow) => {
    if (e.kind === 'EXECUTION_UNKNOWN') return i.unknownOrders.some(u => e.dedupeKey === `unknown:${u.orderId}`)
    if (e.kind === 'PROTECTION_FAILED' || e.kind === 'POSITION_UNPROTECTED') return i.compass.unprotected.some(u => u.accountId === e.accountId && u.instrumentId === e.instrumentId)
    if (e.kind === 'MARGIN_THRESHOLD') return i.compass.marginWarnings.some(m => m.accountId === e.accountId)
    if (e.kind === 'CONNECTION_LOST') return i.accounts.some(a => a.id === e.accountId && !['CONNECTED', 'READ_ONLY'].includes(a.state))
    return false
  }
  const visible = i.pulse.filter(e => !e.dismissedAt)
  const toItem = (e: PulseRow, state: 'recent' | 'resolved'): ActivityItem => ({
    id: `pulse:${e.id}`, kind: e.kind, severity: e.severity, title: e.reason.slice(0, 60), detail: state === 'resolved' ? 'Resolved: no longer true now.' : e.reason.slice(0, 120),
    accountId: e.accountId, account: e.accountId ? alias.get(e.accountId) ?? null : null, instrumentId: e.instrumentId, asset: e.instrumentId ? base(e.instrumentId) : null,
    at: e.createdAt.toISOString(), state, relevant: false, acknowledged: !!e.acknowledgedAt, dismissible: true,
    actions: [...(e.accountId && e.instrumentId && pos(e.accountId, e.instrumentId) ? [{ kind: 'position' as const, label: 'Open position', accountId: e.accountId, instrumentId: e.instrumentId }] : []), ...(e.instrumentId ? [{ kind: 'market' as const, label: `View ${base(e.instrumentId)} market`, asset: base(e.instrumentId) }] : []), { kind: 'dismiss' as const, label: 'Remove from list' }],
  })
  const recent = visible.filter(e => !WARN_KINDS.has(e.kind)).slice(0, 10).map(e => toItem(e, 'recent'))
  const resolved = visible.filter(e => WARN_KINDS.has(e.kind) && !stillTrue(e)).slice(0, 10).map(e => toItem(e, 'resolved'))
  return { current, recent, resolved, asOf: i.portfolio.asOf }
}
