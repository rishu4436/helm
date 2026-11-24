import { H, W, clipBytes, type ScreenSpec } from '../layout'
import type { Acct, PreviewResp, Receipt, VoiceResp } from '../api'

/** HELM G2 trading screens — pure functions of API payloads (unit-tested for fit and SDK limits). */
const n = (s: string | null | undefined, dp = 2) => (s === null || s === undefined || s === '' ? '—' : Number(s).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }))
const usd = (s: string | null | undefined, dp = 2) => (s === null || s === undefined ? '—' : `${Number(s) < 0 ? '-' : ''}$${n(String(Math.abs(Number(s))), dp)}`)
const qty = (s: string | null | undefined) => (s ? String(Number(s)) : '—')
export const sym = (id: string) => { const p = id.split(':'); const [b, q] = (p[2] ?? '').split('-'); return { base: b ?? '', quote: q ?? '', product: p[1] ?? '' } }
const prodLabel = (p: string) => (p === 'perp' ? 'PERP' : p.toUpperCase())
const dot = (state: string) => (state === 'CONNECTED' ? '●' : state === 'LIMITED' || state === 'READ_ONLY' ? '◐' : '○')
export const envTag = (label: string) => label.slice(0, 10)

function head(title: string, ctx: string) {
  return [
    { id: 1, name: 'header', x: 0, y: 0, w: 380, h: 40, text: title, pad: 6 },
    { id: 2, name: 'context', x: 380, y: 0, w: 196, h: 40, text: ctx, pad: 6 },
  ]
}
const foot = (hint: string) => ({ id: 4, name: 'footer', x: 0, y: H - 40, w: W, h: 40, text: hint, pad: 6 })

function textScreen(key: string, title: string, ctx: string, body: string, hint: string, border = false): ScreenSpec {
  return { key, texts: [...head(title, ctx), { id: 3, name: 'body', x: 6, y: 42, w: W - 12, h: H - 84, text: body, pad: 8, border: border ? 2 : 0, borderColor: 10, radius: 6, capture: true }, foot(hint)] }
}
function listScreen(key: string, title: string, ctx: string, items: string[], hint: string, note?: string): ScreenSpec {
  const top = note ? 74 : 42
  const texts = [...head(title, ctx), foot(hint)]
  if (note) texts.push({ id: 5, name: 'note', x: 6, y: 40, w: W - 12, h: 34, text: note, pad: 4 })
  return { key, texts, lists: [{ id: 3, name: 'list', x: 6, y: top, w: W - 12, h: H - 40 - top, items: items.slice(0, 20).map(i => clipBytes(i)), capture: true }] }
}

// ---------- home / overview / holdings ----------
export const HOME_ITEMS = ['Overview', 'Positions & holdings', 'Watchlist', 'Voice command', 'Trade', 'Pulse', 'Exposure Compass', 'Receipts', 'Emergency review', 'Protect positions', 'Accounts'] as const
export const homeScreen = (user: string, sim: boolean) => listScreen('home', 'HELM', sim ? 'incl. SIM' : user.slice(0, 14), [...HOME_ITEMS], 'swipe · tap: open · double-tap: exit')

export function overviewScreen(p: any): ScreenSpec {
  type A = { alias: string; valueUsd: string; environment?: string; state?: string }
  const all = p.accounts as A[]
  const real = all.filter(a => a.environment === 'demo' || a.environment === 'paper')
  const other = all.filter(a => !(a.environment === 'demo' || a.environment === 'paper'))
  const sumv = (xs: A[]) => xs.reduce((t, a) => t + Number(a.valueUsd), 0)
  const rows = real.slice(0, 3).map(a => `${a.alias.slice(0, 22).padEnd(22)} ${usd(a.valueUsd, 0)}`)
  if (real.length > 3) rows.push(`+${real.length - 3} more`)
  const top = (p.exposures as Array<{ asset: string; netDirectionalUsd: string }>).slice(0, 3).map(e => `${e.asset} ${usd(e.netDirectionalUsd, 0)}`).join(' · ')
  const body = `Demo exchanges ${usd(String(sumv(real)), 0)}
${rows.join('\n')}
SIM/SANDBOX ${usd(String(sumv(other)), 0)} (not exchange funds)
${top}`
  return textScreen('overview', 'ALL EXCHANGES', `${all.length} accts`, body, 'tap: refresh · double-tap: back')
}

