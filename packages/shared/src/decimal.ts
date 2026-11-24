import DecimalJs from 'decimal.js'

/**
 * HELM money math. Every price, quantity, balance and fee is a Decimal.
 * JavaScript `number` is never used for financial values.
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN, toExpNeg: -30, toExpPos: 40 })
export type Decimal = InstanceType<typeof Decimal>

/** Decimal values cross API boundaries as plain decimal strings ("123.45"). */
export type DecimalString = string

const DECIMAL_RE = /^-?(?:\d+)(?:\.\d+)?$/

/**
 * Parse a provider/user value into a Decimal.
 * Accepts decimal strings, Decimals, bigints and *safe integers* only:
 * fractional JS numbers are rejected because they may already carry binary rounding error.
 */
export function dec(value: string | number | bigint | Decimal): Decimal {
  if (value instanceof Decimal) return value
  if (typeof value === 'bigint') return new Decimal(value.toString())
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Refusing non-integer JS number ${value} as money; pass a decimal string`)
    }
    return new Decimal(value)
  }
  const s = value.trim()
  // providers sometimes send "1e-8" or "" — handle explicitly
  if (s === '') throw new TypeError('Empty decimal string')
  if (!DECIMAL_RE.test(s) && !/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) {
    throw new TypeError(`Invalid decimal string: ${JSON.stringify(value)}`)
  }
  return new Decimal(s)
}

/** Parse, returning null for null/undefined/empty (common in exchange payloads). */
export function decOrNull(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === '') return null
  return dec(value)
}

export function toDecimalString(d: Decimal): DecimalString {
  return d.toFixed()
}

/** Round a quantity DOWN to the provider's lot step (never round up a size the user can't afford). */
export function floorToStep(value: Decimal, step: Decimal): Decimal {
  if (step.lte(0)) throw new RangeError('step must be > 0')
  return value.div(step).floor().mul(step)
}

/** Round a price to the tick size. BUY limits round down, SELL limits round up (never cross worse than asked). */
export function roundToTick(price: Decimal, tick: Decimal, side: 'BUY' | 'SELL'): Decimal {
  if (tick.lte(0)) throw new RangeError('tick must be > 0')
  const q = price.div(tick)
  return (side === 'BUY' ? q.floor() : q.ceil()).mul(tick)
}

export function isMultipleOf(value: Decimal, step: Decimal): boolean {
  if (step.lte(0)) return false
  return value.mod(step).eq(0)
}

/** Number of decimal places implied by a step like "0.00100000" → 3. */
export function stepDecimals(step: Decimal): number {
  return step.decimalPlaces()
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce((a, b) => a.plus(b), new Decimal(0))
}

/** Display helper for UI only (never feed the output back into calculations). */
export function formatMoney(d: Decimal, currency = 'USD', dp = 2): string {
  const sign = d.isNeg() ? '-' : ''
  const [int, frac] = d.abs().toFixed(dp, Decimal.ROUND_HALF_EVEN).split('.')
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sym = currency === 'USD' ? '$' : ''
  return `${sign}${sym}${grouped}${frac ? '.' + frac : ''}${sym ? '' : ' ' + currency}`
}
