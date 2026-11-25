import { describe, expect, it } from 'vitest'
import { Controller, type Host, type Input } from './controller'
import { SampleBackend } from './sample'
import { validateSpec, utf8Len, type ScreenSpec } from '../layout'
import { sanitize, type RenderAck } from '../render'
import { toInput } from './events'

function rig(opts: { kind?: 'sample' | 'practice'; failKey?: string; backend?: SampleBackend } = {}) {
  let t = Date.parse('2026-11-25T10:00:00Z')
  const shown: ScreenSpec[] = []
  const logs: string[] = []
  let gen = 0
  const host: Host = {
    render: async spec => {
      const s = sanitize(spec)
      shown.push(s)
      const errs = validateSpec(s)
      if (errs.length) throw new Error(`${s.key}: ${errs.join('; ')}`)
      const ok = s.key !== opts.failKey
      const ack: RenderAck = { ok, key: s.key, bind: s.bind, generation: ++gen, mode: ok ? 'rebuild' : 'failed', degraded: false, images: [], ms: 1 }
      return ack
    },
    exit: () => logs.push('EXIT'),
    log: m => logs.push(m),
    now: () => t,
    setTimeout: () => null, clearTimeout: () => undefined, setInterval: () => null, clearInterval: () => undefined,
  }
  const b = opts.backend ?? new SampleBackend(opts.kind ?? 'sample', {}, () => t)
  const c = new Controller(b, host)
  c.practiceFactory = () => new SampleBackend('practice', {}, () => t)
  const last = () => shown[shown.length - 1]!
  const list = () => last().lists?.find(l => l.capture)?.items ?? []
  const idxOf = (re: RegExp) => { const i = list().findIndex(x => re.test(x)); if (i < 0) throw new Error(`no item ${re} in ${last().key}: ${list().join(' | ')}`); return i }
  const tap = (re: RegExp) => c.input({ kind: 'tap', source: 'list', index: idxOf(re) })
  const send = (i: Input) => c.input(i)
  return { c, b, host, shown, logs, last, list, tap, send, idxOf, advance: (ms: number) => { t += ms } }
}

