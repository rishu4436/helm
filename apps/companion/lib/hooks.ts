'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

/** Fetch an API resource; `reload()` refetches. Errors are surfaced, never swallowed. */
export function useApi<T>(path: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(!!path)
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!path) return
    const n = ++seq.current
    setLoading(true)
    try { const d = await api<T>(path); if (n === seq.current) { setData(d); setError(null) } }
    catch (e) { if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'ERR', (e as Error).message)) }
    finally { if (n === seq.current) setLoading(false) }
  }, [path])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!opts.poll) return; const t = setInterval(load, opts.poll); return () => clearInterval(t) }, [load, opts.poll])
  return { data, error, loading, reload: load, setData }
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

export const newIdemKey = () => `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
