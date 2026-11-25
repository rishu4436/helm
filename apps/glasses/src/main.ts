/**
 * HELM G2 app entry. Pairing uses the original screens; everything after pairing runs on the shared UX 2.0
 * Controller (nav/controller.ts) with the LiveBackend. Practice mode (onboarding) uses the local SampleBackend.
 */
import { AudioInputSource, waitForEvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { api, ApiError } from './api'
import { Renderer } from './render'
import { connectionErrorScreen, pairingExpiredScreen, pairingScreen, splashScreen } from './screens'
import { Controller } from './nav/controller'
import { LiveBackend } from './nav/live'
import { SampleBackend } from './nav/sample'
import { toInput } from './nav/events'

const TOKEN_KEY = 'helm.deviceToken'
const bridge = await waitForEvenAppBridge()
const ui = new Renderer(bridge)
let token = ''
let ctl: Controller | null = null
let timers: number[] = []
let pre: 'splash' | 'pairing' | 'pairing-expired' | 'error' | null = 'splash'
let pairing: { pairingId: string; pollSecret: string; code: string; expiresAt: number } | null = null
const clearTimers = () => { timers.forEach(t => clearInterval(t)); timers = [] }

// ---------- microphone (G2 mic → PCM16 16 kHz → base64; the server transcribes) ----------
let chunks: Uint8Array[] | null = null
const mic = {
  async start() { chunks = []; return bridge.audioControl(true, AudioInputSource.Glasses).catch(() => false) },
  async stop() {
    const cs = chunks; chunks = null
    await bridge.audioControl(false).catch(() => false)
    if (!cs) return null
    const len = cs.reduce((a, c) => a + c.length, 0)
    const pcm = new Uint8Array(len); let o = 0; for (const c of cs) { pcm.set(c, o); o += c.length }
    let b64 = ''; for (let i = 0; i < pcm.length; i += 0x8000) b64 += String.fromCharCode(...pcm.subarray(i, i + 0x8000))
    return { audioBase64: btoa(b64) || 'AA==', sampleRate: 16000 }
  },
}

function startController() {
  pre = null; clearTimers()
  ctl = new Controller(new LiveBackend(() => token), {
    render: spec => ui.show(spec),
    exit: () => void bridge.shutDownPageContainer(1),
    mic,
  })
  ctl.practiceFactory = () => new SampleBackend('practice')
  ui.onRenderFail = (key, reason) => ctl?.displayFailed(key, reason)
  return ctl.start()
}

// ---------- pairing (unchanged flow) ----------
async function showPre(s: typeof pre, reason = '') {
  clearTimers(); pre = s
  if (s === 'splash') return ui.show(splashScreen('Tap to begin'))
  if (s === 'pairing-expired') return ui.show(pairingExpiredScreen())
  if (s === 'error') return ui.show(connectionErrorScreen(reason))
  if (s === 'pairing' && pairing) {
    const p = pairing
    const draw = () => { const left = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)); if (left === 0) { void showPre('pairing-expired'); return } void ui.show(pairingScreen(p.code, left)) }
    draw()
    timers.push(window.setInterval(draw, 1000), window.setInterval(() => void pollClaim(p), 3000))
  }
}
async function pollClaim(p: NonNullable<typeof pairing>) {
  if (pairing !== p || pre !== 'pairing') return
  try {
    const r = await api.claim(p.pairingId, p.pollSecret)
    if (r.data.status === 'PAIRED' && r.data.deviceToken) { token = r.data.deviceToken; await saveToken(token); console.log('[HELM] paired'); await afterAuth() }
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) await showPre('pairing-expired')
    else if (e instanceof ApiError && e.status === 0) await showPre('error', 'Check the HELM server and network.')
  }
}
async function startPairing() {
  try {
    const r = await api.startPairing()
    pairing = { pairingId: r.data.pairingId, pollSecret: r.data.pollSecret, code: r.data.code, expiresAt: Date.parse(r.data.expiresAt) }
    await showPre('pairing')
  } catch (e) { await showPre('error', e instanceof ApiError && e.status === 429 ? 'Too many attempts — wait a minute.' : 'Check the HELM server and network.') }
}
async function afterAuth() {
  try { await api.me(token) } catch (e) {
    if (e instanceof ApiError && e.status === 401) { token = ''; await saveToken(''); return startPairing() }
    return showPre('error', 'Check the HELM server and network.')
  }
  return startController()
}
function safeLocal<T>(f: () => T): T | null { try { return f() } catch { return null } }
async function saveToken(t: string) {
  await bridge.setLocalStorage(TOKEN_KEY, t)
  safeLocal(() => (t ? window.localStorage.setItem(TOKEN_KEY, t) : window.localStorage.removeItem(TOKEN_KEY)))
}
async function begin() {
  token = (await bridge.getLocalStorage(TOKEN_KEY)) || safeLocal(() => window.localStorage.getItem(TOKEN_KEY)) || ''
  return token ? afterAuth() : startPairing()
}

bridge.onEvenHubEvent((event: EvenHubEvent) => {
  if (event.audioEvent) {
    if (chunks) { const pcm = event.audioEvent.audioPcm as unknown; chunks.push(pcm instanceof Uint8Array ? pcm : Array.isArray(pcm) ? Uint8Array.from(pcm as number[]) : typeof pcm === 'string' ? Uint8Array.from(atob(pcm), c => c.charCodeAt(0)) : new Uint8Array()) }
    return
  }
  const inp = toInput(event as never)
  if (!inp) return
  if (inp === 'exit') { clearTimers(); return }
  if (inp === 'foreground' || inp === 'background') return
  if (pre) {
    if (inp.kind === 'double') { clearTimers(); void bridge.shutDownPageContainer(1); return }
    if (inp.kind === 'tap' && pre !== 'pairing') void begin()
    return
  }
  void ctl?.input(inp)
})

await showPre('splash')
console.log('[HELM] APP_READY')
