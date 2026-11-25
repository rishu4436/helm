/** LiveBackend — the G2 app talking to the HELM API with its device token (never exchange secrets). */
import { call, type PreviewResp, type Receipt, type Ticket } from '../api'
import type { Acct, ActivityPayload, PortfolioPayload, Prefs, Snapshot, VenueQuote, WatchItem } from '../ux/types'
import { withDefaults } from '../ux/types'
import type { HelmBackend, VoiceContext, VoiceResult } from './backend'

export class LiveBackend implements HelmBackend {
  readonly kind = 'live' as const
  constructor(private readonly token: () => string, readonly canExecute = true, private readonly via: 'glasses' | 'companion' = 'glasses') {}
  private get<T>(path: string) { return call<T>(path, { token: this.token() }).then(r => r.data) }
  private send<T>(method: string, path: string, body: unknown, timeoutMs?: number) { return call<T>(path, { method, body, token: this.token(), timeoutMs }).then(r => r.data) }

  accounts() { return this.get<{ accounts: Acct[] }>('/v1/accounts').then(r => r.accounts) }
  portfolio() { return this.get<{ portfolio: PortfolioPayload; accountErrors: Array<{ accountId: string; error: string }> }>('/v1/portfolio') }
  activity() { return this.get<ActivityPayload>('/v1/activity') }
  async ackEvent(id: string) { await this.send('POST', `/v1/activity/${encodeURIComponent(id)}/ack`, {}) }
  async dismissEvent(id: string) { await this.send('POST', `/v1/activity/${encodeURIComponent(id)}/dismiss`, {}) }
  watchlist(assets: string[]) { return this.get<{ items: WatchItem[] }>(`/v1/markets/watchlist?assets=${encodeURIComponent(assets.join(','))}`).then(r => r.items) }
  snapshot(asset: string) { return this.get<Snapshot>(`/v1/markets/${encodeURIComponent(asset)}/snapshot`) }
  venues(asset: string, product: 'spot' | 'perp', sizeUsd?: number | null) { return this.get<{ venues: VenueQuote[] }>(`/v1/markets/${encodeURIComponent(asset)}?product=${product}${sizeUsd ? `&notional=${sizeUsd}` : ''}`).then(r => r.venues) }
  preview(t: Ticket) { return this.send<PreviewResp>('POST', '/v1/trade/preview', t) }
  protectPreview(b: { accountId: string; instrumentId: string; stopOffsetPercent: string }) { return this.send<PreviewResp>('POST', '/v1/protection/preview', b) }
  confirm(p: PreviewResp, idempotencyKey: string) {
    if (!this.canExecute) return Promise.reject(Object.assign(new Error('Read-only mirror'), { code: 'READ_ONLY' }))
    return this.send<{ receipt: Receipt }>('POST', '/v1/trade/confirm', { proposalId: p.proposalId, confirmToken: p.confirmToken, idempotencyKey, via: this.via }, 45000)
  }
  refreshOrder(orderId: string) { return this.get<{ receipt: Receipt }>(`/v1/orders/${encodeURIComponent(orderId)}`).then(r => r.receipt) }
  receipts() { return this.get<{ receipts: Receipt[] }>('/v1/receipts').then(r => r.receipts) }
  compass() { return this.get<{ compass: any; netLiquidationUsd: string }>('/v1/shield/compass') }
  policy() { return this.get<{ policy: Record<string, string>; version: number }>('/v1/shield/policy') }
  emergency() { return this.get<{ items: Array<{ kind: string; accountId: string; instrumentId: string; detail: string }> }>('/v1/emergency').then(r => r.items) }
  recipes() { return this.get<{ builtins: Array<{ id: string; name: string; definition: { description?: string } }>; recipes: Array<{ id: string; name: string; definition: { description?: string } }> }>('/v1/recipes').then(r => [...r.builtins, ...r.recipes].map(x => ({ id: x.id, name: x.name, summary: x.definition?.description ?? '' }))) }
  prefs() { return this.get<{ preferences: Partial<Prefs> }>('/v1/preferences').then(r => withDefaults(r.preferences)) }
  savePrefs(patch: Partial<Prefs>) { return this.send<{ preferences: Partial<Prefs> }>('PUT', '/v1/preferences', patch).then(r => withDefaults(r.preferences)) }
  async setActive(accountId: string) { await this.send('POST', '/v1/device/active-account', { accountId }) }
  voice(input: { transcript?: string; audioBase64?: string; sampleRate?: number }, ctx: VoiceContext) { return this.send<VoiceResult>('POST', '/v1/voice/command', { ...input, context: ctx }, 40000) }
}
