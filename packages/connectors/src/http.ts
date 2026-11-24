import { HelmError, assertEndpointAllowed, redact, type ProviderId } from '@helm/shared'

export interface HttpResponseLike { status: number; headers: { get(name: string): string | null }; text(): Promise<string> }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<HttpResponseLike>

export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  url: string
  headers?: Record<string, string>
  body?: string
  authenticated: boolean
  /** Order-submitting requests: timeouts become ORDER_UNKNOWN instead of a retryable error. */
  submitsOrder?: boolean
}

export interface HttpResult { status: number; body: unknown; rawText: string; headers: HttpResponseLike['headers'] }

export interface RequestLogEntry { provider: ProviderId; method: string; url: string; status: number | null; ms: number; error?: string }

/**
 * Every provider HTTP call goes through here: environment guard first, then timeout, then
 * transport-level error normalisation. Provider-level error codes are mapped by each connector.
 */
export class GuardedHttp {
  readonly log: RequestLogEntry[] = []
  constructor(
    readonly provider: ProviderId,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs = 10_000,
  ) {}

  /** Run the environment guard without sending anything (call before clock sync / signing). */
  preflight(req: Pick<HttpRequest, 'url' | 'method' | 'authenticated' | 'headers'>): void {
    assertEndpointAllowed({ provider: this.provider, url: req.url, method: req.method, authenticated: req.authenticated, headers: req.headers })
  }

  async request(req: HttpRequest): Promise<HttpResult> {
    // Throws ENVIRONMENT_MISMATCH / LIVE_TRADING_DISABLED before any byte leaves the process.
    assertEndpointAllowed({ provider: this.provider, url: req.url, method: req.method, authenticated: req.authenticated, headers: req.headers })
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    const started = Date.now()
    const safeUrl = redact(req.url)
    try {
      const res = await this.fetchImpl(req.url, { method: req.method, headers: req.headers ?? {}, body: req.body, signal: ctrl.signal })
      const text = await res.text()
      this.log.push({ provider: this.provider, method: req.method, url: safeUrl, status: res.status, ms: Date.now() - started })
      if (this.log.length > 200) this.log.shift()
      let body: unknown = null
      if (text) { try { body = JSON.parse(text) } catch { body = text } }
      if (res.status === 429 || res.status === 418) {
        throw new HelmError('RATE_LIMITED', undefined, { provider: this.provider, providerCode: String(res.status), retryable: true })
      }
      if (res.status >= 500 && !req.submitsOrder) {
        throw new HelmError('EXCHANGE_UNAVAILABLE', undefined, { provider: this.provider, providerCode: String(res.status) })
      }
      if (res.status >= 500 && req.submitsOrder) {
        // Binance documents that 5xx on order endpoints means "execution status unknown".
        throw new HelmError('ORDER_UNKNOWN', undefined, { provider: this.provider, providerCode: String(res.status), retryable: false })
      }
      return { status: res.status, body, rawText: text, headers: res.headers }
    } catch (e) {
      if (e instanceof HelmError) throw e
      const msg = e instanceof Error ? e.message : String(e)
      this.log.push({ provider: this.provider, method: req.method, url: safeUrl, status: null, ms: Date.now() - started, error: msg })
      if (req.submitsOrder) {
        throw new HelmError('ORDER_UNKNOWN', undefined, { provider: this.provider, detail: `transport failure during submit: ${msg}`, retryable: false, cause: e })
      }
      throw new HelmError('EXCHANGE_UNAVAILABLE', undefined, { provider: this.provider, detail: msg, cause: e })
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Tracks local-vs-server clock offset so signed timestamps stay inside the provider's recvWindow. */
export class ClockSync {
  private offsetMs = 0
  private syncedAt = 0
  constructor(private readonly fetchServerTimeMs: () => Promise<number>, private readonly maxAgeMs = 5 * 60_000, private readonly nowFn: () => number = Date.now) {}
  async sync(): Promise<number> {
    const t0 = this.nowFn()
    const server = await this.fetchServerTimeMs()
    const t1 = this.nowFn()
    this.offsetMs = server - Math.round((t0 + t1) / 2)
    this.syncedAt = t1
    return this.offsetMs
  }
  async now(): Promise<number> {
    if (this.nowFn() - this.syncedAt > this.maxAgeMs) {
      try { await this.sync() } catch { /* fall back to last offset; provider will reject if skewed */ }
    }
    return this.nowFn() + this.offsetMs
  }
  get offset() { return this.offsetMs }
}

export function newClientOrderId(prefix = 'helm'): string {
  // Provider limits: Binance 36 chars [.A-Z:/a-z0-9_-], OKX 32 alnum, Bybit 36. Keep 24 alnum.
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 16)
  return `${prefix}${Date.now().toString(36)}${rand}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
}

export function nowIso(): string { return new Date().toISOString() }