export function holdingsScreen(p: any): ScreenSpec {
  const pos = (p.positions as Array<{ instrumentId: string; side: string; quantity: string; unrealizedPnl: string | null; accountId: string }>).map(x => { const s = sym(x.instrumentId); const long = x.side === 'LONG' || (x.side === 'NET' && Number(x.quantity) > 0); return `${long ? 'LONG' : 'SHORT'} ${s.base} ${qty(String(Math.abs(Number(x.quantity))))} · ${x.instrumentId.split(':')[0]} · ${usd(x.unrealizedPnl)}` })
  const hold = (p.exposures as Array<{ asset: string; spotUsd: string }>).filter(e => Number(e.spotUsd) > 1).slice(0, 12).map(e => `${e.asset.padEnd(6)} spot ${usd(e.spotUsd, 0)}`)
  const items = [...pos, ...hold]
  return listScreen('holdings', 'POSITIONS · HOLDINGS', `${pos.length} pos`, items.length ? items : ['No positions or holdings'], 'swipe · double-tap: back')
}

// ---------- markets ----------
export const watchlistScreen = (items: Array<{ asset: string; price: string | null }>) =>
  listScreen('watchlist', 'WATCHLIST', 'live public', items.map(i => `${i.asset.padEnd(5)} ${i.price ? n(i.price, Number(i.price) > 100 ? 1 : 3) : 'unavailable'}`), 'tap: venues · double-tap: back')

export function marketScreen(asset: string, venues: Array<{ venue: string; bid: string | null; ask: string | null; spreadBps: string | null; error?: string }>): ScreenSpec {
  const best = venues.filter(v => v.ask).sort((a, b) => Number(a.ask) - Number(b.ask))[0]
  const rows = venues.map(v => v.error ? `${v.venue.padEnd(8)} unavailable (${v.error})` : `${v.venue.padEnd(8)} ${n(v.bid, 1)} / ${n(v.ask, 1)} · ${n(v.spreadBps, 2)}bp`)
  return textScreen(`market-${asset}`, `${asset} · VENUES`, 'bid / ask', `${rows.join('\n')}\n${best ? `Best ask: ${best.venue}` : ''}\nPublic books · not advice`, 'tap: trade · double-tap: back')
}

// ---------- trade ticket ----------
export const accountPickScreen = (accts: Acct[], question = 'Which exchange?') =>
  listScreen('acct-pick', 'TRADE', 'pick venue', accts.map(a => `${dot(a.state)} ${a.alias} · ${envTag(a.environmentLabel)}`), 'tap: choose · double-tap: back', question)

export interface Preset { label: string; product: 'spot' | 'perp'; side: 'BUY' | 'SELL'; notional?: string; fraction?: string; leverage?: string; stopOffsetPercent?: string; reduceOnly?: boolean }
export function presetsFor(a: Acct, asset: string): Preset[] {
  const out: Preset[] = []
  if (a.products.includes('spot')) out.push({ label: `BUY $15 ${asset} spot`, product: 'spot', side: 'BUY', notional: '15' }, { label: `BUY $15 ${asset} spot + 3% stop`, product: 'spot', side: 'BUY', notional: '15', stopOffsetPercent: '3' }, { label: `SELL $15 ${asset} spot`, product: 'spot', side: 'SELL', notional: '15' })
  if (a.products.includes('perp')) out.push({ label: `LONG $150 ${asset} perp 2x + 3% stop`, product: 'perp', side: 'BUY', notional: '150', leverage: '2', stopOffsetPercent: '3' }, { label: `SHORT $150 ${asset} perp 2x + 3% stop`, product: 'perp', side: 'SELL', notional: '150', leverage: '2', stopOffsetPercent: '3' }, { label: `CLOSE ${asset} perp (reduce-only)`, product: 'perp', side: 'SELL', fraction: '1', reduceOnly: true })
  return out
}
export const ticketScreen = (a: Acct, asset: string) => listScreen('ticket', `TICKET · ${asset}`, envTag(a.environmentLabel), presetsFor(a, asset).map(p => p.label), 'tap: preview · double-tap: back', a.alias)

// ---------- impact → risk → confirm ----------
function orderLine(p: PreviewResp) {
  const s = sym(p.order.instrument)
  const size = p.order.quantity ? `${qty(p.order.quantity)} ${s.base}` : `${usd(p.order.quoteQuantity)} of ${s.base}`
  return `${p.order.side} ${size} · ${prodLabel(s.product)}${p.order.leverage ? ` ${p.order.leverage}x` : ''}${p.order.reduceOnly ? ' · reduce-only' : ''}`
}
export const secondsLeft = (p: PreviewResp, now = Date.now()) => Math.max(0, Math.round((Date.parse(p.expiresAt) - now) / 1000))

