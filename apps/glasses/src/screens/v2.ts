/**
 * HELM G2 — UX 2.0 screen builders. Pure functions (payload + view context → ScreenSpec), unit-tested for SDK limits
 * and text fit, and shared verbatim by the G2 app, the companion Vision mirror and the landing demo.
 *
 * Interaction model (verified against the Even Hub input docs + simulator):
 *  - list screens: swipe moves the firmware highlight, tap selects (listEvent index), double-tap = back.
 *  - card / stepper / tutorial screens: one text container captures input; swipe up/down arrive as textEvent
 *    SCROLL_TOP/SCROLL_BOTTOM, tap and double-tap as sysEvent.
 * Nothing on the lens is "touchable": every action is a list row chosen with the temple touchpad or R1 ring.
 */
import { H, W, clipBytes, type ImageBox, type ScreenSpec, type TextBox } from '../layout'
import { altText, type Graphic } from '../gfx/graphics'
import type { Acct, ActivityItem, ActivityPayload, PortfolioPayload, Prefs, Snapshot, WatchItem } from '../ux/types'
import { pct, pnlOf, signedPct, usdOf, type ViewCtx } from '../ux/format'
import { term } from '../ux/terms'
import {
  SCOPE_LABEL, SCOPE_NOTE, ageLabel, allocationGraphic, envTag, fmtPrice, fmtQty, num, prodLabel, shortAlias, sym, venueName,
  type FocusModel, type Glance, type HoldingAgg, type Page, type PositionAction, type PositionRow, type Scope, type ScopeId, type VenueModel,
} from '../ux/model'
import type { PreviewResp, Receipt } from '../api'
import * as T from './trade'

export interface MenuItem<T extends string = string> { id: T; label: string; ref?: string }

// ---------- frame helpers ----------
const HEAD_H = 36, FOOT_Y = H - 36
export function head(title: string, ctx: string): TextBox[] {
  return [
    { id: 1, name: 'header', x: 0, y: 0, w: 384, h: HEAD_H, text: title, pad: 4 },
    { id: 2, name: 'context', x: 384, y: 0, w: 192, h: HEAD_H, text: ctx, pad: 4 },
  ]
}
export const foot = (hint: string): TextBox => ({ id: 4, name: 'footer', x: 0, y: FOOT_Y, w: W, h: 36, text: hint, pad: 4 })
export const hints = (c: ViewCtx, primary = 'open') => (c.mode === 'pro' ? `tap: ${primary} · 2x: back` : `swipe: move · tap: ${primary} · double-tap: back`)

/** Generic list screen: optional note (1–3 lines) above a capturing list. Items keep stable ids for the controller. */
export function menuScreen(key: string, title: string, context: string, items: MenuItem[], hint: string, note?: string, noteLines = 1, bind?: string): ScreenSpec {
  const noteH = note ? 8 + 27 * noteLines : 0
  const top = HEAD_H + noteH
  const texts: TextBox[] = [...head(title, context), foot(hint)]
  if (note) texts.push({ id: 5, name: 'note', x: 0, y: HEAD_H, w: W, h: noteH, text: note, pad: 4 })
  const rows = items.length ? items : [{ id: 'none', label: 'Nothing here yet' }]
  return { key, bind, texts, lists: [{ id: 3, name: 'list', x: 0, y: top, w: W, h: FOOT_Y - top, items: rows.slice(0, 20).map(i => clipBytes(i.label)), capture: true }] }
}

/** Text + graphic + action list: the standard "understand → act" layout. */
function detailScreen(o: { key: string; title: string; context: string; body: string; bodyW?: number; bodyLines: number; gfx?: Graphic; gfxH?: number; side?: string; sideLines?: number; items: MenuItem[]; hint: string; bind?: string }): ScreenSpec {
  const bodyH = 8 + 27 * o.bodyLines
  const bodyW = o.gfx || o.side ? (o.bodyW ?? 300) : W
  const texts: TextBox[] = [...head(o.title, o.context), foot(o.hint), { id: 5, name: 'body', x: 0, y: HEAD_H, w: bodyW, h: bodyH, text: o.body, pad: 4 }]
  const images: ImageBox[] = []
  const rx = bodyW + 2, rw = Math.min(288, W - rx - 2)
  let ry = HEAD_H + 4
  if (o.gfx) {
    const gh = o.gfxH ?? 96
    texts.push({ id: 6, name: 'gfxalt', x: rx, y: ry, w: rw, h: gh, text: ' ', pad: 2 })
    images.push({ id: 10, name: 'gfx', x: rx, y: ry, w: rw, h: gh, draw: { gfx: o.gfx }, alt: altText(o.gfx).slice(0, 160), altId: 6 })
    ry += gh + 2
  }
  if (o.side) texts.push({ id: 7, name: 'side', x: rx, y: ry, w: W - rx, h: 8 + 27 * (o.sideLines ?? 1), text: o.side, pad: 4 })
  const top = Math.max(HEAD_H + bodyH, o.side ? ry + 8 + 27 * (o.sideLines ?? 1) : o.gfx ? ry : 0) + 2
  return { key: o.key, bind: o.bind, texts, images, lists: [{ id: 3, name: 'list', x: 0, y: top, w: W, h: FOOT_Y - top, items: (o.items.length ? o.items : [{ id: 'back', label: 'Back' }]).slice(0, 20).map(i => clipBytes(i.label)), capture: true }] }
}

/** Card screen: one capturing text container (swipe events), optional graphic on the right. */
function cardScreen(o: { key: string; title: string; context: string; body: string; gfx?: Graphic; hint: string; bind?: string }): ScreenSpec {
  const texts: TextBox[] = [...head(o.title, o.context), foot(o.hint)]
  const images: ImageBox[] = []
  if (o.gfx) {
    texts.push({ id: 5, name: 'card', x: 0, y: HEAD_H, w: 300, h: FOOT_Y - HEAD_H, text: o.body, pad: 6, capture: true })
    texts.push({ id: 6, name: 'gfxalt', x: 302, y: HEAD_H + 8, w: 272, h: 120, text: ' ', pad: 2 })
    images.push({ id: 10, name: 'gfx', x: 302, y: HEAD_H + 8, w: 272, h: 120, draw: { gfx: o.gfx }, alt: altText(o.gfx).slice(0, 160), altId: 6 })
  } else texts.push({ id: 5, name: 'card', x: 0, y: HEAD_H, w: W, h: FOOT_Y - HEAD_H, text: o.body, pad: 6, capture: true })
  return { key: o.key, bind: o.bind, texts, images }
}

