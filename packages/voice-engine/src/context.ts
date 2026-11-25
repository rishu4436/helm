/**
 * Contextual voice resolver (UX 2.0). Binds a spoken command to EXPLICIT screen state — the active account,
 * selected asset, selected position, current draft — and never guesses an asset, amount or account.
 *
 * Read-only commands resolve to a navigation target (answered directly). Financial commands resolve to a
 * proposal that still goes through preview → review → explicit confirmation. Ambiguity → clarify. Stale
 * context (an account or position that no longer exists) → reject, never re-targeted to something else.
 * Deterministic: grammar + tokens only, so transcript text cannot inject instructions.
 */
import { normalise, parseDeterministic } from './parser'

export interface VCtx { screen: string; accountId?: string | null; asset?: string | null; positionKey?: string | null; draft?: Partial<VTicket> | null; proposalId?: string | null; eventId?: string | null }
export interface VAccount { id: string; alias: string; provider: string; environment: string; canTrade: boolean; products: string[] }
export interface VPosition { accountId: string; instrumentId: string; side: string; quantity: string }
export interface VTicket { accountId: string; asset: string; product: 'spot' | 'perp'; side: 'BUY' | 'SELL'; notional?: string; quantity?: string; fraction?: string; leverage?: string; stopOffsetPercent?: string; reduceOnly?: boolean; instrumentId?: string }
export type VAction =
  | { kind: 'navigate'; target: 'home' | 'portfolio' | 'positions' | 'holdings' | 'account' | 'position' | 'market' | 'venues' | 'activity' | 'receipt' | 'unprotected' | 'risk' | 'emergency' | 'liquidation'; accountId?: string; asset?: string; positionKey?: string; providers?: string[] }
  | { kind: 'propose'; ticket: VTicket; summary: string }
  | { kind: 'protect'; accountId: string; instrumentId: string; stopOffsetPercent: string; summary: string }
  | { kind: 'clarify'; question: string; options: Array<{ id: string; label: string }>; field: 'account' | 'asset' | 'position' | 'size' }
  | { kind: 'reject'; message: string }
export interface VResult { interpretation: string; action: VAction }

const PROVIDERS: Array<[RegExp, string]> = [[/\bbinance\b/g, 'binance'], [/\b(okx|o k x|okex)\b/g, 'okx'], [/\b(bybit|by bit|bye bit)\b/g, 'bybit'], [/\bcoinbase\b/g, 'coinbase'], [/\b(ibkr|interactive brokers)\b/g, 'ibkr']]
const providersIn = (t: string) => PROVIDERS.filter(([re]) => { re.lastIndex = 0; return re.test(t) }).map(([, p]) => p)
const pName = (p: string) => (p === 'okx' ? 'OKX' : p === 'ibkr' ? 'IBKR' : p.charAt(0).toUpperCase() + p.slice(1))
export const posKeyOf = (p: Pick<VPosition, 'accountId' | 'instrumentId' | 'side'>) => `${p.accountId}|${p.instrumentId}|${p.side}`
const baseOf = (id: string) => (id.split(':')[2] ?? '').split('-')[0] ?? ''
const isLong = (p: VPosition) => p.side === 'LONG' || ((p.side === 'NET' || p.side === 'BOTH') && Number(p.quantity) > 0)
const WORD_NUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twenty: '20', fifty: '50' }

function money(t: string): string | null {
  const m = t.match(/\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:dollars?|bucks|usd|usdt)\b/)
  return m ? (m[1] ?? m[2] ?? null) : null
}
function fractionOf(t: string): string | null {
  if (/\bhalf\b/.test(t)) return '0.5'
  if (/\b(a )?quarter\b/.test(t)) return '0.25'
  if (/\bthree quarters\b/.test(t)) return '0.75'
  const p = t.match(/(\d+(?:\.\d+)?)\s?(?:percent|%)/)
  if (p && !/\bstop\b/.test(t)) return String(Math.min(1, Number(p[1]) / 100))
  if (/\b(close|all|entire|whole|full)\b/.test(t)) return '1'
  return null
}
function stopPct(t: string): string | null {
  const m = t.match(/(\d+(?:\.\d+)?|one|two|three|four|five|ten)\s?(?:percent|%)\s+stop/) ?? t.match(/stop(?:\s+loss)?\s+(?:at\s+|of\s+)?(\d+(?:\.\d+)?|one|two|three|four|five|ten)\s?(?:percent|%)/)
  return m ? (WORD_NUM[m[1]!] ?? m[1]!) : null
}

