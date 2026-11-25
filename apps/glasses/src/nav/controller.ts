/**
 * HELM UX 2.0 navigation controller — ONE state machine shared by the G2 app, the companion Vision mirror and the
 * landing-page demo. Hosts supply rendering, timers, an optional microphone and exit; backends supply data.
 *
 * Gesture contract (real G2 inputs only): swipe (firmware list highlight, or text-capture scroll events), tap, double-tap.
 * Safety contract:
 *  - Cancel is index 0 on every confirmation; Confirm requires index 1 AND a fresh render ack bound to that proposal.
 *  - A proposal is confirmed at most once (single-use, idempotency key fixed per proposal); expired → fresh preview.
 *  - Input is ignored while a read loads or an order submits; double-tap cancels only read-only loads.
 *  - Back never returns into a used or expired review/confirmation.
 *  - A network failure during confirm shows "Verifying with exchange" and never retries automatically.
 *  - If the display fails to draw the confirmation, confirmation is disabled.
 */
import type { PreviewResp, Receipt, Ticket } from '../api'
import type { RenderAck } from '../render'
import type { ScreenSpec } from '../layout'
import * as V from '../screens/v2'
import * as T from '../screens/trade'
import { type MenuItem } from '../screens/v2'
import type { Acct, ActivityItem, ActivityPayload, PortfolioPayload, Prefs, WatchItem } from '../ux/types'
import { BEGINNER_DECK, DEFAULT_DECK, DEFAULT_PREFS, withDefaults } from '../ux/types'
import type { ViewCtx } from '../ux/format'
import { usdOf } from '../ux/format'
import { EXPLAIN, term } from '../ux/terms'
import * as M from '../ux/model'
import type { HelmBackend, VoiceContext, VoiceResult } from './backend'

export type Input = { kind: 'tap'; index?: number; name?: string; source: 'list' | 'text' | 'sys' } | { kind: 'double' } | { kind: 'swipe'; dir: 'up' | 'down' }
export interface Host {
  render(spec: ScreenSpec): Promise<RenderAck>
  exit(): void
  log?(m: string): void
  /** G2 microphone (PCM16 16 kHz). Hosts without one (Vision, landing demo) get example commands instead. */
  mic?: { start(): Promise<boolean>; stop(): Promise<{ audioBase64: string; sampleRate: number } | null> }
  now?(): number
  setTimeout?(fn: () => void, ms: number): unknown
  clearTimeout?(h: unknown): void
  setInterval?(fn: () => void, ms: number): unknown
  clearInterval?(h: unknown): void
  /** Called whenever the visible view changes (Vision mirror / landing demo status line). */
  onView?(v: { name: string; key: string; backend: string }): void
}

export interface View {
  name: string
  build(): ScreenSpec
  items?: MenuItem[]
  onItem?(it: MenuItem, index: number): unknown
  onTap?(): unknown
  onSwipe?(dir: 'up' | 'down'): unknown
  /** Return true when handled (otherwise the controller pops the stack). */
  onBack?(): unknown
  tickMs?: number
  onTick?(): unknown
  /** Not pushed on the back stack (loading, listening, submitting, errors). */
  transient?: boolean
  /** Review/confirm views carry their proposal so back-navigation can skip used/expired ones. */
  proposal?: PreviewResp
  confirm?: boolean
}
type Redo = () => Promise<PreviewResp>
const VOICE_EXAMPLES: Record<string, string[]> = {
  home: ['Which positions need attention?', 'Show my portfolio', 'Show my Bybit account', 'Prepare a 50 dollar BTC buy'],
  focus: ['Close half of this position', 'Add a three percent stop', 'Show my liquidation distance'],
  review: ['Make it 25 dollars instead', 'Change the leverage to two', 'Use my Bybit account'],
  market: ['Compare Binance and Bybit', 'Prepare a 50 dollar buy', 'Show my holdings'],
  account: ['Show positions on Bybit', 'Prepare a 50 dollar ETH buy', 'Show my portfolio'],
}
export class Canceled extends Error { constructor() { super('canceled') } }
export function sameList(a: string[], b: string[]) { return a.length === b.length && a.every((x, i) => x === b[i]) }
export function draftTicket(d: M.Draft): Ticket | null {
  if (!d.asset || !d.accountId || !d.product || !d.side) return null
  return {
    accountId: d.accountId, asset: d.asset, product: d.product, side: d.side,
    ...(d.notional ? { notional: d.notional } : {}), ...(d.quantity ? { quantity: d.quantity } : {}), ...(d.fraction ? { fraction: d.fraction } : {}),
    ...(d.leverage && d.product === 'perp' ? { leverage: d.leverage } : {}), ...(d.stopOffsetPercent ? { stopOffsetPercent: d.stopOffsetPercent } : {}),
    ...(d.reduceOnly ? { reduceOnly: true } : {}), ...(d.instrumentId ? { instrumentId: d.instrumentId } : {}),
  }
}

export class Controller {
  backend: HelmBackend
  private real: HelmBackend
  private stack: View[] = []
  private view: View | null = null
  private busy = false
  private loadSeq = 0
  private tick: unknown = null
  private lastAck: RenderAck | null = null
  private used = new Set<string>()
  private keys = new Map<string, string>()
  private redo = new Map<string, Redo>()
  private originOf = new Map<string, number>()
  accts: Acct[] = []
  portfolio: PortfolioPayload | null = null
  activity: ActivityPayload | null = null
  prefs: Prefs = DEFAULT_PREFS
  watch: WatchItem[] = []
  private policy: Record<string, unknown> | null = null
  private loaded = 0
  practiceFactory: (() => HelmBackend) | null = null
  /** Exposed for tests / diagnostics. */
  readonly stats = { inputs: 0, ignoredBusy: 0, confirmRejected: 0, renders: 0 }

  constructor(backend: HelmBackend, private readonly host: Host) { this.backend = backend; this.real = backend }

  private now() { return this.host.now?.() ?? Date.now() }
  private log(m: string) { (this.host.log ?? console.log)(`[HELM] ${m}`) }
  get ctx(): ViewCtx { return { mode: this.prefs.mode, privacy: this.prefs.privacy } }
  get current() { return this.view }
  get depth() { return this.stack.length }
  get isBusy() { return this.busy }
  get ack() { return this.lastAck }

  // ---------------- lifecycle ----------------
  async start() {
    try { await this.refresh(true) } catch { /* shown as empty/stale */ }
    if (!this.prefs.onboarding.completedAt && !this.prefs.onboarding.skippedAt && this.backend.kind === 'live') return this.replaceRoot(this.onboardWelcomeView())
    return this.replaceRoot(this.homeView())
  }
  /** Reload accounts/portfolio/activity/prefs. Failures keep the last known values and are shown as stale. */
  async refresh(force = false) {
    if (!force && this.now() - this.loaded < 3000) return
    const b = this.backend
    const [a, p, act, pr] = await Promise.allSettled([b.accounts(), b.portfolio(), b.activity(), b.prefs()])
    if (b !== this.backend) return
    if (a.status === 'fulfilled') this.accts = a.value
    if (p.status === 'fulfilled') this.portfolio = p.value.portfolio
    if (act.status === 'fulfilled') this.activity = act.value
    if (pr.status === 'fulfilled') this.prefs = withDefaults(pr.value)
    if (a.status === 'rejected' && p.status === 'rejected') throw a.reason
    this.loaded = this.now()
  }

  // ---------------- input ----------------
  async input(e: Input) {
    this.stats.inputs++
    const v = this.view
    if (!v) return
    if (this.busy) {
      if (e.kind === 'double' && v.name === 'loading') { this.loadSeq++; this.busy = false; this.log('load canceled'); return this.back() }
      this.stats.ignoredBusy++; this.log(`input ignored (busy) ${e.kind}`); return
    }
    try {
      if (e.kind === 'double') { if (v.onBack) { const r = await v.onBack(); if (r === true) return } return await this.back() }
      if (e.kind === 'swipe') { if (v.onSwipe) await v.onSwipe(e.dir); return }
      if (v.items && e.source === 'list') {
        const i = e.index ?? 0
        const it = v.items[i]
        if (!it) return
        if (v.onItem) await v.onItem(it, i)
        return
      }
      if (v.onTap) await v.onTap()
    } catch (err) { await this.fail('SOMETHING WENT WRONG', err) }
  }
  /** The renderer reported that it could not draw a screen. */
  displayFailed(key: string, reason: string) {
    this.log(`display failed ${key}: ${reason}`)
    const v = this.view
    if (v?.confirm || v?.proposal) return void this.replace(this.recoveryView('DISPLAY ERROR', 'The glasses could not draw the review. Confirmation is disabled. Nothing was sent.', [{ id: 'home', label: 'Home' }]))
  }

