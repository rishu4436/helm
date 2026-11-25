/**
 * HELM graphical display engine — typed financial graphic descriptors and their deterministic geometry.
 *
 * A Graphic is pure data. `layoutGraphic` turns it into primitive drawing ops (pure, unit-tested);
 * `paintOps` (raster.ts) rasterises the ops onto any Canvas 2D context — the glasses WebView canvas,
 * the companion's <canvas>, or a test double. The PNG is then sent through the Even Hub image-container
 * API (`updateImageRawData`), which converts it to 4-bit greyscale. Nothing here is HTML/CSS.
 *
 * Shades are 0–15 (the G2's 16 green levels). Every graphic also has a text fallback (`altText`).
 */

export type Shade = number // 0..15

export type Graphic =
  /** Proportional horizontal allocation ribbon. Values must share ONE scope (never mixed environments). */
  | { kind: 'ribbon'; segments: Array<{ label: string; value: number }>; scope: string }
  /** Horizontal bars (venue spread, concentration, exposure). `unit` names what the bars mean. */
  | { kind: 'bars'; rows: Array<{ label: string; value: number | null; note?: string }>; unit: string; max?: number; limit?: number | null; title: string }
  /** Price sparkline from verified candles only. */
  | { kind: 'sparkline'; points: number[]; caption: string }
  /** LIQUIDATION — STOP — ENTRY — MARK — TAKE PROFIT on a linear price scale (low price left, high price right). */
  | { kind: 'range'; side: 'LONG' | 'SHORT'; markers: Array<{ kind: RangeMarkerKind; price: number | null }> }
  /** Before/after comparison of one comparable quantity (e.g. BTC exposure USD). */
  | { kind: 'beforeAfter'; label: string; before: number; after: number; limit?: number | null }
  /** Utilisation meter against a configured limit (margin, protection coverage). */
  | { kind: 'meter'; label: string; value: number; limit: number; max: number }

export type RangeMarkerKind = 'LIQ' | 'STOP' | 'ENTRY' | 'MARK' | 'TP'

export type Op =
  | { op: 'rect'; x: number; y: number; w: number; h: number; shade: Shade; style: 'fill' | 'stroke' | 'hatch' | 'dots' }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; shade: Shade; width: number; dash?: number[] }
  | { op: 'text'; x: number; y: number; text: string; size: number; shade: Shade; align: 'left' | 'center' | 'right'; bold?: boolean }
  | { op: 'marker'; x: number; y: number; shape: 'triangle' | 'square' | 'diamond' | 'cross' | 'circle'; size: number; shade: Shade; filled: boolean }
  | { op: 'poly'; points: Array<[number, number]>; shade: Shade; width: number }

export const IMG_MIN_W = 20, IMG_MAX_W = 288, IMG_MIN_H = 20, IMG_MAX_H = 144