describe('controller · shared navigation', () => {
  it('starts on an adaptive Home that leads with the no-stop alert', async () => {
    const r = rig(); await r.c.start()
    expect(r.c.current?.name).toBe('home')
    expect(r.last().key).toBe('home-risk')
    expect(r.list()[0]).toMatch(/^! BTC LONG on Bybit has no stop/)
  })
  it('every rendered screen is valid, list labels fit 63 bytes and view items align with the drawn list', async () => {
    const r = rig(); await r.c.start()
    const walk: RegExp[] = [/^Portfolio/]
    for (const w of walk) await r.tap(w)
    await r.send({ kind: 'double' })
    await r.tap(/^Markets/); await r.tap(/^BTC/); await r.tap(/Compare venues/); await r.send({ kind: 'double' }); await r.send({ kind: 'double' }); await r.send({ kind: 'double' })
    await r.tap(/^More/); await r.tap(/^Settings/); await r.tap(/^Mode/)
    expect(r.c.prefs.mode).toBe('pro')
    for (const s of r.shown) for (const l of s.lists ?? []) for (const it of l.items) expect(utf8Len(it)).toBeLessThanOrEqual(63)
    expect(r.logs.filter(l => l.includes('item mismatch'))).toEqual([])
  })
  it('protect flow: alert → add stop → review → confirm (Cancel first) → receipt; Home is no longer in risk mode', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^! BTC LONG/)
    expect(r.c.current?.name).toBe('event')
    await r.tap(/Add protection/)
    expect(r.c.current?.name).toBe('protect-pick')
    await r.tap(/Stop 3%/)
    expect(r.c.current?.name).toBe('review')
    await r.tap(/Continue to confirm/)
    expect(r.c.current?.name).toBe('confirm')
    expect(r.list()[0]).toBe('Cancel')
    expect(r.list()[1]).toMatch(/^Confirm/)
    await r.send({ kind: 'tap', source: 'list', index: 1 })
    expect(r.c.current?.name).toBe('receipt')
    await r.tap(/^Home/)
    expect(r.last().key).not.toBe('home-risk')
  })
  it('Cancel on the confirmation returns to where the user started and sends nothing', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Add protection/); await r.tap(/Stop 2%/); await r.tap(/Continue to confirm/)
    await r.send({ kind: 'tap', source: 'list', index: 0 })
    expect(r.c.current?.name).toBe('protect-pick')
    expect(await r.b.receipts()).toHaveLength(0)
  })
  it('a tap that is not a list selection (sys/text tap) never confirms', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Add protection/); await r.tap(/Stop 2%/); await r.tap(/Continue to confirm/)
    await r.send({ kind: 'tap', source: 'sys' }); await r.send({ kind: 'tap', source: 'text' })
    expect(r.c.current?.name).toBe('confirm')
    expect(await r.b.receipts()).toHaveLength(0)
  })
  it('confirmation is disabled when the confirm screen was not drawn (render ack failed)', async () => {
    const r = rig({ failKey: 'confirm' }); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Add protection/); await r.tap(/Stop 2%/); await r.tap(/Continue to confirm/)
    await r.send({ kind: 'tap', source: 'list', index: 1 })
    expect(r.c.stats.confirmRejected).toBe(1)
    expect(await r.b.receipts()).toHaveLength(0)
    expect(r.c.current?.name).toBe('recovery')
  })
  it('an expired preview cannot be confirmed; the user is offered a fresh preview and back skips the stale review', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Add protection/); await r.tap(/Stop 2%/); await r.tap(/Continue to confirm/)
    r.advance(46_000)
    await r.send({ kind: 'tap', source: 'list', index: 1 })
    expect(await r.b.receipts()).toHaveLength(0)
    expect(r.list()[0]).toBe('Prepare a fresh preview')
    await r.tap(/fresh preview/)
    expect(r.c.current?.name).toBe('review')
    await r.send({ kind: 'double' })
    expect(r.c.current?.name).not.toBe('review')
    expect(r.c.current?.name).not.toBe('confirm')
  })
  it('a proposal is single-use: after the receipt, back never returns into the used confirmation', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Add protection/); await r.tap(/Stop 2%/); await r.tap(/Continue to confirm/)
    await r.send({ kind: 'tap', source: 'list', index: 1 })
    await r.send({ kind: 'double' })
    expect(['home']).toContain(r.c.current?.name)
    expect(await r.b.receipts()).toHaveLength(1)
  })
  it('input is ignored while a preview is loading (rapid taps produce one proposal)', async () => {
    const b = new SampleBackend('sample')
    let release!: () => void
    const orig = b.protectPreview.bind(b)
    let calls = 0
    b.protectPreview = async x => { calls++; await new Promise<void>(res => { release = res }); return orig(x) }
    const r = rig({ backend: b }); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Add protection/)
    const first = r.tap(/Stop 2%/)
    await r.send({ kind: 'tap', source: 'list', index: 1 }); await r.send({ kind: 'tap', source: 'list', index: 1 })
    expect(r.c.stats.ignoredBusy).toBe(2)
    release(); await first
    expect(calls).toBe(1)
    expect(r.c.current?.name).toBe('review')
  })
  it('manual order builder asks only what is unknown, then previews', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^Trade/)
    expect(r.c.current?.name).toBe('build-asset')
    await r.tap(/^ETH/)
    expect(r.c.current?.name).toBe('build-account')
    await r.tap(/^Binance/)
    expect(r.c.current?.name).toBe('build-product') // market + direction in one step
    expect(r.list()).toEqual(expect.arrayContaining([expect.stringMatching(/^Buy ETH/), expect.stringMatching(/^Short/)]))
    await r.tap(/^Buy ETH/)
    await r.tap(/^\$50$/)
    expect(r.c.current?.name).toBe('review')
    expect(r.last().texts.find(t => t.name === 'body')!.text).toMatch(/BUY .* ETH/)
  })
  it('context defaults (§16): after a confirmed order its asset, account, market type and size are listed FIRST but still chosen by the user', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^Trade/); await r.tap(/^ETH/); await r.tap(/^Binance/); await r.tap(/^Buy ETH/); await r.tap(/^\$50$/)
    await r.tap(/^Continue to confirm/)
    expect(r.c.current?.name).toBe('confirm')
    expect(r.list()[0]).toBe('Cancel')
    await r.send({ kind: 'tap', source: 'list', index: 1 })
    expect(r.c.current?.name).toBe('receipt')
    expect(r.c.prefs.lastOrder).toMatchObject({ asset: 'ETH', product: 'spot', side: 'BUY' })
    expect(r.c.prefs.recentSizes?.[0]).toBe('50')
    await r.send({ kind: 'double' })
    await r.tap(/^Trade/)
    expect(r.list()[0]).toMatch(/^ETH/)
    await r.tap(/^ETH/)
    expect(r.c.current?.name).toBe('build-account') // never auto-picked when several accounts fit
    expect(r.list()[0]).toMatch(/^Binance.*last used/)
    await r.tap(/^Binance/)
    expect(r.list()[0]).toMatch(/^Buy ETH/)
    await r.tap(/^Buy ETH/)
    expect(r.list()[0]).toBe('$50 · recent')
  })
  it('market screen compares venues inline; Activity lists the last receipt first', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^Markets/); await r.tap(/^ETH/)
    expect(r.last().texts.find(t => t.name === 'body')!.text).toMatch(/Tightest: Binance 0\.2 bp\nthen OKX 0\.4 bp · Bybit 0\.6 bp/)
    await r.send({ kind: 'double' }); await r.send({ kind: 'double' })
    await r.tap(/^Activity/)
    expect(r.list().some(x => /^Last receipt/.test(x))).toBe(false) // no orders yet → no fake row
    const p = await r.b.preview({ accountId: 's-bin', asset: 'BTC', product: 'spot', side: 'BUY', notional: '25' }); await r.b.confirm(p, 'k1')
    await r.send({ kind: 'double' }); await r.tap(/^Activity/)
    expect(r.list()[0]).toMatch(/^Last receipt · BUY BTC · FILLED/)
    await r.tap(/^Last receipt/)
    expect(r.c.current?.name).toBe('receipt')
  })
  it('position actions: reduce 50% is a reduce-only close-side preview', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^Positions|^Portfolio/)
    if (r.c.current?.name !== 'positions') await r.tap(/^Positions/)
    await r.tap(/^ETH SHORT/)
    expect(r.c.current?.name).toBe('focus')
    await r.tap(/^Reduce 50%/)
    expect(r.c.current?.name).toBe('review')
    const body = r.last().texts.find(t => t.name === 'body')!.text
    expect(body).toMatch(/Only reduces or closes, never adds/)
    expect(body).toMatch(/^BUY/)
  })
  it('positions and holdings paginate instead of truncating', async () => {
    const b = new SampleBackend('sample')
    const p0 = b.portfolio.bind(b)
    b.portfolio = async () => { const r = await p0(); r.portfolio.holdings = Array.from({ length: 40 }, (_, i) => ({ accountId: 's-bin', asset: `A${i}`, total: '1', free: '1', locked: '0', valueUsd: String(100 + i) })); return r }
    const r = rig({ backend: b }); await r.c.start()
    await r.tap(/^Portfolio/); await r.tap(/^Holdings/)
    expect(r.list().length).toBeLessThanOrEqual(20)
    expect(r.list().some(x => /^Next page 2\/3/.test(x))).toBe(true)
    await r.tap(/^Next page/); await r.tap(/^Next page/)
    expect(r.list().some(x => /Previous page/.test(x))).toBe(true)
  })
  it('Quick Deck: swipe moves between cards, tap opens the destination, double-tap returns home', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^Quick Deck/)
    const first = r.last().key
    await r.send({ kind: 'swipe', dir: 'down' })
    expect(r.last().key).not.toBe(first)
    await r.send({ kind: 'swipe', dir: 'up' })
    expect(r.last().key).toBe(first)
    await r.send({ kind: 'double' })
    expect(r.c.current?.name).toBe('home')
  })
  it('double-tap on Home asks the host to exit (system exit dialog)', async () => {
    const r = rig(); await r.c.start()
    await r.send({ kind: 'double' })
    expect(r.logs).toContain('EXIT')
  })
})