  // ---------------- navigation ----------------
  private async show(v: View) {
    this.clearTick()
    this.view = v
    const spec = v.build()
    this.stats.renders++
    const list = spec.lists?.find(l => l.capture)
    if (v.items && list && list.items.length !== Math.min(20, v.items.length)) this.log(`WARN item mismatch ${spec.key}: view ${v.items.length} vs list ${list.items.length}`)
    const ack = await this.host.render(spec)
    if (this.view === v) this.lastAck = ack
    this.host.onView?.({ name: v.name, key: spec.key, backend: this.backend.kind })
    if (v.tickMs && v.onTick && this.view === v) this.tick = (this.host.setInterval ?? setInterval)(() => { if (this.view === v && !this.busy) void v.onTick!() }, v.tickMs)
    return ack
  }
  private clearTick() { if (this.tick !== null) { (this.host.clearInterval ?? clearInterval)(this.tick as never); this.tick = null } }
  async push(v: View) { if (this.view && !this.view.transient) this.stack.push(this.view); return this.show(v) }
  async replace(v: View) { return this.show(v) }
  async replaceRoot(v: View) { this.stack = []; return this.show(v) }
  private redraw() { if (this.view) return this.show(this.view) }
  async back() {
    let prev = this.stack.pop()
    while (prev && prev.proposal && (this.used.has(prev.proposal.proposalId) || T.secondsLeft(prev.proposal, this.now()) === 0)) prev = this.stack.pop()
    if (!prev) {
      if (this.view?.name === 'home' || this.view?.name?.startsWith('ob-')) { this.clearTick(); return this.host.exit() }
      return this.goHome()
    }
    if (prev.name === 'home') return this.goHome()
    return this.show(prev)
  }
  async goHome() {
    try { await this.load('Refreshing', () => this.refresh(), true) } catch { /* keep last known values */ }
    return this.replaceRoot(this.homeView())
  }

  /** Run a read with a delayed loading screen. Double-tap cancels (read-only). */
  private async load<R>(label: string, fn: () => Promise<R>, quiet = false): Promise<R> {
    const seq = ++this.loadSeq
    this.busy = true
    const prevView = this.view
    let shown = false
    const timer = (this.host.setTimeout ?? setTimeout)(() => {
      if (this.loadSeq === seq && this.busy && !quiet) { shown = true; if (prevView && !prevView.transient) this.stack.push(prevView); void this.show(this.loadingView(label, true)) }
    }, 350)
    try {
      const r = await fn()
      if (this.loadSeq !== seq) throw new Canceled()
      return r
    } finally {
      ;(this.host.clearTimeout ?? clearTimeout)(timer as never)
      if (this.loadSeq === seq) { this.busy = false; if (shown) this.stack.pop() }
    }
  }
  private async open(label: string, make: () => Promise<View> | View, mode: 'push' | 'replace' = 'push') {
    let v: View
    try { v = await this.load(label, async () => make()) } catch (e) {
      if (e instanceof Canceled) return
      return this.fail('COULD NOT LOAD', e)
    }
    return mode === 'push' ? this.push(v) : this.replace(v)
  }
  private async fail(title: string, e: unknown) {
    const code = (e as { code?: string } | null)?.code
    const msg = e instanceof Error ? `${code ? `${code}: ` : ''}${e.message}` : 'Unexpected error'
    this.log(`fail ${title} ${msg}`)
    return this.push(this.recoveryView(title, msg, [{ id: 'back', label: 'Back' }, { id: 'home', label: 'Home' }]))
  }

  // ---------------- generic views ----------------
  private loadingView(label: string, cancellable: boolean): View { return { name: 'loading', transient: true, build: () => V.loadingScreen(label, cancellable) } }
  private recoveryView(title: string, msg: string, items: MenuItem[], extra: Partial<View> = {}): View {
    return {
      name: 'recovery', transient: true, items, build: () => V.recoveryScreen('recovery', title, msg, items),
      onItem: it => (it.id === 'home' ? this.goHome() : it.id === 'receipts' ? this.openReceipts() : it.id === 'back' ? this.back() : extra.onItem?.(it, 0)),
      onBack: () => this.goHome().then(() => true), ...extra,
    }
  }
  private infoView(key: string, title: string, context: string, body: string, items: MenuItem[] = [{ id: 'back', label: 'Back' }], onItem?: (it: MenuItem) => unknown): View {
    return { name: key, items, build: () => V.infoScreen(key, title, context, body, this.ctx, items), onItem: it => (onItem ? onItem(it) : this.back()) }
  }

  // ---------------- HOME ----------------
  homeView(): View {
    const g = M.glance(this.portfolio, this.accts, this.activity?.current ?? [], this.prefs, this.now())
    const items: MenuItem[] = V.homeItems(g, this.ctx, { watchTop: this.watch[0] ?? null, activityNow: this.activity?.current.length ?? 0 })
    if (this.backend.kind === 'practice') items.unshift({ id: 'finish', label: 'Finish practice · back to your accounts' })
    return {
      name: 'home', items, build: () => V.homeScreen(g, this.portfolio, items, this.ctx, this.prefs.metrics),
      onItem: it => this.homeAction(String(it.id), it.ref),
      tickMs: 15000, onTick: async () => { try { await this.refresh(); if (this.view?.name === 'home' && !this.busy) await this.replace(this.homeView()) } catch { /* stale */ } },
    }
  }
  private homeAction(id: string, ref?: string) {
    switch (id) {
      case 'finish': return this.finishPractice()
      case 'alert': return ref ? this.openEvent(ref) : this.openActivity()
      case 'positions': return this.openPositions({})
      case 'portfolio': return this.openPortfolio()
      case 'holdings': return this.openHoldings()
      case 'markets': return this.openWatchlist()
      case 'trade': return this.openBuilder({ orderType: 'MARKET', origin: 'manual', answered: [] })
      case 'activity': return this.openActivity()
      case 'deck': return this.push(this.deckView(0))
      case 'voice': return this.listen()
      case 'more': return this.push(this.moreView())
      case 'practice': return this.startPractice()
      case 'connect-help': return this.push(this.infoView('connect-help', 'CONNECT AN EXCHANGE', 'companion', 'Open the HELM companion → Connect.\nUse a DEMO / testnet API key (trade +\nread only, never withdrawal). Binance,\nBybit and OKX demo are supported.'))
      case 'accounts': return this.openAccounts()
    }
  }

  // ---------------- PRACTICE (onboarding stages 3-5) ----------------
  async startPractice() {
    if (!this.practiceFactory) return
    this.backend = this.practiceFactory()
    const keep = this.prefs
    try { await this.refresh(true) } catch { /* local */ }
    this.prefs = withDefaults({ ...this.prefs, mode: keep.mode, onboarding: { ...keep.onboarding, stage: 'practice' } })
    this.log('practice started (simulated sample data)')
    return this.replaceRoot(this.homeView())
  }
  async finishPractice() {
    this.backend = this.real
    try { await this.refresh(true) } catch { /* stale */ }
    await this.savePrefs({ onboarding: { completedAt: new Date(this.now()).toISOString(), skippedAt: null, stage: 'done' } })
    return this.replaceRoot(this.onboardDoneView())
  }
  private async savePrefs(patch: Partial<Prefs>) {
    this.prefs = withDefaults({ ...this.prefs, ...patch })
    if (this.backend === this.real) { try { this.prefs = withDefaults(await this.real.savePrefs(patch)) } catch (e) { this.log(`prefs not saved: ${(e as Error).message}`) } }
  }

  // ---------------- ONBOARDING ----------------
  onboardWelcomeView(): View {
    const items: MenuItem[] = [{ id: 'try', label: 'Try HELM (2 minutes)' }, { id: 'connect', label: 'Connect an account' }, { id: 'skip', label: 'Skip introduction' }]
    return {
      name: 'ob-welcome', items, build: () => V.onboardWelcome(),
      onItem: async it => {
        if (it.id === 'try') { await this.savePrefs({ onboarding: { ...this.prefs.onboarding, stage: 'gestures' } }); return this.push(this.onboardGestureView(0)) }
        if (it.id === 'connect') return this.push(this.infoView('ob-connect', 'CONNECT AN ACCOUNT', '1/6', 'In the companion: Connect → pick an\nexchange → paste a DEMO API key.\nHELM never asks for passwords,\n2FA or withdrawal permission.', [{ id: 'try', label: 'Try HELM with practice data first' }, { id: 'skip', label: 'Skip introduction' }], x => (x.id === 'try' ? this.push(this.onboardGestureView(0)) : this.skipOnboarding())))
        return this.skipOnboarding()
      },
    }
  }
  private async skipOnboarding() { await this.savePrefs({ onboarding: { completedAt: null, skippedAt: new Date(this.now()).toISOString(), stage: 'skipped' } }); return this.goHome() }
  onboardGestureView(step: 0 | 1 | 2 | 3): View {
    const next = () => (step < 3 ? this.replace(this.onboardGestureView((step + 1) as 1 | 2 | 3)) : this.push(this.practiceIntroView()))
    return {
      name: `ob-gesture-${step}`, build: () => V.onboardGesture(step),
      onSwipe: () => (step === 0 ? next() : undefined),
      onTap: () => (step === 0 ? undefined : next()),
      onBack: () => (step === 2 ? next().then(() => true) : undefined),
    }
  }
  private practiceIntroView(): View {
    return this.infoView('ob-practice', 'PRACTICE', '3/6', 'Sample accounts, labelled PRACTICE.\nNothing is sent to any exchange.\nTry: open the BTC position, add a\nstop, review it, then confirm.', [{ id: 'start', label: 'Start practice' }, { id: 'skip', label: 'Skip to my accounts' }], it => (it.id === 'start' ? this.startPractice() : this.finishPractice()))
  }
  onboardDoneView(): View {
    const items: MenuItem[] = [{ id: 'home', label: 'Go to Home' }, { id: 'restart', label: 'Restart tutorial' }]
    return { name: 'ob-finish', items, build: () => V.onboardDone(), onItem: it => (it.id === 'home' ? this.goHome() : this.replaceRoot(this.onboardWelcomeView())) }
  }

