import { describe, expect, it } from 'vitest'
import { dec, type Instrument } from '@helm/shared'
import { ProtectionWorkflow, clientOrderIdFor, materialChange, protectiveQuantity, protectiveStopPrice } from './protection'

const inst = { lotSize: dec('0.00001'), minQty: dec('0.00001'), tickSize: dec('0.01') } as Instrument
describe('Trade-to-Protect', () => {
  it('happy path and failure path states', () => {
    const w = new ProtectionWorkflow()
    w.to('ENTRY_SUBMITTED'); w.to('ENTRY_FILLED'); w.to('PROTECTION_SUBMITTED'); w.to('PROTECTED')
    expect(w.history.map(h => h.to)).toEqual(['PLANNED', 'ENTRY_SUBMITTED', 'ENTRY_FILLED', 'PROTECTION_SUBMITTED', 'PROTECTED'])
    const f = new ProtectionWorkflow('PROTECTION_SUBMITTED'); f.to('UNPROTECTED', 'venue rejected stop')
    expect(f.state).toBe('UNPROTECTED')
    expect(() => new ProtectionWorkflow('PLANNED').to('PROTECTED')).toThrow(/Illegal/)
  })
  it('partial entry fill can be protected for the filled part', () => {
    const w = new ProtectionWorkflow('ENTRY_SUBMITTED'); w.to('ENTRY_PARTIAL'); w.to('PROTECTION_SUBMITTED'); w.to('PROTECTED')
    expect(w.state).toBe('PROTECTED')
  })
  it('stop price 3% below a long entry, rounded to tick away from price', () => {
    expect(protectiveStopPrice(dec('60000.55'), 'BUY', dec(3), dec('0.01')).toFixed()).toBe('58200.53')
    expect(protectiveStopPrice(dec('60000'), 'SELL', dec(3), dec('0.1')).toFixed()).toBe('61800')
    expect(() => protectiveStopPrice(dec(1), 'BUY', dec(0), dec('0.01'))).toThrow()
  })
  it('protective quantity comes from actual fills minus base fee, capped by free balance', () => {
    expect(protectiveQuantity({ filledQty: dec('0.00018'), baseFee: dec('0.00000018'), instrument: inst }).toFixed()).toBe('0.00017')
    expect(protectiveQuantity({ filledQty: dec('0.002'), freeBase: dec('0.0015'), instrument: inst }).toFixed()).toBe('0.0015')
    expect(protectiveQuantity({ filledQty: dec('0.000001'), instrument: inst }).toFixed()).toBe('0')
  })
  it('client order id is deterministic and venue-safe', () => {
    const a = clientOrderIdFor('cmwue4hal000a9xsgvleic1z3')
    expect(a).toBe(clientOrderIdFor('cmwue4hal000a9xsgvleic1z3'))
    expect(a.length).toBeLessThanOrEqual(36); expect(a).toMatch(/^[A-Za-z0-9]+$/)
    expect(clientOrderIdFor('x', 's')).not.toBe(clientOrderIdFor('x', 'e'))
  })
  it('material change detection', () => {
    expect(materialChange(dec(60000), dec(60200)).material).toBe(false) // 33.3 bps ≤ 50
    expect(materialChange(dec(60000), dec(60400)).material).toBe(true) // 66.7 bps
    expect(materialChange(null, dec(1)).material).toBe(true) // unknown ⇒ treat as material
  })
})
