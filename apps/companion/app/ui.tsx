'use client'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import type { ApiError } from '@/lib/api'
import type { ImageBox, ScreenSpec } from '@helm/glasses/src/layout'
import { layoutGraphic } from '@helm/glasses/src/gfx/graphics'
import { paintOps } from '@helm/glasses/src/gfx/raster'

type BtnProps = { children: React.ReactNode; onClick?: () => void | Promise<void>; href?: string; variant?: 'amber' | 'ghost' | 'danger' | 'quiet'; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit'; title?: string; className?: string; testId?: string; danger?: boolean }
/** Every button either navigates (href), submits a form, or runs an action. No dead buttons (enforced at render). */
export function Btn({ children, onClick, href, variant = 'ghost', busy, disabled, type = 'button', title, className = '', testId, danger }: BtnProps) {
  const cls = `btn ${variant === 'amber' ? 'btn-amber' : variant === 'danger' ? 'btn-danger' : variant === 'quiet' ? 'btn-quiet' : 'btn-ghost'} ${className}`
  if (href) return <Link href={href} className={cls} title={title} data-testid={testId}>{children}</Link>
  if (type !== 'submit' && !onClick) throw new Error('Btn needs onClick, href or type=submit')
  return <button type={type} className={cls} onClick={onClick ? () => { void onClick() } : undefined} disabled={disabled || busy} title={title} data-testid={testId} data-danger={danger ? '1' : undefined}>{busy ? <Spinner /> : null}{children}</button>
}
export const Spinner = () => <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />

export function PageHeader({ title, subtitle, actions, kicker }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; kicker?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        {kicker && <div className="mb-1 text-[11px] font-semibold tracking-[0.22em] text-amber-helm">{kicker}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-graphite-300">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, action, children, className = '', pad = true, testId }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean; testId?: string }) {
  return (
    <section className={`card ${className}`} data-testid={testId}>
      {(title || action) && <div className="flex items-center gap-3 border-b border-graphite-800 px-5 py-3"><h2 className="text-[12px] font-semibold tracking-[0.16em] text-graphite-300 uppercase">{title}</h2><div className="ml-auto flex gap-2">{action}</div></div>}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, sub, tone = '', testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; testId?: string }) {
  return (
    <div className="card p-4" data-testid={testId}>
      <div className="text-[11px] font-semibold tracking-[0.14em] text-graphite-500 uppercase">{label}</div>
      <div className={`num mt-1.5 text-2xl font-semibold ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-graphite-500">{sub}</div>}
    </div>
  )
}

const STATE_STYLE: Record<string, string> = {
  CONNECTED: 'bg-up/15 text-up', READ_ONLY: 'bg-sky-400/15 text-sky-300', LIMITED: 'bg-amber-helm/15 text-amber-helm',
  EXPIRED: 'bg-down/15 text-down', ERROR: 'bg-down/15 text-down', RECONNECTING: 'bg-graphite-700 text-graphite-300', DISCONNECTED: 'bg-graphite-700 text-graphite-300',
  PROTECTED: 'bg-up/15 text-up', UNPROTECTED: 'bg-down/15 text-down', PENDING: 'bg-amber-helm/15 text-amber-helm', CANCELED: 'bg-graphite-700 text-graphite-300',
  FILLED: 'bg-up/15 text-up', PARTIALLY_FILLED: 'bg-amber-helm/15 text-amber-helm', ACCEPTED: 'bg-sky-400/15 text-sky-300', REJECTED: 'bg-down/15 text-down', UNKNOWN: 'bg-down/15 text-down', RECONCILING: 'bg-amber-helm/15 text-amber-helm', EXPIRED_ORDER: 'bg-graphite-700',
  PASS: 'bg-up/15 text-up', WARN: 'bg-amber-helm/15 text-amber-helm', FAIL: 'bg-down/15 text-down', BLOCKED: 'bg-down/15 text-down',
  ALLOW: 'bg-up/15 text-up', BLOCK: 'bg-down/15 text-down', ok: 'bg-up/15 text-up', attention: 'bg-amber-helm/15 text-amber-helm', previewed: 'bg-sky-400/15 text-sky-300', blocked: 'bg-down/15 text-down', needs_account: 'bg-amber-helm/15 text-amber-helm', error: 'bg-down/15 text-down', draft: 'bg-graphite-700 text-graphite-300', needs_params: 'bg-amber-helm/15 text-amber-helm', no_account: 'bg-down/15 text-down',
}
export function Pill({ v, title }: { v: string; title?: string }) {
  return <span title={title} className={`pill whitespace-nowrap ${STATE_STYLE[v] ?? 'bg-graphite-700 text-graphite-300'}`}>{v.replace(/_/g, ' ')}</span>
}
const ENV_STYLE: Record<string, string> = { demo: 'text-up border-up/40', paper: 'text-sky-300 border-sky-400/40', sandbox_static: 'text-amber-helm border-amber-helm/40', simulated: 'text-violet-300 border-violet-400/40', blocked: 'text-down border-down/40' }
const ENV_TEXT: Record<string, string> = { demo: 'DEMO', paper: 'PAPER', sandbox_static: 'STATIC SANDBOX', simulated: 'SIMULATED', blocked: 'BLOCKED' }
export function EnvPill({ env }: { env: string }) { return <span className={`pill whitespace-nowrap border ${ENV_STYLE[env] ?? 'border-graphite-700'}`}>{ENV_TEXT[env] ?? env}</span> }

export function ErrorNote({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-down/40 bg-down/5 px-4 py-3 text-sm text-down">
      <span>{error.message}</span>
      {'reasons' in error && (error as ApiError).reasons?.length ? <span className="text-graphite-300">{(error as ApiError).reasons.join(' · ')}</span> : null}
      {onRetry && <Btn variant="quiet" onClick={onRetry} className="ml-auto">Retry</Btn>}
    </div>
  )
}
export function Empty({ title, hint, action }: { title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-graphite-700 px-5 py-8 text-center"><div className="font-medium text-graphite-100">{title}</div>{hint && <div className="mt-1 text-sm text-graphite-500">{hint}</div>}{action && <div className="mt-4 flex justify-center gap-2">{action}</div>}</div>
}
export const Skeleton = ({ h = 'h-24' }: { h?: string }) => <div className={`animate-pulse rounded-xl bg-graphite-900 ${h}`} />

export function Modal({ open, title, children, onClose, wide }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); ref.current?.focus(); return () => window.removeEventListener('keydown', k) }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} outline-none`}>
        <div className="flex items-center border-b border-graphite-800 px-5 py-3"><h3 className="font-semibold">{title}</h3><button className="ml-auto rounded-md px-2 text-graphite-300 hover:text-graphite-100" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="max-h-[75vh] overflow-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block text-sm"><span className="text-graphite-300">{label}</span><div className="mt-1">{children}</div>{hint && <span className="mt-1 block text-xs text-graphite-500">{hint}</span>}</label>
}

export function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="inline-flex rounded-lg border border-graphite-700 p-0.5" data-testid={testId}>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`rounded-md px-3 py-1 text-sm ${value === v ? 'bg-graphite-700 text-graphite-100' : 'text-graphite-300 hover:text-graphite-100'}`}>{l}</button>)}
    </div>
  )
}

