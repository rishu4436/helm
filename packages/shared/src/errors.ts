import type { ProviderId } from './providers'

export const HELM_ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'INSUFFICIENT_PERMISSIONS',
  'EXCESSIVE_PERMISSIONS',
  'UNSUPPORTED_OPERATION',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_MARGIN',
  'INVALID_INSTRUMENT',
  'INVALID_QUANTITY',
  'INVALID_PRICE',
  'MARKET_CLOSED',
  'RATE_LIMITED',
  'EXCHANGE_UNAVAILABLE',
  'CONNECTION_EXPIRED',
  'ORDER_REJECTED',
  'ORDER_UNKNOWN',
  'STALE_PROPOSAL',
  'RISK_POLICY_VIOLATION',
  'ENVIRONMENT_MISMATCH',
  'LIVE_TRADING_DISABLED',
  'ACCESS_RESTRICTED',
  'PROVIDER_ERROR',
] as const
export type HelmErrorCode = (typeof HELM_ERROR_CODES)[number]

/** User-safe messages. Never include secrets, signatures or raw provider payloads here. */
const USER_MESSAGES: Record<HelmErrorCode, string> = {
  INVALID_CREDENTIALS: 'The exchange rejected these API credentials.',
  INSUFFICIENT_PERMISSIONS: 'This API key lacks a permission HELM needs for this action.',
  EXCESSIVE_PERMISSIONS: 'This API key has permissions HELM never needs (e.g. withdrawals). Create a narrower key.',
  UNSUPPORTED_OPERATION: 'This exchange connection does not support that action.',
  INSUFFICIENT_BALANCE: 'Not enough available balance.',
  INSUFFICIENT_MARGIN: 'Not enough available margin.',
  INVALID_INSTRUMENT: 'That instrument is not available on this account.',
  INVALID_QUANTITY: 'Quantity does not meet the instrument rules.',
  INVALID_PRICE: 'Price does not meet the instrument rules.',
  MARKET_CLOSED: 'The market is closed for this instrument.',
  RATE_LIMITED: 'The exchange rate limit was hit. Try again shortly.',
  EXCHANGE_UNAVAILABLE: 'The exchange is unreachable right now.',
  CONNECTION_EXPIRED: 'This connection expired. Reconnect the account.',
  ORDER_REJECTED: 'The exchange rejected the order.',
  ORDER_UNKNOWN: 'Order state is unknown. HELM is checking the exchange before doing anything else.',
  STALE_PROPOSAL: 'This preview expired or the market moved. Review a fresh preview.',
  RISK_POLICY_VIOLATION: 'Blocked by your HELM Shield risk policy.',
  ENVIRONMENT_MISMATCH: 'Blocked: this endpoint or account is not a verified demo/paper environment.',
  LIVE_TRADING_DISABLED: 'Live trading is disabled in HELM.',
  ACCESS_RESTRICTED: 'The exchange restricted this request (region, compliance or IP rules). HELM will not work around it.',
  PROVIDER_ERROR: 'The exchange returned an error.',
}

export interface HelmErrorOptions {
  provider?: ProviderId
  /** Provider's own error code (e.g. Binance -2010, OKX 51008, Bybit 110007). Safe to show. */
  providerCode?: string
  /** Internal detail for logs (must already be redacted). */
  detail?: string
  retryable?: boolean
  cause?: unknown
}

export class HelmError extends Error {
  readonly code: HelmErrorCode
  readonly provider?: ProviderId
  readonly providerCode?: string
  readonly detail?: string
  readonly retryable: boolean

  constructor(code: HelmErrorCode, message?: string, opts: HelmErrorOptions = {}) {
    super(message ?? USER_MESSAGES[code], { cause: opts.cause })
    this.name = 'HelmError'
    this.code = code
    this.provider = opts.provider
    this.providerCode = opts.providerCode
    this.detail = opts.detail
    this.retryable = opts.retryable ?? (code === 'RATE_LIMITED' || code === 'EXCHANGE_UNAVAILABLE')
  }

  get userMessage(): string {
    return USER_MESSAGES[this.code]
  }

  toJSON() {
    return { code: this.code, message: this.userMessage, provider: this.provider, providerCode: this.providerCode, retryable: this.retryable }
  }
}

/** Thrown when an adapter is asked for an operation its capability manifest does not declare. */
export class CapabilityError extends HelmError {
  readonly operation: string
  constructor(provider: ProviderId, operation: string, reason?: string) {
    super('UNSUPPORTED_OPERATION', `${provider} does not support ${operation}${reason ? `: ${reason}` : ''}`, { provider, retryable: false })
    this.name = 'CapabilityError'
    this.operation = operation
  }
}

export function isHelmError(e: unknown): e is HelmError {
  return e instanceof HelmError
}