export function impactScreen(p: PreviewResp, now = Date.now()): ScreenSpec {
  if (p.kind === 'protect_existing') return protectImpactScreen(p, now)
  const v = p.preview, i = v.impact
  const body = [
    orderLine(p),
    `≈ ${usd(v.estimatedNotional)} @ ${n(v.estimatedPrice, 2)} · fee ≈ ${usd(v.estimatedFee)}`,
    `Spread ${n(i.spreadBps, 1)}bp · slip ${n(v.estimatedSlippageBps, 1)}bp`,
    `${i.asset} exposure ${usd(i.currentExposureUsd, 0)} → ${usd(i.proposedExposureUsd, 0)}`,
    `Buying power left ${usd(v.remainingBuyingPower, 0)}${v.requiredMargin ? ` · margin ${usd(v.requiredMargin)}` : ''}`,
    v.protection ? `Stop ${v.protection.stopOffsetPercent}% → ≈${n(v.protection.estimatedStopPrice, 1)}${v.protection.supported ? '' : ' (unsupported)'}` : v.willCancel?.length ? `Then cancels ${v.willCancel.length} stop(s) left with nothing to protect` : p.order.reduceOnly ? 'Reduce-only: cannot add exposure' : 'No protective stop',
  ].join('\n')
  return textScreen('impact', 'TRADE IMPACT', `${envTag(p.account.environmentLabel)} · ${secondsLeft(p, now)}s`, body, 'tap: risk check · double-tap: cancel', true)
}

export function riskScreen(p: PreviewResp, now = Date.now()): ScreenSpec {
  const f = p.risk.findings.filter(x => x.verdict !== 'ALLOW').slice(0, 4).map(x => `${x.verdict === 'BLOCK' ? '■' : '▲'} ${x.message}`)
  const body = `HELM Shield: ${p.risk.verdict}${p.risk.policyVersion ? ` (policy v${p.risk.policyVersion})` : ' (default policy)'}\n${f.length ? f.join('\n') : 'All limits within policy'}\n${p.label ? p.label.slice(0, 60) : `${p.account.alias} · real demo exchange`}`
  return textScreen('risk', 'RISK CHECK', `${p.risk.verdict} · ${secondsLeft(p, now)}s`, body, p.canConfirm ? 'tap: continue · double-tap: cancel' : 'Blocked — double-tap: back', true)
}

/** Explicit confirmation. Cancel is item 0 (the default selection); Confirm requires a deliberate move + tap. */
export function confirmScreen(p: PreviewResp, now = Date.now()): ScreenSpec {
  const s = sym(p.order.instrument)
  if (p.kind === 'protect_existing') return {
    key: 'confirm',
    texts: [...head('CONFIRM STOP', `${envTag(p.account.environmentLabel)} · ${secondsLeft(p, now)}s`),
      { id: 5, name: 'summary', x: 6, y: 42, w: W - 12, h: 120, text: `Reduce-only stop ${n(p.order.stopPrice ?? null, 1)}\nfor ${qty(p.order.quantity)} ${s.base} ${prodLabel(s.product)} · ${p.account.alias}\nShown PROTECTED only once the venue lists it`, pad: 6, border: 2, borderColor: 10, radius: 6 },
      foot('swipe to Confirm · tap: select · double-tap: cancel')],
    lists: [{ id: 3, name: 'choice', x: 6, y: 166, w: W - 12, h: 80, items: ['Cancel', clipBytes(`Confirm stop on ${p.account.alias}`)], capture: true }],
  }
  return {
    key: 'confirm',
    texts: [...head('CONFIRM ORDER', `${envTag(p.account.environmentLabel)} · ${secondsLeft(p, now)}s`),
      { id: 5, name: 'summary', x: 6, y: 42, w: W - 12, h: 120, text: `${orderLine(p)}\n${p.account.alias} · ≈ ${usd(p.preview.estimatedNotional)}\n${p.preview.protection ? `Then stop ${p.preview.protection.stopOffsetPercent}% (only shown active when the venue lists it)` : `${s.base} ${prodLabel(s.product)} · no stop`}`, pad: 6, border: 2, borderColor: 10, radius: 6 },
      foot('swipe to Confirm · tap: select · double-tap: cancel')],
    lists: [{ id: 3, name: 'choice', x: 6, y: 166, w: W - 12, h: 80, items: ['Cancel', clipBytes(`Confirm ${p.order.side} on ${p.account.alias}`)], capture: true }],
  }
}

