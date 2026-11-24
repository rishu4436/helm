export const num = (v: string | number | null | undefined, dp = 2) => {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v); if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
export const usd = (v: string | number | null | undefined, dp = 2) => {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v); if (!Number.isFinite(n)) return '—'
  return `${n < 0 ? '−' : ''}$${num(Math.abs(n), dp)}`
}
export const signedUsd = (v: string | number | null | undefined, dp = 2) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `+${usd(n, dp)}` : usd(v, dp) }
export const pct = (v: string | number | null | undefined, dp = 1) => (v === null || v === undefined ? '—' : `${num(v, dp)}%`)
export const qty = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(Number(v)))
export const ist = (iso: string | null | undefined) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' IST'
}
export const ago = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return `${Math.max(0, s)}s ago`; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
export const sym = (instrumentId: string) => { const p = instrumentId.split(':'); const [b, q] = (p[2] ?? '').split('-'); return { venue: p[0] ?? '', product: p[1] ?? '', base: b ?? '', quote: q ?? '', label: `${b ?? ''}${q ? `/${q}` : ''} ${p[1] === 'perp' ? 'PERP' : (p[1] ?? '').toUpperCase()}` } }
export const tone = (v: string | number | null | undefined) => { const n = Number(v); return !Number.isFinite(n) || n === 0 ? '' : n > 0 ? 'text-up' : 'text-down' }
export const SEV = ['', 'info', 'low', 'medium', 'high', 'critical']
export const REAL_ENV = (env: string) => env === 'demo' || env === 'paper'