  // ---------------- QUICK DECK ----------------
  deckOrder(): V.CardId[] {
    const valid = new Set<string>(DEFAULT_DECK)
    const base = this.prefs.mode === 'beginner' && sameList(this.prefs.deckOrder, [...DEFAULT_DECK]) ? [...BEGINNER_DECK] : this.prefs.deckOrder
    const order = base.filter(x => valid.has(x)) as V.CardId[]
    const fav = this.prefs.deckFavorites.filter(x => order.includes(x as V.CardId)) as V.CardId[]
    return [...fav, ...order.filter(x => !fav.includes(x))]
  }
  deckView(i: number): View {
    const order = this.deckOrder()
    const idx = ((i % order.length) + order.length) % order.length
    const id = order[idx]!
    const rows = this.portfolio ? M.positionRows(this.portfolio) : []
    const largest = [...rows].sort((a, b) => (b.notionalUsd ?? 0) - (a.notionalUsd ?? 0))[0]
    const d: V.DeckData = { p: this.portfolio, g: M.glance(this.portfolio, this.accts, this.activity?.current ?? [], this.prefs, this.now()), rows, watch: this.watch, activity: this.activity, largest: largest ? M.focusModel(largest) : null }
    if (id === 'watchlist' && !this.watch.length) void this.backend.watchlist(this.prefs.watchlist).then(w => { this.watch = w; if (this.view?.name === 'deck-watchlist' && !this.busy) void this.replace(this.deckView(idx)) }).catch(() => undefined)
    return {
      name: `deck-${id}`, build: () => V.deckCardScreen(id, idx, order.length, d, this.ctx, this.prefs.deckFavorites.includes(id)),
      onSwipe: dir => this.replace(this.deckView(idx + (dir === 'down' ? 1 : -1))),
      onTap: () => {
        switch (V.CARD_ACTION[id]) {
          case 'portfolio': return this.openPortfolio()
          case 'positions': return this.openPositions({})
          case 'accounts': return this.openPortfolio()
          case 'markets': return this.openWatchlist()
          case 'position': return largest ? this.openFocus(largest.key) : this.openPositions({})
          case 'risk': return this.openShield()
          case 'activity': return this.openActivity()
          case 'speak': return this.listen()
        }
      },
    }
  }

  // ---------------- PORTFOLIO / ACCOUNTS ----------------
  openPortfolio(scope?: M.ScopeId) {
    return this.open('Loading portfolio', async () => { await this.refresh(); return this.portfolioView(scope) })
  }
  private portfolioView(scopeId?: M.ScopeId): View {
    const p = this.portfolio ?? { accounts: [], exposures: [], positions: [] }
    const scopes = M.scopesOf(p)
    const scope = scopes.find(s => s.id === scopeId) ?? scopes[0]
    if (!scope) return this.infoView('portfolio-empty', 'PORTFOLIO', '', 'No accounts yet.\nConnect a demo account in the\ncompanion, or try practice data.')
    const items = V.portfolioItems(p, scope, scopes, this.ctx, M.positionRows(p, { scope: scope.id }).length, M.holdingsByAsset(p, scope.id).length)
    return {
      name: `portfolio-${scope.id}`, items, build: () => V.portfolioScreen(p, scope, items, this.ctx),
      onItem: it => {
        switch (it.id) {
          case 'account': return this.openAccount(it.ref!)
          case 'positions': return this.openPositions({ scope: scope.id })
          case 'holdings': return this.openHoldings(scope.id)
          case 'risk': return this.openShield()
          case 'scope': return this.replace(this.portfolioView(it.ref as M.ScopeId))
        }
      },
    }
  }
  openAccounts() {
    return this.open('Loading accounts', async () => {
      this.accts = await this.backend.accounts()
      const items: MenuItem[] = this.accts.map(a => ({ id: 'acct', ref: a.id, label: `${a.alias} · ${M.envTag(a.environment)} · ${a.state === 'CONNECTED' ? 'OK' : a.state}` }))
      const shown = items.length ? items : [{ id: 'none', label: 'No accounts: connect one in the companion' }]
      const v: View = { name: 'accounts', items: shown, build: () => V.listScreen('accounts', 'ACCOUNTS', `${this.accts.length} connected`, shown, this.ctx), onItem: it => (it.ref ? this.openAccount(it.ref) : undefined) }
      return v
    })
  }
  openAccount(accountId: string) {
    return this.open('Loading account', async () => { await this.refresh(); return this.accountView(accountId) })
  }
  private accountView(accountId: string): View {
    const p = this.portfolio
    const a = p?.accounts.find(x => x.accountId === accountId)
    const acct = this.accts.find(x => x.id === accountId)
    if (!p || !a) return this.recoveryView('ACCOUNT', 'That account is no longer connected.', [{ id: 'home', label: 'Home' }])
    const scope = M.scopeOf(a.environment)
    const items = V.accountItems(acct, M.positionRows(p, { accountId }).length, M.holdingsByAsset(p, scope, accountId).length)
    return {
      name: `account-${accountId}`, items, build: () => V.accountScreen(a, acct, items, this.ctx),
      onItem: async it => {
        switch (it.id) {
          case 'positions': return this.openPositions({ accountId })
          case 'holdings': return this.openHoldings(scope, accountId)
          case 'trade': return this.openBuilder({ accountId, orderType: 'MARKET', origin: 'manual', answered: ['account'] })
          case 'status': return this.push(this.infoView(`status-${accountId}`, 'CONNECTION', acct?.environmentLabel ?? '', `${acct?.alias ?? a.alias}\nState: ${acct?.state ?? a.state}\n${acct?.canTrade ? 'Can prepare demo orders' : 'Read-only'}\n${(acct?.reasons ?? []).slice(0, 2).join('\n') || (acct?.label ?? '').slice(0, 60)}`))
          case 'default': await this.backend.setActive(accountId).catch(() => undefined); await this.savePrefs({ preferredExchange: accountId }); return this.push(this.infoView('default-set', 'DEFAULT ACCOUNT', 'saved', `${a.alias} is now the default\nfor this device. Voice and trades\nstill ask when several accounts fit.`))
          case 'all': return this.openPortfolio(scope)
        }
      },
    }
  }

