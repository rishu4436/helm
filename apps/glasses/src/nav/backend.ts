import type { PreviewResp, Receipt, Ticket } from '../api'
import type { Acct, ActivityPayload, PortfolioPayload, Prefs, Snapshot, VenueQuote, WatchItem } from '../ux/types'

/** Voice context sent with every command so "this position" / "make it fifty" bind to explicit state, never a guess. */
export interface VoiceContext {
  screen: string
  accountId?: string | null
  asset?: string | null
  positionKey?: string | null
  draft?: Partial<Ticket> | null
  proposalId?: string | null
  eventId?: string | null
}
export type VoiceAction =
  | { kind: 'navigate'; target: 'home' | 'portfolio' | 'positions' | 'holdings' | 'account' | 'position' | 'market' | 'venues' | 'activity' | 'receipt' | 'unprotected' | 'risk' | 'emergency' | 'liquidation'; accountId?: string; asset?: string; positionKey?: string; providers?: string[] }
  | { kind: 'propose'; ticket: Ticket; summary: string }
  | { kind: 'protect'; accountId: string; instrumentId: string; stopOffsetPercent: string; summary: string }
  | { kind: 'clarify'; question: string; options: Array<{ id: string; label: string }>; field: 'account' | 'asset' | 'position' | 'size' }
  | { kind: 'reject'; message: string }
export interface VoiceResult { transcript: string; sttProvider: string; sttLabel: string | null; interpretation: string; action: VoiceAction }

/** Everything the controller needs from HELM. The G2 app implements it over HTTP; the landing demo and onboarding practice implement it locally. */
export interface HelmBackend {
  readonly kind: 'live' | 'sample' | 'practice'
  /** Whether confirmations may execute (false in read-only mirrors). */
  readonly canExecute: boolean
  accounts(): Promise<Acct[]>
  portfolio(): Promise<{ portfolio: PortfolioPayload; accountErrors: Array<{ accountId: string; error: string }> }>
  activity(): Promise<ActivityPayload>
  ackEvent(id: string): Promise<void>
  dismissEvent(id: string): Promise<void>
  watchlist(assets: string[]): Promise<WatchItem[]>
  snapshot(asset: string): Promise<Snapshot>
  venues(asset: string, product: 'spot' | 'perp', sizeUsd?: number | null): Promise<VenueQuote[]>
  preview(t: Ticket): Promise<PreviewResp>
  protectPreview(b: { accountId: string; instrumentId: string; stopOffsetPercent: string }): Promise<PreviewResp>
  confirm(p: PreviewResp, idempotencyKey: string): Promise<{ receipt: Receipt }>
  refreshOrder(orderId: string): Promise<Receipt>
  receipts(): Promise<Receipt[]>
  compass(): Promise<{ compass: any; netLiquidationUsd: string }>
  policy(): Promise<{ policy: Record<string, string | number | null | string[]>; version: number }>
  emergency(): Promise<Array<{ kind: string; accountId: string; instrumentId: string; detail: string }>>
  recipes(): Promise<Array<{ id: string; name: string; summary: string }>>
  prefs(): Promise<Prefs>
  savePrefs(patch: Partial<Prefs>): Promise<Prefs>
  setActive(accountId: string): Promise<void>
  voice(input: { transcript?: string; audioBase64?: string; sampleRate?: number }, ctx: VoiceContext): Promise<VoiceResult>
}