export const submittingScreen = (p: PreviewResp) => textScreen('submitting', 'SUBMITTING', envTag(p.account.environmentLabel), `${orderLine(p)}\n${p.account.alias}\n\nSent once. If the exchange does not answer,\nHELM reconciles — it never blindly retries.`, 'please wait', true)

export function receiptScreen(r: Receipt): ScreenSpec {
  const s = sym(r.instrumentId)
  const fee = r.fills.reduce((a, f) => a + Number(f.fee ?? 0), 0)
  const feeAsset = r.fills.find(f => f.feeAsset)?.feeAsset ?? ''
  const orph = r.orphanCleanup?.length ? `Position flat · ${r.orphanCleanup.filter(o => o.result === 'CANCELED').length}/${r.orphanCleanup.length} orphan stop(s) canceled` : null
  const prot = orph ?? (r.protection ? `Protection: ${r.protection.state}${r.protection.stopPrice ? ` · stop ${n(r.protection.stopPrice, 1)}` : ''}` : 'No protection requested')
  const reason = r.status === 'REJECTED' ? (r.events.slice().reverse().find(e => e.to === 'REJECTED')?.reason ?? '').slice(0, 56) : ''
  const body = [
    Number(r.filledQuantity) === 0 && r.quantity
      ? `${r.status} · ${r.side} ${qty(r.quantity)} ${s.base}${/STOP/.test(r.type) ? ' (resting stop, not filled)' : ' (not filled)'}`
      : `${r.status} · ${r.side} ${qty(r.filledQuantity)} ${s.base}${r.avgFillPrice ? ` @ ${n(r.avgFillPrice, 2)}` : ''}`,
    `${r.account} · ${prodLabel(s.product)} · ${r.type}`,
    reason || `Order ${r.providerOrderId ? (r.providerOrderId.length > 14 ? `…${r.providerOrderId.slice(-12)}` : r.providerOrderId) : '—'}${r.fills.length ? ` · fee ${fee ? String(Number(fee.toPrecision(3))) : '0'} ${feeAsset}` : ''}`,
    prot,
    r.label?.startsWith('SIMULATED') ? 'SIMULATED by HELM · fill computed locally' : r.label ? r.label.slice(0, 60) : r.fillTruth.startsWith('Reported by the exchange') ? `Verified: read back from ${r.provider.charAt(0).toUpperCase()}${r.provider.slice(1)} demo` : r.fillTruth.slice(0, 60),
  ].join('\n')
  return textScreen('receipt', 'RECEIPT', envTag(r.environmentLabel), body, 'tap: home · double-tap: back', true)
}

export const errorScreen = (title: string, msg: string) => textScreen('err', title, 'HELM', `${msg.slice(0, 160)}\n\nNothing was submitted unless a receipt says so.`, 'tap: home · double-tap: back', true)

// ---------- Trade-to-Protect recovery ----------
export interface UnprotectedItem { accountId: string; instrumentId: string; side: string; notionalUsd: string | null; alias: string }
export const unprotectedScreen = (items: UnprotectedItem[]) =>
  listScreen('unprotected', 'PROTECT POSITIONS', `${items.length} open`, items.length ? items.map(i => `${sym(i.instrumentId).base} ${i.side === 'SHORT' || (i.notionalUsd && Number(i.notionalUsd) < 0) ? 'SHORT' : 'LONG'} ${prodLabel(sym(i.instrumentId).product)} · ${i.alias}${i.notionalUsd ? ` · ${usd(String(Math.abs(Number(i.notionalUsd))), 0)}` : ''}`) : ['Every position has a venue-listed stop'], items.length ? 'tap: add a stop · double-tap: back' : 'double-tap: back', items.length ? 'No venue-listed stop on these positions' : undefined)
export const STOP_DISTANCES = ['2', '3', '5'] as const
export const protectPickScreen = (i: UnprotectedItem) =>
  listScreen('protect-pick', `PROTECT ${sym(i.instrumentId).base}`, 'stop distance', STOP_DISTANCES.map(d => `Reduce-only stop ${d}% from mark`), 'tap: preview · double-tap: back', i.alias)
