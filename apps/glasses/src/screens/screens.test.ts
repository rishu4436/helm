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

import * as T from './trade'
const acct = { id: 'a1', alias: 'Bybit Demo · Unified', provider: 'bybit', environment: 'demo', environmentLabel: 'DEMO', state: 'CONNECTED', canTrade: true, products: ['spot', 'perp'], label: null }
const prev = {
  proposalId: 'p1', confirmToken: 't', expiresAt: new Date(Date.now() + 40_000).toISOString(), canConfirm: true, label: null,
  account: { id: 'a1', alias: 'Bybit Demo · Unified', provider: 'bybit', environmentLabel: 'DEMO', connectionState: 'CONNECTED' },
  order: { instrument: 'bybit:perp:BTC-USDT:USDT', side: 'BUY', type: 'MARKET', quantity: '0.002', leverage: '2' },
  preview: { estimatedPrice: '60343.1', estimatedNotional: '120.69', estimatedFee: '0.066', estimatedSlippageBps: '0.0', requiredMargin: '60.34', remainingBuyingPower: '151234.5', estimateNotes: [],
    impact: { asset: 'BTC', currentExposureUsd: '97193.77', proposedExposureUsd: '97314.46', currentPositionQty: '0', proposedPositionQty: '0.002', spreadBps: '0.02', liquidation: { current: null, proposed: null, note: '' } },
    protection: { stopOffsetPercent: '3', estimatedStopPrice: '58532.8', supported: true, note: '' } },
  risk: { verdict: 'WARN' as const, findings: [{ rule: 'x', verdict: 'WARN' as const, message: 'Spread is wider than usual' }], policyVersion: 1 },
}
const rcpt = { orderId: 'o1', account: 'Bybit Demo · Unified', provider: 'bybit', environmentLabel: 'DEMO', label: null, instrumentId: 'bybit:perp:BTC-USDT:USDT', side: 'BUY', type: 'MARKET', status: 'FILLED', providerOrderId: '2355', quantity: '0.002', quoteQuantity: null, filledQuantity: '0.002', avgFillPrice: '60343.1', fills: [{ price: '60343.1', qty: '0.002', fee: '0.0663', feeAsset: 'USDT' }], protection: { state: 'PROTECTED', stopPrice: '58532.8', protectedQuantity: '0.002' }, fillTruth: 'Reported by the exchange demo environment', events: [] }
const pf = { netLiquidationUsd: '251234.5', unrealizedPnlUsd: '-12.3', accounts: [{ alias: 'Bybit Demo · Unified', valueUsd: '161970' }, { alias: 'Binance Demo · Spot', valueUsd: '80000' }, { alias: 'Binance Demo · USDⓈ-M', valueUsd: '5000' }, { alias: 'Binance · SIM', valueUsd: '15000' }], exposures: [{ asset: 'BTC', netDirectionalUsd: '97193', spotUsd: '97193' }, { asset: 'ETH', netDirectionalUsd: '20400', spotUsd: '20400' }], positions: [{ instrumentId: 'binance:perp:BTC-USDT:USDT', side: 'NET', quantity: '-0.002', unrealizedPnl: '1.2', accountId: 'x' }] }
const uitem = { accountId: 'a1', instrumentId: 'binance:perp:BTC-USDT:USDT', side: 'NET', notionalUsd: '-150.12', alias: 'Binance Demo · USDⓈ-M' }
const protPrev = { ...prev, kind: 'protect_existing' as const, account: { ...prev.account, alias: 'Binance Demo · USDⓈ-M' },
  order: { instrument: 'binance:perp:BTC-USDT:USDT', side: 'SELL', type: 'STOP_MARKET', quantity: '0.0025', stopPrice: '58532.8', reduceOnly: true },
  preview: { ...prev.preview, estimateNotes: ['Protects the existing LONG 0.0025 BTC', 'If triggered: P&L vs entry ≈ -4.52 USDT before fees and slippage'], recovery: { positionQty: '0.0025', positionSide: 'LONG' as const, entryPrice: '60343.1', markPrice: '60341.2', referencePrice: '60341.2', stopOffsetPercent: '3' } } }