// ---------- HOME (Glance) ----------
export type HomeId = 'alert' | 'positions' | 'portfolio' | 'holdings' | 'markets' | 'trade' | 'activity' | 'deck' | 'voice' | 'more' | 'practice' | 'connect-help' | 'accounts'
export function homeItems(g: Glance, c: ViewCtx, extra: { watchTop?: WatchItem | null; activityNow?: number } = {}): MenuItem<HomeId>[] {
  const usd = usdOf(c)
  const out: MenuItem<HomeId>[] = []
  const alert = g.topAlert
  switch (g.mode) {
    case 'empty': out.push({ id: 'practice', label: 'Try HELM with practice data' }, { id: 'connect-help', label: 'How to connect an exchange' }); break
    case 'disconnected': out.push({ id: 'accounts', label: 'Reconnect: accounts need attention' }); break
    case 'risk': if (alert) out.push({ id: 'alert', label: `! ${alert.title}`, ref: alert.id }); break
    case 'futures': out.push({ id: 'positions', label: `Positions · ${g.positions} open${g.unprotected ? ` · ${g.unprotected} ${term('unprotected', c.mode)}` : ''}` }); break
    case 'multi': out.push({ id: 'portfolio', label: `Accounts · ${(g.primary?.accounts ?? []).slice(0, 2).map(a => `${shortAlias(a.alias)} ${g.primary!.valueUsd > 0 ? Math.round((num(a.valueUsd) / g.primary!.valueUsd) * 100) : 0}%`).join(' · ')}` }); break
    case 'spot': out.push({ id: 'holdings', label: 'Holdings · what you hold, where' }); break
  }
  if (alert && g.mode !== 'risk') out.push({ id: 'alert', label: `Alert: ${alert.title}`, ref: alert.id })
  if (g.mode !== 'empty') out.push({ id: 'portfolio', label: g.primary ? `Portfolio · ${usd(g.primary.valueUsd)}` : 'Portfolio' })
  out.push({ id: 'markets', label: extra.watchTop?.price ? `Markets · ${extra.watchTop.asset} ${fmtPrice(Number(extra.watchTop.price))}` : 'Markets' })
  out.push({ id: 'trade', label: 'Trade' })
  out.push({ id: 'activity', label: `${term('pulse', c.mode)}${extra.activityNow ? ` · ${extra.activityNow} now` : ''}` })
  out.push({ id: 'deck', label: 'Quick Deck' }, { id: 'voice', label: 'Voice command' }, { id: 'more', label: 'More: risk, accounts, settings, help' })
  // De-duplicate destinations (e.g. the contextual first row may already be Portfolio).
  const seen = new Set<string>()
  return out.filter(i => (seen.has(i.id) && i.id !== 'alert' ? false : (seen.add(i.id), true)))
}

export function homeScreen(g: Glance, p: PortfolioPayload | null, items: MenuItem[], c: ViewCtx, metrics: Prefs['metrics'] = ['value', 'pnl', 'positions', 'health']): ScreenSpec {
  const usd = usdOf(c), pnl = pnlOf(c)
  const title = g.primary ? `HELM · ${g.primary.label}` : 'HELM'
  const fresh = g.mode === 'disconnected' ? 'STALE' : ageLabel(g.ageSec)
  let glanceText: string
  if (g.mode === 'empty') glanceText = 'No exchange connected yet.\nTry practice data, or connect\na demo account in the companion.'
  else if (!g.primary) glanceText = 'Getting your accounts…'
  else {
    const l1 = [metrics.includes('value') ? usd(g.primary.valueUsd) : null, metrics.includes('pnl') ? `${term('upnl', c.mode)} ${pnl(g.primary.pnlUsd)}` : null].filter(Boolean).join(' · ')
    const l2 = [metrics.includes('positions') ? `${g.positions} position${g.positions === 1 ? '' : 's'}` : null, metrics.includes('health') ? `${g.healthOk}/${g.healthTotal} accounts OK` : null].filter(Boolean).join(' · ')
    const other = g.scopes.filter(s => s.id !== g.primary!.id)
    const l3 = g.mode === 'disconnected' ? `Last known values · ${g.healthBad.length} offline` : other.length ? `+ ${other.map(s => `${s.id === 'simulated' ? 'SIM' : 'SANDBOX'} ${usd(s.valueUsd)}`).join(' · ')} (separate)` : g.healthBad.length ? `Offline: ${g.healthBad.slice(0, 2).join(', ')}` : SCOPE_NOTE[g.primary.id]
    glanceText = [l1 || ' ', l2 || ' ', l3].join('\n')
  }
  const texts: TextBox[] = [...head(title, fresh), foot(c.mode === 'pro' ? 'tap: open · 2x: exit' : 'swipe: move · tap: open · double-tap: exit'),
    { id: 5, name: 'glance', x: 0, y: HEAD_H, w: 304, h: 8 + 27 * 3, text: glanceText, pad: 4 }]
  const images: ImageBox[] = []
  if (p && g.primary && g.primary.valueUsd > 0 && !c.privacy) {
    const gfx = allocationGraphic(p, g.primary.id)
    texts.push({ id: 6, name: 'gfxalt', x: 306, y: HEAD_H + 4, w: 268, h: 76, text: ' ', pad: 2 })
    images.push({ id: 10, name: 'ribbon', x: 306, y: HEAD_H + 4, w: 268, h: 76, draw: { gfx }, alt: altText(gfx).slice(0, 160), altId: 6 })
  }
  const top = HEAD_H + 8 + 27 * 3 + 2
  return { key: `home-${g.mode}`, texts, images, lists: [{ id: 3, name: 'list', x: 0, y: top, w: W, h: FOOT_Y - top, items: items.slice(0, 20).map(i => clipBytes(i.label)), capture: true }] }
}