export function resolveContextual(transcript: string, ctx: VCtx, accounts: VAccount[], positions: VPosition[]): VResult {
  const t = normalise(transcript)
  const intent = parseDeterministic(transcript)
  if (intent.rejectedReason) return { interpretation: 'Not a HELM command', action: { kind: 'reject', message: intent.rejectedReason } }
  const provs = providersIn(t)
  const acctById = (id?: string | null) => (id ? accounts.find(a => a.id === id) : undefined)
  const posByKey = (k?: string | null) => (k ? positions.find(p => posKeyOf(p) === k) : undefined)

  // Stale context is never silently re-targeted.
  if (ctx.accountId && !acctById(ctx.accountId)) return { interpretation: 'Context out of date', action: { kind: 'reject', message: 'That account is no longer connected. Nothing changed.' } }
  const ctxPos = posByKey(ctx.positionKey)
  if (ctx.positionKey && !ctxPos && /\b(this|it)\b/.test(t)) return { interpretation: 'Context out of date', action: { kind: 'reject', message: 'That position is no longer open. Nothing was prepared.' } }

  const accountFor = (provider?: string | null, need?: { trading?: boolean; product?: string }) => {
    let pool = accounts.filter(a => (!provider || a.provider === provider) && (!need?.trading || a.canTrade) && (!need?.product || a.products.includes(need.product)))
    if (!provider && ctx.accountId) { const a = pool.find(x => x.id === ctx.accountId); if (a) pool = [a] }
    return pool
  }
  const clarifyAccount = (pool: VAccount[], why: string): VResult => ({ interpretation: why, action: { kind: 'clarify', field: 'account', question: 'Which account?', options: pool.slice(0, 6).map(a => ({ id: a.id, label: a.alias })) } })

  // ---------- draft edits ("make it fifty dollars instead", "change the leverage to two", "use my Bybit account") ----------
  if (ctx.draft && ctx.draft.accountId && ctx.draft.asset && ctx.draft.side && ctx.draft.product) {
    const d = { ...ctx.draft } as VTicket
    const changes: string[] = []
    const amt = /\b(make it|instead|change (the )?(amount|size)|set (the )?(amount|size))\b/.test(t) ? money(t) : null
    if (amt) { d.notional = amt; delete d.quantity; delete d.fraction; changes.push(`amount $${amt}`) }
    const lev = t.match(/leverage\s+(?:to\s+)?(\d+(?:\.\d+)?|one|two|three|four|five)\b/) ?? t.match(/\b(\d+)\s?x\b/)
    if (lev && /\bleverage|\bx\b/.test(t)) { if (d.product !== 'perp') return { interpretation: 'Leverage change', action: { kind: 'reject', message: 'Spot orders have no leverage. Nothing changed.' } }; d.leverage = WORD_NUM[lev[1]!] ?? lev[1]!; changes.push(`leverage ${d.leverage}x`) }
    if (/\b(use|switch to|on)\b.*\baccount\b|\buse my\b/.test(t) && provs.length) {
      const pool = accountFor(provs[0], { trading: true, product: d.product })
      if (!pool.length) return { interpretation: `Use ${pName(provs[0]!)}`, action: { kind: 'reject', message: `No connected ${pName(provs[0]!)} account can trade ${d.product}.` } }
      if (pool.length > 1) return clarifyAccount(pool, `Use ${pName(provs[0]!)}`)
      d.accountId = pool[0]!.id; delete d.instrumentId; changes.push(`account ${pool[0]!.alias}`)
    }
    const sp = stopPct(t)
    if (sp && !d.reduceOnly) { d.stopOffsetPercent = sp; changes.push(`stop ${sp}%`) }
    if (/\b(no stop|remove (the )?stop|without (a )?stop)\b/.test(t)) { delete d.stopOffsetPercent; changes.push('no stop') }
    if (changes.length) return { interpretation: `Change: ${changes.join(', ')}`, action: { kind: 'propose', ticket: d, summary: summarize(d, accounts) } }
  }

  // ---------- position context ("close half of this position", "add a three percent stop", "show my liquidation distance") ----------
  const focus = ctxPos && (!intent.asset || intent.asset === baseOf(ctxPos.instrumentId)) ? ctxPos : undefined
  if (/\bliquidation\b/.test(t)) {
    const p = focus ?? onlyOne(positions.filter(x => x.instrumentId.includes(':perp:') && (!intent.asset || baseOf(x.instrumentId) === intent.asset)))
    if (p) return { interpretation: 'Show liquidation distance', action: { kind: 'navigate', target: 'liquidation', positionKey: posKeyOf(p), accountId: p.accountId } }
    return clarifyPosition(positions.filter(x => x.instrumentId.includes(':perp:')), accounts, 'Which position?')
  }
  if (focus && /\b(close|reduce|trim|cut)\b/.test(t)) {
    const f = fractionOf(t) ?? (/\bclose\b/.test(t) ? '1' : null)
    if (!f) return { interpretation: 'Reduce this position', action: { kind: 'reject', message: 'Say how much, e.g. "close half" or "reduce 25 percent".' } }
    const tk: VTicket = { accountId: focus.accountId, asset: baseOf(focus.instrumentId), instrumentId: focus.instrumentId, product: focus.instrumentId.includes(':perp:') ? 'perp' : 'spot', side: isLong(focus) ? 'SELL' : 'BUY', fraction: f, reduceOnly: true }
    return { interpretation: `${f === '1' ? 'Close' : `Reduce ${Math.round(Number(f) * 100)}% of`} this ${tk.asset} position`, action: { kind: 'propose', ticket: tk, summary: summarize(tk, accounts) } }
  }
  const sp = stopPct(t)
  if (/\b(stop|protect|protection)\b/.test(t) && /\b(add|set|put|place|prepare|protect)\b/.test(t) && !/\b(buy|sell|long|short)\b/.test(t)) {
    const p = focus ?? onlyOne(positions.filter(x => x.instrumentId.includes(':perp:') && (!intent.asset || baseOf(x.instrumentId) === intent.asset) && (!provs.length || accounts.find(a => a.id === x.accountId)?.provider === provs[0])))
    if (!p) return focus === undefined && ctx.positionKey ? { interpretation: 'Add a stop', action: { kind: 'reject', message: 'That position is no longer open.' } } : { interpretation: 'Add protection', action: { kind: 'navigate', target: 'unprotected' } }
    if (!sp) return { interpretation: `Add a stop to ${baseOf(p.instrumentId)}`, action: { kind: 'reject', message: 'Say the distance, e.g. "add a three percent stop".' } }
    return { interpretation: `Add a ${sp}% stop to ${baseOf(p.instrumentId)} ${isLong(p) ? 'LONG' : 'SHORT'}`, action: { kind: 'protect', accountId: p.accountId, instrumentId: p.instrumentId, stopOffsetPercent: sp, summary: `Reduce-only stop ${sp}% from mark · ${accounts.find(a => a.id === p.accountId)?.alias ?? ''}` } }
  }

  // ---------- read-only navigation ----------
  const nav = (target: Extract<VAction, { kind: 'navigate' }>['target'], extra: Partial<Extract<VAction, { kind: 'navigate' }>> = {}, label = ''): VResult => ({ interpretation: label || `Show ${target}`, action: { kind: 'navigate', target, ...extra } })
  const trading = /\b(buy|sell|long|short|close|reduce|trim|open|purchase)\b/.test(t)
  if (!trading) {
    if (/\b(need|needs|requires?) attention\b|\bunprotected\b|\bno stop\b/.test(t)) {
      if (/\breview\b/.test(t)) { const un = positions.filter(x => x.instrumentId.includes(':perp:')); void un }
      return nav('unprotected', {}, 'Positions that need attention')
    }
    if (/\b(last|latest|recent) receipt\b|\blast order\b/.test(t)) return nav('receipt', {}, 'Show your last receipt')
    if (/\bcompare\b/.test(t)) {
      const asset = intent.asset ?? ctx.asset
      if (!asset) return { interpretation: 'Compare venues', action: { kind: 'clarify', field: 'asset', question: 'Compare which asset?', options: ['BTC', 'ETH', 'SOL'].map(a => ({ id: a, label: a })) } }
      return nav('venues', { asset, providers: provs.length ? provs : undefined }, `Compare ${provs.length ? provs.map(pName).join(' and ') : 'venues'} for ${asset}`)
    }
    if (/\baccount\b/.test(t) && provs.length) {
      const pool = accounts.filter(a => a.provider === provs[0])
      if (!pool.length) return { interpretation: `Show ${pName(provs[0]!)} account`, action: { kind: 'reject', message: `No ${pName(provs[0]!)} account connected. Connect one in the companion, or add a SIMULATED account.` } }
      if (pool.length > 1) return clarifyAccount(pool, `Show ${pName(provs[0]!)} account`)
      return nav('account', { accountId: pool[0]!.id }, `Show ${pool[0]!.alias}`)
    }
    if (/\bholdings?\b/.test(t)) return nav('holdings', { asset: intent.asset ?? undefined }, intent.asset ? `Show ${intent.asset} holdings` : 'Show holdings')
    if (/\bpositions?\b/.test(t)) {
      if (provs.length) { const pool = accounts.filter(a => a.provider === provs[0]); if (pool.length === 1) return nav('positions', { accountId: pool[0]!.id }, `Positions on ${pool[0]!.alias}`); if (!pool.length) return { interpretation: 'Positions', action: { kind: 'reject', message: `No ${pName(provs[0]!)} account connected.` } }; return clarifyAccount(pool, 'Positions') }
      return nav('positions', { asset: intent.asset ?? undefined }, 'Show positions')
    }
    if (/\bportfolio\b|\bbalance\b|\bhow (am i|is my)\b/.test(t)) return nav('portfolio', {}, 'Show your portfolio')
    if (/\b(alerts?|activity|pulse)\b/.test(t)) return nav('activity', {}, 'Show activity')
    if (/\b(risk|exposure|shield)\b/.test(t)) return nav('risk', {}, 'Show portfolio risk')
    if (/\bemergency\b|\bpanic\b/.test(t)) return nav('emergency', {}, 'Emergency review')
    if (/\b(go )?home\b/.test(t)) return nav('home', {}, 'Home')
    if (/\b(price|market|chart)\b/.test(t) && (intent.asset ?? ctx.asset)) return nav('market', { asset: intent.asset ?? ctx.asset! }, `Show ${intent.asset ?? ctx.asset} market`)
  }

  // ---------- new orders / closes from anywhere ----------
  if (intent.intent === 'CLOSE_POSITION' || intent.intent === 'REDUCE_POSITION') {
    const pool = positions.filter(x => (!intent.asset || baseOf(x.instrumentId) === intent.asset) && (!provs.length || accounts.find(a => a.id === x.accountId)?.provider === provs[0]))
    if (!intent.fraction) return { interpretation: 'Reduce a position', action: { kind: 'reject', message: 'Say how much, e.g. "close half of my BTC long on Bybit".' } }
    const p = onlyOne(pool)
    if (!p) return pool.length ? clarifyPosition(pool, accounts, 'Which position?') : { interpretation: 'Close a position', action: { kind: 'reject', message: 'No matching open position.' } }
    const tk: VTicket = { accountId: p.accountId, asset: baseOf(p.instrumentId), instrumentId: p.instrumentId, product: p.instrumentId.includes(':perp:') ? 'perp' : 'spot', side: isLong(p) ? 'SELL' : 'BUY', fraction: intent.fraction, reduceOnly: true }
    return { interpretation: `${intent.fraction === '1' ? 'Close' : `Reduce ${Math.round(Number(intent.fraction) * 100)}% of`} ${tk.asset} position`, action: { kind: 'propose', ticket: tk, summary: summarize(tk, accounts) } }
  }
  if (intent.intent === 'PLACE_ORDER') {
    const asset = intent.asset ?? ctx.asset ?? null
    if (!asset) return { interpretation: 'New order', action: { kind: 'clarify', field: 'asset', question: 'Which asset?', options: ['BTC', 'ETH', 'SOL'].map(a => ({ id: a, label: a })) } }
    if (!intent.side) return { interpretation: `Order ${asset}`, action: { kind: 'reject', message: 'Say buy or sell (long or short).' } }
    if (!intent.notional && !intent.quantity) return { interpretation: `${intent.side} ${asset}`, action: { kind: 'reject', message: 'Say an amount, e.g. "fifty dollars". HELM never guesses a size.' } }
    const product = intent.product === 'perp' ? 'perp' : 'spot'
    const pool = accountFor(provs[0] ?? intent.provider, { trading: true, product })
    if (!pool.length) return { interpretation: `${intent.side} ${asset}`, action: { kind: 'reject', message: `No connected ${provs[0] ? pName(provs[0]) + ' ' : ''}account can trade ${product}.` } }
    if (pool.length > 1) return clarifyAccount(pool, `${intent.side} ${intent.notional ? `$${intent.notional}` : intent.quantity} ${asset}`)
    const tk: VTicket = { accountId: pool[0]!.id, asset, product, side: intent.side, ...(intent.notional ? { notional: intent.notional } : { quantity: intent.quantity! }), ...(intent.leverage ? { leverage: intent.leverage } : {}), ...(intent.stopOffsetPercent ? { stopOffsetPercent: intent.stopOffsetPercent } : {}) }
    return { interpretation: `${intent.side} ${intent.notional ? `$${intent.notional}` : `${intent.quantity}`} ${asset}${!intent.asset ? ' (asset from this screen)' : ''}`, action: { kind: 'propose', ticket: tk, summary: summarize(tk, accounts) } }
  }
  if (intent.intent === 'QUERY_POSITIONS') return nav('positions', {}, 'Show positions')
  if (intent.intent === 'QUERY_PORTFOLIO' || intent.intent === 'QUERY_BALANCE') return nav('portfolio', {}, 'Show your portfolio')
  if (intent.intent === 'QUERY_EXPOSURE') return nav('risk', {}, 'Show portfolio risk')
  if (intent.intent === 'QUERY_UNPROTECTED') return nav('unprotected', {}, 'Positions with no stop')
  if (intent.intent === 'EMERGENCY_REVIEW') return nav('emergency', {}, 'Emergency review')
  if (intent.intent === 'COMPARE_VENUES' && (intent.asset ?? ctx.asset)) return nav('venues', { asset: intent.asset ?? ctx.asset! }, 'Compare venues')
  return { interpretation: 'Not understood', action: { kind: 'reject', message: 'Try "show my portfolio" or "prepare a 50 dollar BTC buy on Bybit".' } }
}

