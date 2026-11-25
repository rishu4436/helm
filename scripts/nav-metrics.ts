/**
 * Navigation-step metrics (AUTOMATED walkthrough, no human participants).
 * "After" counts are measured by driving the real UX 2.0 Controller against SampleBackend and counting gestures
 * (swipe / tap / double-tap; voice commands counted separately). "Before" counts are derived from the main-branch
 * main.ts state machine and its 11-item HOME_ITEMS menu (static analysis; the old app was not re-run here).
 * Run: npx tsx scripts/nav-metrics.ts > evidence/ux-v2/navigation-metrics.json
 */
import { Controller, type Host } from '../apps/glasses/src/nav/controller'
import { SampleBackend } from '../apps/glasses/src/nav/sample'
import type { ScreenSpec } from '../apps/glasses/src/layout'

type Task = { id: string; task: string; before: { gestures: number; path: string }; run: (d: Driver) => Promise<void>; expect: RegExp }
class Driver {
  spec!: ScreenSpec; gestures = 0; voice = 0; ms: number[] = []; c: Controller; sel = 0
  constructor() {
    let gen = 0
    const host: Host = { render: async s => { if (!this.spec || this.spec.key !== s.key) this.sel = 0; this.spec = s; return { ok: true, key: s.key, bind: s.bind, generation: ++gen, mode: 'rebuild', degraded: false, images: [], ms: 0 } }, exit: () => {}, log: () => {} }
    this.c = new Controller(new SampleBackend('sample'), host)
  }
  items() { return this.spec.lists?.find(l => l.capture)?.items ?? [] }
  text() { return [...this.spec.texts.map(t => t.text), ...this.items()].join('\n') }
  async timed(f: () => Promise<unknown>) { const t = performance.now(); await f(); this.ms.push(performance.now() - t) }
  /** Swipe to the first row matching re (counting each swipe), then tap. */
  async pick(re: RegExp) {
    const i = this.items().findIndex(x => re.test(x)); if (i < 0) throw new Error(`no ${re} in ${this.spec.key}: ${this.items().join(' / ')}`)
    this.gestures += Math.abs(i - this.sel) + 1; this.sel = i
    await this.timed(() => this.c.input({ kind: 'tap', source: 'list', index: i }))
  }
  async say(t: string) { this.voice++; await this.timed(() => this.c.say(t)) }
}
const tasks: Task[] = [
  { id: 'portfolio-value', task: 'Find total portfolio value', before: { gestures: 1, path: 'Home menu → tap Overview' }, run: async () => {}, expect: /\$19,3\d\d/ },
  { id: 'bybit-btc-position', task: 'Find the BTC position on Bybit (with details)', before: { gestures: 2, path: 'swipe → tap "Positions & holdings" (text list; a position could not be opened)' },
    run: async d => { await d.pick(/^Portfolio/); await d.pick(/^Positions/); await d.pick(/BTC LONG/) }, expect: /Entry|ENTRY|entry/ },
  { id: 'largest-allocation', task: 'Identify which exchange has the largest allocation', before: { gestures: 7, path: 'swipe ×6 → tap "Exposure Compass" (largest exchange line)' },
    run: async d => { await d.pick(/^Portfolio/) }, expect: /Bybit/ },
  { id: 'unprotected', task: 'Find an unprotected position', before: { gestures: 10, path: 'swipe ×9 → tap "Protect positions"' }, run: async () => {}, expect: /has no stop/ },
  { id: 'protect', task: 'Protect the unprotected position with a 3% stop, through to the confirm screen', before: { gestures: 14, path: 'swipe ×9 → tap Protect positions → tap position → swipe → tap 3% → tap (impact) → tap (risk) → CONFIRM' },
    run: async d => { await d.pick(/has no stop/); await d.pick(/Add protection/); await d.pick(/3%/); await d.pick(/Continue/) }, expect: /CONFIRM/ },
  { id: 'trade-btc', task: 'Prepare a $100 BTC spot buy on Bybit, through to the confirm screen (gestures only)', before: { gestures: 9, path: 'swipe ×4 → tap Trade → swipe → tap Bybit → tap $100 preset → tap (impact) → tap (risk) → CONFIRM' },
    run: async d => { await d.pick(/^Trade/); await d.pick(/BTC/); await d.pick(/Bybit/); await d.pick(/^Buy BTC/); await d.pick(/\$?100\b/); await d.pick(/Continue|Review|Preview/); if (!/CONFIRM/.test(d.text())) await d.pick(/Continue/) }, expect: /CONFIRM/ },
  { id: 'trade-voice', task: 'Same $100 BTC buy on Bybit by voice, to the confirm screen', before: { gestures: 5, path: 'swipe ×3 → tap Voice command → tap (finish) → speak → tap (heard) → tap (impact) → tap (risk) → CONFIRM (≈5 gestures after speaking, plus 3 to reach Voice)' },
    run: async d => { await d.say('Buy 100 dollars of BTC on Bybit'); await d.pick(/Preview/); await d.pick(/Continue/) }, expect: /CONFIRM/ },
  { id: 'cancel', task: 'Cancel an order preview from the confirm screen', before: { gestures: 1, path: 'tap (Cancel is default)' },
    run: async d => { await d.say('Buy 100 dollars of BTC on Bybit'); await d.pick(/Preview/); await d.pick(/Continue/); d.gestures = 0; d.voice = 0; await d.pick(/^Cancel/) }, expect: /HELM/ },
  { id: 'last-receipt', task: 'Find the last receipt', before: { gestures: 9, path: 'swipe ×7 → tap Receipts → tap first' },
    run: async d => { await d.pick(/^Activity/); await d.pick(/^Receipts/); await d.pick(/./) }, expect: /RECEIPT|receipt|Receipt|FILLED/ },
  { id: 'venue-compare', task: 'Compare venues for ETH', before: { gestures: 5, path: 'swipe ×2 → tap Watchlist → swipe → tap ETH (venue table)' },
    run: async d => { await d.pick(/^Markets/); await d.pick(/^ETH/); await d.pick(/Compare venues/) }, expect: /VENUE|Venue/ },
]
;(async () => {
  const out = []
  for (const t of tasks) {
    const d = new Driver(); await d.c.start()
    let ok = true, err: string | undefined
    try { await t.run(d); ok = t.expect.test(d.text()) } catch (e) { ok = false; err = (e as Error).message }
    out.push({ id: t.id, task: t.task, before: t.before, after: { gestures: d.gestures, voiceCommands: d.voice, endScreen: d.spec.key, reached: ok, ...(err ? { error: err } : {}) }, controllerMsAvg: d.ms.length ? +(d.ms.reduce((a, b) => a + b, 0) / d.ms.length).toFixed(2) : 0 })
  }
  console.log(JSON.stringify({ kind: 'AUTOMATED task walkthrough — no human participants', generatedAt: new Date().toISOString(), method: 'after = real Controller + SampleBackend (in-process, no network, no BLE); before = static analysis of main-branch main.ts (11-item menu)', note: 'controllerMsAvg is in-process controller time only; it is not simulator, BLE or physical-device latency', tasks: out }, null, 2))
  process.exit(0) // confirm-screen countdown timers would otherwise keep the process alive
})()