describe('controller · contextual voice', () => {
  it('"close half of this position" binds to the focused position', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^! BTC LONG/); await r.tap(/Open position/)
    expect(r.c.current?.name).toBe('focus')
    await r.tap(/^Voice/)
    await r.tap(/Close half of this position/)
    expect(r.c.current?.name).toBe('heard')
    expect(r.list()[0]).toMatch(/^Preview: REDUCE 50% BTC PERP/)
    await r.tap(/^Preview/)
    expect(r.c.current?.name).toBe('review')
  })
  it('an ambiguous order asks which account instead of guessing', async () => {
    const r = rig(); await r.c.start()
    await r.c.say('prepare a 50 dollar BTC buy')
    expect(r.c.current?.name).toBe('heard')
    expect(r.list().slice(0, 3).every(x => /sample/.test(x))).toBe(true)
    await r.tap(/^Bybit/)
    expect(r.list()[0]).toMatch(/^Preview: BUY \$50 BTC SPOT · Bybit/)
  })
  it('"make it 25 dollars instead" edits the current draft', async () => {
    const r = rig(); await r.c.start()
    await r.tap(/^Trade/); await r.tap(/^ETH/); await r.tap(/^Binance/); await r.tap(/^Buy ETH/); await r.tap(/^\$50$/)
    await r.tap(/Change by voice/)
    await r.tap(/Make it 25 dollars instead/)
    expect(r.list()[0]).toMatch(/\$25 ETH/)
  })
  it('read-only commands navigate; nothing is proposed', async () => {
    const r = rig(); await r.c.start()
    await r.c.say('show my bybit account')
    expect(r.list()[0]).toMatch(/^Open: Show Bybit/)
    await r.tap(/^Open/)
    expect(r.c.current?.name).toBe('account-s-byb')
  })
  it('withdrawals are rejected', async () => {
    const r = rig(); await r.c.start()
    await r.c.say('withdraw all my bitcoin')
    expect(r.list()[0]).toBe('Try again')
  })
})

