/**
 * SDK-independent screen description, so every screen can be unit-tested for
 * container limits and text fit (via @evenrealities/pretext) without a device.
 * Canvas: 576×288, 4-bit green, one fixed LVGL font (27px line height).
 */
export const W = 576
export const H = 288
export const LINE_H = 27

export interface TextBox {
  id: number
  name: string // ≤16 chars, unique
  x: number; y: number; w: number; h: number
  text: string
  border?: number // 0–5
  borderColor?: number // 0–15
  radius?: number
  pad?: number
  capture?: boolean
}
export interface ListBox {
  id: number
  name: string
  x: number; y: number; w: number; h: number
  items: string[] // ≤20, ≤64 chars
  border?: number
  capture?: boolean
}
export interface ImageBox { id: number; name: string; x: number; y: number; w: number; h: number; draw: 'wordmark' | { code: string } }

export interface ScreenSpec {
  key: string // screen identity; same key + same structure → in-place text updates
  texts: TextBox[]
  lists?: ListBox[]
  images?: ImageBox[]
}

export function structureSignature(s: ScreenSpec): string {
  const t = s.texts.map(b => `t${b.id}:${b.name}:${b.x},${b.y},${b.w},${b.h},${b.border ?? 0},${b.capture ? 1 : 0}`)
  const l = (s.lists ?? []).map(b => `l${b.id}:${b.items.join('|')}`)
  const i = (s.images ?? []).map(b => `i${b.id}:${b.x},${b.y},${b.w},${b.h}`)
  return [s.key, ...t, ...l, ...i].join(';')
}

export function validateSpec(s: ScreenSpec): string[] {
  const errs: string[] = []
  const lists = s.lists ?? [], images = s.images ?? []
  const total = s.texts.length + lists.length + images.length
  if (total > 12) errs.push(`${total} containers > 12`)
  if (s.texts.length + lists.length > 8) errs.push('more than 8 text/list containers')
  if (images.length > 4) errs.push('more than 4 image containers')
  const captures = [...s.texts.filter(t => t.capture), ...lists.filter(l => l.capture)]
  if (captures.length !== 1) errs.push(`exactly one capture container required (got ${captures.length})`)
  const ids = new Set<number>(), names = new Set<string>()
  for (const b of [...s.texts, ...lists, ...images]) {
    if (ids.has(b.id)) errs.push(`duplicate id ${b.id}`)
    if (names.has(b.name)) errs.push(`duplicate name ${b.name}`)
    if (b.name.length > 16) errs.push(`name too long ${b.name}`)
    ids.add(b.id); names.add(b.name)
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) errs.push(`${b.name} outside canvas`)
  }
  for (const i of images) if (i.w < 20 || i.w > 288 || i.h < 20 || i.h > 144) errs.push(`${i.name} image size out of range`)
  for (const l of lists) {
    if (l.items.length < 1 || l.items.length > 20) errs.push(`${l.name} needs 1–20 items`)
    for (const it of l.items) if (it.length > 64) errs.push(`${l.name} item too long`)
  }
  for (const t of s.texts) if (t.text.length > 1000) errs.push(`${t.name} > 1000 chars`)
  return errs
}

/** Pad to visually centre a short line (the firmware has no alignment). */
export function spaced(code: string): string {
  return code.split('').join('  ')
}
