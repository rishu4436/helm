import type { FetchLike } from '../http'

export interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
type Responder = (req: Recorded) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>

/** Route-table fetch mock: first matching [method, url-substring] wins. Records every request. */
export function mockFetch(routes: Array<[string, string, Responder | { status?: number; body?: unknown }]>) {
  const calls: Recorded[] = []
  const fetch: FetchLike = async (url, init) => {
    const req: Recorded = { url, method: init.method, headers: init.headers, body: init.body }
    calls.push(req)
    const route = routes.find(([m, frag]) => m === init.method && url.includes(frag))
    if (!route) return { status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ error: `no mock for ${init.method} ${url}` }) }
    const r = typeof route[2] === 'function' ? await route[2](req) : route[2]
    return { status: r.status ?? 200, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) }
  }
  return { fetch, calls }
}

export const failingFetch = (err = new Error('socket hang up')): FetchLike => async () => { throw err }