  // ---------------- POSITIONS ----------------
  openPositions(filter: { accountId?: string; asset?: string; scope?: M.ScopeId; unprotectedOnly?: boolean }, page = 0) {
    return this.open('Loading positions', async () => { await this.refresh(); return this.positionsView(filter, page) })
  }
  private positionsView(filter: { accountId?: string; asset?: string; scope?: M.ScopeId; unprotectedOnly?: boolean }, page: number): View {
    let rows = this.portfolio ? M.positionRows(this.portfolio, filter) : []
    if (filter.unprotectedOnly) rows = rows.filter(r => r.product !== 'spot' && !r.stop)
    const pg = M.paginate(rows, page)
    const title = filter.unprotectedOnly ? 'NO STOP' : filter.accountId ? M.shortAlias(this.accts.find(a => a.id === filter.accountId)?.alias ?? '') : filter.scope ? M.SCOPE_LABEL[filter.scope] : 'ALL'
    const items = V.pagedItems(pg, r => V.positionLabel(r, this.ctx), r => r.key)
    return {
      name: 'positions', items: items.length ? items : [{ id: 'row', label: 'No open positions' }], build: () => V.positionsScreen(pg, title, this.ctx),
      onItem: it => (it.id === 'next' ? this.replace(this.positionsView(filter, pg.page + 1)) : it.id === 'prev' ? this.replace(this.positionsView(filter, pg.page - 1)) : it.ref ? this.openFocus(it.ref) : undefined),
    }
  }
  openFocus(key: string) { return this.open('Loading position', async () => { await this.refresh(); return this.focusView(key) }) }
  private findRow(key: string) { return this.portfolio ? M.positionRows(this.portfolio).find(r => r.key === key) : undefined }
  private focusView(key: string): View {
    const row = this.findRow(key)
    if (!row) return this.recoveryView('POSITION', 'That position is no longer open.', [{ id: 'home', label: 'Home' }, { id: 'back', label: 'Back' }])
    const f = M.focusModel(row)
    const acct = this.accts.find(a => a.id === row.pos.accountId)
    const actions = M.positionActions(f, !!acct?.canTrade)
    const items: MenuItem[] = actions.map(a => ({ id: a.id, label: a.label }))
    return {
      name: 'focus', items, build: () => V.focusScreen(f, actions, this.ctx),
      onItem: (_it, i) => {
        const act = actions[i]!
        const closeSide = row.long ? 'SELL' : 'BUY'
        switch (act.id) {
          case 'protect': return this.push(this.protectPickView(row))
          case 'review-stop': return this.push(this.infoView('stop', `${row.base} STOP`, M.shortAlias(row.alias), `Stop ${M.fmtPrice(f.stopPrice)} listed at the venue\n${row.stop?.type ?? ''} · qty ${M.fmtQty(row.stop?.quantity)}\nreduce-only: ${row.stop?.reduceOnly ? 'yes' : 'n/a'}\nNot a guaranteed maximum loss.`))
          case 'review-tp': return this.push(this.infoView('tp', `${row.base} TAKE PROFIT`, M.shortAlias(row.alias), `Take profit ${M.fmtPrice(f.tpPrice)} listed\n${row.tp?.type ?? ''} · qty ${M.fmtQty(row.tp?.quantity)}`))
          case 'reduce25': case 'reduce50': case 'reduce75': case 'close':
            return this.preview({ accountId: row.pos.accountId, asset: row.base, instrumentId: row.pos.instrumentId, product: 'perp', side: closeSide, fraction: act.fraction!, reduceOnly: true })
          case 'increase': return this.openBuilder({ asset: row.base, accountId: row.pos.accountId, product: 'perp', side: row.long ? 'BUY' : 'SELL', instrumentId: row.pos.instrumentId, orderType: 'MARKET', origin: 'position', answered: ['asset', 'account', 'product', 'side'] })
          case 'risk': return this.openPositionRisk(row, f)
          case 'fills': return this.openReceipts(r => r.instrumentId === row.pos.instrumentId)
          case 'voice': return this.listen({ positionKey: row.key, accountId: row.pos.accountId, asset: row.base })
          case 'market': return this.openMarket(row.base)
          case 'buy': case 'sell': return this.openBuilder({ asset: row.base, accountId: row.pos.accountId, product: 'spot', side: act.id === 'buy' ? 'BUY' : 'SELL', orderType: 'MARKET', origin: 'position', answered: ['asset', 'account', 'product', 'side'] })
        }
      },
    }
  }
  openPositionRisk(row: M.PositionRow, f: M.FocusModel) {
    return this.open('Loading risk', async () => {
      const pol = await this.getPolicy()
      const total = this.portfolio ? (M.scopesOf(this.portfolio).find(s => s.id === M.scopeOf(row.env))?.valueUsd ?? 0) : 0
      const items: MenuItem[] = [{ id: 'back', label: 'Back to position' }, ...(row.stop || row.product === 'spot' ? [] : [{ id: 'protect', label: 'Add protection (stop)' }])]
      const v: View = { name: 'position-risk', items, build: () => V.positionRiskScreen(f, pol as { nearLiquidationPct?: string }, total > 0 && f.notional !== null ? (f.notional / total) * 100 : null, this.ctx), onItem: it => (it.id === 'protect' ? this.push(this.protectPickView(row)) : this.back()) }
      return v
    })
  }
  private async getPolicy() { if (!this.policy) { try { this.policy = (await this.backend.policy()).policy } catch { this.policy = {} } } return this.policy }
  private protectPickView(row: M.PositionRow): View {
    const dists = ['2', '3', '5']
    const items: MenuItem[] = [...dists.map(d => ({ id: 'dist', ref: d, label: `Stop ${d}%` })), { id: 'back', label: 'Back' }]
    return {
      name: 'protect-pick', items, build: () => V.protectPickScreen(row.base, row.long ? 'LONG' : 'SHORT', row.alias, dists, this.ctx),
      onItem: it => (it.id === 'dist' ? this.protectPreview({ accountId: row.pos.accountId, instrumentId: row.pos.instrumentId, stopOffsetPercent: it.ref! }) : this.back()),
    }
  }
  openProtectList() {
    return this.open('Loading positions', async () => {
      await this.refresh()
      const rows = (this.portfolio ? M.positionRows(this.portfolio) : []).filter(r => r.product !== 'spot' && !r.stop)
      if (rows.length === 1) return this.focusView(rows[0]!.key)
      return this.positionsView({ unprotectedOnly: true }, 0)
    })
  }

  // ---------------- HOLDINGS ----------------
  openHoldings(scope?: M.ScopeId, accountId?: string, asset?: string) {
    return this.open('Loading holdings', async () => {
      await this.refresh()
      const sc = scope ?? (this.portfolio ? M.primaryScope(this.portfolio) : 'exchange')
      if (asset) { const h = this.portfolio ? M.holdingsByAsset(this.portfolio, sc, accountId).find(x => x.asset === asset) : undefined; if (h) return this.assetHoldingView(h) }
      return this.holdingsView(sc, accountId, 0)
    })
  }
  private holdingsView(scope: M.ScopeId, accountId: string | undefined, page: number): View {
    const all = this.portfolio ? M.holdingsByAsset(this.portfolio, scope, accountId) : []
    const pg = M.paginate(all, page)
    const items = V.pagedItems(pg, h => h.asset, h => h.asset)
    const title = accountId ? `HOLDINGS · ${M.shortAlias(this.accts.find(a => a.id === accountId)?.alias ?? '')}` : 'HOLDINGS'
    return {
      name: 'holdings', items: items.length ? items : [{ id: 'row', label: 'No spot holdings' }], build: () => V.holdingsScreen(pg, scope, this.ctx, title),
      onItem: it => (it.id === 'next' ? this.replace(this.holdingsView(scope, accountId, pg.page + 1)) : it.id === 'prev' ? this.replace(this.holdingsView(scope, accountId, pg.page - 1)) : it.ref ? this.push(this.assetHoldingView(all.find(h => h.asset === it.ref)!)) : undefined),
    }
  }
  private assetHoldingView(h: M.HoldingAgg): View {
    const items: MenuItem[] = h.rows.map(r => ({ id: 'row', ref: r.accountId, label: r.alias }))
    if (!(h.asset === 'USDT' || h.asset === 'USDC')) items.push({ id: 'market', label: 'market' })
    return {
      name: 'asset-holding', items, build: () => V.assetHoldingScreen(h, this.ctx),
      onItem: it => (it.id === 'market' ? this.openMarket(h.asset) : this.push(this.holdingDetailView(h, h.rows.find(r => r.accountId === it.ref)!))),
    }
  }
  private holdingDetailView(h: M.HoldingAgg, row: M.HoldingAgg['rows'][number]): View {
    const acct = this.accts.find(a => a.id === row.accountId)
    const canTrade = !!acct?.canTrade && !!acct?.products.includes('spot')
    const stable = h.asset === 'USDT' || h.asset === 'USDC' || h.asset === 'USD'
    const ids: V.HoldingActionId[] = []
    if (!stable) ids.push('market')
    if (canTrade && !stable) ids.push('buy', 'sell')
    ids.push('receipts', 'back')
    const items: MenuItem[] = ids.map(id => ({ id, label: id }))
    return {
      name: 'holding-detail', items, build: () => V.holdingDetailScreen(h, row, canTrade, this.ctx),
      onItem: it => {
        switch (it.id) {
          case 'market': return this.openMarket(h.asset)
          case 'buy': case 'sell': return this.openBuilder({ asset: h.asset, accountId: row.accountId, product: 'spot', side: it.id === 'buy' ? 'BUY' : 'SELL', orderType: 'MARKET', origin: 'holding', answered: ['asset', 'account', 'product', 'side'] })
          case 'receipts': return this.openReceipts(r => M.sym(r.instrumentId).base === h.asset)
          default: return this.back()
        }
      },
    }
  }