/** Faithful G2 HUD render of a ScreenSpec (576×288, single green, firmware-like font metrics). */
export function G2Screen({ spec, selected = 0, scale = 1, caption, testId }: { spec: ScreenSpec; selected?: number; scale?: number; caption?: string; testId?: string }) {
  return (
    <figure className="inline-block" data-testid={testId}>
      <div className="g2-glass relative overflow-hidden rounded-[18px] border border-graphite-800" style={{ width: 576 * scale, height: 288 * scale }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: 576, height: 288, transform: `scale(${scale})` }}>
          {spec.texts.filter(t => t.text.trim()).map(t => (
            <div key={t.id} className="g2-text absolute overflow-hidden whitespace-pre-wrap" style={{ left: t.x, top: t.y, width: t.w, height: t.h, padding: t.pad ?? 0, fontSize: 21, lineHeight: '27px', border: t.border ? `${t.border}px solid rgba(77,255,124,.55)` : undefined, borderRadius: t.radius }}>{t.text}</div>
          ))}
          {(spec.lists ?? []).map(l => {
            const rows = Math.max(1, Math.floor(l.h / 34)); const start = Math.min(Math.max(0, selected - rows + 1), Math.max(0, l.items.length - rows))
            return (
              <div key={l.id} className="absolute" style={{ left: l.x, top: l.y, width: l.w, height: l.h }}>
                {l.items.slice(start, start + rows).map((it, i) => (
                  <div key={i} className="g2-text overflow-hidden whitespace-nowrap px-2" style={{ height: 34, lineHeight: '30px', fontSize: 21, border: start + i === selected ? '2px solid rgba(77,255,124,.8)' : '2px solid transparent', borderRadius: 6 }}>{it}</div>
                ))}
              </div>
            )
          })}
          {(spec.images ?? []).map(im => im.draw === 'wordmark' ? <div key={im.id} className="g2-text absolute flex items-center justify-center text-[64px] font-bold tracking-[0.25em]" style={{ left: im.x, top: im.y, width: im.w, height: im.h }}>HELM</div> : typeof im.draw === 'object' && 'gfx' in im.draw ? <GfxImage key={im.id} im={im} /> : null)}
        </div>
      </div>
      {caption && <figcaption className="mt-2 text-center text-xs text-graphite-500">{caption}</figcaption>}
    </figure>
  )
}

/** Paints a glasses graphic with the exact same draw ops the G2 receives (layoutGraphic → paintOps), tinted G2 green. */
function GfxImage({ im }: { im: ImageBox }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const draw = im.draw as { gfx: Parameters<typeof layoutGraphic>[0] }
  const sig = JSON.stringify(draw.gfx)
  useEffect(() => {
    const c = ref.current; const g = c?.getContext('2d'); if (!c || !g) return
    g.clearRect(0, 0, im.w, im.h)
    try { paintOps(g, layoutGraphic(draw.gfx, im.w, im.h), im.w, im.h, [77, 255, 124]) } catch { /* fall back to alt text below */ }
  }, [sig, im.w, im.h]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={im.w} height={im.h} role="img" aria-label={im.alt ?? 'chart'} className="absolute" style={{ left: im.x, top: im.y, width: im.w, height: im.h }} />
}
