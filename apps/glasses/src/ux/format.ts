import type { Mode } from './terms'

/** Per-render presentation context: Beginner/Pro wording + privacy mode (hides money values on the lens). */
export interface ViewCtx { mode: Mode; privacy: boolean }
export const DEFAULT_CTX: ViewCtx = { mode: 'beginner', privacy: false }

export function usdOf(ctx: ViewCtx) {
  return (s: string | number | null | undefined, dp = 2): string => {
    if (s === null || s === undefined || s === '' || !Number.isFinite(Number(s))) return 'n/a'
    if (ctx.privacy) return '$***'
    const v = Number(s)
    const a = Math.abs(v)
    const d = a >= 10000 ? 0 : dp
    return `${v < 0 ? '-' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
  }
}
export function pnlOf(ctx: ViewCtx) {
  const usd = usdOf(ctx)
  return (s: string | number | null | undefined) => (s === null || s === undefined || s === '' ? 'n/a' : ctx.privacy ? '$***' : `${Number(s) > 0 ? '+' : ''}${usd(s)}`)
}
export const pct = (v: number | null | undefined, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(dp)}%`)
export const signedPct = (v: number | null | undefined, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`)
