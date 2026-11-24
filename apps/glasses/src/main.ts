import { OsEventTypeList, waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { api, ApiError, type DeviceMe } from './api'
import { Renderer } from './render'
import { accountChosenScreen, accountSelectorScreen, connectionErrorScreen, pairingExpiredScreen, pairingScreen, splashScreen } from './screens'

const TOKEN_KEY = 'helm.deviceToken'
const bridge = await waitForEvenAppBridge()
const ui = new Renderer(bridge)

type State =
  | { name: 'splash' }
  | { name: 'pairing'; pairingId: string; pollSecret: string; code: string; expiresAt: number }
  | { name: 'pairing-expired' }
  | { name: 'error'; reason: string }
  | { name: 'accounts'; me: DeviceMe }
  | { name: 'chosen'; me: DeviceMe; index: number }

let state: State = { name: 'splash' }
let token = ''
let timers: number[] = []
const clearTimers = () => { timers.forEach(t => clearInterval(t)); timers = [] }

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
  }
}

async function pollClaim(p: Extract<State, { name: 'pairing' }>) {
  if (state !== p) return
  try {
    const r = await api.claim(p.pairingId, p.pollSecret)
    if (r.data.status === 'PAIRED' && r.data.deviceToken) {
      token = r.data.deviceToken
      await bridge.setLocalStorage(TOKEN_KEY, token)
      console.log('[HELM] paired')
      await loadAccounts()
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

async function loadAccounts() {
  try {
    const me = await api.me(token)
    await go({ name: 'accounts', me: me.data })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      token = ''
      await bridge.setLocalStorage(TOKEN_KEY, '')
      return startPairing()
    }
    await go({ name: 'error', reason: 'Check the HELM server and network.' })
  }
}

async function begin() {
  token = (await bridge.getLocalStorage(TOKEN_KEY)) || ''
  if (token) return loadAccounts()
  return startPairing()
}

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

bridge.onEvenHubEvent((event: EvenHubEvent) => {
  const sys = eventTypeOf(event.sysEvent)
  if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    // Back. At the root screens, exit the app.
    if (state.name === 'chosen') void go({ name: 'accounts', me: state.me })
    else { clearTimers(); void bridge.shutDownPageContainer(1) }
    return
  }
  if (event.listEvent && state.name === 'accounts') {
    const idx = event.listEvent.currentSelectItemIndex ?? 0
    const me = state.me
    const acct = me.accounts[idx]
    if (!acct) return
    void api.setActive(token, acct.id).then(() => go({ name: 'chosen', me, index: idx })).catch(() => go({ name: 'error', reason: 'Could not set the active account.' }))
    return
  }
  if (sys === OsEventTypeList.CLICK_EVENT) {
    if (state.name === 'splash') void begin()
    else if (state.name === 'pairing-expired' || state.name === 'error') void begin()
    else if (state.name === 'accounts' && state.me.accounts.length === 0) void loadAccounts()
    return
  }
  if (sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) clearTimers()
})

await go({ name: 'splash' })
console.log('[HELM] APP_READY')