// ---------- QUICK DECK ----------
export type CardId = 'portfolio' | 'positions' | 'allocation' | 'watchlist' | 'largest' | 'risk' | 'activity' | 'voice'
export const CARD_TITLE: Record<CardId, string> = { portfolio: 'PORTFOLIO', positions: 'OPEN POSITIONS', allocation: 'ACCOUNT ALLOCATION', watchlist: 'WATCHLIST', largest: 'LARGEST POSITION', risk: 'RISK SUMMARY', activity: 'RECENT ACTIVITY', voice: 'QUICK VOICE' }
export const CARD_ACTION: Record<CardId, string> = { portfolio: 'portfolio', positions: 'positions', allocation: 'accounts', watchlist: 'markets', largest: 'position', risk: 'risk', activity: 'activity', voice: 'speak' }
export interface DeckData { p: PortfolioPayload | null; g: Glance; rows: PositionRow[]; watch: WatchItem[]; activity: ActivityPayload | null; largest: FocusModel | null }
export function deckCardScreen(id: CardId, i: number, n: number, d: DeckData, c: ViewCtx, favorite: boolean): ScreenSpec {
  const usd = usdOf(c), pnl = pnlOf(c)
  let body = '', gfx: Graphic | undefined
  switch (id) {
    case 'portfolio': body = d.g.primary ? `${usd(d.g.primary.valueUsd)}\n${term('upnl', c.mode)} ${pnl(d.g.primary.pnlUsd)}\n${d.g.primary.label}\n${d.g.healthOk}/${d.g.healthTotal} accounts OK` : 'No account yet.'; if (d.p && d.g.primary && !c.privacy) gfx = allocationGraphic(d.p, d.g.primary.id); break
    case 'positions': body = d.rows.length ? d.rows.slice(0, 4).map(r => `${r.base} ${r.long ? 'LONG' : 'SHORT'} ${pnl(r.pnl)}${r.stop ? '' : ' · no stop'}`).join('\n') + (d.rows.length > 4 ? `\n+${d.rows.length - 4} more` : '') : 'No open positions.'; break
    case 'allocation': body = d.g.primary ? d.g.primary.accounts.slice(0, 4).map(a => `${shortAlias(a.alias)} ${usd(a.valueUsd, 0)}`).join('\n') : 'No accounts.'; if (d.p && d.g.primary && !c.privacy) gfx = { kind: 'bars', title: `${d.g.primary.label}, % of value`, unit: '%', rows: d.g.primary.accounts.slice(0, 4).map(a => ({ label: shortAlias(a.alias), value: d.g.primary!.valueUsd > 0 ? (num(a.valueUsd) / d.g.primary!.valueUsd) * 100 : 0 })), max: 100 }; break
    case 'watchlist': body = d.watch.slice(0, 5).map(w => `${w.asset.padEnd(5)} ${w.price ? fmtPrice(Number(w.price)) : 'unavailable'} ${w.change24hPct ? signedPct(Number(w.change24hPct)) : ''}`).join('\n') || 'Watchlist empty.'; break
    case 'largest': body = d.largest ? `${d.largest.row.base} ${d.largest.row.long ? 'LONG' : 'SHORT'} · ${shortAlias(d.largest.row.alias)}\n${usd(d.largest.notional, 0)} · ${pnl(d.largest.row.pnl)}\n${d.largest.liqDistancePct !== null ? `${term('liq', c.mode)} ${pct(d.largest.liqDistancePct)} away` : 'liquidation n/a'}\n${d.largest.row.stop ? `stop ${fmtPrice(d.largest.stopPrice)}` : 'no stop listed'}` : 'No open positions.'; if (d.largest) gfx = d.largest.range; break
    case 'risk': body = `${d.g.unprotected} position${d.g.unprotected === 1 ? '' : 's'} with no stop\n${(d.activity?.current.length ?? 0)} current warning${d.activity?.current.length === 1 ? '' : 's'}\n${d.g.healthBad.length ? `Offline: ${d.g.healthBad.slice(0, 2).join(', ')}` : 'All accounts reachable'}`; break
    case 'activity': body = [...(d.activity?.current ?? []), ...(d.activity?.recent ?? [])].slice(0, 4).map(a => `${a.state === 'current' ? '! ' : ''}${a.title}`).join('\n') || 'All quiet.'; break
    case 'voice': body = 'Tap and speak, e.g.\n"Which positions need attention?"\n"Show my Bybit account"\n"Prepare a 50 dollar BTC buy"'; break
  }
  return cardScreen({ key: `deck-${id}`, title: `${favorite ? '* ' : ''}${CARD_TITLE[id]}`, context: `card ${i + 1}/${n}`, body, gfx, hint: c.mode === 'pro' ? `swipe: card · tap: ${CARD_ACTION[id]}` : `swipe: next card · tap: ${CARD_ACTION[id]} · double-tap: home` })
}

// ---------- PORTFOLIO ----------
export type PortfolioId = 'scope' | 'account' | 'positions' | 'holdings' | 'risk' | 'all'
export function portfolioItems(p: PortfolioPayload, scope: Scope, scopes: Scope[], c: ViewCtx, posCount: number, holdCount: number): MenuItem<PortfolioId>[] {
  const usd = usdOf(c)
  const out: MenuItem<PortfolioId>[] = []
  for (const a of scope.accounts) out.push({ id: 'account', ref: a.accountId, label: `${a.alias} · ${scope.valueUsd > 0 ? Math.round((num(a.valueUsd) / scope.valueUsd) * 100) : 0}% · ${usd(a.valueUsd, 0)}${a.error ? ' · read error' : ''}` })
  out.push({ id: 'positions', label: `Positions · ${posCount} open` }, { id: 'holdings', label: `Holdings · ${holdCount} asset${holdCount === 1 ? '' : 's'}` }, { id: 'risk', label: term('compass', c.mode) })
  if (scopes.length > 1) for (const s of scopes.filter(s => s.id !== scope.id)) out.push({ id: 'scope', ref: s.id, label: `Switch to ${s.label} · ${usd(s.valueUsd, 0)}` })
  void p
  return out
}
export function portfolioScreen(p: PortfolioPayload, scope: Scope, items: MenuItem[], c: ViewCtx): ScreenSpec {
  const usd = usdOf(c), pnl = pnlOf(c)
  const avail = scope.accounts.reduce((t, a) => t + num(a.availableUsd), 0)
  return detailScreen({
    key: `portfolio-${scope.id}`, title: `PORTFOLIO · ${scope.label}`, context: usd(scope.valueUsd, 0),
    body: `${scope.accounts.length} account${scope.accounts.length === 1 ? '' : 's'}\n${term('upnl', c.mode)} ${pnl(scope.pnlUsd)}\nAvailable ${usd(avail, 0)}`, bodyLines: 3, bodyW: 286,
    gfx: c.privacy ? undefined : allocationGraphic(p, scope.id), gfxH: 76, items, hint: hints(c),
  })
}
export type AccountId = 'positions' | 'holdings' | 'trade' | 'default' | 'status' | 'all'
export function accountItems(acct: Acct | undefined, posCount: number, holdCount: number): MenuItem<AccountId>[] {
  const out: MenuItem<AccountId>[] = [{ id: 'positions', label: `Positions on this account · ${posCount}` }, { id: 'holdings', label: `Holdings on this account · ${holdCount}` }]
  if (acct?.canTrade) out.push({ id: 'trade', label: 'Trade on this account' })
  out.push({ id: 'status', label: 'Connection status' }, { id: 'default', label: 'Make default for this device' }, { id: 'all', label: 'Back to all accounts' })
  return out
}
export function accountScreen(a: PortfolioPayload['accounts'][number], acct: Acct | undefined, items: MenuItem[], c: ViewCtx): ScreenSpec {
  const usd = usdOf(c), pnl = pnlOf(c)
  const state = acct?.state ?? a.state
  return menuScreen(`account-${a.accountId}`, a.alias.toUpperCase().slice(0, 26), `${envTag(a.environment)} · ${state === 'CONNECTED' ? 'OK' : state}`, items, hints(c),
    `Value ${usd(a.valueUsd)} · available ${usd(a.availableUsd ?? null, 0)}\n${term('upnl', c.mode)} ${pnl(a.unrealizedPnlUsd ?? null)} · ${a.positions ?? 0} positions${a.error ? ' · some reads failed' : ''}`, 2)
}