const tradeScreens: ScreenSpec[] = [
  T.unprotectedScreen([uitem, { ...uitem, instrumentId: 'bybit:perp:ETH-USDT:USDT', side: 'SHORT', alias: 'Bybit Demo · Unified' }]), T.unprotectedScreen([]), T.protectPickScreen(uitem),
  T.impactScreen(protPrev), T.confirmScreen(protPrev),
  T.homeScreen('rishabh', true), T.overviewScreen(pf), T.holdingsScreen(pf), T.watchlistScreen([{ asset: 'BTC', price: '60312.5' }, { asset: 'SOL', price: '150.123' }]),
  T.marketScreen('BTC', [{ venue: 'binance', bid: '60312.0', ask: '60312.1', spreadBps: '0.02' }, { venue: 'okx', bid: '60311.9', ask: '60312.0', spreadBps: '0.02' }, { venue: 'bybit', bid: null, ask: null, spreadBps: null, error: 'EXCHANGE_UNAVAILABLE' }]),
  T.accountPickScreen([acct, { ...acct, id: 'a2', alias: 'Binance Demo · Spot', products: ['spot'] }]), T.ticketScreen(acct, 'BTC'),
  T.impactScreen(prev), T.riskScreen(prev), T.confirmScreen(prev), T.submittingScreen(prev), T.receiptScreen(rcpt), T.receiptScreen({ ...rcpt, label: 'SIMULATED by HELM — live public prices, fills computed locally, nothing sent to any exchange', environmentLabel: 'SIMULATED' }),
  T.errorScreen('PREVIEW EXPIRED', 'Price moved since the preview — review again'),
  T.pulseScreen([{ kind: 'PROTECTION_FAILED', severity: 4, reason: 'BTC position is UNPROTECTED: stop rejected', count: 1 }]),
  T.compassScreen({ largestDirectional: { asset: 'BTC', direction: 'LONG', netUsd: '97193' }, largestExchange: { alias: 'Bybit Demo · Unified', sharePct: '64.4' }, unprotected: [], nearRisk: [], marginWarnings: [], rose: [{ asset: 'BTC', sharePct: '70', direction: 'LONG' }, { asset: 'ETH', sharePct: '20', direction: 'LONG' }] }, '251234'),
  T.emergencyScreen([{ kind: 'CLOSE_POSITION', detail: 'LONG 0.002 (reduce-only close, needs its own preview + confirm)', instrumentId: 'bybit:perp:BTC-USDT:USDT' }]),
  T.receiptsScreen([rcpt]), T.listeningScreen(4, 12),
  T.heardScreen({ transcript: 'Buy 100 dollars of BTC', sttProvider: 'deterministic', sttLabel: 'TEST STT', intent: { intent: 'PLACE_ORDER', asset: 'BTC', side: 'BUY', product: null, notional: '100', quantity: null, fraction: null, leverage: null, stopOffsetPercent: null, provider: null }, resolution: { status: 'clarify', question: 'Which exchange?' }, next: { screen: 'clarify_account', message: 'Which exchange?' } }),
]
describe('G2 trading screens', () => {
  it.each(tradeScreens.map(s => [s.key, s] as const))('%s respects SDK container rules', (_k, s) => { expect(validateSpec(s)).toEqual([]) })
  it.each(tradeScreens.map(s => [s.key, s] as const))('%s text fits (pretext)', (_k, s) => {
    for (const t of s.texts) {
      const m = measureTextWrap(t.text, t.w - 2 * ((t.pad ?? 0) + (t.border ?? 0)))
      const maxLines = Math.max(1, Math.floor((t.h - 2 * ((t.pad ?? 0) + (t.border ?? 0))) / LINE_H))
      expect.soft(m.lineCount, `${s.key}/${t.name}: "${t.text}" → ${m.lineCount} lines, room for ${maxLines}`).toBeLessThanOrEqual(maxLines)
    }
  })
  it('confirm defaults to Cancel (item 0); Confirm names side + venue', () => {
    const l = T.confirmScreen(prev).lists![0]!
    expect(l.items[0]).toBe('Cancel'); expect(l.items[1]).toMatch(/^Confirm BUY on Bybit Demo/)
  })
  it('simulated receipts carry the SIMULATED label; NET short shown as SHORT', () => {
    expect(T.receiptScreen({ ...rcpt, label: 'SIMULATED by HELM — x', environmentLabel: 'SIMULATED' }).texts.find(t => t.name === 'body')!.text).toMatch(/SIMULATED/)
    expect(T.holdingsScreen(pf).lists![0]!.items[0]).toMatch(/^SHORT BTC/)
  })
  it('list items are clipped to 64 UTF-8 bytes (firmware limit; "·" is 2 bytes)', () => {
    const s = T.emergencyScreen([{ kind: 'CLOSE_POSITION', detail: 'LONG 0.002 (reduce-only close, needs its own preview + confirm)', instrumentId: 'bybit:perp:BTC-USDT:USDT' }])
    for (const it of s.lists![0]!.items) expect(new TextEncoder().encode(it).length).toBeLessThanOrEqual(64)
  })
  it('recovery: unprotected list, stop distances, PROTECT impact, and a Cancel-first stop confirmation', () => {
    expect(T.unprotectedScreen([uitem]).lists![0]!.items[0]).toMatch(/^BTC SHORT PERP · Binance Demo/)
    expect(T.protectPickScreen(uitem).lists![0]!.items).toEqual(['Reduce-only stop 2% from mark', 'Reduce-only stop 3% from mark', 'Reduce-only stop 5% from mark'])
    expect(T.impactScreen(protPrev).texts.find(t => t.name === 'header')!.text).toBe('PROTECT POSITION')
    const c = T.confirmScreen(protPrev)
    expect(c.lists![0]!.items[0]).toBe('Cancel'); expect(c.lists![0]!.items[1]).toMatch(/^Confirm stop on Binance Demo/)
    expect(c.texts.find(t => t.name === 'summary')!.text).toMatch(/PROTECTED only once the venue lists it/)
  })
  it('blocked risk cannot continue', () => { expect(T.riskScreen({ ...prev, canConfirm: false, risk: { ...prev.risk, verdict: 'BLOCK' } }).texts.find(t => t.name === 'footer')!.text).toMatch(/Blocked/) })
})