  // ---------------- MARKETS ----------------
  openWatchlist() {
    return this.open('Loading markets', async () => {
      this.watch = await this.backend.watchlist(this.prefs.watchlist)
      const items: MenuItem[] = [...this.watch.map(w => ({ id: 'asset', ref: w.asset, label: w.asset })), { id: 'search', label: 'search' }]
      const v: View = { name: 'watchlist', items, build: () => V.watchlistScreen(this.watch, [], this.ctx), onItem: it => (it.id === 'search' ? this.listen({ screen: 'market' }) : this.openMarket(it.ref!)) }
      return v
    })
  }
  openMarket(asset: string) {
    return this.open(`Loading ${asset}`, async () => this.marketViewFrom(asset, await this.backend.snapshot(asset)))
  }
  private marketViewFrom(asset: string, s: Awaited<ReturnType<HelmBackend['snapshot']>>): View {
    const fav = this.prefs.watchlist.includes(asset)
    const ids: V.MarketActionId[] = ['venues', 'trade', 'fav', 'voice']
    return { name: 'market', items: ids.map(id => ({ id, label: id })), build: () => V.marketScreen(s, fav, this.ctx), onItem: it => (it.id === 'venues' ? this.openVenues(asset) : it.id === 'trade' ? this.openBuilder({ asset, orderType: 'MARKET', origin: 'market', answered: ['asset'] }) : it.id === 'voice' ? this.listen({ screen: 'market', asset }) : this.savePrefs({ watchlist: fav ? this.prefs.watchlist.filter(x => x !== asset) : [...this.prefs.watchlist, asset].slice(0, 12) }).then(() => this.replace(this.marketViewFrom(asset, s)))) }
  }
  openVenues(asset: string, sizeUsd?: number | null, providers?: string[]) {
    return this.open('Comparing venues', async () => {
      const qs = (await this.backend.venues(asset, 'spot', sizeUsd)).filter(q => !providers?.length || providers.includes(q.venue))
      const vm = M.venueModel(qs, sizeUsd)
      const items: MenuItem[] = vm.rows.map(r => ({ id: 'venue', ref: r.venue, label: r.venue }))
      const v: View = {
        name: 'venues', items, build: () => V.venueScreen(asset, vm, this.ctx),
        onItem: it => {
          const q = vm.rows.find(r => r.venue === it.ref)!
          const acct = this.accts.find(a => a.provider === q.venue && a.canTrade && a.products.includes('spot')) ?? null
          const bp = acct ? M.numOrNull(this.portfolio?.accounts.find(x => x.accountId === acct.id)?.availableUsd ?? null) : null
          const dItems: MenuItem[] = [acct ? { id: 'trade', ref: acct.id, label: 'trade' } : { id: 'connect', label: 'connect' }, { id: 'back', label: 'back' }]
          return this.push({
            name: 'venue-detail', items: dItems, build: () => V.venueDetailScreen(asset, q, acct, bp, this.ctx),
            onItem: x => (x.id === 'trade' ? this.openBuilder({ asset, accountId: x.ref, product: 'spot', orderType: 'MARKET', origin: 'market', answered: ['asset', 'account', 'product'] }) : x.id === 'connect' ? this.push(this.infoView('connect-help', 'CONNECT', M.venueName(q.venue), `Connect a ${M.venueName(q.venue)} demo account in the\nHELM companion to trade here.`)) : this.back()),
          })
        },
      }
      return v
    })
  }

  // ---------------- TRADE BUILDER ----------------
  openBuilder(d: M.Draft) {
    return this.open('Preparing', async () => {
      await this.refresh()
      if (!this.watch.length) this.watch = await this.backend.watchlist(this.prefs.watchlist).catch(() => [])
      await this.getPolicy()
      return this.builderView(d)
    })
  }
  builderView(d0: M.Draft): View {
    let d = M.autoResolve(d0, this.accts)
    if (d.product === 'spot' && !d.answered.includes('protection')) d = { ...d, answered: [...d.answered, 'protection'] }
    const step = M.nextStep(d, this.accts)
    const c = this.ctx
    const ctxLine = [d.asset, d.accountId ? M.shortAlias(this.accts.find(a => a.id === d.accountId)?.alias ?? '') : null, d.product ? M.prodLabel(d.product) : null].filter(Boolean).join(' · ')
    const nextWith = (patch: Partial<M.Draft>, field: M.Draft['answered'][number]) => this.push(this.builderView({ ...d, ...patch, answered: [...d.answered, field] }))
    const mk = (title: string, items: MenuItem[], onItem: (it: MenuItem) => unknown, note?: string): View => ({ name: `build-${step}`, items, build: () => V.builderScreen(step, title, ctxLine || 'new order', items, c, note), onItem })
    switch (step) {
      case 'asset': {
        const items: MenuItem[] = [...this.prefs.watchlist.slice(0, 8).map(a => { const w = this.watch.find(x => x.asset === a); return { id: 'asset', ref: a, label: `${a}${w?.price ? ` · ${M.fmtPrice(Number(w.price))}` : ''}` } }), { id: 'voice', label: 'Say another asset' }]
        return mk('NEW ORDER · ASSET', items, it => (it.id === 'voice' ? this.listen({ screen: 'build', draft: draftTicket(d) }) : nextWith({ asset: it.ref }, 'asset')))
      }
      case 'account': {
        const el = M.eligibleAccounts(this.accts, d)
        if (!el.length) return this.recoveryView('NO ACCOUNT', `No connected account can trade ${d.product ?? 'this'}. Connect a demo account in the companion.`, [{ id: 'back', label: 'Back' }, { id: 'home', label: 'Home' }])
        const items: MenuItem[] = el.map(a => { const av = M.numOrNull(this.portfolio?.accounts.find(x => x.accountId === a.id)?.availableUsd ?? null); return { id: 'acct', ref: a.id, label: `${a.alias} · ${M.envTag(a.environment)}${av !== null ? ` · ${usdOf(c)(av, 0)} free` : ''}` } })
        return mk(`${d.asset} · WHICH ACCOUNT?`, items, it => nextWith({ accountId: it.ref }, 'account'), 'HELM never picks between several accounts for you')
      }
      case 'product': {
        const a = this.accts.find(x => x.id === d.accountId)!
        const items: MenuItem[] = []
        if (a.products.includes('spot')) items.push({ id: 'spot', label: c.mode === 'pro' ? 'Spot' : 'Spot · buy and hold the coin' })
        if (a.products.includes('perp')) items.push({ id: 'perp', label: c.mode === 'pro' ? 'Perpetual futures' : 'Futures · leveraged long or short' })
        return mk(`${d.asset} · SPOT OR FUTURES`, items, it => nextWith({ product: it.id as 'spot' | 'perp' }, 'product'))
      }
      case 'side': {
        const items: MenuItem[] = d.product === 'perp' ? [{ id: 'BUY', label: 'Long · profit if price rises' }, { id: 'SELL', label: 'Short · profit if price falls' }] : [{ id: 'BUY', label: `Buy ${d.asset}` }, { id: 'SELL', label: `Sell ${d.asset}` }]
        return mk(`${d.asset} · DIRECTION`, items, it => nextWith({ side: it.id as 'BUY' | 'SELL' }, 'side'))
      }
      case 'size': {
        const usd = usdOf(c)
        const items: MenuItem[] = this.prefs.sizePresets.map(s => ({ id: 'usd', ref: s, label: usd(Number(s), 0) }))
        if (d.product === 'spot' && d.side === 'SELL') items.unshift({ id: 'frac', ref: '0.25', label: `25% of your ${d.asset}` }, { id: 'frac', ref: '0.5', label: `50% of your ${d.asset}` }, { id: 'frac', ref: '1', label: `All your ${d.asset}` })
        items.push({ id: 'custom', label: 'Custom amount (swipe to adjust)' })
        return mk(`${d.asset} · HOW MUCH?`, items, it => (it.id === 'custom' ? this.push(this.stepperView(d, 50)) : it.id === 'frac' ? nextWith({ fraction: it.ref }, 'size') : nextWith({ notional: it.ref }, 'size')))
      }
      case 'leverage': {
        const max = Number((this.policy as { maxLeverage?: string } | null)?.maxLeverage ?? 5)
        const items: MenuItem[] = ['1', '2', '3', '5'].filter(x => Number(x) <= max).map(x => ({ id: 'lev', ref: x, label: x === '1' ? '1x · no extra leverage' : `${x}x` }))
        return mk(`${d.asset} · LEVERAGE`, items, it => nextWith({ leverage: it.ref }, 'leverage'), c.mode === 'beginner' ? 'Leverage multiplies gains and losses' : undefined)
      }
      case 'protection': {
        const items: MenuItem[] = [{ id: 'stop', ref: '2', label: 'Stop 2% away (recommended)' }, { id: 'stop', ref: '3', label: 'Stop 3% away' }, { id: 'stop', ref: '5', label: 'Stop 5% away' }, { id: 'none', label: 'No stop' }]
        return mk(`${d.asset} · PROTECTION`, items, it => (it.id === 'none' ? nextWith({ stopOffsetPercent: null }, 'protection') : nextWith({ stopOffsetPercent: it.ref }, 'protection')), 'A stop closes the position if price moves against you')
      }
      case 'review': {
        const tk = draftTicket(d)!
        return { name: 'build-review', transient: true, build: () => { queueMicrotask(() => void this.preview(tk)); return V.loadingScreen('Preparing preview', false) } }
      }
    }
  }
  private stepperView(d: M.Draft, amount: number): View {
    const max = d.product === 'perp' ? 2000 : 1000
    const av = M.numOrNull(this.portfolio?.accounts.find(x => x.accountId === d.accountId)?.availableUsd ?? null)
    return {
      name: 'build-stepper', build: () => V.stepperScreen(d.asset ?? '', amount, M.stepSize(amount), max, av, this.ctx),
      onSwipe: dir => this.replace(this.stepperView(d, M.stepAmount(amount, dir === 'up' ? 1 : -1, 5, max))),
      onTap: () => this.push(this.builderView({ ...d, notional: String(amount), answered: [...d.answered, 'size'] })),
    }
  }