// ---------- POSITIONS ----------
export function positionLabel(r: PositionRow, c: ViewCtx): string {
  const pnl = pnlOf(c)
  return `${r.base} ${r.long ? 'LONG' : 'SHORT'} · ${shortAlias(r.alias)} ${envTag(r.env)} · ${pnl(r.pnl)}${r.product === 'spot' ? '' : r.stop ? ' · stop' : ` · ${term('unprotected', c.mode)}`}`
}
export function pagedItems<T>(pg: Page<T>, label: (x: T) => string, ref: (x: T) => string): MenuItem<'row' | 'next' | 'prev'>[] {
  const out: MenuItem<'row' | 'next' | 'prev'>[] = pg.rows.map(r => ({ id: 'row', label: label(r), ref: ref(r) }))
  if (pg.page < pg.pages - 1) out.push({ id: 'next', label: `Next page ${pg.page + 2}/${pg.pages} ▶` })
  if (pg.page > 0) out.push({ id: 'prev', label: `◀ Previous page ${pg.page}/${pg.pages}` })
  return out
}
export function positionsScreen(pg: Page<PositionRow>, scopeTitle: string, c: ViewCtx): ScreenSpec {
  const items = pagedItems(pg, r => positionLabel(r, c), r => r.key)
  return menuScreen(`positions-p${pg.page}`, `POSITIONS · ${scopeTitle}`.slice(0, 30), `${pg.total} open${pg.pages > 1 ? ` · p${pg.page + 1}` : ''}`, items.length ? items : [{ id: 'row', label: 'No open positions' }], hints(c), pg.rows.some(r => !r.stop && r.product !== 'spot') ? `${term('unprotectedLong', c.mode)}: listed first` : undefined)
}

export function focusScreen(f: FocusModel, actions: PositionAction[], c: ViewCtx): ScreenSpec {
  const usd = usdOf(c), pnl = pnlOf(c), r = f.row
  const body = [
    `${fmtQty(f.qty)} ${r.base} · ${prodLabel(r.product)}${f.leverage ? ` ${f.leverage}x` : ''}`,
    `${term('upnl', c.mode)} ${pnl(r.pnl)}`,
    `Entry ${fmtPrice(f.entry)} · ${term('mark', c.mode)} ${fmtPrice(f.mark)}`,
    f.liq !== null ? `${c.mode === 'pro' ? 'Liq' : 'Liquidation'} ${fmtPrice(f.liq)} · ${pct(f.liqDistancePct)} away` : 'Liquidation: not reported',
    r.stop ? `Stop ${fmtPrice(f.stopPrice)} listed at venue` : r.product === 'spot' ? 'Spot holding' : term('unprotectedLong', c.mode),
  ].join('\n')
  return detailScreen({
    key: `focus-${r.key}`, title: `${r.base} ${r.long ? 'LONG' : 'SHORT'} · ${prodLabel(r.product)}`, context: `${shortAlias(r.alias)} · ${envTag(r.env)}`,
    body, bodyLines: 5, bodyW: 300, gfx: f.range, gfxH: 92,
    side: `${usd(f.notional, 0)} notional${f.margin !== null ? `\nmargin ${usd(f.margin, 0)}` : ''}`, sideLines: f.margin !== null ? 2 : 1,
    items: actions.map(a => ({ id: a.id, label: a.label })), hint: hints(c, 'act'),
  })
}

export function positionRiskScreen(f: FocusModel, policy: { nearLiquidationPct?: string } | null, sharePct: number | null, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  const near = policy?.nearLiquidationPct ? Number(policy.nearLiquidationPct) : null
  const gfx: Graphic | undefined = f.liqDistancePct !== null ? { kind: 'meter', label: `Distance to ${term('liq', c.mode)} (%)`, value: Math.min(f.liqDistancePct, 50), limit: near ?? 10, max: 50 } : undefined
  const body = [
    f.liqDistancePct !== null ? `${pct(f.liqDistancePct)} from ${term('liq', c.mode)}${near !== null ? ` (alert < ${near}%)` : ''}` : 'Liquidation not reported by venue',
    `Margin ${usd(f.margin, 0)}${f.marginMode ? ` · ${f.marginMode}` : ''}`,
    `Share of portfolio ${pct(sharePct)}`,
    f.row.stop ? `Stop ${fmtPrice(f.stopPrice)} · not a max-loss cap` : 'No stop listed at the venue',
  ].join('\n')
  return detailScreen({ key: `prisk-${f.row.key}`, title: `${f.row.base} POSITION RISK`, context: shortAlias(f.row.alias), body, bodyLines: 4, bodyW: 330, gfx, gfxH: 64, items: [{ id: 'back', label: 'Back to position' }, ...(f.row.stop || f.row.product === 'spot' ? [] : [{ id: 'protect', label: 'Add protection (stop)' }])], hint: hints(c, 'select') })
}

// ---------- HOLDINGS ----------
export function holdingsScreen(pg: Page<HoldingAgg>, scope: ScopeId, c: ViewCtx, title = 'HOLDINGS'): ScreenSpec {
  const usd = usdOf(c)
  const items = pagedItems(pg, h => `${h.asset} · ${fmtQty(h.qty)} · ${usd(h.valueUsd, 0)} · ${h.rows.length} acct${h.rows.length === 1 ? '' : 's'}${h.share !== null ? ` · ${Math.round(h.share * 100)}%` : ''}`, h => h.asset)
  return menuScreen(`holdings-${scope}-p${pg.page}`, `${title} · SPOT`.slice(0, 30), `${pg.total} assets`, items.length ? items : [{ id: 'row', label: 'No spot holdings' }], hints(c), `${SCOPE_LABEL[scope]} · quantities summed only for the same asset`)
}
export function assetHoldingScreen(h: HoldingAgg, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  const items: MenuItem[] = h.rows.map(r => ({ id: 'row', ref: r.accountId, label: `${r.alias}: ${fmtQty(r.total)} ${h.asset} · ${usd(r.valueUsd, 0)}` }))
  if (!(h.asset === 'USDT' || h.asset === 'USDC')) items.push({ id: 'market', label: `View ${h.asset} market` })
  return menuScreen(`asset-${h.asset}`, `${h.asset} · WHERE YOU HOLD IT`, usd(h.valueUsd, 0), items, hints(c), `Total ${fmtQty(h.qty)} ${h.asset} across ${h.rows.length} account${h.rows.length === 1 ? '' : 's'} · not movable by HELM`)
}
export type HoldingActionId = 'market' | 'buy' | 'sell' | 'receipts' | 'back'
export function holdingDetailScreen(h: HoldingAgg, row: HoldingAgg['rows'][number], canTrade: boolean, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  const stable = h.asset === 'USDT' || h.asset === 'USDC' || h.asset === 'USD'
  const items: MenuItem<HoldingActionId>[] = []
  if (!stable) items.push({ id: 'market', label: `Review ${h.asset} price & market` })
  if (canTrade && !stable) items.push({ id: 'buy', label: `Prepare ${h.asset} purchase` }, { id: 'sell', label: `Prepare ${h.asset} sale` })
  items.push({ id: 'receipts', label: 'Related receipts' }, { id: 'back', label: 'Back' })
  return menuScreen(`hold-${row.accountId}-${h.asset}`, `${h.asset} · ${row.alias}`.slice(0, 30), envTag(row.env), items, hints(c),
    `${fmtQty(row.total)} ${h.asset} · ${usd(row.valueUsd)}\nAvailable ${fmtQty(row.free)} · in orders ${fmtQty(row.locked)}`, 2)
}

