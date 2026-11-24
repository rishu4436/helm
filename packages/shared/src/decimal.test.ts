import { describe, expect, it } from 'vitest'
import { Decimal, dec, decOrNull, floorToStep, formatMoney, isMultipleOf, roundToTick, stepDecimals, sum, toDecimalString } from './decimal'

describe('decimal money math', () => {
  it('avoids binary floating point error', () => {
    expect(dec('0.1').plus(dec('0.2')).eq(dec('0.3'))).toBe(true)
    expect(0.1 + 0.2 === 0.3).toBe(false) // the reason this module exists
  })
  it('rejects fractional JS numbers but accepts safe integers', () => {
    expect(() => dec(0.1)).toThrow(/non-integer/)
    expect(dec(100).toFixed()).toBe('100')
    expect(() => dec(Number.MAX_SAFE_INTEGER + 2)).toThrow()
  })
  it('parses provider strings including exponent form and rejects garbage', () => {
    expect(dec('1e-8').toFixed()).toBe('0.00000001')
    expect(dec(' 42.50 ').toFixed()).toBe('42.5')
    expect(() => dec('')).toThrow()
    expect(() => dec('12,5')).toThrow()
    expect(() => dec('NaN')).toThrow()
    expect(decOrNull('')).toBeNull()
    expect(decOrNull(undefined)).toBeNull()
  })
  it('floors quantity to lot step', () => {
    expect(floorToStep(dec('0.123456'), dec('0.001')).toFixed()).toBe('0.123')
    expect(floorToStep(dec('5'), dec('0.5')).toFixed()).toBe('5')
    expect(() => floorToStep(dec('1'), dec('0'))).toThrow()
  })
  it('rounds price to tick in the safe direction', () => {
    expect(roundToTick(dec('100.037'), dec('0.01'), 'BUY').toFixed()).toBe('100.03')
    expect(roundToTick(dec('100.031'), dec('0.01'), 'SELL').toFixed()).toBe('100.04')
  })
  it('checks multiples and step decimals', () => {
    expect(isMultipleOf(dec('0.0030'), dec('0.001'))).toBe(true)
    expect(isMultipleOf(dec('0.0035'), dec('0.001'))).toBe(false)
    expect(stepDecimals(dec('0.00100000'))).toBe(3)
  })
  it('sums with full precision', () => {
    const parts = Array.from({ length: 10 }, () => dec('0.1'))
    expect(sum(parts).toFixed()).toBe('1')
    expect(toDecimalString(new Decimal('123456789012345678901234.123456789'))).toBe('123456789012345678901234.123456789')
  })
  it('formats money with banker rounding for display only', () => {
    expect(formatMoney(dec('1234567.125'))).toBe('$1,234,567.12')
    expect(formatMoney(dec('-0.5'), 'USD')).toBe('-$0.50')
    expect(formatMoney(dec('2.5'), 'BTC', 4)).toBe('2.5000 BTC')
  })
})