  // ---------------- PREVIEW → REVIEW → CONFIRM → RECEIPT ----------------
  async preview(tk: Ticket) { return this.runPreview(() => this.backend.preview(tk), tk) }
  async protectPreview(b: { accountId: string; instrumentId: string; stopOffsetPercent: string }) { return this.runPreview(() => this.backend.protectPreview(b), null) }
  private async runPreview(redo: Redo, tk: Ticket | null) {
    let p: PreviewResp
    try { p = await this.load('Preparing preview', redo) } catch (e) {
      if (e instanceof Canceled) return
      const code = (e as { code?: string }).code
      return this.push(this.recoveryView('PREVIEW FAILED', `${code ? `${code}: ` : ''}${(e as Error).message}. Nothing was sent.`, [{ id: 'back', label: 'Back' }, { id: 'home', label: 'Home' }]))
    }
    this.log(`preview ${p.proposalId} ${p.risk.verdict}`)
    this.redo.set(p.proposalId, redo)
    this.keys.set(p.proposalId, `g2-${p.proposalId}-${Math.random().toString(36).slice(2, 10)}`)
    // Cancel returns to the screen the user started from (the builder steps are skipped).
    let origin = this.stack.length
    while (origin > 0 && this.stack[origin - 1]!.name.startsWith('build-')) origin--
    if (this.view && !this.view.transient && !this.view.name.startsWith('build-')) origin = this.view.name === 'heard' ? this.stack.length : this.stack.length + 1
    this.originOf.set(p.proposalId, origin)
    return this.push(this.reviewView(p, tk))
  }
  private expiredView(p: PreviewResp, tk: Ticket | null): View {
    return this.recoveryView('PREVIEW EXPIRED', 'The preview expired before confirmation. Nothing was sent.', [{ id: 'fresh', label: 'Prepare a fresh preview' }, { id: 'home', label: 'Home' }], {
      onItem: it => (it.id === 'fresh' ? this.runPreview(this.redo.get(p.proposalId)!, tk) : this.goHome()),
    })
  }
  private expiring(p: PreviewResp, tk: Ticket | null) { return () => (T.secondsLeft(p, this.now()) === 0 ? this.replace(this.expiredView(p, tk)) : this.redraw()) }
  private reviewView(p: PreviewResp, tk: Ticket | null): View {
    const fast = M.fastPathEligible(p, this.now()).ok
    const items = V.reviewItems(p, fast)
    return {
      name: 'review', proposal: p, items, build: () => V.reviewScreen(p, items, this.ctx, this.now()),
      tickMs: 1000, onTick: this.expiring(p, tk),
      onBack: () => this.cancelReview(p).then(() => true),
      onItem: it => {
        if (T.secondsLeft(p, this.now()) === 0) return this.replace(this.expiredView(p, tk))
        switch (it.id) {
          case 'confirm': return this.push(this.confirmView(p, tk))
          case 'findings': return this.push(this.findingsView(p, tk))
          case 'details': return this.push(this.detailsView(p, 0))
          case 'voice': return this.listen({ screen: 'review', draft: tk, proposalId: p.proposalId, accountId: tk?.accountId ?? p.account.id, asset: M.sym(p.order.instrument).base })
          case 'cancel': return this.cancelReview(p)
        }
      },
    }
  }
  private findingsView(p: PreviewResp, tk: Ticket | null): View {
    const items: MenuItem[] = p.canConfirm ? [{ id: 'cancel', label: 'cancel' }, { id: 'confirm', label: 'continue' }] : [{ id: 'cancel', label: 'cancel' }]
    return {
      name: 'findings', proposal: p, items, build: () => V.findingsScreen(p, this.ctx, this.now()),
      tickMs: 1000, onTick: this.expiring(p, tk),
      onBack: () => this.cancelReview(p).then(() => true),
      onItem: (it, i) => (i === 1 && it.id === 'confirm' && p.canConfirm ? this.push(this.confirmView(p, tk)) : this.cancelReview(p)),
    }
  }
  private detailsView(p: PreviewResp, page: number): View {
    const pages = V.detailsScreen(p, page, this.ctx).pages
    return { name: 'details', proposal: p, build: () => V.detailsScreen(p, page, this.ctx).spec, onSwipe: dir => this.replace(this.detailsView(p, (page + (dir === 'down' ? 1 : -1) + pages) % pages)), onTap: () => this.back() }
  }
  private confirmView(p: PreviewResp, tk: Ticket | null): View {
    const items: MenuItem[] = [{ id: 'cancel', label: 'Cancel' }, { id: 'confirm', label: 'Confirm' }]
    return {
      name: 'confirm', proposal: p, confirm: true, items, build: () => V.confirmScreen(p, this.now()),
      tickMs: 1000, onTick: this.expiring(p, tk),
      onBack: () => this.cancelReview(p).then(() => true),
      onItem: (_it, i) => (i === 1 ? this.submit(p, tk) : this.cancelReview(p)),
    }
  }
  private async cancelReview(p: PreviewResp) {
    this.log('user canceled')
    const origin = this.originOf.get(p.proposalId) ?? 0
    this.stack.length = Math.min(this.stack.length, origin)
    let prev = this.stack.pop()
    while (prev && (prev.proposal || prev.name === 'heard' || prev.name.startsWith('build-'))) prev = this.stack.pop()
    if (!prev || prev.name === 'home') return this.goHome()
    return this.show(prev)
  }
  /** Every gate must hold; otherwise the tap is treated as nothing (never as Confirm). */
  confirmGate(p: PreviewResp): string | null {
    if (!this.backend.canExecute) return 'read-only mirror'
    if (this.used.has(p.proposalId)) return 'already used'
    if (T.secondsLeft(p, this.now()) === 0) return 'expired'
    if (!p.canConfirm || !p.confirmToken) return 'cannot confirm'
    const a = this.lastAck
    if (!a || !a.ok || a.key !== 'confirm' || a.bind !== p.proposalId) return 'confirmation not displayed'
    return null
  }
  private async submit(p: PreviewResp, tk: Ticket | null) {
    const why = this.confirmGate(p)
    if (why) {
      this.stats.confirmRejected++
      this.log(`confirm rejected: ${why}`)
      if (why === 'expired') return this.replace(this.expiredView(p, tk))
      if (why === 'read-only mirror') return this.push(this.infoView('mirror', 'READ-ONLY MIRROR', 'Vision', 'This mirror cannot confirm orders.\nConfirm on the glasses, with a fresh\npreview. Nothing was sent.'))
      if (why === 'confirmation not displayed') return this.replace(this.recoveryView('DISPLAY ERROR', 'The confirmation was not shown correctly, so it cannot be confirmed. Nothing was sent.', [{ id: 'fresh', label: 'Prepare a fresh preview' }, { id: 'home', label: 'Home' }], { onItem: it => (it.id === 'fresh' ? this.runPreview(this.redo.get(p.proposalId)!, tk) : this.goHome()) }))
      return this.goHome()
    }
    this.used.add(p.proposalId)
    this.log('user confirmed')
    this.busy = true
    this.clearTick()
    const submitting: View = { name: 'submitting', transient: true, build: () => T.submittingScreen(p) }
    this.view = submitting
    await this.host.render(submitting.build())
    let receipt: Receipt
    try {
      receipt = (await this.backend.confirm(p, this.keys.get(p.proposalId)!)).receipt
    } catch (e) {
      this.busy = false
      const status = (e as { status?: number }).status ?? 0
      const code = (e as { code?: string }).code ?? ''
      this.stack = [this.homeView()]
      if (status === 0 || status >= 500 || code === 'TIMEOUT' || code === 'NETWORK') {
        this.log('confirm outcome unknown → verify')
        return this.show(this.recoveryView(term('reconciling', this.ctx.mode).toUpperCase(), 'The connection dropped after you confirmed. HELM is checking the exchange. Do not retry: check Receipts first.', [{ id: 'receipts', label: 'Check receipts' }, { id: 'home', label: 'Home' }]))
      }
      return this.show(this.recoveryView('NOT SUBMITTED', `${code ? `${code}: ` : ''}${(e as Error).message}. Nothing was sent.`, [{ id: 'fresh', label: 'Prepare a fresh preview' }, { id: 'home', label: 'Home' }], { onItem: it => (it.id === 'fresh' ? this.runPreview(this.redo.get(p.proposalId)!, tk) : this.goHome()) }))
    }
    this.busy = false
    this.log(`receipt ${receipt.orderId} ${receipt.status}`)
    this.loaded = 0
    try { await this.refresh(true) } catch { /* receipt still shown */ }
    this.stack = [this.homeView()]
    if (this.backend.kind === 'practice') this.prefs = withDefaults({ ...this.prefs, onboarding: { ...this.prefs.onboarding, stage: 'practice-done' } })
    return this.show(this.receiptView(receipt, p.account.id))
  }
  private receiptView(r: Receipt, accountId: string | null): View {
    const pos = accountId && this.portfolio ? M.positionRows(this.portfolio, { accountId }).find(x => x.pos.instrumentId === r.instrumentId) : undefined
    const items: MenuItem[] = V.receiptItems(r, !!pos)
    if (this.backend.kind === 'practice') items.unshift({ id: 'finish', label: 'Finish practice' })
    return {
      name: 'receipt', items, build: () => V.receiptScreen(r, items, this.ctx),
      onItem: async it => {
        switch (String(it.id)) {
          case 'finish': return this.finishPractice()
          case 'verify': {
            let n: Receipt
            try { n = await this.load('Verifying with exchange', () => this.backend.refreshOrder(r.orderId)) } catch (e) { return e instanceof Canceled ? undefined : this.fail('VERIFY FAILED', e) }
            return this.replace(this.receiptView(n, accountId))
          }
          case 'position': return pos ? this.openFocus(pos.key) : undefined
          case 'activity': return this.openActivity()
          default: return this.goHome()
        }
      },
    }
  }
  openReceipts(filter?: (r: Receipt) => boolean) {
    return this.open('Loading receipts', async () => {
      const rs = (await this.backend.receipts()).filter(r => !filter || filter(r))
      const items: MenuItem[] = rs.slice(0, 20).map(r => ({ id: 'r', ref: r.orderId, label: r.orderId }))
      const v: View = { name: 'receipts', items, build: () => T.receiptsScreen(rs), onItem: it => { const r = rs.find(x => x.orderId === it.ref); return r ? this.push(this.receiptView(r, null)) : undefined } }
      return v
    })
  }