// ---------- MARKETS ----------
export function watchlistScreen(items: WatchItem[], favorites: string[], c: ViewCtx, source = 'Binance Demo'): ScreenSpec {
  const rows: MenuItem[] = items.map(w => ({ id: 'asset', ref: w.asset, label: `${favorites.includes(w.asset) ? '* ' : ''}${w.asset.padEnd(5)} ${w.price ? fmtPrice(Number(w.price)) : 'unavailable'}${w.change24hPct ? ` · ${signedPct(Number(w.change24hPct))} 24h` : ''}` }))
  rows.push({ id: 'search', label: 'Find another asset by voice' })
  return menuScreen('watchlist', 'MARKETS · WATCHLIST', source, rows, hints(c), source === 'SAMPLE' ? 'Sample quotes · not a market feed' : 'Public quotes · 24h change from the venue ticker')
}
export type MarketActionId = 'venues' | 'trade' | 'fav' | 'voice' | 'back'
export function marketScreen(s: Snapshot, fav: boolean, c: ViewCtx): ScreenSpec {
  const pts = (s.candles?.closes ?? []).map(Number).filter(Number.isFinite)
  const gfx: Graphic | undefined = pts.length >= 2 ? { kind: 'sparkline', points: pts, caption: `${s.candles!.interval} closes · ${s.period}` } : undefined
  const body = [
    s.price ? fmtPrice(Number(s.price)) : 'Price unavailable',
    s.change24hPct ? `${signedPct(Number(s.change24hPct), 2)} over ${s.period}` : 'Change unavailable',
    gfx ? 'Sparkline: verified candles' : 'No verified candles: no chart',
    `Source: ${s.source.slice(0, 19)}`,
  ].join('\n')
  const items: MenuItem<MarketActionId>[] = [{ id: 'venues', label: 'Compare venues (Venue Compass)' }, { id: 'trade', label: `Prepare ${s.asset} order` }, { id: 'fav', label: fav ? 'Remove from favorites' : 'Add to favorites' }, { id: 'voice', label: 'Voice' }]
  return detailScreen({ key: `market-${s.asset}`, title: `${s.asset} · MARKET`, context: s.at ? ageLabel(Math.max(0, Math.round((Date.now() - Date.parse(s.at)) / 1000))) : 'age n/a', body, bodyLines: 4, bodyW: 288, gfx, gfxH: 104, items, hint: hints(c) })
}
export function venueScreen(asset: string, vm: VenueModel, c: ViewCtx): ScreenSpec {
  const items: MenuItem[] = vm.rows.map(r => ({ id: 'venue', ref: r.venue, label: r.complete ? `${venueName(r.venue)} · ${Number(r.spreadBps).toFixed(2)} bp · ${r.fresh ? `${((r.ageMs ?? 0) / 1000).toFixed(1)}s` : 'stale'}${vm.leader === r.venue ? ' · lowest' : ''}` : `${venueName(r.venue)} · unavailable` }))
  return detailScreen({ key: `venues-${asset}`, title: `${asset} · VENUE COMPASS`, context: 'spread, bp', body: `${vm.label ?? 'No venue singled out:'}\n${vm.label ? `→ ${venueName(vm.leader!)}` : 'a quote is stale or missing'}\nBars: bid/ask spread\nlower = tighter · not advice`, bodyLines: 4, bodyW: 284, gfx: vm.graphic, gfxH: 104, items, hint: hints(c, 'details') })
}
export function venueDetailScreen(asset: string, q: VenueModel['rows'][number], acct: Acct | null, buyingPowerUsd: number | null, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  const items: MenuItem[] = acct ? [{ id: 'trade', ref: acct.id, label: `Prepare order on ${acct.alias}` }] : [{ id: 'connect', label: `Connect ${venueName(q.venue)} in the companion` }]
  items.push({ id: 'back', label: 'Back to venues' })
  return menuScreen(`venue-${asset}-${q.venue}`, `${asset} · ${venueName(q.venue).toUpperCase()}`, q.fresh ? 'fresh' : 'STALE', items, hints(c), [
    q.complete ? `Bid ${fmtPrice(Number(q.bid))} · ask ${fmtPrice(Number(q.ask))}` : `Quote unavailable${q.error ? ` (${q.error})` : ''}`,
    q.complete ? `Spread ${Number(q.spreadBps).toFixed(2)} bp · age ${((q.ageMs ?? 0) / 1000).toFixed(1)}s${q.impactBps ? ` · impact ${q.impactBps} bp` : ''}` : 'No execution data: not recommended',
    acct ? `Eligible: ${acct.alias}${buyingPowerUsd !== null ? ` · ${usd(buyingPowerUsd, 0)} free` : ''}` : 'No connected account here: view only',
  ].join('\n'), 3)
}

// ---------- TRADE BUILDER ----------
export function builderScreen(step: string, title: string, context: string, items: MenuItem[], c: ViewCtx, note?: string): ScreenSpec {
  return menuScreen(`build-${step}`, title, context, items, c.mode === 'pro' ? 'tap: choose · 2x: back' : 'swipe: move · tap: choose · double-tap: back', note)
}
export function stepperScreen(asset: string, amount: number, step: number, max: number, available: number | null, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  return cardScreen({ key: 'build-stepper', title: `CUSTOM SIZE · ${asset}`, context: `max ${usd(max, 0)}`, body: `\n      ${usd(amount, 0)}\n\nswipe up: +  ·  swipe down: -\nstep ${usd(step, 0)}${available !== null ? ` · available ${usd(available, 0)}` : ''}`, hint: 'tap: use this amount · double-tap: back' })
}

