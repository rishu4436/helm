import { TradeIntentSchema, type ProviderId, type TradeIntent } from '@helm/shared'

/**
 * Deterministic HELM command parser. Grammar-based, no model: it only extracts known tokens, so
 * transcript text can never inject instructions. Output always passes TradeIntentSchema and always
 * has requiresConfirmation = true. An optional model may be consulted only when this returns UNKNOWN,
 * and its output is schema-validated and re-sanitised (see parseIntent).
 */

const NUM_WORDS: Record<string, number> = { zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const MULT: Record<string, number> = { hundred: 100, thousand: 1000, k: 1000 }

export const ASSET_ALIASES: Record<string, string> = {
  btc: 'BTC', bitcoin: 'BTC', bitcoins: 'BTC', eth: 'ETH', ether: 'ETH', ethereum: 'ETH', sol: 'SOL', solana: 'SOL',
  apple: 'AAPL', aapl: 'AAPL', tesla: 'TSLA', tsla: 'TSLA', nvidia: 'NVDA', nvda: 'NVDA', microsoft: 'MSFT', msft: 'MSFT', spy: 'SPY',
}
const STOCKS = new Set(['AAPL', 'TSLA', 'NVDA', 'MSFT', 'SPY'])
const PROVIDER_ALIASES: Array<[RegExp, ProviderId]> = [
  [/\bbinance\b/, 'binance'], [/\b(okx|o k x|okex)\b/, 'okx'], [/\b(bybit|by bit|bye bit)\b/, 'bybit'], [/\bcoinbase\b/, 'coinbase'],
  [/\b(interactive brokers|ibkr|i b k r|paper brokerage|brokerage)\b/, 'ibkr'], [/\balpaca\b/, 'alpaca'],
]

/** Normalise a transcript: lowercase, strip wake word, control chars, collapse number words. */
export function normalise(raw: string): string {
  let t = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500).toLowerCase()
  t = t.replace(/^\s*(hey\s+)?helm[,.!:]?\s*/, '')
  t = t.replace(/(\d),(\d{3})/g, '$1$2').replace(/[“”"']/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  // "a hundred", "two hundred", "one thousand five hundred" → digits
  t = t.replace(/\b((?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty)(?:\s+(?:hundred|thousand))+(?:\s+(?:and\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred))*)\b/g, m => {
    let total = 0, cur = 0
    for (const w of m.split(/\s+/)) {
      if (w === 'and') continue
      if (w in NUM_WORDS) cur += NUM_WORDS[w]!
      else if (w in MULT) { cur = (cur || 1) * MULT[w]!; if (MULT[w]! >= 1000) { total += cur; cur = 0 } }
    }
    return String(total + cur)
  })
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\b(?=\s+(share|shares|percent|%|dollars?|bucks|usd|usdt|x\b|times))/g, w => String(NUM_WORDS[w]))
  return t
}

const num = String.raw`(\d+(?:\.\d+)?)`

export function parseDeterministic(transcript: string): TradeIntent {
  const t = normalise(transcript)
  const base: TradeIntent = {
    intent: 'UNKNOWN', provider: null, accountId: null, asset: null, product: null, side: null, orderType: null, quantity: null, notional: null,
    fraction: null, leverage: null, limitPrice: null, stopOffsetPercent: null, shockPercent: null, rejectedReason: null, confidence: 0,
    clarificationNeeded: [], requiresConfirmation: true, transcript: transcript.slice(0, 500),
  }
  const done = (x: Partial<TradeIntent>): TradeIntent => TradeIntentSchema.parse({ ...base, ...x })

  for (const [re, p] of PROVIDER_ALIASES) if (re.test(t)) { base.provider = p; break }
  const assetWord = t.match(/\b(btc|bitcoins?|eth|ether|ethereum|sol|solana|apple|aapl|tesla|tsla|nvidia|nvda|microsoft|msft|spy)\b/)
  base.asset = assetWord ? ASSET_ALIASES[assetWord[1]!]! : null
  if (base.asset && STOCKS.has(base.asset)) base.product = 'stock'
  if (/\b(futures?|perps?|perpetual|long|short|leverage)\b/.test(t) && base.product !== 'stock') base.product = 'perp'
  if (/\bstocks?\b|\bshares?\b/.test(t)) base.product = 'stock'

  // Safety: HELM never moves funds.
  if (/\b(withdraw|withdrawal|transfer|send|deposit|seed phrase|recovery phrase|password|private key|2fa)\b/.test(t)) {
    return done({ intent: 'UNKNOWN', rejectedReason: 'HELM never moves funds or handles secrets', confidence: 1 })
  }

  const notional = t.match(new RegExp(String.raw`\$\s?${num}|${num}\s?(?:dollars?|bucks|usd|usdt)\b|${num}\s?dollar\b`))
  const notionalVal = notional ? (notional[1] ?? notional[2] ?? notional[3]) : null
  const lev = t.match(new RegExp(String.raw`${num}\s?(?:x|times)\b(?:\s+leverage)?|leverage\s+(?:of\s+)?${num}`))
  const levVal = lev ? (lev[1] ?? lev[2]) : null
  const stop = t.match(new RegExp(String.raw`stop(?:\s+loss)?\s+(?:at\s+)?${num}\s?(?:percent|%)\s+(?:below|under|beneath|above)`))
  const shares = t.match(new RegExp(String.raw`${num}\s+shares?`))
  const qty = t.match(new RegExp(String.raw`(?<![$\d.]\s?)${num}\s+(?:btc|bitcoin|eth|ether|sol|solana)\b`))
  const pctMatch = t.match(new RegExp(String.raw`${num}\s?(?:percent|%)`))
  const fraction = /\bhalf\b/.test(t) ? '0.5' : /\bquarter\b/.test(t) ? '0.25' : /\b(all|entire|whole|full)\b/.test(t) ? '1' : pctMatch && !stop ? String(Number(pctMatch[1]) / 100) : null

  // ----- queries -----
  if (/\bwhat (happens|if)\b|\bstress\b|\bif\b.*\b(falls?|drops?|rises?|jumps?|crash(es)?)\b/.test(t) && pctMatch) {
    const down = /\b(falls?|drops?|down|crash(es)?|declines?)\b/.test(t)
    return done({ intent: 'STRESS_TEST', shockPercent: `${down ? '-' : ''}${pctMatch[1]}`, confidence: base.asset ? 0.9 : 0.6, clarificationNeeded: base.asset ? [] : ['instrument'] })
  }
  if (/\b(unprotected|no (protective )?stop|without (a )?stop)\b/.test(t)) return done({ intent: 'QUERY_UNPROTECTED', confidence: 0.95 })
  if (/\bcompare\b/.test(t)) return done({ intent: 'COMPARE_VENUES', side: /\bsell/.test(t) ? 'SELL' : 'BUY', confidence: base.asset ? 0.9 : 0.6, clarificationNeeded: base.asset ? [] : ['instrument'] })
  if (/\b(emergency|panic)\b|\bclose (everything|all)\b|\bcancel (everything|all)\b/.test(t)) return done({ intent: 'EMERGENCY_REVIEW', confidence: 0.95 })
  if (/\bexposure\b|\bwhich exchange has\b|\blargest\b/.test(t)) return done({ intent: 'QUERY_EXPOSURE', confidence: 0.9 })
  if (/\bbalance\b|\bhow much (cash|money|usdt|usd)\b|\bbuying power\b/.test(t)) return done({ intent: 'QUERY_BALANCE', confidence: 0.9 })
  if (/\bopen orders?\b|\bpending orders?\b(?!.*\bcancel)|\bmy orders\b/.test(t) && !/\bcancel\b/.test(t)) return done({ intent: 'QUERY_ORDERS', confidence: 0.9 })
  if (/\bportfolio\b/.test(t) && !/\bstock portfolio\b/.test(t)) return done({ intent: 'QUERY_PORTFOLIO', confidence: 0.9 })
  if (/\b(show|list|what are|display)\b.*\b(positions?|trades?|holdings?|portfolio)\b/.test(t)) return done({ intent: 'QUERY_POSITIONS', confidence: 0.9 })

  // ----- actions -----
  if (/\bcancel\b/.test(t)) return done({ intent: 'CANCEL_ORDER', confidence: base.asset ? 0.9 : 0.6, clarificationNeeded: base.asset ? [] : ['position'] })
  if (/\b(stop|protect|protection)\b/.test(t) && /\b(prepare|set|add|put|place)\b/.test(t) && !/\b(buy|sell|open)\b/.test(t)) {
    return done({ intent: 'PREPARE_PROTECTION', stopOffsetPercent: stop?.[1] ?? null, confidence: base.asset ? 0.85 : 0.5, clarificationNeeded: base.asset ? [] : ['position'] })
  }
  if (/\b(close|reduce|trim|cut)\b/.test(t)) {
    const f = fraction ?? (/\bclose\b/.test(t) ? '1' : null)
    const clar: TradeIntent['clarificationNeeded'] = []
    if (!base.asset) clar.push('position')
    if (!f) clar.push('quantity')
    return done({ intent: f === '1' ? 'CLOSE_POSITION' : 'REDUCE_POSITION', fraction: f, product: base.product ?? (base.asset && STOCKS.has(base.asset) ? 'stock' : null), confidence: clar.length ? 0.6 : 0.9, clarificationNeeded: clar })
  }
  const buy = /\b(buy|long|go long|purchase)\b/.test(t), sell = /\b(sell|short|go short)\b/.test(t)
  if (buy || sell || /\bopen\b/.test(t)) {
    const side = sell && !buy ? 'SELL' : buy && !sell ? 'BUY' : null
    const clar: TradeIntent['clarificationNeeded'] = []
    if (!base.asset) clar.push('instrument')
    if (!side) clar.push('side')
    const q = shares?.[1] ?? qty?.[1] ?? null
    if (!q && !notionalVal && !(sell && fraction)) clar.push('quantity')
    if (!base.provider) clar.push('account') // resolved later against connected accounts; may auto-resolve if only one fits
    const limit = t.match(new RegExp(String.raw`\b(?:at|limit(?: price)?(?: of)?)\s+\$?${num}(?!\s?(?:percent|%))`))
    return done({
      intent: 'PLACE_ORDER', side, product: base.product ?? (base.asset ? 'spot' : null), quantity: q, notional: q ? null : notionalVal, fraction: !q && !notionalVal ? fraction : null,
      leverage: levVal, stopOffsetPercent: stop?.[1] ?? null, orderType: limit ? 'LIMIT' : 'MARKET', limitPrice: limit?.[1] ?? null,
      confidence: clar.filter(c => c !== 'account').length === 0 ? 0.92 : 0.6, clarificationNeeded: clar,
    })
  }
  return done({ intent: 'UNKNOWN', confidence: 0.2 })
}

export interface IntentModel { id: string; parse(transcript: string): Promise<unknown> }

/** Deterministic first; an optional model is consulted only for UNKNOWN, and its output is validated + sanitised. */
export async function parseIntent(transcript: string, model?: IntentModel): Promise<{ intent: TradeIntent; parser: 'deterministic' | string }> {
  const d = parseDeterministic(transcript)
  if (d.intent !== 'UNKNOWN' || d.rejectedReason || !model) return { intent: d, parser: 'deterministic' }
  try {
    const raw = await model.parse(normalise(transcript))
    const r = TradeIntentSchema.safeParse({ ...(raw as object), transcript: transcript.slice(0, 500), requiresConfirmation: true, accountId: null })
    if (!r.success) return { intent: d, parser: 'deterministic' }
    // A model may never raise its own confidence above a deterministic parse nor skip confirmation.
    return { intent: { ...r.data, confidence: Math.min(r.data.confidence, 0.8) }, parser: model.id }
  } catch {
    return { intent: d, parser: 'deterministic' }
  }
}
