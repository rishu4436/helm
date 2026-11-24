import type { ProviderId, TradeIntent } from '@helm/shared'

export interface ResolvableAccount { id: string; alias: string; provider: ProviderId; environment: string; canTrade: boolean; products: string[] }
export type Resolution =
  | { status: 'resolved'; account: ResolvableAccount; reason: string }
  | { status: 'clarify'; question: string; options: ResolvableAccount[] }
  | { status: 'none'; message: string }

/** Account resolution. Never guesses between several eligible accounts ("Which exchange?"). */
export function resolveAccount(intent: TradeIntent, accounts: ResolvableAccount[], activeAccountId?: string | null): Resolution {
  if (intent.accountId) {
    const a = accounts.find(x => x.id === intent.accountId)
    return a ? { status: 'resolved', account: a, reason: 'Chosen by you' } : { status: 'none', message: 'That account is not connected' }
  }
  const trading = ['PLACE_ORDER', 'CLOSE_POSITION', 'REDUCE_POSITION', 'CANCEL_ORDER', 'PREPARE_PROTECTION'].includes(intent.intent)
  const product = intent.product ?? (trading ? 'spot' : null)
  let pool = accounts.filter(a => (!intent.provider || a.provider === intent.provider) && (!trading || a.canTrade) && (!product || a.products.includes(product)))
  if (pool.length === 0) {
    const who = intent.provider ? `${intent.provider.toUpperCase()} ` : ''
    return { status: 'none', message: `No connected ${who}account can ${trading ? 'trade' : 'show'} ${product ?? 'this'}` }
  }
  if (pool.length === 1) return { status: 'resolved', account: pool[0]!, reason: intent.provider ? 'Named in your command' : 'Only eligible account' }
  // Several eligible: the active device account is NOT used to silently pick a trading venue.
  if (!trading && activeAccountId) { const a = pool.find(x => x.id === activeAccountId); if (a) return { status: 'resolved', account: a, reason: 'Active account' } }
  pool = pool.slice(0, 6)
  return { status: 'clarify', question: 'Which exchange?', options: pool }
}
