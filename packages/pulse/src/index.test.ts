import { describe, expect, it } from 'vitest'
import { rank, type PulseEventInput } from './index'

const now = new Date('2026-11-24T08:00:00Z')
const ev = (kind: PulseEventInput['kind'], severity: PulseEventInput['severity'], minsAgo: number, key: string, extra: Partial<PulseEventInput> = {}): PulseEventInput =>
  ({ kind, severity, reason: kind, createdAt: new Date(now.getTime() - minsAgo * 60000).toISOString(), dedupeKey: key, ...extra })

describe('Pulse ranking', () => {
  it('critical protection failure outranks a fresh fill', () => {
    const r = rank([ev('ORDER_FILLED', 2, 0, 'a'), ev('PROTECTION_FAILED', 4, 20, 'b')], now)
    expect(r[0]!.kind).toBe('PROTECTION_FAILED')
  })
  it('dedupes repeats and counts them', () => {
    const r = rank([ev('CONNECTION_LOST', 3, 5, 'okx-conn'), ev('CONNECTION_LOST', 3, 1, 'okx-conn'), ev('CONNECTION_LOST', 3, 3, 'okx-conn')], now)
    expect(r).toHaveLength(1); expect(r[0]!.count).toBe(3)
  })
  it('drops dismissed and muted, boosts active account, is deterministic', () => {
    const list = [ev('PRICE_ALERT', 2, 0, 'p', { dismissedAt: now.toISOString() }), ev('SESSION_OPENED', 1, 0, 's'), ev('ORDER_FILLED', 2, 0, 'x', { accountId: 'A' }), ev('ORDER_FILLED', 2, 0, 'y', { accountId: 'B' })]
    const r = rank(list, now, { mutedKinds: ['SESSION_OPENED'], activeAccountId: 'B' })
    expect(r.map(e => e.dedupeKey)).toEqual(['y', 'x'])
    expect(rank(list, now, { activeAccountId: 'B' })).toEqual(rank(list, now, { activeAccountId: 'B' }))
  })
})
