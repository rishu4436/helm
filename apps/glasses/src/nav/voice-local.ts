import { resolveContextual } from '@helm/voice-engine/context'
import type { Acct, PortfolioPayload } from '../ux/types'
import type { VoiceContext, VoiceResult } from './backend'

/** Local (in-browser) contextual resolution for the sample/practice backends — the same resolver the API runs. */
export function resolveVoiceLocally(transcript: string, ctx: VoiceContext, accts: Acct[], p: PortfolioPayload, stt: { sttProvider: string; sttLabel: string | null }): VoiceResult {
  const r = resolveContextual(transcript, ctx, accts.map(a => ({ id: a.id, alias: a.alias, provider: a.provider, environment: a.environment, canTrade: a.canTrade, products: a.products })), p.positions.map(x => ({ accountId: x.accountId, instrumentId: x.instrumentId, side: x.side, quantity: x.quantity })))
  return { transcript, ...stt, interpretation: r.interpretation, action: r.action as VoiceResult['action'] }
}
