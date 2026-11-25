import { describe, expect, it } from 'vitest'
import { altText, fingerprint, layoutGraphic, priceScale, rangeMarkerPositions, ribbonShares, type Graphic } from '../gfx/graphics'
import { fastPathEligible, glance, holdingsByAsset, paginate, positionRows, scopesOf, stepAmount, venueModel, focusModel, positionActions, nextStep, autoResolve } from './model'
import type { Acct, PortfolioPayload } from './types'
import { usdOf, pnlOf } from './format'
import { term } from './terms'

const acct = (id: string, provider: string, environment: string, products = ['spot', 'perp']): Acct => ({ id, alias: `${provider} ${id}`, provider, environment, environmentLabel: environment.toUpperCase(), state: 'CONNECTED', canTrade: true, products, label: null })
const P: PortfolioPayload = {
  accounts: [
    { accountId: 'a', alias: 'Binance Demo', provider: 'binance', environment: 'demo', state: 'CONNECTED', valueUsd: '6000' },
    { accountId: 'b', alias: 'Bybit Demo', provider: 'bybit', environment: 'demo', state: 'CONNECTED', valueUsd: '4000' },
    { accountId: 's', alias: 'Sim', provider: 'simulator', environment: 'simulated', state: 'CONNECTED', valueUsd: '100000' },
  ],
  exposures: [],
  positions: [
    { accountId: 'b', instrumentId: 'bybit:perp:BTC-USDT:USDT', side: 'LONG', quantity: '0.01', entryPrice: '60000', markPrice: '59000', liquidationPrice: '30000', notional: '590', leverage: '2', unrealizedPnl: '-10' },
    { accountId: 'a', instrumentId: 'binance:perp:ETH-USDT:USDT', side: 'SHORT', quantity: '-1', entryPrice: '1700', markPrice: '1650', liquidationPrice: '2400', notional: '-1650', leverage: '3', unrealizedPnl: '50' },
  ],
  openOrders: [{ accountId: 'a', instrumentId: 'binance:perp:ETH-USDT:USDT', side: 'BUY', type: 'STOP_MARKET', stopPrice: '1750', reduceOnly: true }],
  holdings: [
    { accountId: 'a', asset: 'BTC', total: '0.1', free: '0.1', locked: '0', valueUsd: '5900' },
    { accountId: 'b', asset: 'BTC', total: '0.05', free: '0.05', locked: '0', valueUsd: '2950' },
    { accountId: 's', asset: 'BTC', total: '1', free: '1', locked: '0', valueUsd: '59000' },
    { accountId: 'a', asset: 'WBTC', total: '0.01', free: '0.01', locked: '0', valueUsd: '590' },
  ],
}

