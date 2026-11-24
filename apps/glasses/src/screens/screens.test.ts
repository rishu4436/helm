import { describe, expect, it } from 'vitest'
import { measureTextWrap } from '@evenrealities/pretext'
import { LINE_H, validateSpec, type ScreenSpec } from '../layout'
import { accountChosenScreen, accountSelectorScreen, connectionErrorScreen, pairingExpiredScreen, pairingScreen, splashScreen } from './index'

const accounts = [
  { alias: 'My Binance', provider: 'binance', environment: 'demo', state: 'CONNECTED' },
  { alias: 'OKX Trading', provider: 'okx', environment: 'demo', state: 'READ_ONLY' },
  { alias: 'Coinbase Sandbox', provider: 'coinbase', environment: 'sandbox_static', state: 'LIMITED' },
]
const all: ScreenSpec[] = [
  splashScreen('Tap to begin'), pairingScreen('K7M4Q2', 299), pairingExpiredScreen(), connectionErrorScreen('Check the HELM server and network.'),
  accountSelectorScreen('rishabh', accounts), accountSelectorScreen('rishabh', []), accountChosenScreen(accounts[0]!),
]

describe('G2 screens', () => {
  it.each(all.map(s => [s.key, s] as const))('%s respects SDK container rules', (_k, s) => {
    expect(validateSpec(s)).toEqual([])
  })
  it.each(all.map(s => [s.key, s] as const))('%s text fits its containers (pretext measurement)', (_k, s) => {
    for (const t of s.texts) {
      const inner = t.w - 2 * ((t.pad ?? 0) + (t.border ?? 0))
      const innerH = t.h - 2 * ((t.pad ?? 0) + (t.border ?? 0))
      const m = measureTextWrap(t.text, inner)
      const maxLines = Math.max(1, Math.floor(innerH / LINE_H))
      expect.soft(m.lineCount, `${s.key}/${t.name}: "${t.text}" → ${m.lineCount} lines, room for ${maxLines}`).toBeLessThanOrEqual(maxLines)
    }
  })
  it('account rows show environment and state, never secrets', () => {
    const s = accountSelectorScreen('r', accounts)
    expect(s.lists![0]!.items).toEqual(['● My Binance · DEMO', '◐ OKX Trading · DEMO', '◐ Coinbase Sandbox · SANDBOX'])
  })
  it('pairing code is drawn large as an image within G2 image limits', () => {
    const img = pairingScreen('K7M4Q2', 299).images![0]!
    expect(img.draw).toEqual({ code: 'K7M4Q2' })
    expect(img.w).toBeLessThanOrEqual(288); expect(img.h).toBeLessThanOrEqual(144)
  })

  it('pairing countdown formats m:ss and keeps structure stable for in-place updates', () => {
    expect(pairingScreen('ABCDEF', 65).texts[1]!.text).toBe('expires 1:05')
    const a = pairingScreen('ABCDEF', 65), b = pairingScreen('ABCDEF', 64)
    expect(a.texts.map(t => [t.id, t.x, t.y, t.w, t.h])).toEqual(b.texts.map(t => [t.id, t.x, t.y, t.w, t.h]))
  })
})