/** FNV-1a 32-bit over a stable JSON encoding — the image content fingerprint. */
export function fingerprint(v: unknown): string {
  const s = stableJson(v)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(typeof v === 'number' && !Number.isFinite(v) ? null : v)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`
}

const fmtPct = (p: number) => (p >= 9.5 ? p.toFixed(0) : p.toFixed(1))
/** Segment proportions for a ribbon; negative/NaN values are excluded (not part of an allocation). */
export function ribbonShares(segments: Array<{ label: string; value: number }>): Array<{ label: string; share: number }> {
  const ok = segments.filter(s => Number.isFinite(s.value) && s.value > 0)
  const total = ok.reduce((t, s) => t + s.value, 0)
  return total > 0 ? ok.map(s => ({ label: s.label, share: s.value / total })) : []
}

/** Linear price → x mapping used by the range diagram. Documented: low price at the left edge, high price at the right. */
export function priceScale(prices: number[], x0: number, x1: number, padFrac = 0.08) {
  const ps = prices.filter(p => Number.isFinite(p))
  let lo = Math.min(...ps), hi = Math.max(...ps)
  if (!ps.length) { lo = 0; hi = 1 }
  if (hi === lo) { lo = lo * 0.99; hi = hi * 1.01 || 1 }
  const pad = (hi - lo) * padFrac
  lo -= pad; hi += pad
  return { lo, hi, x: (p: number) => x0 + ((p - lo) / (hi - lo)) * (x1 - x0) }
}

const PATTERNS: Array<'fill' | 'hatch' | 'dots' | 'stroke'> = ['fill', 'hatch', 'dots', 'stroke']
const SHADES = [15, 11, 8, 13]

export function layoutGraphic(g: Graphic, w: number, h: number): Op[] {
  switch (g.kind) {
    case 'ribbon': return ribbonOps(g, w, h)
    case 'bars': return barsOps(g, w, h)
    case 'sparkline': return sparkOps(g, w, h)
    case 'range': return rangeOps(g, w, h)
    case 'beforeAfter': return beforeAfterOps(g, w, h)
    case 'meter': return meterOps(g, w, h)
  }
}

function ribbonOps(g: Extract<Graphic, { kind: 'ribbon' }>, w: number, h: number): Op[] {
  const sh = ribbonShares(g.segments)
  const ops: Op[] = []
  const barH = Math.max(12, Math.round(h * 0.42)), y = 2
  if (!sh.length) return [{ op: 'rect', x: 1, y, w: w - 2, h: barH, shade: 6, style: 'stroke' }, { op: 'text', x: w / 2, y: y + barH + 16, text: 'No valued holdings', size: 15, shade: 12, align: 'center' }]
  let x = 1
  const inner = w - 2
  sh.forEach((s, i) => {
    const sw = i === sh.length - 1 ? 1 + inner - x : Math.max(2, Math.round(s.share * inner))
    ops.push({ op: 'rect', x, y, w: Math.max(1, sw - 2), h: barH, shade: SHADES[i % SHADES.length]!, style: PATTERNS[i % PATTERNS.length]! })
    x += sw
  })
  // Legend row: pattern swatch + label + percent (labels never rely on shade alone).
  const legendY = y + barH + 6
  const colW = w / Math.min(sh.length, 3)
  sh.slice(0, 3).forEach((s, i) => {
    const lx = Math.round(i * colW)
    ops.push({ op: 'rect', x: lx + 1, y: legendY + 2, w: 10, h: 10, shade: SHADES[i % SHADES.length]!, style: PATTERNS[i % PATTERNS.length]! })
    ops.push({ op: 'text', x: lx + 15, y: legendY + 12, text: `${s.label.slice(0, 9)} ${fmtPct(s.share * 100)}%`, size: 14, shade: 15, align: 'left' })
  })
  if (sh.length > 3) ops.push({ op: 'text', x: w - 2, y: legendY + 28, text: `+${sh.length - 3} more`, size: 13, shade: 10, align: 'right' })
  return ops
}

function barsOps(g: Extract<Graphic, { kind: 'bars' }>, w: number, h: number): Op[] {
  const ops: Op[] = [{ op: 'text', x: 1, y: 13, text: g.title.slice(0, 36), size: 13, shade: 11, align: 'left' }]
  const rows = g.rows.slice(0, 4)
  const vals = rows.map(r => r.value).filter((v): v is number => v !== null && Number.isFinite(v))
  const max = Math.max(g.max ?? 0, g.limit ?? 0, ...vals, 1e-9)
  const top = 20, rowH = Math.max(14, Math.floor((h - top) / Math.max(1, rows.length)))
  const labelW = 70, valW = 64, bx = labelW, bw = w - labelW - valW - 4
  rows.forEach((r, i) => {
    const y = top + i * rowH
    const bh = Math.max(8, rowH - 8)
    ops.push({ op: 'text', x: 1, y: y + bh - 1, text: r.label.slice(0, 9), size: 14, shade: 15, align: 'left' })
    if (r.value === null || !Number.isFinite(r.value)) {
      ops.push({ op: 'rect', x: bx, y, w: bw, h: bh, shade: 5, style: 'dots' })
      ops.push({ op: 'text', x: w - 1, y: y + bh - 1, text: r.note ?? 'n/a', size: 13, shade: 10, align: 'right' })
      return
    }
    const len = Math.max(2, Math.round((Math.max(0, r.value) / max) * bw))
    ops.push({ op: 'rect', x: bx, y, w: len, h: bh, shade: 14, style: 'fill' })
    ops.push({ op: 'text', x: w - 1, y: y + bh - 1, text: `${formatNum(r.value)}${g.unit}`, size: 14, shade: 15, align: 'right' })
  })
  if (g.limit) {
    const lx = bx + Math.round((g.limit / max) * bw)
    ops.push({ op: 'line', x1: lx, y1: top - 2, x2: lx, y2: h - 2, shade: 15, width: 1, dash: [3, 2] })
  }
  return ops
}

function sparkOps(g: Extract<Graphic, { kind: 'sparkline' }>, w: number, h: number): Op[] {
  const pts = g.points.filter(Number.isFinite)
  const capH = 14
  if (pts.length < 2) return [{ op: 'text', x: w / 2, y: h / 2, text: 'No verified candles', size: 14, shade: 12, align: 'center' }]
  const lo = Math.min(...pts), hi = Math.max(...pts)
  const span = hi - lo || hi * 0.001 || 1
  const top = 3, bot = h - capH - 3
  const poly: Array<[number, number]> = pts.map((p, i) => [1 + (i / (pts.length - 1)) * (w - 2), bot - ((p - lo) / span) * (bot - top)])
  const ops: Op[] = [{ op: 'line', x1: 1, y1: bot, x2: w - 1, y2: bot, shade: 4, width: 1, dash: [2, 3] }, { op: 'poly', points: poly, shade: 15, width: 2 }]
  const last = poly[poly.length - 1]!
  ops.push({ op: 'marker', x: last[0] - 2, y: last[1], shape: 'circle', size: 4, shade: 15, filled: true })
  ops.push({ op: 'text', x: 1, y: h - 2, text: g.caption.slice(0, 40), size: 12, shade: 10, align: 'left' })
  return ops
}

export const MARKER_SHAPE: Record<RangeMarkerKind, Extract<Op, { op: 'marker' }>['shape']> = { LIQ: 'cross', STOP: 'square', ENTRY: 'diamond', MARK: 'triangle', TP: 'circle' }
export const MARKER_LABEL: Record<RangeMarkerKind, string> = { LIQ: 'LIQ', STOP: 'STOP', ENTRY: 'ENTRY', MARK: 'NOW', TP: 'TP' }

/** Marker x positions (exported for tests): only markers with a known price are placed — never invented. */
export function rangeMarkerPositions(g: Extract<Graphic, { kind: 'range' }>, w: number): Array<{ kind: RangeMarkerKind; price: number; x: number }> {
  const known = g.markers.filter((m): m is { kind: RangeMarkerKind; price: number } => m.price !== null && Number.isFinite(m.price) && m.price > 0)
  const sc = priceScale(known.map(m => m.price), 8, w - 8)
  return known.map(m => ({ ...m, x: Math.round(sc.x(m.price)) }))
}

function rangeOps(g: Extract<Graphic, { kind: 'range' }>, w: number, h: number): Op[] {
  const pos = rangeMarkerPositions(g, w)
  const axisY = Math.round(h / 2)
  const ops: Op[] = [{ op: 'line', x1: 4, y1: axisY, x2: w - 4, y2: axisY, shade: 7, width: 1 }]
  if (!pos.length) return [...ops, { op: 'text', x: w / 2, y: axisY - 8, text: 'Prices unavailable', size: 14, shade: 12, align: 'center' }]
  const mark = pos.find(p => p.kind === 'MARK'), liq = pos.find(p => p.kind === 'LIQ'), stop = pos.find(p => p.kind === 'STOP')
  // Dashed line: distance from current price to liquidation (the risk zone). Solid: current price to stop.
  if (mark && liq) ops.push({ op: 'line', x1: mark.x, y1: axisY, x2: liq.x, y2: axisY, shade: 15, width: 3, dash: [5, 3] })
  if (mark && stop) ops.push({ op: 'line', x1: mark.x, y1: axisY, x2: stop.x, y2: axisY, shade: 13, width: 3 })
  // Alternate label rows above / below the axis so close markers stay legible.
  const sorted = [...pos].sort((a, b) => a.x - b.x)
  sorted.forEach((p, i) => {
    const up = i % 2 === 0
    ops.push({ op: 'marker', x: p.x, y: axisY, shape: MARKER_SHAPE[p.kind], size: p.kind === 'MARK' ? 8 : 6, shade: 15, filled: p.kind !== 'TP' })
    ops.push({ op: 'line', x1: p.x, y1: up ? axisY - 8 : axisY + 8, x2: p.x, y2: up ? axisY - 14 : axisY + 14, shade: 9, width: 1 })
    const align = p.x < 30 ? 'left' : p.x > w - 30 ? 'right' : 'center'
    ops.push({ op: 'text', x: p.x, y: up ? axisY - 17 : axisY + 29, text: MARKER_LABEL[p.kind], size: 13, shade: 15, align, bold: p.kind === 'MARK' })
  })
  ops.push({ op: 'text', x: 2, y: h - 1, text: 'low', size: 11, shade: 7, align: 'left' }, { op: 'text', x: w - 2, y: h - 1, text: 'high price', size: 11, shade: 7, align: 'right' })
  return ops
}

function beforeAfterOps(g: Extract<Graphic, { kind: 'beforeAfter' }>, w: number, h: number): Op[] {
  const max = Math.max(Math.abs(g.before), Math.abs(g.after), g.limit ?? 0, 1e-9)
  const labelW = 58, valW = 66, bw = w - labelW - valW - 4
  const rowH = Math.floor((h - 18) / 2)
  const ops: Op[] = [{ op: 'text', x: 1, y: 13, text: g.label.slice(0, 36), size: 13, shade: 11, align: 'left' }]
  const row = (y: number, name: string, v: number, style: 'fill' | 'hatch') => {
    ops.push({ op: 'text', x: 1, y: y + rowH - 6, text: name, size: 14, shade: 15, align: 'left' })
    ops.push({ op: 'rect', x: labelW, y: y + 2, w: Math.max(2, Math.round((Math.abs(v) / max) * bw)), h: rowH - 6, shade: 14, style })
    ops.push({ op: 'text', x: w - 1, y: y + rowH - 6, text: `${v < 0 ? '-' : ''}$${formatNum(Math.abs(v))}`, size: 14, shade: 15, align: 'right' })
  }
  row(18, 'Now', g.before, 'hatch')
  row(18 + rowH, 'After', g.after, 'fill')
  if (g.limit) { const lx = labelW + Math.round((g.limit / max) * bw); ops.push({ op: 'line', x1: lx, y1: 16, x2: lx, y2: h - 1, shade: 15, width: 1, dash: [3, 2] }) }
  return ops
}

function meterOps(g: Extract<Graphic, { kind: 'meter' }>, w: number, h: number): Op[] {
  const max = Math.max(g.max, 1e-9)
  const bh = Math.max(10, Math.min(22, h - 22)), y = 18
  const ops: Op[] = [
    { op: 'text', x: 1, y: 13, text: g.label.slice(0, 36), size: 13, shade: 11, align: 'left' },
    { op: 'rect', x: 1, y, w: w - 2, h: bh, shade: 8, style: 'stroke' },
    { op: 'rect', x: 2, y: y + 1, w: Math.max(1, Math.round((Math.min(g.value, max) / max) * (w - 4))), h: bh - 2, shade: 14, style: 'fill' },
  ]
  const lx = 1 + Math.round((Math.min(g.limit, max) / max) * (w - 2))
  ops.push({ op: 'line', x1: lx, y1: y - 3, x2: lx, y2: y + bh + 3, shade: 15, width: 2 })
  ops.push({ op: 'text', x: Math.min(w - 2, Math.max(2, lx)), y: Math.min(h - 1, y + bh + 15), text: `limit ${formatNum(g.limit)}%`, size: 12, shade: 12, align: lx > w - 40 ? 'right' : lx < 40 ? 'left' : 'center' })
  return ops
}

export function formatNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  return v.toFixed(a >= 1 ? 2 : a === 0 ? 0 : 3).replace(/\.?0+$/, '') || '0'
}

/** Text fallback for every graphic — shown if an image transfer fails, and used by screen readers in the companion. */
export function altText(g: Graphic): string {
  switch (g.kind) {
    case 'ribbon': { const s = ribbonShares(g.segments); return s.length ? `${g.scope}: ${s.map(x => `${x.label} ${fmtPct(x.share * 100)}%`).join(', ')}` : `${g.scope}: no valued holdings` }
    case 'bars': return `${g.title}: ${g.rows.map(r => `${r.label} ${r.value === null ? (r.note ?? 'n/a') : `${formatNum(r.value)}${g.unit}`}`).join(', ')}`
    case 'sparkline': return g.points.length >= 2 ? `${g.caption}: ${formatNum(g.points[0]!)} to ${formatNum(g.points[g.points.length - 1]!)}` : 'No verified candles'
    case 'range': return g.markers.map(m => `${MARKER_LABEL[m.kind]} ${m.price === null ? 'unavailable' : formatNum(m.price)}`).join(', ')
    case 'beforeAfter': return `${g.label}: ${g.before < 0 ? '-' : ''}$${formatNum(Math.abs(g.before))} now, ${g.after < 0 ? '-' : ''}$${formatNum(Math.abs(g.after))} after`
    case 'meter': return `${g.label}: ${formatNum(g.value)}% of ${formatNum(g.limit)}% limit`
  }
}
