/**
 * UX 2.0 screen matrix: every screen reachable from Home (sample data, depth ≤ 4, Beginner + Pro + privacy)
 * is checked against the SDK container rules, pretext text fit, the firmware glyph set and the 63-byte list limit.
 */
import { describe, expect, it } from 'vitest'
import { getAdvW, measureTextWrap } from '@evenrealities/pretext'
import { LINE_H, utf8Len, validateSpec, type ScreenSpec } from '../layout'
import { sanitize, type RenderAck } from '../render'
import { Controller, type Host } from '../nav/controller'
import { SampleBackend } from '../nav/sample'
import type { Prefs } from '../ux/types'

type Step = { k: 'tap'; i: number } | { k: 'swipe' }
async function explore(prefs: Partial<Prefs>, maxDepth = 5, maxPaths = 2500) {
  const specs = new Map<string, ScreenSpec>()
  const T0 = Date.parse('2026-11-25T10:00:00Z')
  const run = async (path: Step[]) => {
    const shown: ScreenSpec[] = []
    const host: Host = {
      render: async s0 => { const s = sanitize(s0); shown.push(s); { const k = `${s.key}#${s.texts.map(t => t.text).join('|')}#${(s.lists ?? []).map(l => l.items.join('|')).join('/')}`; if (!specs.has(k)) specs.set(k, s) } return { ok: true, key: s.key, bind: s.bind, generation: shown.length, mode: 'rebuild', degraded: false, images: [], ms: 0 } as RenderAck },
      exit: () => undefined, log: () => undefined, now: () => T0,
      setTimeout: () => null, clearTimeout: () => undefined, setInterval: () => null, clearInterval: () => undefined,
    }
    const c = new Controller(new SampleBackend('sample', prefs, () => T0), host)
    c.practiceFactory = () => new SampleBackend('practice', prefs, () => T0)
    await c.start()
    for (const s of path) await c.input(s.k === 'tap' ? { kind: 'tap', source: 'list', index: s.i } : { kind: 'swipe', dir: 'down' })
    const last = shown[shown.length - 1]!
    return { n: last.lists?.find(l => l.capture)?.items.length ?? 0, card: !last.lists?.length }
  }
  const queue: Step[][] = [[]]
  let paths = 0
  while (queue.length && paths < maxPaths) {
    const p = queue.shift()!
    const r = await run(p); paths++
    if (p.length >= maxDepth) continue
    if (r.card) queue.push([...p, { k: 'swipe' }])
    for (let i = 0; i < r.n; i++) queue.push([...p, { k: 'tap', i }])
  }
  return specs
}

function problems(s: ScreenSpec): string[] {
  const out = validateSpec(s)
  for (const t of s.texts) {
    const inner = t.w - 2 * ((t.pad ?? 0) + (t.border ?? 0)), innerH = t.h - 2 * ((t.pad ?? 0) + (t.border ?? 0))
    const lines = measureTextWrap(t.text, inner).lineCount, room = Math.max(1, Math.floor(innerH / LINE_H))
    if (lines > room) out.push(`${t.name} overflows: ${lines} lines > ${room}: ${JSON.stringify(t.text)}`)
    for (const ch of t.text) { const cp = ch.codePointAt(0)!; if (cp >= 32 && getAdvW(cp) === 0) out.push(`${t.name} glyph U+${cp.toString(16)} not in firmware font`) }
  }
  for (const l of s.lists ?? []) for (const it of l.items) {
    if (utf8Len(it) > 63) out.push(`list item > 63 bytes: ${it}`)
    for (const ch of it) { const cp = ch.codePointAt(0)!; if (cp >= 32 && getAdvW(cp) === 0) out.push(`list glyph U+${cp.toString(16)} not in firmware font: ${it}`) }
  }
  return out
}

describe('UX 2.0 screen matrix', () => {
  for (const [name, prefs] of [['beginner', { mode: 'beginner' }], ['pro', { mode: 'pro' }], ['privacy', { mode: 'beginner', privacy: true }]] as const) {
    it(`${name}: every reachable screen fits and uses supported glyphs`, async () => {
      const specs = await explore(prefs as Partial<Prefs>)
      console.log(`[matrix] ${name}: ${specs.size} unique screens`)
      expect(specs.size).toBeGreaterThan(name === 'beginner' ? 40 : 30)
      const bad = [...specs.values()].flatMap(s => problems(s).map(p => `${s.key}: ${p}`))
      expect(bad).toEqual([])
    }, 60_000)
  }
  it('privacy mode never draws a dollar amount', async () => {
    const specs = await explore({ privacy: true }, 3, 300)
    // Order-specific screens (voice heard, builder size presets, review, confirm, receipt) show the order's own size by design.
    const orderScreens = /^(heard|build-|review|confirm|receipt|details|voice-examples)/
    const leaks = [...specs.values()].filter(s => !orderScreens.test(s.key)).flatMap(s => [...s.texts.map(t => t.text), ...(s.lists ?? []).flatMap(l => l.items)]).filter(t => /\$\d/.test(t))
    expect(leaks).toEqual([])
  }, 60_000)
})
