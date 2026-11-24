import { AudioInputSource, OsEventTypeList, waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { api, ApiError, trade, type Acct, type DeviceMe, type PreviewResp, type Receipt, type Ticket, type VoiceResp } from './api'
import * as T from './screens/trade'
import { Renderer } from './render'
import { accountChosenScreen, accountSelectorScreen, connectionErrorScreen, pairingExpiredScreen, pairingScreen, splashScreen } from './screens'

const TOKEN_KEY = 'helm.deviceToken'
const bridge = await waitForEvenAppBridge()
const ui = new Renderer(bridge)
// If the host refuses a screen, say so instead of leaving the wearer on a stale screen that no longer matches app state.
ui.onRenderFail = key => { if (key !== 'err') { stack.length = 0; void go({ name: 'fail', title: 'DISPLAY ERROR', msg: `The glasses could not draw ${key}. Tap for home; check Receipts before acting again.` }) } }

type Review = { name: 'impact' | 'risk' | 'confirm'; p: PreviewResp; via: 'glasses' | 'voice'; key: string }
type State =
  | { name: 'splash' }
  | { name: 'pairing'; pairingId: string; pollSecret: string; code: string; expiresAt: number }
  | { name: 'pairing-expired' }
  | { name: 'error'; reason: string }
  | { name: 'accounts'; me: DeviceMe }
  | { name: 'chosen'; me: DeviceMe; index: number }
  | { name: 'home' }
  | { name: 'overview'; p: any }
  | { name: 'holdings'; p: any }
  | { name: 'watchlist'; items: Array<{ asset: string; price: string | null }> }
  | { name: 'market'; asset: string; venues: Array<{ venue: string; bid: string | null; ask: string | null; spreadBps: string | null; error?: string }> }
  | { name: 'acct-pick'; asset: string; accts: Acct[]; question: string; voice?: VoiceResp }
  | { name: 'ticket'; acct: Acct; asset: string }
  | Review
  | { name: 'submitting'; p: PreviewResp }
  | { name: 'receipt'; r: Receipt }
  | { name: 'receipts'; rs: Receipt[] }
  | { name: 'pulse'; ev: Array<{ kind: string; severity: number; reason: string; count: number }> }
  | { name: 'compass'; c: any; net: string }
  | { name: 'unprotected'; items: T.UnprotectedItem[] }
  | { name: 'protect-pick'; item: T.UnprotectedItem }
  | { name: 'emergency'; items: Array<{ kind: string; accountId: string; instrumentId: string; detail: string }> }
  | { name: 'listening'; started: number; chunks: Uint8Array[] }
  | { name: 'heard'; v: VoiceResp }
  | { name: 'fail'; title: string; msg: string }

let state: State = { name: 'splash' }
const stack: State[] = []
let token = ''
let me: DeviceMe | null = null
let accts: Acct[] = []
let timers: number[] = []
/** A preview is in flight: further taps are ignored so one tap = one proposal (venues can take seconds to answer). */
let previewing = false
const clearTimers = () => { timers.forEach(t => clearInterval(t)); timers = [] }
const newKey = () => `g2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Navigate: push the current screen for double-tap back (transient screens are not pushed). */
async function nav(next: State) {
  const transient = ['splash', 'pairing', 'pairing-expired', 'error', 'submitting', 'listening', 'fail']
  if (!transient.includes(state.name) && state.name !== next.name) stack.push(state)
  return go(next)
}
async function back() {
  if (state.name === 'listening') await bridge.audioControl(false).catch(() => false)
  const prev = stack.pop()
  if (!prev || state.name === 'home') { clearTimers(); return void bridge.shutDownPageContainer(1) }
  // Never return into a used/expired confirmation.
  if (prev.name === 'impact' || prev.name === 'risk' || prev.name === 'confirm' || prev.name === 'submitting') { stack.length = 0; return go({ name: 'home' }) }
  return go(prev)
}
const fail = (title: string, e: unknown) => nav({ name: 'fail', title, msg: e instanceof ApiError ? `${e.code}: ${e.message}` : 'Something went wrong' })

async function go(next: State) {
  clearTimers()
  state = next
  switch (next.name) {
    case 'splash': return ui.show(splashScreen('Tap to begin'))
    case 'pairing-expired': return ui.show(pairingExpiredScreen())
    case 'error': return ui.show(connectionErrorScreen(next.reason))
    case 'accounts': return ui.show(accountSelectorScreen(next.me.user.name, next.me.accounts))
    case 'chosen': return ui.show(accountChosenScreen(next.me.accounts[next.index]!))
    case 'pairing': {
      const render = () => {
        const left = Math.max(0, Math.round((next.expiresAt - Date.now()) / 1000))
        if (left === 0) { void go({ name: 'pairing-expired' }); return }
        void ui.show(pairingScreen(next.code, left))
      }
      render()
      timers.push(window.setInterval(render, 1000))
      timers.push(window.setInterval(() => void pollClaim(next), 3000))
      return
    }
    case 'home': return ui.show(T.homeScreen(me?.user.name ?? '', accts.some(a => a.environment === 'simulated')))
    case 'overview': return ui.show(T.overviewScreen(next.p))
    case 'holdings': return ui.show(T.holdingsScreen(next.p))
    case 'watchlist': return ui.show(T.watchlistScreen(next.items))
    case 'market': return ui.show(T.marketScreen(next.asset, next.venues))
    case 'acct-pick': return ui.show(T.accountPickScreen(next.accts, next.question))
    case 'ticket': return ui.show(T.ticketScreen(next.acct, next.asset))
    case 'impact': case 'risk': case 'confirm': {
      const draw = () => {
        if (T.secondsLeft(next.p) === 0) { void go({ name: 'fail', title: 'PREVIEW EXPIRED', msg: 'The 45 s preview expired. Nothing was sent. Start a fresh preview.' }); return }
        void ui.show(next.name === 'impact' ? T.impactScreen(next.p) : next.name === 'risk' ? T.riskScreen(next.p) : T.confirmScreen(next.p))
      }
      draw(); timers.push(window.setInterval(draw, 1000)); return
    }
    case 'submitting': return ui.show(T.submittingScreen(next.p))
    case 'receipt': return ui.show(T.receiptScreen(next.r))
    case 'receipts': return ui.show(T.receiptsScreen(next.rs))
    case 'pulse': return ui.show(T.pulseScreen(next.ev))
    case 'compass': return ui.show(T.compassScreen(next.c, next.net))
    case 'emergency': return ui.show(T.emergencyScreen(next.items))
    case 'unprotected': return ui.show(T.unprotectedScreen(next.items))
    case 'protect-pick': return ui.show(T.protectPickScreen(next.item))
    case 'heard': return ui.show(T.heardScreen(next.v))
    case 'fail': return ui.show(T.errorScreen(next.title, next.msg))
    case 'listening': {
      const draw = () => {
        const secs = Math.round((Date.now() - next.started) / 1000)
        if (secs >= 8) { void finishListening(); return }
        void ui.show(T.listeningScreen(secs, next.chunks.length))
      }
      draw(); timers.push(window.setInterval(draw, 1000)); return
    }
  }
}

async function loadHome() {
  try { accts = (await trade.accounts(token)).data.accounts } catch { accts = [] }
  stack.length = 0
  await go({ name: 'home' })
}

async function openHome(idx: number) {
  const item = T.HOME_ITEMS[idx]
  try {
    switch (item) {
      case 'Overview': return nav({ name: 'overview', p: (await trade.portfolio(token)).data.portfolio })
      case 'Positions & holdings': return nav({ name: 'holdings', p: (await trade.portfolio(token)).data.portfolio })
      case 'Watchlist': return nav({ name: 'watchlist', items: (await trade.watchlist(token)).data.items })
      case 'Voice command': return startListening()
      case 'Trade': return nav({ name: 'acct-pick', asset: 'BTC', accts: accts.filter(a => a.canTrade), question: 'Which exchange? (BTC)' })
      case 'Pulse': return nav({ name: 'pulse', ev: (await trade.pulse(token)).data.events })
      case 'Exposure Compass': { const r = (await trade.compass(token)).data; return nav({ name: 'compass', c: r.compass, net: r.netLiquidationUsd }) }
      case 'Receipts': return nav({ name: 'receipts', rs: (await trade.receipts(token)).data.receipts })
      case 'Emergency review': return nav({ name: 'emergency', items: (await trade.emergency(token)).data.items })
      case 'Protect positions': return openUnprotected()
      case 'Accounts': { me = (await api.me(token)).data; return nav({ name: 'accounts', me }) }
    }
  } catch (e) { return fail('UNAVAILABLE', e) }
}

/** Unprotected perp positions, optionally narrowed by voice (asset / account). A spoken stop distance with exactly one match
 *  goes straight to the preview — which still needs the Impact → Risk → Confirm taps. */
async function openUnprotected(f: { asset?: string | null; accountId?: string | null; stopOffsetPercent?: string | null } = {}) {
  const r = (await trade.compass(token)).data
  const items: T.UnprotectedItem[] = (r.compass.unprotected as Array<{ accountId: string; instrumentId: string; side: string; notionalUsd: string | null }>)
    .filter(u => (!f.asset || T.sym(u.instrumentId).base === f.asset) && (!f.accountId || u.accountId === f.accountId))
    .map(u => ({ ...u, alias: accts.find(a => a.id === u.accountId)?.alias ?? 'account' }))
  if (items.length === 1 && f.stopOffsetPercent) return runProtectPreview(items[0]!, f.stopOffsetPercent)
  return nav({ name: 'unprotected', items })
}

async function runProtectPreview(item: T.UnprotectedItem, stopOffsetPercent: string) {
  if (previewing) { console.log('[HELM] preview in flight, tap ignored'); return }
  previewing = true
  try {
    const p = (await trade.protectPreview(token, { accountId: item.accountId, instrumentId: item.instrumentId, stopOffsetPercent })).data
    console.log(`[HELM] protect preview ${p.proposalId} ${p.risk.verdict} stop ${p.order.stopPrice}`)
    await nav({ name: 'impact', p, via: 'glasses', key: newKey() })
  } catch (e) { await fail('PREVIEW FAILED', e) } finally { previewing = false }
}

async function runPreview(tk: Ticket, via: 'glasses' | 'voice') {
  if (previewing) { console.log('[HELM] preview in flight, tap ignored'); return }
  previewing = true
  try {
    const p = (await trade.preview(token, tk)).data
    console.log(`[HELM] preview ${p.proposalId} ${p.risk.verdict}`)
    await nav({ name: 'impact', p, via, key: newKey() })
  } catch (e) { await fail('PREVIEW FAILED', e) } finally { previewing = false }
}

async function submit(s: Review) {
  await go({ name: 'submitting', p: s.p })
  try {
    const r = (await trade.confirm(token, s.p, s.key, s.via)).data
    console.log(`[HELM] receipt ${r.receipt.orderId} ${r.receipt.status}`)
    stack.length = 0; stack.push({ name: 'home' })
    await go({ name: 'receipt', r: r.receipt })
  } catch (e) { stack.length = 0; stack.push({ name: 'home' }); await go({ name: 'fail', title: 'NOT SUBMITTED', msg: e instanceof ApiError ? `${e.code}: ${e.message}` : 'Unknown — check Receipts before retrying' }) }
}

// ---------- voice (G2 microphone → server STT → typed intent) ----------
async function startListening() {
  const ok = await bridge.audioControl(true, AudioInputSource.Glasses).catch(() => false)
  console.log(`[HELM] mic ${ok ? 'open' : 'unavailable'}`)
  await nav({ name: 'listening', started: Date.now(), chunks: [] })
}
async function finishListening() {
  if (state.name !== 'listening') return
  const chunks = state.chunks
  clearTimers()
  await bridge.audioControl(false).catch(() => false)
  const len = chunks.reduce((a, c) => a + c.length, 0)
  const pcm = new Uint8Array(len); let o = 0; for (const c of chunks) { pcm.set(c, o); o += c.length }
  let b64 = ''; for (let i = 0; i < pcm.length; i += 0x8000) b64 += String.fromCharCode(...pcm.subarray(i, i + 0x8000))
  try {
    const v = (await trade.voice(token, { audioBase64: btoa(b64) || 'AA==', sampleRate: 16000 })).data
    console.log(`[HELM] heard "${v.transcript}" via ${v.sttProvider} → ${v.next.screen}`)
    await go({ name: 'heard', v })
  } catch (e) { await go({ name: 'fail', title: 'VOICE', msg: e instanceof ApiError ? e.message : 'Voice unavailable' }) }
}
function ticketFromVoice(v: VoiceResp, accountId: string): Ticket | null {
  const i = v.intent
  if (!i.asset || !i.side) return null
  return { accountId, asset: i.asset, product: i.product === 'perp' ? 'perp' : 'spot', side: i.side, notional: i.notional ?? undefined, quantity: i.quantity ?? undefined, fraction: i.fraction ?? undefined, leverage: i.leverage ?? undefined, stopOffsetPercent: i.stopOffsetPercent ?? undefined, reduceOnly: i.intent === 'CLOSE_POSITION' || i.intent === 'REDUCE_POSITION' || undefined }
}
async function continueVoice(v: VoiceResp) {
  const sc = v.next.screen
  if (sc === 'protect') return openUnprotected(v.intent.intent === 'PREPARE_PROTECTION' ? { asset: v.intent.asset, accountId: v.resolution.account?.id, stopOffsetPercent: v.intent.stopOffsetPercent } : {})
  if (sc === 'clarify_account') return nav({ name: 'acct-pick', asset: v.intent.asset ?? 'BTC', accts: accts.filter(a => v.resolution.options?.some(o => o.id === a.id)), question: v.resolution.question ?? 'Which exchange?', voice: v })
  if (sc === 'ticket' && v.resolution.account) { const tk = ticketFromVoice(v, v.resolution.account.id); return tk ? runPreview(tk, 'voice') : fail('VOICE', new ApiError(400, 'INCOMPLETE', 'Say asset, side and size')) }
  const map: Record<string, number> = { positions: 1, overview: 0, compass: 6, orders: 7, emergency: 8, market: 2 }
  if (sc in map) return openHome(map[sc]!)
  if (sc === 'not_understood') return startListening()
  return go({ name: 'home' })
}

bridge.onEvenHubEvent((event: EvenHubEvent) => {
  if (event.audioEvent && state.name === 'listening') {
    const pcm = event.audioEvent.audioPcm as unknown
    state.chunks.push(pcm instanceof Uint8Array ? pcm : Array.isArray(pcm) ? Uint8Array.from(pcm as number[]) : typeof pcm === 'string' ? Uint8Array.from(atob(pcm), c => c.charCodeAt(0)) : new Uint8Array())
    return
  }
  const sys = eventTypeOf(event.sysEvent)
  const listType = event.listEvent ? (event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  const textType = event.textEvent ? (event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  const type = listType ?? textType ?? sys
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (['splash', 'pairing', 'pairing-expired', 'error'].includes(state.name)) { clearTimers(); void bridge.shutDownPageContainer(1); return }
    void back(); return
  }
  if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) { clearTimers(); return }
  if (type !== OsEventTypeList.CLICK_EVENT) return
  const idx = event.listEvent?.currentSelectItemIndex ?? 0
  const s = state
  switch (s.name) {
    case 'splash': case 'pairing-expired': case 'error': return void begin()
    case 'accounts': {
      if (!event.listEvent) { if (s.me.accounts.length === 0) void loadAccounts(); return }
      const acct = s.me.accounts[idx]; if (!acct) return
      void api.setActive(token, acct.id).then(() => nav({ name: 'chosen', me: s.me, index: idx })).catch(() => go({ name: 'error', reason: 'Could not set the active account.' }))
      return
    }
    case 'home': if (event.listEvent) void openHome(idx); return
    case 'overview': void trade.portfolio(token).then(r => go({ name: 'overview', p: r.data.portfolio })).catch(e => fail('UNAVAILABLE', e)); return
    case 'compass': void trade.compass(token).then(r => go({ name: 'compass', c: r.data.compass, net: r.data.netLiquidationUsd })).catch(e => fail('UNAVAILABLE', e)); return
    case 'watchlist': { const a = s.items[idx]?.asset; if (event.listEvent && a) void trade.market(token, a).then(r => nav({ name: 'market', asset: a, venues: r.data.venues })).catch(e => fail('UNAVAILABLE', e)); return }
    case 'market': return void nav({ name: 'acct-pick', asset: s.asset, accts: accts.filter(a => a.canTrade), question: `Which exchange? (${s.asset})` })
    case 'acct-pick': {
      const a = s.accts[idx]; if (!event.listEvent || !a) return
      if (s.voice?.intent.intent === 'PREPARE_PROTECTION') { const i = s.voice.intent; void openUnprotected({ asset: i.asset, accountId: a.id, stopOffsetPercent: i.stopOffsetPercent }).catch(e => fail('UNAVAILABLE', e)); return }
      if (s.voice) { const tk = ticketFromVoice(s.voice, a.id); if (tk) void runPreview(tk, 'voice'); return }
      return void nav({ name: 'ticket', acct: a, asset: s.asset })
    }
    case 'ticket': {
      const pr = T.presetsFor(s.acct, s.asset)[idx]; if (!event.listEvent || !pr) return
      return void runPreview({ accountId: s.acct.id, asset: s.asset, product: pr.product, side: pr.side, notional: pr.notional, fraction: pr.fraction, leverage: pr.leverage, stopOffsetPercent: pr.stopOffsetPercent, reduceOnly: pr.reduceOnly }, 'glasses')
    }
    case 'impact': return void nav({ ...s, name: 'risk' })
    case 'risk': if (s.p.canConfirm) void nav({ ...s, name: 'confirm' }); return
    case 'confirm':
      if (!event.listEvent) return
      if (idx === 1 && event.listEvent.currentSelectItemName?.startsWith('Confirm') !== false) { console.log('[HELM] user confirmed'); void submit(s) }
      else { console.log('[HELM] user canceled'); stack.length = 0; void go({ name: 'home' }) }
      return
    case 'receipt': case 'fail': return void loadHome()
    case 'receipts': { const r = s.rs[idx]; if (event.listEvent && r) void nav({ name: 'receipt', r }); return }
    case 'unprotected': { const it = s.items[idx]; if (event.listEvent && it) void nav({ name: 'protect-pick', item: it }); return }
    case 'protect-pick': { const d = T.STOP_DISTANCES[idx]; if (event.listEvent && d) void runProtectPreview(s.item, d); return }
    case 'listening': return void finishListening()
    case 'heard': return void continueVoice(s.v)
    default: return
  }
})

async function pollClaim(p: Extract<State, { name: 'pairing' }>) {
  if (state !== p) return
  try {
    const r = await api.claim(p.pairingId, p.pollSecret)
    if (r.data.status === 'PAIRED' && r.data.deviceToken) {
      token = r.data.deviceToken
      await saveToken(token)
      console.log('[HELM] paired')
      await afterAuth()
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) await go({ name: 'pairing-expired' })
    else if (e instanceof ApiError && e.status === 0) await go({ name: 'error', reason: 'Check the HELM server and network.' })
  }
}

async function startPairing() {
  try {
    const r = await api.startPairing()
    await go({ name: 'pairing', pairingId: r.data.pairingId, pollSecret: r.data.pollSecret, code: r.data.code, expiresAt: Date.parse(r.data.expiresAt) })
  } catch (e) {
    await go({ name: 'error', reason: e instanceof ApiError && e.status === 429 ? 'Too many attempts — wait a minute.' : 'Check the HELM server and network.' })
  }
}

async function afterAuth() {
  try {
    me = (await api.me(token)).data
    await loadHome()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { token = ''; await saveToken(''); return startPairing() }
    await go({ name: 'error', reason: 'Check the HELM server and network.' })
  }
}

async function loadAccounts() {
  try {
    me = (await api.me(token)).data
    await nav({ name: 'accounts', me })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      token = ''
      await saveToken('')
      return startPairing()
    }
    await go({ name: 'error', reason: 'Check the HELM server and network.' })
  }
}

function safeLocal<T>(f: () => T): T | null { try { return f() } catch { return null } }
/** Bridge storage is the reliable store on device; WebView localStorage is a best-effort mirror (simulator). */
async function saveToken(t: string) {
  await bridge.setLocalStorage(TOKEN_KEY, t)
  safeLocal(() => (t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY)))
}

async function begin() {
  token = (await bridge.getLocalStorage(TOKEN_KEY)) || safeLocal(() => window.localStorage.getItem(TOKEN_KEY)) || ''
  if (token) return afterAuth()
  return startPairing()
}

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

await go({ name: 'splash' })
console.log('[HELM] APP_READY')