function onlyOne<T>(xs: T[]): T | undefined { return xs.length === 1 ? xs[0] : undefined }
function clarifyPosition(pool: VPosition[], accounts: VAccount[], q: string): VResult {
  return { interpretation: q, action: { kind: 'clarify', field: 'position', question: q, options: pool.slice(0, 6).map(p => ({ id: posKeyOf(p), label: `${baseOf(p.instrumentId)} ${isLong(p) ? 'LONG' : 'SHORT'} · ${accounts.find(a => a.id === p.accountId)?.alias ?? 'account'}` })) } }
}
export function summarize(tk: VTicket, accounts: VAccount[]): string {
  const a = accounts.find(x => x.id === tk.accountId)
  const size = tk.fraction ? `${Math.round(Number(tk.fraction) * 100)}%` : tk.notional ? `$${tk.notional}` : `${tk.quantity} ${tk.asset}`
  const dir = tk.reduceOnly ? (tk.fraction === '1' ? 'CLOSE' : 'REDUCE') : tk.product === 'perp' ? (tk.side === 'BUY' ? 'LONG' : 'SHORT') : tk.side
  return `${dir} ${size} ${tk.asset} ${tk.product === 'perp' ? 'PERP' : 'SPOT'}${tk.leverage ? ` ${tk.leverage}x` : ''}${tk.stopOffsetPercent ? ` · stop ${tk.stopOffsetPercent}%` : ''} · ${a?.alias ?? 'account'}`
}
