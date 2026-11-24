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
