'use client'

export const API = process.env.NEXT_PUBLIC_HELM_API ?? 'http://localhost:4000'
const KEY = 'helm.session'

export function getToken(): string | null { return typeof window === 'undefined' ? null : sessionStorage.getItem(KEY) }
export function setToken(t: string | null) { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY) }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly reasons: string[] = []) { super(message) }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.auth !== false) { const t = getToken(); if (t) headers.Authorization = `Bearer ${t}` }
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  } catch {
    throw new ApiError(0, 'NETWORK', 'HELM API is unreachable')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && init.auth !== false) setToken(null)
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP', data?.error?.message ?? 'Request failed', data?.error?.reasons ?? [])
  }
  return data as T
}

export interface ProviderInfo { id: string; name: string; assetClasses: string[]; hackathonEnvironment: string; trackEligible: boolean; connectionMethod: string; notes: string; enabled: boolean }
export interface Manifest { provider: string; environment: string; accountTypes: string[]; spot: boolean; futures: boolean; stocks: boolean; orderTypes: string[]; reduceOnly: boolean; hedgeMode: boolean; margin: boolean; cancelReplace: boolean; streaming: { market: boolean; account: boolean }; simulation: string; operations: string[]; restrictions: string[] }
export interface Connection { id: string; provider: string; environment: string; alias: string; state: string; reasons: string[]; lastCheckedAt: string | null; credential: { keyFingerprint: string; scopes: string[] } | null; accounts: Array<{ id: string; alias: string; accountType: string; capabilities: Manifest | null }> }