describe('graphics engine', () => {
  it('ribbon legend lines never overlap and stay inside the image, with "+n more" when space runs out', () => {
    for (const [w, h, n] of [[190, 76, 3], [190, 76, 6], [288, 100, 4], [120, 60, 2]] as const) {
      const ops = layoutGraphic({ kind: 'ribbon', segments: Array.from({ length: n }, (_, i) => ({ label: `Exchange Demo ${i}`, value: 100 - i * 10 })) }, w, h)
      const texts = ops.filter((o): o is Extract<typeof o, { op: 'text' }> => o.op === 'text')
      const ys = texts.map(t => t.y)
      expect(new Set(ys).size).toBe(ys.length)
      for (const t of texts) { expect(t.y).toBeLessThanOrEqual(h); expect(t.text.length * 7.4 + t.x).toBeLessThanOrEqual(w + 8) }
      const shownSegments = texts.filter(t => /%$/.test(t.text)).length
      if (shownSegments < n) expect(texts.some(t => /^\+\d+ more$/.test(t.text))).toBe(true)
    }
  })
  it('ribbon proportions are exact and exclude non-positive values', () => {
    const s = ribbonShares([{ label: 'A', value: 600 }, { label: 'B', value: 400 }, { label: 'C', value: -5 }])
    expect(s.map(x => x.share)).toEqual([0.6, 0.4])
  })
  it('range diagram: low price left, high right; only known prices are placed (never invented)', () => {
    const g: Extract<Graphic, { kind: 'range' }> = { kind: 'range', side: 'LONG', markers: [{ kind: 'LIQ', price: 30000 }, { kind: 'STOP', price: null }, { kind: 'ENTRY', price: 60000 }, { kind: 'MARK', price: 59000 }, { kind: 'TP', price: null }] }
    const pos = rangeMarkerPositions(g, 288)
    expect(pos.map(p => p.kind)).toEqual(['LIQ', 'ENTRY', 'MARK'])
    const x = Object.fromEntries(pos.map(p => [p.kind, p.x]))
    expect(x.LIQ!).toBeLessThan(x.MARK!); expect(x.MARK!).toBeLessThan(x.ENTRY!)
    const sc = priceScale([10, 20], 0, 100)
    expect(sc.x(10)).toBeLessThan(sc.x(20))
  })
  it('SHORT positions keep the same price orientation (liquidation to the right of mark)', () => {
    const pos = rangeMarkerPositions({ kind: 'range', side: 'SHORT', markers: [{ kind: 'LIQ', price: 2400 }, { kind: 'MARK', price: 1650 }, { kind: 'STOP', price: 1750 }] }, 288)
    const x = Object.fromEntries(pos.map(p => [p.kind, p.x]))
    expect(x.MARK!).toBeLessThan(x.STOP!); expect(x.STOP!).toBeLessThan(x.LIQ!)
  })
  it('missing data degrades honestly', () => {
    expect(layoutGraphic({ kind: 'range', side: 'LONG', markers: [{ kind: 'MARK', price: null }] }, 200, 80).some(o => o.op === 'text' && /unavailable/i.test(o.text))).toBe(true)
    expect(altText({ kind: 'sparkline', points: [], caption: 'x' })).toBe('No verified candles')
    expect(altText({ kind: 'bars', title: 'Spread', unit: 'bp', rows: [{ label: 'OKX', value: null, note: 'unavailable' }] })).toMatch(/OKX unavailable/)
  })
  it('fingerprints are stable across key order and change with content', () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }))
    expect(fingerprint({ kind: 'sparkline', points: [1, 2] })).not.toBe(fingerprint({ kind: 'sparkline', points: [1, 3] }))
  })
  it('all ops stay inside the image bounds', () => {
    const gs: Graphic[] = [
      { kind: 'ribbon', scope: 'Exchange demo', segments: [{ label: 'Binance', value: 6 }, { label: 'Bybit', value: 4 }] },
      { kind: 'bars', title: 't', unit: 'bp', rows: [{ label: 'Binance', value: 0.2 }, { label: 'Bybit', value: 1.4 }], limit: 1 },
      { kind: 'sparkline', points: [1, 3, 2, 5, 4], caption: '1h' },
      { kind: 'beforeAfter', label: 'BTC exposure', before: 100, after: 150 },
      { kind: 'meter', label: 'Distance', value: 20, limit: 10, max: 50 },
    ]
    for (const g of gs) for (const o of layoutGraphic(g, 272, 104)) {
      if (o.op === 'rect') { expect(o.x).toBeGreaterThanOrEqual(0); expect(o.x + o.w).toBeLessThanOrEqual(272) }
      if (o.op === 'line') { for (const v of [o.x1, o.x2]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(272) } }
    }
  })
})