// ---------- REVIEW (HELM Impact) ----------
export type ReviewId = 'confirm' | 'findings' | 'details' | 'voice' | 'cancel'
export function reviewItems(p: PreviewResp, fast: boolean): MenuItem<ReviewId>[] {
  const out: MenuItem<ReviewId>[] = []
  if (p.canConfirm && fast) out.push({ id: 'confirm', label: 'Continue to confirm' })
  if (!fast || !p.canConfirm) out.push({ id: 'findings', label: p.canConfirm ? 'Review findings (required)' : 'Why it cannot proceed' })
  out.push({ id: 'details', label: 'Details: fees, spread, assumptions' }, { id: 'voice', label: 'Change by voice' }, { id: 'cancel', label: 'Cancel (nothing sent)' })
  return out
}
export function reviewScreen(p: PreviewResp, items: MenuItem[], c: ViewCtx, now = Date.now()): ScreenSpec {
  if (p.kind === 'protect_existing') return protectReviewScreen(p, items, c, now)
  // The order's own size and cost are always shown — confirming blind is unsafe. Privacy hides portfolio values only.
  const usd = usdOf({ ...c, privacy: false })
  const s = sym(p.order.instrument), v = p.preview, i = v.impact
  const perp = s.product !== 'spot'
  const dir = perp && !p.order.reduceOnly ? (p.order.side === 'BUY' ? 'LONG' : 'SHORT') : p.order.side
  const size = p.order.quoteQuantity ? `${usd(p.order.quoteQuantity)} of ${s.base}` : `${fmtQty(p.order.quantity)} ${s.base}`
  const body = [
    `${dir} ${size} · ${prodLabel(s.product)}${p.order.leverage ? ` ${p.order.leverage}x` : ''}`,
    `${p.account.alias} · ${p.account.environmentLabel}`,
    `≈ ${usd(v.estimatedNotional)} at ${fmtPrice(v.estimatedPrice ? Number(v.estimatedPrice) : null)}${v.requiredMargin ? ` · margin ${usd(v.requiredMargin)}` : ''}`,
    p.order.reduceOnly ? (v.willCancel?.length ? `Reduce-only, then cancels ${v.willCancel.length} stop` : c.mode === 'pro' ? 'Reduce-only' : 'Only reduces or closes, never adds') : v.protection ? `Stop ${v.protection.stopOffsetPercent}% ≈ ${fmtPrice(v.protection.estimatedStopPrice ? Number(v.protection.estimatedStopPrice) : null)}` : 'No protective stop',
    `${p.risk.verdict === 'ALLOW' ? '' : p.risk.verdict === 'WARN' ? '▲ ' : '■ '}${term(p.risk.verdict, c.mode)}`,
  ].join('\n')
  const gfx: Graphic = { kind: 'beforeAfter', label: `${i.asset} exposure (USD)`, before: num(i.currentExposureUsd), after: num(i.proposedExposureUsd) }
  return detailScreen({ key: 'review', bind: p.proposalId, title: `REVIEW · ${dir} ${s.base}`, context: `${T.envTag(p.account.environmentLabel)} · ${T.secondsLeft(p, now)}s`, body, bodyLines: 5, bodyW: 330, gfx: c.privacy ? undefined : gfx, gfxH: 86, side: c.privacy ? undefined : `fee ≈ ${usd(v.estimatedFee)}`, sideLines: 1, items, hint: c.mode === 'pro' ? 'tap: select · 2x: cancel' : 'swipe: move · tap: select · double-tap: cancel' })
}
function protectReviewScreen(p: PreviewResp, items: MenuItem[], c: ViewCtx, now: number): ScreenSpec {
  const s = sym(p.order.instrument), r = p.preview.recovery
  const body = [
    `${r?.positionSide ?? ''} ${fmtQty(p.order.quantity)} ${s.base} ${prodLabel(s.product)} · ${p.account.alias}`,
    `Add stop ${fmtPrice(p.order.stopPrice ? Number(p.order.stopPrice) : null)} (${c.mode === 'pro' ? 'reduce-only' : 'closes only, never adds'})`,
    `${term('mark', c.mode)} ${fmtPrice(r ? Number(r.referencePrice) : null)} · entry ${fmtPrice(r?.entryPrice ? Number(r.entryPrice) : null)}`,
    'Shown PROTECTED only once listed',
    `${p.risk.verdict === 'ALLOW' ? '' : '▲ '}${term(p.risk.verdict, c.mode)}`,
  ].join('\n')
  return detailScreen({ key: 'review', bind: p.proposalId, title: `PROTECT ${s.base}`, context: `${T.envTag(p.account.environmentLabel)} · ${T.secondsLeft(p, now)}s`, body, bodyLines: 5, bodyW: W, items, hint: 'tap: select · double-tap: cancel' })
}
export function detailsScreen(p: PreviewResp, page: number, c: ViewCtx): { spec: ScreenSpec; pages: number } {
  const usd = usdOf(c), v = p.preview
  const pages = [
    [`Fee ≈ ${usd(v.estimatedFee)} (assumed taker tier)`, `Spread ${v.impact.spreadBps ?? 'n/a'} bp`, `${c.mode === 'pro' ? 'Slippage' : 'Est. price impact'} ${v.estimatedSlippageBps ?? 'n/a'} bp`, `Buying power after ${usd(v.remainingBuyingPower, 0)}`, `Liquidation: ${v.impact.liquidation.proposed ?? 'not estimated'}`].join('\n'),
    [`${p.risk.verdict} · policy v${p.risk.policyVersion || 'default'}`, ...p.risk.findings.slice(0, 4).map(f => `${f.verdict === 'ALLOW' ? 'ok' : f.verdict} ${f.message}`.slice(0, 50))].join('\n'),
    ['Assumptions:', ...v.estimateNotes.slice(0, 4).map(n => n.slice(0, 50))].join('\n') || 'No extra assumptions',
  ]
  const pg = Math.min(Math.max(0, page), pages.length - 1)
  return { pages: pages.length, spec: cardScreen({ key: `details-${pg}`, title: 'ORDER DETAILS', context: `${pg + 1}/${pages.length} · ${T.secondsLeft(p)}s`, body: pages[pg]!, hint: 'swipe: page · tap or double-tap: back' }) }
}
export function confirmScreen(p: PreviewResp, now = Date.now()): ScreenSpec { return { ...T.confirmScreen(p, now), bind: p.proposalId } }

// ---------- RECEIPT ----------
export type ReceiptId = 'position' | 'verify' | 'home' | 'activity'
export function receiptItems(r: Receipt, hasPosition: boolean): MenuItem<ReceiptId>[] {
  const out: MenuItem<ReceiptId>[] = []
  if (r.status === 'UNKNOWN' || r.status === 'RECONCILING' || r.status === 'SUBMITTING') out.push({ id: 'verify', label: 'Verify with exchange now' })
  if (hasPosition) out.push({ id: 'position', label: 'View this position' })
  out.push({ id: 'home', label: 'Home' }, { id: 'activity', label: 'Activity' })
  return out
}
export function receiptScreen(r: Receipt, items: MenuItem[], c: ViewCtx): ScreenSpec {
  const body = T.receiptScreen(r).texts.find(t => t.name === 'body')!.text
  const status = r.status === 'UNKNOWN' || r.status === 'RECONCILING' ? term('reconciling', c.mode) : r.status
  return { ...menuScreen(`receipt-${r.orderId}`, `RECEIPT · ${status}`.slice(0, 30), T.envTag(r.environmentLabel), items, hints(c, 'select'), body, 5) }
}

