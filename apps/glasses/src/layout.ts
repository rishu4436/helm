/**
 * SDK-independent screen description, so every screen can be unit-tested for
 * container limits and text fit (via @evenrealities/pretext) without a device.
 * Canvas: 576×288, 4-bit green, one fixed LVGL font (27px line height).
 */
import { IMG_MAX_H, IMG_MAX_W, IMG_MIN_H, IMG_MIN_W, fingerprint, type Graphic } from './gfx/graphics'
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
  items: string[] // ≤20, ≤LIST_ITEM_MAX_BYTES UTF-8 bytes
  border?: number
  capture?: boolean
}
export type ImageDraw = 'wordmark' | { code: string } | { gfx: Graphic }
/**
 * Image container. `alt` + `altId` give every financial graphic a text fallback: if the image transfer is
 * rejected, the renderer writes `alt` into text container `altId` (placed under the image) so nothing is lost.
 */
export interface ImageBox { id: number; name: string; x: number; y: number; w: number; h: number; draw: ImageDraw; alt?: string; altId?: number }

/** Content fingerprint of an image container (changes whenever the drawn data changes, even if geometry does not). */
export function imagePrint(i: ImageBox): string {
  return fingerprint({ d: i.draw, w: i.w, h: i.h })
}

export interface ScreenSpec {
  key: string // screen identity; same key + same structure → in-place text updates
  /** Binds the rendered screen to app state (e.g. a proposalId): confirmation is only enabled once THIS binding has rendered. */
  bind?: string
  texts: TextBox[]
  lists?: ListBox[]
  images?: ImageBox[]
}

export const utf8Len = (t: string) => new TextEncoder().encode(t).length
/**
 * List items are limited in UTF-8 BYTES, not characters ('·' is 2 bytes, '…' is 3). The SDK docs say 64, but simulator 0.9.5
 * rejects the whole rebuild when any item is exactly 64 bytes and accepts 63 (bisected 2026-11-24 on a real Pulse list),
 * so HELM keeps every item at ≤63 bytes.
 */
export const LIST_ITEM_MAX_BYTES = 63
export function clipBytes(t: string, max = LIST_ITEM_MAX_BYTES): string {
  if (utf8Len(t) <= max) return t
  let out = ''
  for (const ch of t) { if (utf8Len(out + ch + '…') > max) break; out += ch }
  return out + '…'
}

export function structureSignature(s: ScreenSpec): string {
  const t = s.texts.map(b => `t${b.id}:${b.name}:${b.x},${b.y},${b.w},${b.h},${b.border ?? 0},${b.capture ? 1 : 0}`)
  const l = (s.lists ?? []).map(b => `l${b.id}:${b.name}:${b.x},${b.y},${b.w},${b.h},${b.capture ? 1 : 0}:${b.items.join('|')}`)
  // Geometry only: image CONTENT is tracked separately by imagePrint so changed chart data re-sends the image without a rebuild.
  const i = (s.images ?? []).map(b => `i${b.id}:${b.name}:${b.x},${b.y},${b.w},${b.h}`)
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
  for (const i of images) {
    if (i.w < IMG_MIN_W || i.w > IMG_MAX_W || i.h < IMG_MIN_H || i.h > IMG_MAX_H) errs.push(`${i.name} image size out of range`)
    if (typeof i.draw === 'object' && 'gfx' in i.draw) {
      if (!i.alt) errs.push(`${i.name} graphic needs alt text`)
      if (i.altId === undefined || !s.texts.some(t => t.id === i.altId)) errs.push(`${i.name} graphic needs an altId text container`)
    }
  }
  for (const l of lists) {
    if (l.items.length < 1 || l.items.length > 20) errs.push(`${l.name} needs 1–20 items`)
    for (const it of l.items) if (utf8Len(it) > LIST_ITEM_MAX_BYTES) errs.push(`${l.name} item exceeds ${LIST_ITEM_MAX_BYTES} bytes`)
  }
  for (const t of s.texts) if (t.text.length > 1000) errs.push(`${t.name} > 1000 chars`)
  return errs
}

/** Pad to visually centre a short line (the firmware has no alignment). */
export function spaced(code: string): string {
  return code.split('').join('  ')
}
