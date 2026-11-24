import { describe, expect, it } from 'vitest'
import { assertCapability, assertOrderTypeSupported, assertTradeable, type CapabilityManifest } from './capabilities'
import { CapabilityError, HelmError } from './errors'
import { BaseAdapter } from './adapter'
import { canSubmitOrders, canTransition, deriveConnectionHealth } from './connection'

const manifest: CapabilityManifest = {
  provider: 'coinbase', environment: 'sandbox_static', accountTypes: ['portfolio'],
  permissions: { read: true, trade: false, withdraw: false }, products: ['spot'], spot: true, futures: false, stocks: false,
  orderTypes: ['MARKET', 'LIMIT'], reduceOnly: false, hedgeMode: false, margin: false, cancelReplace: false,
  streaming: { market: false, account: false }, simulation: 'static_responses', operations: ['getBalances'], restrictions: [], verification: 'documented',
}

describe('capability errors', () => {
  it('throws typed CapabilityError for undeclared operations', () => {
    expect(() => assertCapability(manifest, 'getBalances')).not.toThrow()
    try { assertCapability(manifest, 'submitOrder') } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError)
      expect((e as HelmError).code).toBe('UNSUPPORTED_OPERATION')
      expect((e as CapabilityError).operation).toBe('submitOrder')
      expect((e as HelmError).retryable).toBe(false)
    }
    expect(() => assertOrderTypeSupported(manifest, 'STOP_MARKET')).toThrow(CapabilityError)
    expect(() => assertTradeable(manifest)).toThrow(/read-only/)
  })

  it('BaseAdapter defaults every operation to CapabilityError (no silent substitution)', async () => {
    class Empty extends BaseAdapter {
      provider = 'okx' as const
      getCapabilities() { return { ...manifest, provider: 'okx' as const } }
      async connect() { return deriveConnectionHealth({ authenticatedReadOk: false, environmentVerified: false, canRead: false, canTrade: false, excessivePermissions: false }) }
      getConnectionState() { return { state: 'DISCONNECTED' as const, reasons: [], checkedAt: '' } }
    }
    const a = new Empty()
    await expect(a.submitOrder({} as never)).rejects.toBeInstanceOf(CapabilityError)
    await expect(a.getPositions()).rejects.toThrow(/okx does not support getPositions/)
    await expect(a.amendOrder('x', {}, {})).rejects.toBeInstanceOf(CapabilityError)
  })

  it('serialises safely for the UI', () => {
    const e = new HelmError('INVALID_CREDENTIALS', undefined, { provider: 'bybit', providerCode: '10003', detail: 'internal' })
    expect(e.toJSON()).toEqual({ code: 'INVALID_CREDENTIALS', message: 'The exchange rejected these API credentials.', provider: 'bybit', providerCode: '10003', retryable: false })
    expect(new HelmError('RATE_LIMITED').retryable).toBe(true)
  })
})

describe('connection health', () => {
  const base = { authenticatedReadOk: true, environmentVerified: true, canRead: true, canTrade: true, excessivePermissions: false }
  it('requires authenticated read + verified environment for CONNECTED', () => {
    expect(deriveConnectionHealth(base).state).toBe('CONNECTED')
    expect(deriveConnectionHealth({ ...base, authenticatedReadOk: false }).state).toBe('ERROR')
    expect(deriveConnectionHealth({ ...base, environmentVerified: false }).state).toBe('ERROR')
    expect(deriveConnectionHealth({ ...base, canTrade: false }).state).toBe('READ_ONLY')
    expect(deriveConnectionHealth({ ...base, excessivePermissions: true }).state).toBe('LIMITED')
    expect(deriveConnectionHealth({ ...base, partial: true }).state).toBe('LIMITED')
    expect(deriveConnectionHealth({ ...base, sessionExpired: true }).state).toBe('EXPIRED')
    expect(deriveConnectionHealth({ ...base, authenticatedReadOk: false, error: 'HTTP 200 but empty body' }).reasons).toContain('HTTP 200 but empty body')
  })
  it('enforces state transitions and order gating', () => {
    expect(canTransition('EXPIRED', 'CONNECTED')).toBe(false)
    expect(canTransition('EXPIRED', 'RECONNECTING')).toBe(true)
    expect(canSubmitOrders('CONNECTED')).toBe(true)
    for (const s of ['READ_ONLY', 'LIMITED', 'EXPIRED', 'RECONNECTING', 'DISCONNECTED', 'ERROR'] as const) expect(canSubmitOrders(s)).toBe(false)
  })
})