  // ---------------- ACTIVITY ----------------
  openActivity() { return this.open('Loading activity', async () => { this.activity = await this.backend.activity(); return this.activityView() }) }
  private activityView(): View {
    const a = this.activity!
    const rows = V.activityRows(a, this.ctx)
    return { name: 'activity', items: rows, build: () => V.activityScreen(a, rows, this.ctx), onItem: it => (it.ref ? this.openEvent(it.ref) : undefined) }
  }
  openEvent(id: string) {
    return this.open('Loading', async () => {
      if (!this.activity) this.activity = await this.backend.activity()
      const e = [...this.activity.current, ...this.activity.recent, ...this.activity.resolved].find(x => x.id === id)
      if (!e) return this.recoveryView('ACTIVITY', 'That alert is no longer current.', [{ id: 'back', label: 'Back' }])
      return this.eventView(e)
    })
  }
  private eventView(e: ActivityItem): View {
    const items: MenuItem[] = e.actions.map(a => ({ id: a.kind, label: a.label }))
    const gone = () => this.push(this.recoveryView('POSITION', 'That position is no longer open.', [{ id: 'back', label: 'Back' }]))
    return {
      name: 'event', items, build: () => V.eventScreen(e, this.ctx),
      onItem: async (_it, i) => {
        const a = e.actions[i]
        if (!a) return
        const key = a.accountId && a.instrumentId && this.portfolio ? M.positionRows(this.portfolio, { accountId: a.accountId }).find(r => r.pos.instrumentId === a.instrumentId)?.key : undefined
        switch (a.kind) {
          case 'position': return key ? this.openFocus(key) : gone()
          case 'protect': { const row = key ? this.findRow(key) : undefined; return row ? this.push(this.protectPickView(row)) : gone() }
          case 'receipt': case 'reconcile': return this.openReceipts(a.orderId ? r => r.orderId === a.orderId : undefined)
          case 'account': return a.accountId ? this.openAccount(a.accountId) : this.openAccounts()
          case 'market': return a.asset ? this.openMarket(a.asset) : this.openWatchlist()
          case 'ack': case 'dismiss': {
            try { await this.load('Saving', async () => { if (a.kind === 'ack') await this.backend.ackEvent(e.id); else await this.backend.dismissEvent(e.id); this.activity = await this.backend.activity() }) } catch (err) { return err instanceof Canceled ? undefined : this.fail('NOT SAVED', err) }
            this.stack.pop()
            return this.replace(this.activityView())
          }
        }
      },
    }
  }

  // ---------------- RISK / MORE / SETTINGS / HELP ----------------
  openShield() {
    return this.open('Checking risk', async () => {
      await this.refresh()
      const [{ compass }, pol] = await Promise.all([this.backend.compass(), this.getPolicy()])
      const p = this.portfolio
      const sc = p ? M.scopesOf(p)[0] : undefined
      const m: V.ShieldModel = {
        unprotected: compass.unprotected?.length ?? 0, nearLiq: compass.nearRisk?.length ?? 0, marginWarn: compass.marginWarnings?.length ?? 0,
        largestExchange: compass.largestExchange ? { alias: compass.largestExchange.alias, sharePct: Number(compass.largestExchange.sharePct) } : null,
        largestAsset: compass.largestDirectional ? { asset: compass.largestDirectional.asset, direction: compass.largestDirectional.direction, usd: Math.abs(Number(compass.largestDirectional.netUsd)) } : null,
        exchangeRows: sc && sc.valueUsd > 0 ? sc.accounts.slice(0, 4).map(a => ({ label: M.shortAlias(a.alias), value: (M.num(a.valueUsd) / sc.valueUsd) * 100 })) : [],
        maxExchangePct: M.numOrNull((pol as { maxExchangeExposurePct?: string }).maxExchangeExposurePct ?? null), maxMarginPct: M.numOrNull((pol as { maxMarginUtilizationPct?: string }).maxMarginUtilizationPct ?? null),
      }
      const items: MenuItem[] = ['unprotected', 'positions', 'compass', 'emergency'].map(id => ({ id, label: id }))
      const v: View = { name: 'shield', items, build: () => V.shieldScreen(m, this.ctx), onItem: it => (it.id === 'unprotected' ? this.openProtectList() : it.id === 'positions' ? this.openPositions({}) : it.id === 'compass' ? this.openCompass() : this.openEmergency()) }
      return v
    })
  }
  openCompass() { return this.open('Loading', async () => { const r = await this.backend.compass(); const v: View = { name: 'compass', build: () => V.compassScreen(r.compass, r.netLiquidationUsd, this.ctx), onTap: () => this.back() }; return v }) }
  openEmergency() {
    return this.open('Loading', async () => {
      const its = await this.backend.emergency()
      const items: MenuItem[] = (its.length ? its : [{ detail: '' }]).slice(0, 20).map((_x, i) => ({ id: 'e', ref: String(i), label: String(i) }))
      const v: View = {
        name: 'emergency', items, build: () => T.emergencyScreen(its),
        onItem: it => {
          const x = its[Number(it.ref)]
          if (!x) return
          const key = this.portfolio ? M.positionRows(this.portfolio, { accountId: x.accountId }).find(r => r.pos.instrumentId === x.instrumentId)?.key : undefined
          return key ? this.openFocus(key) : this.push(this.infoView('em-item', 'EMERGENCY', 'review', `${x.detail.slice(0, 60)}\nEach action needs its own preview\nand confirmation. Cancel open orders\nfrom the companion Orders page.`))
        },
      }
      return v
    })
  }
  moreView(): View {
    const items = V.moreItems(this.ctx)
    return {
      name: 'more', items, build: () => V.moreScreen(this.ctx),
      onItem: it => {
        switch (it.id as V.MoreId) {
          case 'shield': return this.openShield()
          case 'protect': return this.openProtectList()
          case 'emergency': return this.openEmergency()
          case 'compass': return this.openCompass()
          case 'receipts': return this.openReceipts()
          case 'accounts': return this.openAccounts()
          case 'recipes': return this.openRecipes()
          case 'settings': return this.push(this.settingsView())
          case 'help': return this.push(this.helpView())
          case 'device': return this.push(this.infoView('device', 'THIS DEVICE', this.backend.kind, `Data: ${this.backend.kind === 'live' ? 'HELM server' : 'sample data, nothing sent'}\nDefault account: ${this.accts.find(a => a.id === this.prefs.preferredExchange)?.alias ?? 'none'}\nInput: temple touchpad or R1 ring\nUnpair from the companion: Devices`))
          case 'diagnostics': return this.push(this.infoView('diag', 'DIAGNOSTICS', 'local', `Renders ${this.stats.renders} · inputs ${this.stats.inputs}\nIgnored while busy ${this.stats.ignoredBusy}\nLast draw ${this.lastAck?.mode ?? '-'} ${this.lastAck?.ms ?? 0}ms${this.lastAck?.degraded ? ' · text fallback' : ''}\nAccounts ${this.accts.length} · ${this.backend.kind}`))
        }
      },
    }
  }
  openRecipes() {
    return this.open('Loading recipes', async () => {
      const rs = await this.backend.recipes()
      const its: MenuItem[] = rs.slice(0, 20).map(r => ({ id: 'r', ref: r.id, label: r.name }))
      const shown = its.length ? its : [{ id: 'none', label: 'No recipes yet' }]
      const v: View = { name: 'recipes', items: shown, build: () => V.listScreen('recipes', 'TRADING RECIPES', `${rs.length}`, shown, this.ctx, 'Recipes prepare previews; you confirm each one'), onItem: x => { const r = rs.find(y => y.id === x.ref); return r ? this.push(this.infoView('recipe', r.name.toUpperCase().slice(0, 28), 'recipe', `${r.summary.slice(0, 110)}\nRun it from the companion: every\norder step still needs a preview\nand your confirmation.`)) : undefined } }
      return v
    })
  }
  settingsView(saved?: string): View {
    const items = V.settingsItems(this.prefs, this.accts)
    const cycle = <X,>(xs: X[], x: X) => xs[(xs.indexOf(x) + 1) % xs.length]!
    return {
      name: 'settings', items, build: () => V.settingsScreen(this.prefs, this.accts, this.ctx, saved),
      onItem: async it => {
        const p = this.prefs
        switch (it.id as V.SettingId) {
          case 'mode': await this.savePrefs({ mode: p.mode === 'pro' ? 'beginner' : 'pro' }); break
          case 'home': await this.savePrefs({ homeMode: cycle<Prefs['homeMode']>(['auto', 'spot', 'futures', 'multi'], p.homeMode) }); break
          case 'privacy': await this.savePrefs({ privacy: !p.privacy }); break
          case 'alerts': await this.savePrefs({ alertSensitivity: cycle<Prefs['alertSensitivity']>(['normal', 'critical', 'all'], p.alertSensitivity) }); break
          case 'exchange': await this.savePrefs({ preferredExchange: cycle<string | null>([null, ...this.accts.map(a => a.id)], p.preferredExchange) }); break
          case 'deck-reset': await this.savePrefs({ deckOrder: [...DEFAULT_DECK], deckFavorites: [] }); break
          case 'tutorial': return this.replaceRoot(this.onboardWelcomeView())
          default: return this.back()
        }
        return this.replace(this.settingsView('saved'))
      },
    }
  }
  private helpView(): View {
    const items = V.helpItems()
    const body: Record<string, [string, string]> = {
      gestures: ['GESTURES', 'Swipe on the temple touchpad or R1\nring: move. Tap: select.\nDouble-tap: back or cancel.\nThe lens is not a touchscreen.'],
      terms: ['WHAT THE WORDS MEAN', `Stop: closes a position at a price.\nReduce-only: can only shrink it.\nLiquidation: forced close by venue.\n"Within limits" is not "safe".`],
      safety: ['HOW ORDERS STAY SAFE', 'Every order: preview, review, then\nConfirm (Cancel is first). Previews\nexpire in 45 s and work once.\nDemo / paper / simulated only.'],
      voice: ['VOICE EXAMPLES', '"Which positions need attention?"\n"Show my Bybit account"\n"Close half of this position"\n"Make it fifty dollars instead"'],
    }
    void EXPLAIN
    return {
      name: 'help', items, build: () => V.helpScreen(this.ctx),
      onItem: it => (it.id === 'tutorial' ? this.replaceRoot(this.onboardWelcomeView()) : body[it.id] ? this.push(this.infoView(`help-${it.id}`, body[it.id]![0], 'help', body[it.id]![1])) : undefined),
    }
  }

