export const CONNECTION_STATES = ['CONNECTED', 'READ_ONLY', 'LIMITED', 'EXPIRED', 'RECONNECTING', 'DISCONNECTED', 'ERROR'] as const
export type ConnectionState = (typeof CONNECTION_STATES)[number]

export interface ConnectionCheck {
  /** An authenticated, account-scoped read succeeded and parsed (not just HTTP 200). */
  authenticatedReadOk: boolean
  /** The endpoint/account was positively identified as demo/paper/sandbox. */
  environmentVerified: boolean
  canRead: boolean
  canTrade: boolean
  /** Key/session has dangerous scopes (withdraw/transfer) → never CONNECTED. */
  excessivePermissions: boolean
  sessionExpired?: boolean
  /** Some declared capabilities failed to verify (e.g. futures account missing). */
  partial?: boolean
  error?: string
}

export interface ConnectionHealth {
  state: ConnectionState
  reasons: string[]
  checkedAt: string
}

/**
 * Derive a health state from evidence. A connection is never CONNECTED just because a request
 * returned HTTP 200: it needs an authenticated read, a verified non-live environment and no
 * excessive permissions.
 */
export function deriveConnectionHealth(c: ConnectionCheck, now = new Date()): ConnectionHealth {
  const reasons: string[] = []
  let state: ConnectionState
  if (c.sessionExpired) {
    state = 'EXPIRED'; reasons.push('Session or credentials expired')
  } else if (c.error && !c.authenticatedReadOk) {
    state = 'ERROR'; reasons.push(c.error)
  } else if (!c.authenticatedReadOk) {
    state = 'ERROR'; reasons.push('No authenticated account read succeeded')
  } else if (!c.environmentVerified) {
    state = 'ERROR'; reasons.push('Environment could not be verified as demo/paper — trading blocked')
  } else if (c.excessivePermissions) {
    state = 'LIMITED'; reasons.push('Key has excessive permissions (withdraw/transfer) — trading disabled until replaced')
  } else if (c.canRead && !c.canTrade) {
    state = 'READ_ONLY'; reasons.push('Key is read-only')
  } else if (c.partial) {
    state = 'LIMITED'; reasons.push('Some capabilities could not be verified')
  } else if (c.canRead && c.canTrade) {
    state = 'CONNECTED'
  } else {
    state = 'ERROR'; reasons.push('Key has no usable permissions')
  }
  return { state, reasons, checkedAt: now.toISOString() }
}

const ALLOWED: Record<ConnectionState, ConnectionState[]> = {
  DISCONNECTED: ['RECONNECTING', 'CONNECTED', 'READ_ONLY', 'LIMITED', 'ERROR'],
  RECONNECTING: ['CONNECTED', 'READ_ONLY', 'LIMITED', 'ERROR', 'EXPIRED', 'DISCONNECTED'],
  CONNECTED: ['RECONNECTING', 'EXPIRED', 'ERROR', 'DISCONNECTED', 'LIMITED', 'READ_ONLY'],
  READ_ONLY: ['RECONNECTING', 'EXPIRED', 'ERROR', 'DISCONNECTED', 'CONNECTED', 'LIMITED'],
  LIMITED: ['RECONNECTING', 'EXPIRED', 'ERROR', 'DISCONNECTED', 'CONNECTED', 'READ_ONLY'],
  EXPIRED: ['RECONNECTING', 'DISCONNECTED'],
  ERROR: ['RECONNECTING', 'DISCONNECTED'],
}

export function canTransition(from: ConnectionState, to: ConnectionState): boolean {
  return ALLOWED[from].includes(to)
}

/**
 * Only these states may submit orders. Real demo/paper connections must be CONNECTED.
 * Sandbox/simulated connections are honestly LIMITED (no real execution) and may run their
 * labelled sandbox/simulated submit path.
 */
export function canSubmitOrders(state: ConnectionState, environment?: string): boolean {
  if (state === 'CONNECTED') return environment !== 'live'
  return state === 'LIMITED' && (environment === 'sandbox_static' || environment === 'simulated')
}
