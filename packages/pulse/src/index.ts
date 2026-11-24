/**
 * HELM Pulse — deterministic event ranking + dedupe.
 * score = severity weight + kind urgency + account relevance + recency decay. No ML, fully reproducible.
 */
export const PULSE_KINDS = [
  'ORDER_FILLED', 'ORDER_PARTIALLY_FILLED', 'ORDER_REJECTED', 'POSITION_OPENED', 'POSITION_CLOSED', 'POSITION_UNPROTECTED',
  'MARGIN_THRESHOLD', 'CONNECTION_LOST', 'PRICE_ALERT', 'WATCHLIST_CONDITION', 'SESSION_OPENED', 'SESSION_CLOSED',
  'EXPOSURE_CHANGED', 'EXECUTION_UNKNOWN', 'PROTECTION_FAILED', 'PROTECTION_ACTIVE',
] as const
export type PulseKind = (typeof PULSE_KINDS)[number]

/** 1 info · 2 notice · 3 warning · 4 critical */
export type Severity = 1 | 2 | 3 | 4

export interface PulseEventInput {
  kind: PulseKind; severity: Severity; provider?: string | null; accountId?: string | null; instrumentId?: string | null
  reason: string; context?: Record<string, unknown>; createdAt: string; dedupeKey: string; dismissedAt?: string | null
  action?: { label: string; target: string } | null
}
export interface RankedEvent extends PulseEventInput { score: number; count: number }

const URGENCY: Record<PulseKind, number> = {
  PROTECTION_FAILED: 40, EXECUTION_UNKNOWN: 38, POSITION_UNPROTECTED: 30, MARGIN_THRESHOLD: 30, CONNECTION_LOST: 25, ORDER_REJECTED: 20,
  ORDER_PARTIALLY_FILLED: 15, ORDER_FILLED: 12, PROTECTION_ACTIVE: 10, PRICE_ALERT: 10, WATCHLIST_CONDITION: 8, POSITION_OPENED: 8,
  POSITION_CLOSED: 6, EXPOSURE_CHANGED: 5, SESSION_OPENED: 2, SESSION_CLOSED: 2,
}

export interface RankPrefs { activeAccountId?: string | null; mutedKinds?: PulseKind[]; halfLifeMinutes?: number }

export function score(e: PulseEventInput, now: Date, prefs: RankPrefs = {}): number {
  const ageMin = Math.max(0, (now.getTime() - new Date(e.createdAt).getTime()) / 60000)
  const decay = Math.pow(0.5, ageMin / (prefs.halfLifeMinutes ?? 30))
  const relevance = prefs.activeAccountId && e.accountId === prefs.activeAccountId ? 10 : 0
  return Math.round((e.severity * 100 + URGENCY[e.kind] + relevance) * (0.5 + 0.5 * decay) * 100) / 100
}

/** Dedupe by key (keeps newest, counts repeats), drop dismissed/muted, sort by score then recency. */
export function rank(events: PulseEventInput[], now = new Date(), prefs: RankPrefs = {}): RankedEvent[] {
  const byKey = new Map<string, RankedEvent>()
  for (const e of events) {
    if (e.dismissedAt || prefs.mutedKinds?.includes(e.kind)) continue
    const prev = byKey.get(e.dedupeKey)
    if (!prev) { byKey.set(e.dedupeKey, { ...e, score: 0, count: 1 }); continue }
    const newer = new Date(e.createdAt) > new Date(prev.createdAt) ? e : prev
    byKey.set(e.dedupeKey, { ...newer, score: 0, count: prev.count + 1 })
  }
  return [...byKey.values()].map(e => ({ ...e, score: score(e, now, prefs) })).sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
}