  // ---------------- VOICE ----------------
  /** Explicit context for the current screen (never guessed). */
  voiceContext(extra: Partial<VoiceContext> = {}): VoiceContext { return { screen: this.view?.name ?? 'home', ...extra } }
  async listen(extra: Partial<VoiceContext> = {}) {
    const ctx = this.voiceContext(extra)
    const examples = VOICE_EXAMPLES[ctx.positionKey ? 'focus' : ctx.proposalId ? 'review' : ctx.screen === 'market' ? 'market' : ctx.accountId ? 'account' : 'home']!
    if (!this.host.mic) {
      const items: MenuItem[] = examples.map(e => ({ id: 'say', ref: e, label: `"${e}"` }))
      return this.push({ name: 'voice-examples', items, build: () => V.listScreen('voice-examples', 'VOICE', 'typed', items, this.ctx, 'No microphone here: pick a phrase'), onItem: it => this.runVoice({ transcript: it.ref! }, ctx) })
    }
    const ok = await this.host.mic.start()
    this.log(`mic ${ok ? 'open' : 'unavailable'}`)
    const started = this.now()
    let done = false
    const finish = async () => {
      if (done) return
      done = true
      const audio = await this.host.mic!.stop()
      return this.runVoice(audio ?? { audioBase64: 'AA==', sampleRate: 16000 }, ctx)
    }
    const v: View = {
      name: 'listening', transient: true, build: () => V.listeningScreen(Math.round((this.now() - started) / 1000), examples[0]!),
      tickMs: 1000, onTick: () => (this.now() - started >= 8000 ? finish() : this.redraw()),
      onTap: finish, onBack: async () => { done = true; await this.host.mic!.stop(); await this.back(); return true },
    }
    if (this.view && !this.view.transient) this.stack.push(this.view)
    return this.show(v)
  }
  /** Typed voice (companion text box / tests). */
  async say(transcript: string, extra: Partial<VoiceContext> = {}) { return this.runVoice({ transcript }, this.voiceContext(extra)) }
  async runVoice(input: { transcript?: string; audioBase64?: string; sampleRate?: number }, ctx: VoiceContext) {
    let r: VoiceResult
    try { r = await this.load('Understanding', () => this.backend.voice(input, ctx)) } catch (e) { if (e instanceof Canceled) return; return this.fail('VOICE', e) }
    this.log(`heard "${r.transcript}" → ${r.action.kind}`)
    return this.push(this.heardView(r, ctx))
  }
  private heardView(r: VoiceResult, ctx: VoiceContext): View {
    const a = r.action
    let items: MenuItem[] = []
    let outcome = ''
    switch (a.kind) {
      case 'navigate': items = [{ id: 'go', label: `Open: ${r.interpretation}` }, { id: 'cancel', label: 'Cancel' }]; outcome = 'Read-only: nothing will be sent'; break
      case 'propose': items = [{ id: 'go', label: `Preview: ${a.summary}` }, { id: 'cancel', label: 'Cancel' }]; outcome = 'Next: preview and review. Nothing sent'; break
      case 'protect': items = [{ id: 'go', label: `Preview stop: ${a.summary}` }, { id: 'cancel', label: 'Cancel' }]; outcome = 'Next: preview and review. Nothing sent'; break
      case 'clarify': items = [...a.options.map(o => ({ id: 'opt', ref: o.id, label: o.label })), { id: 'cancel', label: 'Cancel' }]; outcome = a.question; break
      case 'reject': items = [{ id: 'again', label: 'Try again' }, { id: 'cancel', label: 'Back' }]; outcome = a.message; break
    }
    return {
      name: 'heard', items, build: () => V.heardScreen(r.transcript || '(nothing heard)', r.sttLabel ?? r.sttProvider, r.interpretation, outcome, items),
      onItem: it => {
        if (it.id === 'cancel') return this.back()
        if (it.id === 'again') return this.listen(ctx)
        if (it.id === 'opt' && a.kind === 'clarify') {
          const patch: Partial<VoiceContext> = a.field === 'account' ? { accountId: it.ref } : a.field === 'asset' ? { asset: it.ref } : a.field === 'position' ? { positionKey: it.ref } : {}
          return this.runVoice({ transcript: r.transcript }, { ...ctx, ...patch })
        }
        if (a.kind === 'navigate') return this.navigateTo(a)
        if (a.kind === 'propose') return this.preview(a.ticket)
        if (a.kind === 'protect') return this.protectPreview({ accountId: a.accountId, instrumentId: a.instrumentId, stopOffsetPercent: a.stopOffsetPercent })
      },
    }
  }
  navigateTo(a: Extract<VoiceResult['action'], { kind: 'navigate' }>) {
    switch (a.target) {
      case 'home': return this.goHome()
      case 'portfolio': return this.openPortfolio()
      case 'positions': return this.openPositions({ accountId: a.accountId, asset: a.asset })
      case 'holdings': return this.openHoldings(undefined, a.accountId, a.asset)
      case 'account': return a.accountId ? this.openAccount(a.accountId) : this.openAccounts()
      case 'position': return a.positionKey ? this.openFocus(a.positionKey) : this.openPositions({})
      case 'liquidation': {
        const row = a.positionKey ? this.findRow(a.positionKey) : undefined
        return row ? this.openPositionRisk(row, M.focusModel(row)) : this.openPositions({})
      }
      case 'market': return a.asset ? this.openMarket(a.asset) : this.openWatchlist()
      case 'venues': return a.asset ? this.openVenues(a.asset, null, a.providers) : this.openWatchlist()
      case 'activity': return this.openActivity()
      case 'receipt': return this.open('Loading receipt', async () => { const rs = await this.backend.receipts(); return rs[0] ? this.receiptView(rs[0], null) : this.infoView('no-receipt', 'RECEIPTS', '', 'No receipts yet.') })
      case 'unprotected': return this.openProtectList()
      case 'risk': return this.openShield()
      case 'emergency': return this.openEmergency()
    }
  }
}