// ---------- ACTIVITY (Pulse) ----------
export function activityRows(a: ActivityPayload, c: ViewCtx): MenuItem[] {
  const rows: MenuItem[] = []
  for (const e of a.current) rows.push({ id: 'event', ref: e.id, label: `${e.acknowledged ? 'seen' : 'NOW'} · ${e.title}` })
  for (const e of a.recent) rows.push({ id: 'event', ref: e.id, label: `${shortTime(e.at)} · ${e.title}` })
  for (const e of a.resolved.slice(0, 6)) rows.push({ id: 'event', ref: e.id, label: `resolved · ${e.title}` })
  void c
  return rows.slice(0, 20)
}
export function activityScreen(a: ActivityPayload, rows: MenuItem[], c: ViewCtx): ScreenSpec {
  return menuScreen('activity', term('pulse', c.mode).toUpperCase(), `${a.current.length} now`, rows.length ? rows : [{ id: 'none', label: 'All quiet' }], hints(c), a.current.length ? `${a.current.length} need${a.current.length === 1 ? 's' : ''} attention · then recent · then resolved` : 'Nothing needs attention right now')
}
export function eventScreen(e: ActivityItem, c: ViewCtx): ScreenSpec {
  const when = shortTime(e.at)
  return menuScreen(`event-${e.id}`, e.state === 'current' ? 'NEEDS ATTENTION' : e.state === 'resolved' ? 'RESOLVED' : 'ACTIVITY', when, e.actions.map(a => ({ id: a.kind, label: a.label })), hints(c, 'act'),
    `${e.title}\n${e.detail.slice(0, 90)}\n${e.account ? `${e.account} · ` : ''}${e.state === 'current' ? 'still relevant now' : e.state === 'resolved' ? 'no longer an issue' : 'history'}`, 3)
}
const shortTime = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--' }

// ---------- SHIELD (Portfolio Risk) ----------
export interface ShieldModel { unprotected: number; nearLiq: number; marginWarn: number; largestExchange: { alias: string; sharePct: number } | null; largestAsset: { asset: string; direction: string; usd: number } | null; exchangeRows: Array<{ label: string; value: number }>; maxExchangePct: number | null; maxMarginPct: number | null }
export function shieldScreen(m: ShieldModel, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  const attention = m.unprotected + m.nearLiq + m.marginWarn
  const body = [
    attention ? `${attention} item${attention === 1 ? '' : 's'} need attention` : 'Within your configured limits',
    `${m.unprotected} position${m.unprotected === 1 ? '' : 's'} with no stop`,
    `${m.nearLiq} near ${term('liq', c.mode)} · ${m.marginWarn} margin`,
    m.largestExchange ? `Top account ${shortAlias(m.largestExchange.alias)} ${pct(m.largestExchange.sharePct, 0)}` : 'No account concentration',
    m.largestAsset ? `Largest ${m.largestAsset.asset} ${m.largestAsset.direction} ${usd(m.largestAsset.usd, 0)}` : 'Flat',
  ].join('\n')
  const gfx: Graphic | undefined = m.exchangeRows.length ? { kind: 'bars', title: 'Account share of value, % (line = limit)', unit: '%', rows: m.exchangeRows.slice(0, 4), max: 100, limit: m.maxExchangePct } : undefined
  const items: MenuItem[] = [{ id: 'unprotected', label: `Positions with no stop · ${m.unprotected}` }, { id: 'positions', label: 'All positions' }, { id: 'compass', label: 'Exposure Compass (detail)' }, { id: 'emergency', label: 'Emergency review' }]
  return detailScreen({ key: 'shield', title: c.mode === 'pro' ? 'HELM SHIELD' : 'PORTFOLIO RISK', context: c.mode === 'pro' ? 'policy' : 'HELM Shield', body, bodyLines: 5, bodyW: 302, gfx, gfxH: 100, items, hint: hints(c) })
}

// ---------- MORE / SETTINGS / HELP ----------
export type MoreId = 'shield' | 'compass' | 'emergency' | 'protect' | 'accounts' | 'recipes' | 'receipts' | 'settings' | 'help' | 'device' | 'diagnostics'
export function moreItems(c: ViewCtx): MenuItem<MoreId>[] {
  return [
    { id: 'shield', label: term('shield', c.mode) }, { id: 'protect', label: 'Protect positions (add stops)' }, { id: 'emergency', label: 'Emergency review' },
    { id: 'compass', label: 'Exposure Compass' }, { id: 'receipts', label: 'Receipts' }, { id: 'accounts', label: 'Accounts & connection status' }, { id: 'recipes', label: 'Trading recipes' },
    { id: 'settings', label: 'Settings: mode, privacy, alerts' }, { id: 'help', label: 'Help & tutorial' }, { id: 'device', label: 'This device' }, { id: 'diagnostics', label: 'Diagnostics' },
  ]
}
export const moreScreen = (c: ViewCtx) => menuScreen('more', 'MORE', '', moreItems(c), hints(c))
export type SettingId = 'mode' | 'home' | 'privacy' | 'alerts' | 'exchange' | 'deck-reset' | 'tutorial' | 'back'
export function settingsItems(p: Prefs, accts: Acct[]): MenuItem<SettingId>[] {
  const pref = accts.find(a => a.id === p.preferredExchange)
  return [
    { id: 'mode', label: `Mode: ${p.mode === 'pro' ? 'Pro' : 'Beginner'} · tap to switch` },
    { id: 'home', label: `Home layout: ${p.homeMode}` },
    { id: 'privacy', label: `Privacy mode: ${p.privacy ? 'on, values hidden' : 'off'}` },
    { id: 'alerts', label: `Alert sensitivity: ${p.alertSensitivity}` },
    { id: 'exchange', label: `Preferred account: ${pref ? pref.alias : 'ask each time'}` },
    { id: 'deck-reset', label: 'Quick Deck: restore default order' },
    { id: 'tutorial', label: 'Restart the tutorial' },
  ]
}
export const settingsScreen = (p: Prefs, accts: Acct[], c: ViewCtx, saved?: string) => menuScreen('settings', 'SETTINGS', saved ?? 'saved per user', settingsItems(p, accts), hints(c, 'change'), 'Presentation only; your trading limits never change')
export const helpItems = (): MenuItem[] => [{ id: 'gestures', label: 'Gestures: swipe, tap, double-tap' }, { id: 'tutorial', label: 'Restart the tutorial' }, { id: 'terms', label: 'What the words mean' }, { id: 'safety', label: 'How HELM keeps orders safe' }, { id: 'voice', label: 'Voice command examples' }]
export const helpScreen = (c: ViewCtx) => menuScreen('help', 'HELP', '', helpItems(), hints(c))
export function infoScreen(key: string, title: string, context: string, body: string, c: ViewCtx, items: MenuItem[] = [{ id: 'back', label: 'Back' }]): ScreenSpec {
  const lines = Math.min(5, body.split('\n').length)
  return menuScreen(key, title, context, items, hints(c, 'select'), body, lines)
}