describe('controller · onboarding practice', () => {
  it('practice mode uses sample data and finishing returns to the real backend', async () => {
    const r = rig(); await r.c.start()
    r.c.prefs.onboarding.completedAt = null
    await r.c.replaceRoot(r.c.onboardWelcomeView())
    await r.tap(/^Try HELM/)
    expect(r.c.current?.name).toBe('ob-gesture-0')
    await r.send({ kind: 'swipe', dir: 'down' })
    await r.send({ kind: 'tap', source: 'sys' })
    await r.send({ kind: 'double' })
    await r.send({ kind: 'tap', source: 'sys' })
    expect(r.c.current?.name).toBe('ob-practice')
    await r.tap(/Start practice/)
    expect(r.c.backend.kind).toBe('practice')
    expect(r.list()[0]).toMatch(/Finish practice/)
    await r.tap(/Finish practice/)
    expect(r.c.backend.kind).toBe('sample')
    expect(r.c.current?.name).toBe('ob-finish')
  })
})

describe('events · Even Hub envelope mapping', () => {
  it('maps list taps with index, text scrolls to swipes, double-taps and lifecycle', () => {
    expect(toInput({ listEvent: { currentSelectItemIndex: 2, currentSelectItemName: 'X' } })).toEqual({ kind: 'tap', source: 'list', index: 2, name: 'X' })
    expect(toInput({ listEvent: {} })).toEqual({ kind: 'tap', source: 'list', index: 0, name: undefined })
    expect(toInput({ textEvent: { eventType: 1 } })).toEqual({ kind: 'swipe', dir: 'up' })
    expect(toInput({ textEvent: { eventType: 2 } })).toEqual({ kind: 'swipe', dir: 'down' })
    expect(toInput({ sysEvent: { eventType: 3 } })).toEqual({ kind: 'double' })
    expect(toInput({ sysEvent: {} })).toEqual({ kind: 'tap', source: 'sys' })
    expect(toInput({ sysEvent: { eventType: 7 } })).toBe('exit')
    expect(toInput({ listEvent: { eventType: 1 } })).toBeNull()
  })
})