function protectImpactScreen(p: PreviewResp, now: number): ScreenSpec {
  const s = sym(p.order.instrument), r = p.preview.recovery
  const body = [
    `${r?.positionSide ?? ''} ${qty(p.order.quantity)} ${s.base} ${prodLabel(s.product)} has no stop`,
    `Add: reduce-only STOP ${n(p.order.stopPrice ?? null, 1)}`,
    `Mark ${n(r?.referencePrice ?? null, 1)} · entry ${n(r?.entryPrice ?? null, 1)}`,
    p.preview.estimateNotes.find(x => x.startsWith('If triggered'))?.replace(' before fees and slippage', '') ?? '',
    'Places no new exposure · confirm once',
  ].join('\n')
  return textScreen('impact', 'PROTECT POSITION', `${envTag(p.account.environmentLabel)} · ${secondsLeft(p, now)}s`, body, 'tap: risk check · double-tap: cancel', true)
}

// ---------- pulse / compass / emergency / receipts ----------
export const pulseScreen = (ev: Array<{ kind: string; severity: number; reason: string; count: number }>) =>
  listScreen('pulse', 'PULSE', `${ev.length} events`, ev.length ? ev.slice(0, 20).map(e => `${e.severity >= 4 ? '!!' : e.severity >= 3 ? '! ' : '  '}${e.reason}${e.count > 1 ? ` ×${e.count}` : ''}`) : ['All quiet'], 'swipe · double-tap: back')

export function compassScreen(c: any, net: string): ScreenSpec {
  const ld = c.largestDirectional ? `${c.largestDirectional.asset} ${c.largestDirectional.direction} ${usd(c.largestDirectional.netUsd, 0)}` : 'flat'
  const le = c.largestExchange ? `${c.largestExchange.alias} ${n(c.largestExchange.sharePct, 0)}%` : '—'
  const rose = (c.rose as Array<{ asset: string; sharePct: string; direction: string }>).slice(0, 4).map(r => `${r.asset} ${n(r.sharePct, 0)}%${r.direction === 'SHORT' ? '↓' : r.direction === 'LONG' ? '↑' : ''}`).join(' ')
  const body = `Largest: ${ld}\nTop venue: ${le}\nUnprotected: ${c.unprotected.length} · near-liq: ${c.nearRisk.length}\nMargin warnings: ${c.marginWarnings.length}\n${rose}`
  return textScreen('compass', 'EXPOSURE COMPASS', usd(net, 0), body, 'tap: refresh · double-tap: back')
}

export const emergencyScreen = (items: Array<{ kind: string; detail: string; instrumentId: string }>) =>
  listScreen('emergency', 'EMERGENCY REVIEW', `${items.length} items`, items.length ? items.map(i => `${i.kind === 'CLOSE_POSITION' ? 'CLOSE' : 'CANCEL'} ${sym(i.instrumentId).base} ${i.instrumentId.split(':')[0]} · ${i.detail.replace(/ \(reduce-only close, needs its own preview \+ confirm\)/, ' reduce-only').replace(/STOP_MARKET/, 'STOP').replace(/ @ /, ' at ')}`) : ['Nothing open'], 'each item: own preview + confirm · double-tap: back', 'Itemized. HELM never broadcasts "close all".')

export const receiptsScreen = (rs: Receipt[]) => listScreen('receipts', 'RECEIPTS', `${rs.length}`, rs.length ? rs.slice(0, 20).map(r => `${r.status.slice(0, 8)} ${r.side} ${qty(r.filledQuantity || r.quantity)} ${sym(r.instrumentId).base} · ${r.account}`) : ['No orders yet'], 'tap: open · double-tap: back')

// ---------- voice ----------
export const listeningScreen = (secs: number, frames: number) => textScreen('listening', 'LISTENING', `${secs}s`, `Say a command, e.g.\n“Buy 100 dollars of BTC on Bybit”\n“Show all my positions”\n\nmic frames: ${frames}`, 'tap: done · double-tap: cancel', true)
export function heardScreen(v: VoiceResp): ScreenSpec {
  const stt = v.sttLabel ? `${v.sttProvider} (${v.sttLabel})` : v.sttProvider
  return textScreen('heard', 'HEARD', v.next.screen, `“${v.transcript.slice(0, 80)}”\nvia ${stt}\nIntent: ${v.intent.intent}${v.intent.asset ? ` ${v.intent.asset}` : ''}${v.intent.side ? ` ${v.intent.side}` : ''}${v.intent.notional ? ` $${v.intent.notional}` : ''}\n${v.next.message ?? (v.resolution.account ? `Account: ${v.resolution.account.alias}` : '')}`, v.next.screen === 'not_understood' ? 'tap: try again · double-tap: back' : 'tap: continue · double-tap: back', true)
}
