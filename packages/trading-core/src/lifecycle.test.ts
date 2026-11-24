import { describe, expect, it } from 'vitest'
import { dec } from '@helm/shared'
import { ConfirmationRegistry, OrderLifecycle, canonicalJson, hashProposal } from './index'

describe('order lifecycle', () => {
  it('walks the happy path with an audit trail', () => {
    const o = new OrderLifecycle()
    o.transition('VALIDATED', 'system'); o.transition('AWAITING_CONFIRMATION', 'system'); o.transition('CONFIRMED', 'user')
    expect(o.maySubmit).toBe(true)
    o.transition('SUBMITTING', 'system'); o.transition('ACCEPTED', 'provider'); o.transition('PARTIALLY_FILLED', 'provider'); o.transition('FILLED', 'provider')
    expect(o.isTerminal).toBe(true)
    expect(o.events.map(e => e.to)).toEqual(['DRAFT', 'VALIDATED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'SUBMITTING', 'ACCEPTED', 'PARTIALLY_FILLED', 'FILLED'])
  })
  it('never submits without explicit user confirmation', () => {
    const o = new OrderLifecycle('AWAITING_CONFIRMATION')
    expect(() => o.transition('SUBMITTING', 'system')).toThrow(/Illegal/)
    expect(() => o.transition('CONFIRMED', 'system')).toThrow(/explicit user/)
  })
  it('unknown results must reconcile, never resubmit', () => {
    const o = new OrderLifecycle('SUBMITTING')
    o.transition('UNKNOWN', 'system', 'timeout')
    expect(o.can('SUBMITTING')).toBe(false)
    expect(() => o.transition('FILLED', 'provider')).toThrow()
    o.transition('RECONCILING', 'system')
    o.transition('FILLED', 'provider')
  })
  it('users cannot fabricate fills; terminal states are final', () => {
    const o = new OrderLifecycle('SUBMITTING')
    expect(() => o.transition('FILLED', 'user')).toThrow(/provider truth/)
    o.transition('REJECTED', 'provider')
    expect(() => o.transition('ACCEPTED', 'provider')).toThrow()
  })
})

describe('confirmation tokens', () => {
  const proposal = { account: 'a1', side: 'BUY', notional: dec('100'), instrument: 'binance:spot:BTC-USDT' }
  it('canonical hashing ignores key order and normalises decimals', () => {
    expect(hashProposal({ b: 1, a: dec('1.50') })).toBe(hashProposal({ a: dec('1.5'), b: 1 }))
    expect(canonicalJson({ z: undefined, a: [1, { y: 2, x: 1 }] })).toBe('{"a":[1,{"x":1,"y":2}]}')
  })
  it('is single-use', () => {
    const r = new ConfirmationRegistry()
    const g = r.issue(proposal)
    r.consume(g.token, proposal)
    expect(() => r.consume(g.token, proposal)).toThrow(/already used/)
  })
  it('expires', () => {
    let t = 1000
    const r = new ConfirmationRegistry(30_000, () => t)
    const g = r.issue(proposal)
    t += 30_001
    expect(() => r.consume(g.token, proposal)).toThrow(/expired/)
  })
  it('rejects a changed proposal and unknown tokens', () => {
    const r = new ConfirmationRegistry()
    const g = r.issue(proposal)
    expect(() => r.consume(g.token, { ...proposal, notional: dec('1000') })).toThrow(/changed/)
    expect(() => r.consume('forged', proposal)).toThrow(/Unknown/)
  })
})