describe('portfolio model', () => {
  it('scopes never mix exchange demo with simulated value', () => {
    const s = scopesOf(P)
    expect(s.map(x => [x.id, x.valueUsd])).toEqual([['exchange', 10000], ['simulated', 100000]])
  })
  it('holdings aggregate only the exact same symbol within one scope', () => {
    const h = holdingsByAsset(P, 'exchange')
    const btc = h.find(x => x.asset === 'BTC')!
    expect(btc.qty).toBeCloseTo(0.15); expect(btc.rows).toHaveLength(2)
    expect(h.find(x => x.asset === 'WBTC')!.qty).toBeCloseTo(0.01)
  })
  it('pagination keeps every row reachable', () => {
    const items = Array.from({ length: 40 }, (_, i) => i)
    const seen = [0, 1, 2].flatMap(p => paginate(items, p).rows)
    expect(seen).toEqual(items)
    expect(paginate(items, 99).page).toBe(2)
  })
  it('positions without a stop are listed first; focus shows liquidation distance from the venue value', () => {
    const rows = positionRows(P)
    expect(rows[0]!.base).toBe('BTC'); expect(rows[0]!.stop).toBeNull(); expect(rows[1]!.stop?.stopPrice).toBe('1750')
    const f = focusModel(rows[0]!)
    expect(f.liqDistancePct).toBeCloseTo(((59000 - 30000) / 59000) * 100)
    expect(positionActions(f, true).map(a => a.id)).toContain('protect')
    expect(positionActions(focusModel(rows[1]!), false).map(a => a.id)).not.toContain('reduce50')
  })
  it('glance picks the risk home when an unacknowledged severe alert exists', () => {
    const accts = [acct('a', 'binance', 'demo'), acct('b', 'bybit', 'demo')]
    expect(glance(P, accts, [], { homeMode: 'auto', alertSensitivity: 'normal' }).mode).toBe('futures')
    const alert = { id: 'x', kind: 'POSITION_UNPROTECTED', severity: 4, title: 't', detail: '', at: '', state: 'current' as const, relevant: true, actions: [] }
    expect(glance(P, accts, [alert], { homeMode: 'auto', alertSensitivity: 'normal' }).mode).toBe('risk')
    expect(glance(P, accts, [{ ...alert, acknowledged: true }], { homeMode: 'auto', alertSensitivity: 'normal' }).mode).toBe('futures')
    expect(glance(null, [], [], { homeMode: 'auto', alertSensitivity: 'normal' }).mode).toBe('empty')
  })
  it('venue compass only singles out a venue when every quote is fresh and complete — never "best"', () => {
    const fresh = [{ venue: 'binance', bid: '1', ask: '1.01', spreadBps: '0.5', ageMs: 300 }, { venue: 'bybit', bid: '1', ask: '1.02', spreadBps: '1.2', ageMs: 400 }]
    expect(venueModel(fresh).label).toBe('Lowest observed spread'); expect(venueModel(fresh).leader).toBe('binance')
    expect(venueModel([...fresh, { venue: 'okx', bid: null, ask: null, spreadBps: null, ageMs: null, error: 'x' }]).label).toBeNull()
    expect(venueModel([{ ...fresh[0]!, ageMs: 9000 }, fresh[1]!]).label).toBeNull()
    expect(venueModel(fresh.map((q, i) => ({ ...q, estCostBps: String(5 + i) })), 100).label).toMatch(/^Lowest est\. cost for \$100/)
  })
  it('fast path requires ALLOW, a complete estimate and time left', () => {
    const base = { canConfirm: true, expiresAt: new Date(Date.now() + 40000).toISOString(), account: { connectionState: 'CONNECTED' }, preview: { estimatedPrice: '1', estimatedNotional: '1' }, risk: { verdict: 'ALLOW' as const } }
    expect(fastPathEligible(base).ok).toBe(true)
    expect(fastPathEligible({ ...base, risk: { verdict: 'WARN' } }).ok).toBe(false)
    expect(fastPathEligible({ ...base, preview: { estimatedPrice: null, estimatedNotional: null } }).ok).toBe(false)
    expect(fastPathEligible({ ...base, kind: 'protect_existing', preview: { estimatedPrice: null, estimatedNotional: null } }).ok).toBe(true)
    expect(fastPathEligible({ ...base, expiresAt: new Date(Date.now() + 5000).toISOString() }).ok).toBe(false)
  })
  it('builder skips questions with a single valid answer and never picks between accounts', () => {
    const one = [acct('a', 'binance', 'demo', ['spot'])]
    const d = autoResolve({ asset: 'BTC', orderType: 'MARKET', origin: 'manual', answered: [] }, one)
    expect(d.accountId).toBe('a'); expect(d.product).toBe('spot')
    const two = [acct('a', 'binance', 'demo'), acct('b', 'bybit', 'demo')]
    expect(nextStep(autoResolve({ asset: 'BTC', orderType: 'MARKET', origin: 'manual', answered: [] }, two), two)).toBe('account')
  })
  it('stepper increments grow with the amount and respect limits', () => {
    expect(stepAmount(50, 1)).toBe(60); expect(stepAmount(5, -1)).toBe(5); expect(stepAmount(990, 1, 5, 1000)).toBe(1000)
  })
})

describe('terminology & privacy', () => {
  it('beginner and pro wording differ without changing meaning', () => {
    expect(term('unprotected', 'beginner')).toBe('no stop'); expect(term('unprotected', 'pro')).toBe('unprotected')
    expect(term('ALLOW', 'beginner')).toBe('Within your trading limits')
  })
  it('privacy mode hides every money value', () => {
    expect(usdOf({ mode: 'beginner', privacy: true })(1234)).toBe('$***')
    expect(pnlOf({ mode: 'pro', privacy: true })('-5')).toBe('$***')
    expect(usdOf({ mode: 'beginner', privacy: false })(-1234.5)).toBe('-$1,234.50')
  })
})
