/** JSON payload shapes the glasses consume (Decimals arrive as strings). Shared by the G2 app, Vision and the landing demo. */
export type Env = 'demo' | 'paper' | 'sandbox_static' | 'simulated' | string

export interface Acct { id: string; alias: string; provider: string; environment: Env; environmentLabel: string; state: string; canTrade: boolean; products: string[]; label: string | null; reasons?: string[] }

export interface PAccount {
  accountId: string; alias: string; provider: string; environment: Env; state: string
  valueUsd: string; unvalued?: string[]; derivativeNotionalUsd?: string; unrealizedPnlUsd?: string
  positions?: number; openOrders?: number; error?: string
  /** Free stablecoin balance (spot) or available margin (derivatives) where the venue reports it. */
  availableUsd?: string | null
}
export interface PPosition {
  accountId: string; instrumentId: string; provider?: string; product?: string; side: string; quantity: string
  entryPrice?: string | null; markPrice?: string | null; notional?: string | null; unrealizedPnl?: string | null
  leverage?: string | null; liquidationPrice?: string | null; marginMode?: string | null; isolatedMargin?: string | null; asOf?: string
}
export interface POrder { accountId: string; instrumentId: string; side: string; type: string; quantity?: string | null; price?: string | null; stopPrice?: string | null; reduceOnly?: boolean; status?: string; providerOrderId?: string | null }
export interface PHolding { accountId: string; asset: string; free: string; locked: string; total: string; valueUsd: string | null }
export interface PExposure { asset: string; spotUsd: string; derivativesNetUsd?: string; netDirectionalUsd: string; grossUsd?: string; byAccount?: Array<{ accountId?: string; alias: string; kind: string; usd: string; side?: string }> }
export interface PortfolioPayload {
  netLiquidationUsd?: string; unrealizedPnlUsd?: string; accounts: PAccount[]; exposures: PExposure[]; positions: PPosition[]
  openOrders?: POrder[]; holdings?: PHolding[]; asOf?: string; unvaluedAssets?: string[]
}

export interface ActivityAction { kind: 'position' | 'protect' | 'receipt' | 'account' | 'reconcile' | 'market' | 'ack' | 'dismiss'; label: string; accountId?: string; instrumentId?: string; orderId?: string; asset?: string }
export interface ActivityItem {
  id: string; kind: string; severity: number; title: string; detail: string
  accountId?: string | null; account?: string | null; instrumentId?: string | null; asset?: string | null
  at: string; state: 'current' | 'recent' | 'resolved'; relevant: boolean; count?: number; acknowledged?: boolean; dismissible?: boolean
  actions: ActivityAction[]
}
export interface ActivityPayload { current: ActivityItem[]; recent: ActivityItem[]; resolved: ActivityItem[]; asOf: string }

export interface VenueQuote { venue: string; source?: string; instrumentId?: string; bid: string | null; ask: string | null; spreadBps: string | null; depthUsd10bps?: string | null; ageMs?: number | null; impactBps?: string | null; estCostBps?: string | null; error?: string }
export interface Snapshot { asset: string; price: string | null; change24hPct: string | null; period: string; candles: { interval: string; closes: string[]; source: string } | null; source: string; at: string | null }
export interface WatchItem { asset: string; price: string | null; change24hPct?: string | null; at?: string | null }

export interface Prefs {
  mode: 'beginner' | 'pro'
  homeMode: 'auto' | 'spot' | 'futures' | 'multi'
  reportingCurrency: 'USD'
  preferredExchange: string | null
  watchlist: string[]
  metrics: Array<'value' | 'pnl' | 'positions' | 'health'>
  alertSensitivity: 'all' | 'normal' | 'critical'
  privacy: boolean
  deckOrder: string[]
  deckFavorites: string[]
  sizePresets: string[]
  onboarding: { completedAt: string | null; skippedAt: string | null; stage: string | null }
  companionDraft?: { asset: string; notional: string; accountId?: string | null; expiresAt: string } | null
}

export const DEFAULT_DECK = ['portfolio', 'positions', 'allocation', 'watchlist', 'largest', 'risk', 'activity', 'voice'] as const
export const BEGINNER_DECK = ['portfolio', 'positions', 'watchlist', 'activity', 'voice'] as const
export const DEFAULT_PREFS: Prefs = {
  mode: 'beginner', homeMode: 'auto', reportingCurrency: 'USD', preferredExchange: null, watchlist: ['BTC', 'ETH', 'SOL', 'BNB'],
  metrics: ['value', 'pnl', 'positions', 'health'], alertSensitivity: 'normal', privacy: false, deckOrder: [...DEFAULT_DECK], deckFavorites: [],
  sizePresets: ['25', '50', '100', '250'], onboarding: { completedAt: null, skippedAt: null, stage: null }, companionDraft: null,
}
export function withDefaults(p: Partial<Prefs> | null | undefined): Prefs {
  return { ...DEFAULT_PREFS, ...(p ?? {}), onboarding: { ...DEFAULT_PREFS.onboarding, ...(p?.onboarding ?? {}) } }
}
