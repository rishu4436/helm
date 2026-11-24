import { HelmError } from './errors'
import type { ProviderId } from './providers'

/**
 * HELM environment guard — the single choke point every outbound provider request passes through.
 *
 * Hackathon rule: live trading is disabled. Authenticated (signed) requests may only go to
 * verified demo / paper / sandbox hosts. Production hosts are reachable ONLY for unauthenticated
 * public market-data GETs. There is no fallback to production, ever.
 */

interface HostRule {
  /** Hosts that accept authenticated requests (demo/paper/sandbox/local-gateway only). */
  authenticated: string[]
  /** Hosts allowed for unauthenticated public market-data GETs. */
  publicData: string[]
  /** Path prefixes allowed on publicData hosts (empty = any path). */
  publicPathPrefixes?: string[]
  /** Hosts allowed for authenticated GET-only market data (e.g. Alpaca data API). */
  authenticatedReadOnly?: string[]
  /** Header that must be present with the given value on authenticated requests. */
  requiredAuthHeader?: { name: string; value: string }
  loopbackOnly?: boolean
}

export const ENDPOINT_RULES: Record<ProviderId, HostRule> = {
  binance: {
    authenticated: ['demo-api.binance.com', 'demo-fapi.binance.com', 'demo-ws-api.binance.com', 'demo-stream.binance.com', 'demo-fstream.binance.com'],
    publicData: ['demo-api.binance.com', 'demo-fapi.binance.com', 'demo-stream.binance.com', 'demo-fstream.binance.com', 'data-api.binance.vision'],
  },
  okx: {
    // OKX demo trading shares the production host; the x-simulated-trading header selects demo.
    authenticated: ['www.okx.com', 'wspap.okx.com'],
    publicData: ['www.okx.com', 'ws.okx.com', 'wspap.okx.com'],
    publicPathPrefixes: ['/api/v5/public/', '/api/v5/market/', '/ws/'],
    requiredAuthHeader: { name: 'x-simulated-trading', value: '1' },
  },
  bybit: {
    authenticated: ['api-demo.bybit.com', 'stream-demo.bybit.com'],
    publicData: ['api-demo.bybit.com', 'api.bybit.com', 'stream.bybit.com'],
    publicPathPrefixes: ['/v5/market/', '/v5/public/'],
  },
  coinbase: {
    // Static sandbox needs no auth; HELM never sends Coinbase production credentials in the hackathon.
    authenticated: [],
    publicData: ['api-sandbox.coinbase.com', 'api.coinbase.com'],
    publicPathPrefixes: ['/api/v3/brokerage/'],
  },
  alpaca: {
    authenticated: ['paper-api.alpaca.markets'],
    authenticatedReadOnly: ['data.alpaca.markets', 'stream.data.alpaca.markets'],
    publicData: [],
  },
  ibkr: {
    authenticated: ['localhost', '127.0.0.1', '[::1]', '::1'],
    publicData: [],
    loopbackOnly: true,
  },
}

export interface EndpointCheck {
  provider: ProviderId
  url: string
  method: string
  authenticated: boolean
  headers?: Record<string, string>
}

/** Throws unless HELM_LIVE_TRADING is absent or exactly "false". Call at process start and per request. */
export function assertLiveTradingDisabled(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): void {
  const v = env.HELM_LIVE_TRADING
  if (v !== undefined && v !== '' && v.toLowerCase() !== 'false') {
    throw new HelmError('LIVE_TRADING_DISABLED', `HELM_LIVE_TRADING=${v} is not allowed: live trading is disabled for the hackathon build`)
  }
}

export function assertEndpointAllowed(c: EndpointCheck): void {
  assertLiveTradingDisabled()
  const rule = ENDPOINT_RULES[c.provider]
  if (!rule) throw new HelmError('ENVIRONMENT_MISMATCH', `Unknown provider ${c.provider}`)
  let u: URL
  try { u = new URL(c.url) } catch { throw new HelmError('ENVIRONMENT_MISMATCH', `Invalid URL`, { provider: c.provider }) }

  const host = u.hostname.toLowerCase()
  const method = c.method.toUpperCase()
  const fail = (why: string): never => {
    throw new HelmError('ENVIRONMENT_MISMATCH', `Blocked ${method} ${u.protocol}//${host}${u.pathname}: ${why}`, { provider: c.provider, retryable: false })
  }

  if (u.username || u.password) fail('credentials in URL')
  const secure = u.protocol === 'https:' || u.protocol === 'wss:'
  if (!secure) fail('only https/wss allowed')
  if (rule.loopbackOnly && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) fail('gateway must be on loopback')

  if (c.authenticated) {
    if (rule.authenticated.includes(host)) {
      if (rule.requiredAuthHeader) {
        const want = rule.requiredAuthHeader
        const got = Object.entries(c.headers ?? {}).find(([k]) => k.toLowerCase() === want.name)?.[1]
        if (got !== want.value) fail(`authenticated ${c.provider} requests require ${want.name}: ${want.value}`)
      }
      return
    }
    if (rule.authenticatedReadOnly?.includes(host)) {
      if (method !== 'GET') fail('read-only data host')
      return
    }
    fail('authenticated requests are restricted to demo/paper/sandbox hosts')
  }

  // unauthenticated
  if (method !== 'GET') fail('unauthenticated requests are GET-only market data')
  if (!rule.publicData.includes(host) && !rule.authenticated.includes(host)) fail('host not on public market-data allowlist')
  if (rule.publicPathPrefixes && rule.publicData.includes(host) && !rule.authenticated.includes(host)) {
    if (!rule.publicPathPrefixes.some(p => u.pathname.startsWith(p))) fail('path is not a public market-data path')
  }
  if (c.provider === 'okx' && rule.publicPathPrefixes && !rule.publicPathPrefixes.some(p => u.pathname.startsWith(p))) {
    fail('unauthenticated OKX requests are limited to public/market paths')
  }
}

/** Never let anything that looks like a secret reach logs. */
const SECRET_KEYS = /(secret|signature|sign|passphrase|password|token|api[-_]?key|apca-api|x-mbx-apikey|ok-access|x-bapi|authorization|cookie)/i
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => redact(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v)
    }
    return out as T
  }
  if (typeof value === 'string') {
    return value.replace(/([?&](signature|sign|apiKey|secret)=)[^&]+/gi, '$1[REDACTED]') as T
  }
  return value
}
