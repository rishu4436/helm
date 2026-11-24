/** HELM backend client for the glasses. Holds only the HELM device token — never exchange secrets. */
export const API_BASE: string = (import.meta as unknown as { env: Record<string, string> }).env.VITE_HELM_API ?? 'http://localhost:4000'

export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message) } }

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; data: T }> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Server unreachable')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: { code: string; message: string } }
  if (res.status >= 400) throw new ApiError(res.status, data.error?.code ?? 'HTTP_' + res.status, data.error?.message ?? 'Request failed')
  return { status: res.status, data }
}

export interface PairingStart { pairingId: string; code: string; pollSecret: string; expiresAt: string }
export interface DeviceMe { user: { name: string }; device: { id: string; label: string; activeAccountId: string | null }; accounts: Array<{ id: string; alias: string; provider: string; environment: string; accountType: string; state: string }> }

export const api = {
  health: () => call<{ status: string }>('/health'),
  startPairing: () => call<PairingStart>('/v1/pairing/start', { method: 'POST' }),
  claim: (pairingId: string, pollSecret: string) => call<{ status: 'PENDING' | 'PAIRED'; deviceToken?: string }>('/v1/pairing/claim', { method: 'POST', body: { pairingId, pollSecret } }),
  me: (token: string) => call<DeviceMe>('/v1/device/me', { token }),
  setActive: (token: string, accountId: string) => call<{ ok: boolean }>('/v1/device/active-account', { method: 'POST', token, body: { accountId } }),
}

// ---------- trading/portfolio (device token; server enforces tenant + Shield) ----------
export interface Acct { id: string; alias: string; provider: string; environment: string; environmentLabel: string; state: string; canTrade: boolean; products: string[]; label: string | null }
export interface Finding { rule: string; verdict: 'ALLOW' | 'WARN' | 'BLOCK'; message: string }
export interface PreviewResp {
  proposalId: string; confirmToken: string | null; expiresAt: string; canConfirm: boolean; label: string | null
  account: { id: string; alias: string; provider: string; environmentLabel: string; connectionState: string }
  order: { instrument: string; side: string; type: string; quantity?: string; quoteQuantity?: string; price?: string; reduceOnly?: boolean; leverage?: string }
  preview: { estimatedPrice: string | null; estimatedNotional: string | null; estimatedFee: string | null; estimatedSlippageBps: string | null; requiredMargin: string | null; remainingBuyingPower: string | null; estimateNotes: string[]
    impact: { asset: string; currentExposureUsd: string; proposedExposureUsd: string; currentPositionQty: string; proposedPositionQty: string; spreadBps: string | null; liquidation: { current: string | null; proposed: string | null; note: string } }
    protection: { stopOffsetPercent: string; estimatedStopPrice: string | null; supported: boolean; note: string } | null }
  risk: { verdict: 'ALLOW' | 'WARN' | 'BLOCK'; findings: Finding[]; policyVersion: number }
}
export interface Receipt { orderId: string; account: string; provider: string; environmentLabel: string; label: string | null; instrumentId: string; side: string; type: string; status: string; providerOrderId: string | null; quantity: string | null; quoteQuantity: string | null; filledQuantity: string; avgFillPrice: string | null; fills: Array<{ price: string; qty: string; fee: string | null; feeAsset: string | null }>; protection: { state: string; stopPrice: string | null; protectedQuantity: string } | null; fillTruth: string; orphanCleanup?: Array<{ result: string }> | null; events: Array<{ to: string; reason: string | null }> }
export interface Ticket { accountId: string; asset: string; product: 'spot' | 'perp'; side: 'BUY' | 'SELL'; notional?: string; quantity?: string; fraction?: string; leverage?: string; stopOffsetPercent?: string; reduceOnly?: boolean }
export interface VoiceResp { transcript: string; sttProvider: string; sttLabel: string | null; intent: { intent: string; asset: string | null; side: 'BUY' | 'SELL' | null; product: string | null; notional: string | null; quantity: string | null; fraction: string | null; leverage: string | null; stopOffsetPercent: string | null; provider: string | null }; resolution: { status: string; question?: string; options?: Array<{ id: string; alias: string; provider: string }>; account?: { id: string; alias: string; provider: string }; message?: string }; next: { screen: string; message?: string } }

export const trade = {
  accounts: (t: string) => call<{ accounts: Acct[] }>('/v1/accounts', { token: t }),
  portfolio: (t: string) => call<{ portfolio: any }>('/v1/portfolio', { token: t }),
  watchlist: (t: string) => call<{ source: string; items: Array<{ asset: string; price: string | null }> }>('/v1/markets/watchlist', { token: t }),
  market: (t: string, asset: string) => call<{ asset: string; venues: Array<{ venue: string; bid: string | null; ask: string | null; spreadBps: string | null; error?: string }> }>(`/v1/markets/${asset}`, { token: t }),
  preview: (t: string, tk: Ticket) => call<PreviewResp>('/v1/trade/preview', { method: 'POST', token: t, body: tk }),
  confirm: (t: string, p: PreviewResp, idempotencyKey: string, via: 'glasses' | 'voice') => call<{ receipt: Receipt; replayed?: boolean }>('/v1/trade/confirm', { method: 'POST', token: t, body: { proposalId: p.proposalId, confirmToken: p.confirmToken, idempotencyKey, via } }),
  receipts: (t: string) => call<{ receipts: Receipt[] }>('/v1/receipts', { token: t }),
  pulse: (t: string) => call<{ events: Array<{ kind: string; severity: number; reason: string; count: number }> }>('/v1/pulse', { token: t }),
  compass: (t: string) => call<{ compass: any; netLiquidationUsd: string }>('/v1/shield/compass', { token: t }),
  emergency: (t: string) => call<{ items: Array<{ kind: string; accountId: string; instrumentId: string; detail: string }>; note: string }>('/v1/emergency', { token: t }),
  voice: (t: string, body: { transcript?: string; audioBase64?: string; sampleRate?: number }) => call<VoiceResp>('/v1/voice/command', { method: 'POST', token: t, body }),
}