// ---------- LOADING / RECOVERY ----------
export function loadingScreen(label: string, cancellable: boolean): ScreenSpec {
  return { key: 'loading', texts: [...head('HELM', 'working'), { id: 5, name: 'msg', x: 0, y: 100, w: W, h: 70, text: `${label}…`, pad: 10, capture: true }, foot(cancellable ? 'double-tap: cancel (read-only)' : 'please wait')] }
}
export function recoveryScreen(key: string, title: string, msg: string, items: MenuItem[]): ScreenSpec {
  return menuScreen(key, title, 'HELM', items, 'tap: select · double-tap: home', `${msg.slice(0, 150)}`, 3)
}

// ---------- VOICE ----------
export const listeningScreen = (secs: number, hint: string) => cardScreen({ key: 'listening', title: 'LISTENING', context: `${secs}s`, body: `Say a command${hint ? `, e.g.\n"${hint}"` : ''}\n\nTap when done.`, hint: 'tap: done · double-tap: cancel' })
export function heardScreen(transcript: string, sttLabel: string, interpretation: string, outcome: string, items: MenuItem[]): ScreenSpec {
  return menuScreen('heard', 'HEARD', sttLabel.slice(0, 16), items, 'tap: select · double-tap: back', `"${transcript.slice(0, 60)}"\n${interpretation.slice(0, 60)}\n${outcome.slice(0, 60)}`, 3)
}

// ---------- ONBOARDING ----------
export const onboardWelcome = (): ScreenSpec => menuScreen('ob-welcome', 'WELCOME TO HELM', '1/6', [{ id: 'try', label: 'Try HELM (2 minutes)' }, { id: 'connect', label: 'Connect an account' }, { id: 'skip', label: 'Skip introduction' }], 'swipe: move · tap: choose', 'Your exchanges. One glance.', 1)
export function onboardGesture(step: 0 | 1 | 2 | 3): ScreenSpec {
  const body = [
    'Swipe on the touchpad (temple\nor R1 ring): try a swipe now.\n\nThe lens is not a touchscreen.',
    'Swipe: done.\n\nNow TAP once to select.',
    'Tap: done.\n\nDouble-tap goes back or cancels.\nTap to continue.',
    'Gestures learned:\nswipe = move · tap = select\ndouble-tap = back / cancel\nTap to continue.',
  ][step]
  return cardScreen({ key: `ob-gesture-${step}`, title: 'GESTURES', context: '2/6', body, hint: step === 0 ? 'swipe up or down' : 'tap: continue' })
}
export const onboardDone = (): ScreenSpec => menuScreen('ob-finish', 'YOU ARE READY', '6/6', [{ id: 'home', label: 'Go to Home' }, { id: 'restart', label: 'Restart tutorial' }], 'tap: choose', 'Home shows your value, positions and alerts.\nRestart anytime: More → Help.', 2)

// ---------- RISK FINDINGS (mandatory step when the fast path does not apply) ----------
export function findingsScreen(p: PreviewResp, c: ViewCtx, now = Date.now()): ScreenSpec {
  const f = p.risk.findings.filter(x => x.verdict !== 'ALLOW').slice(0, 3).map(x => `${x.verdict === 'BLOCK' ? '■' : '▲'} ${x.message}`.slice(0, 60))
  const notes = f.length ? f : [term(p.risk.verdict, c.mode)]
  const items: MenuItem[] = p.canConfirm ? [{ id: 'cancel', label: 'Cancel (nothing sent)' }, { id: 'confirm', label: 'I reviewed this: continue to confirm' }] : [{ id: 'cancel', label: 'Back (nothing sent)' }]
  return menuScreen('findings', p.canConfirm ? 'REVIEW REQUIRED' : 'CANNOT PROCEED', `${p.risk.verdict} · ${T.secondsLeft(p, now)}s`, items, 'swipe: move · tap: select · double-tap: cancel', notes.join('\n'), Math.min(3, notes.length), p.proposalId)
}
export function protectPickScreen(base: string, side: string, alias: string, distances: string[], c: ViewCtx): ScreenSpec {
  const items: MenuItem[] = distances.map(d => ({ id: 'dist', ref: d, label: `Stop ${d}% from ${term('mark', c.mode)}` }))
  items.push({ id: 'back', label: 'Back' })
  return menuScreen('protect-pick', `PROTECT ${base} ${side}`.slice(0, 30), shortAlias(alias), items, hints(c, 'preview'), `${c.mode === 'pro' ? 'Reduce-only stop' : 'A stop closes the position if price reaches it (closes only, never adds)'}`, 2)
}
export function listScreen(key: string, title: string, context: string, items: MenuItem[], c: ViewCtx, note?: string, noteLines = 1): ScreenSpec {
  return menuScreen(key, title, context, items, hints(c), note, noteLines)
}

// ---------- EXPOSURE COMPASS (detail) ----------
export function compassScreen(cp: { largestDirectional?: { asset: string; direction: string; netUsd: string } | null; largestExchange?: { alias: string; sharePct: string } | null; unprotected: unknown[]; nearRisk: unknown[]; marginWarnings: unknown[]; rose?: Array<{ asset: string; sharePct: string; direction: string }> }, net: string, c: ViewCtx): ScreenSpec {
  const usd = usdOf(c)
  const ld = cp.largestDirectional ? `${cp.largestDirectional.asset} ${cp.largestDirectional.direction} ${usd(Math.abs(Number(cp.largestDirectional.netUsd)), 0)}` : 'flat'
  const le = cp.largestExchange ? `${shortAlias(cp.largestExchange.alias)} ${Math.round(Number(cp.largestExchange.sharePct))}%` : 'none'
  const rose = (cp.rose ?? []).slice(0, 4).map(r => `${r.asset} ${Math.round(Number(r.sharePct))}%${r.direction === 'SHORT' ? '↓' : r.direction === 'LONG' ? '↑' : ''}`).join(' ')
  const body = `Largest: ${ld}\nTop account: ${le}\nNo stop: ${cp.unprotected.length} · near ${term('liq', c.mode)}: ${cp.nearRisk.length}\nMargin warnings: ${cp.marginWarnings.length}\n${rose || 'No exposure'}`
  return cardScreen({ key: 'compass', title: term('compass', c.mode).toUpperCase(), context: usd(net, 0), body, hint: 'tap or double-tap: back' })
}
