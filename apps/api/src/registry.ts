import {
  AlpacaPaperAdapter, BinanceAdapter, BybitAdapter, CoinbaseSandboxAdapter, IbkrGatewayAdapter, OkxAdapter, SimulatedAdapter, type FetchLike, type MarketSource, type SimStore,
} from '@helm/connectors'
import { HelmError, PROVIDER_INFO, SIM_VENUES, type Environment, type ExchangeAdapter, type ProviderId, type SimVenue } from '@helm/shared'
import { z } from 'zod'

/** Provider-specific credential schemas. No passwords, 2FA codes, recovery phrases or withdrawal keys — ever. */
export const CredentialSchemas = {
  binance: z.object({ apiKey: z.string().min(16).max(128), apiSecret: z.string().min(16).max(128), market: z.enum(['spot', 'usdm']).default('spot') }),
  okx: z.object({ apiKey: z.string().min(16).max(128), apiSecret: z.string().min(16).max(128), passphrase: z.string().min(1).max(64) }),
  bybit: z.object({ apiKey: z.string().min(10).max(128), apiSecret: z.string().min(16).max(128) }),
  coinbase: z.object({}).strict(), // static sandbox: no credentials
  ibkr: z.object({}).strict(), // local Client Portal Gateway session: HELM never collects the brokerage password
  alpaca: z.object({ keyId: z.string().min(10).max(64), secretKey: z.string().min(16).max(128) }),
} as const

export interface FactoryExtras { environment?: Environment; simStore?: SimStore }
export type AdapterFactory = (provider: ProviderId, creds: Record<string, string>, accountId: string, extras?: FactoryExtras) => ExchangeAdapter

export function simulatorEnabled(env: NodeJS.ProcessEnv = process.env) { return env.HELM_ENABLE_SIMULATOR !== 'false' }
export const isSimVenue = (p: ProviderId): p is SimVenue => (SIM_VENUES as readonly string[]).includes(p)

/** Public (unauthenticated) market data per venue — used to price the HELM simulator and valuations. */
export function publicMarket(venue: SimVenue, fetchImpl?: FetchLike): MarketSource {
  const none = { apiKey: 'public', apiSecret: 'public' }
  const spot = venue === 'binance' ? new BinanceAdapter(none, { market: 'spot', accountId: 'public', fetch: fetchImpl }) : venue === 'okx' ? new OkxAdapter({ ...none, passphrase: 'public' }, { accountId: 'public', fetch: fetchImpl }) : new BybitAdapter(none, { accountId: 'public', fetch: fetchImpl })
  const perp = venue === 'binance' ? new BinanceAdapter(none, { market: 'usdm', accountId: 'public', fetch: fetchImpl }) : spot
  return { getOrderBook: (id, depth) => (id.includes(':perp:') ? perp : spot).getOrderBook(id, depth) }
}

export function alpacaEnabled(env: NodeJS.ProcessEnv = process.env) { return env.HELM_ENABLE_ALPACA === 'true' }

export function makeAdapterFactory(fetchImpl?: FetchLike, env: NodeJS.ProcessEnv = process.env): AdapterFactory {
  return (provider, c, accountId, extras) => {
    if (extras?.environment === 'simulated') {
      if (!simulatorEnabled(env)) throw new HelmError('UNSUPPORTED_OPERATION', 'HELM simulator disabled (HELM_ENABLE_SIMULATOR=false)')
      if (!isSimVenue(provider) || !extras.simStore) throw new HelmError('UNSUPPORTED_OPERATION', `No simulator for ${provider}`)
      return new SimulatedAdapter({ venue: provider, accountId, market: publicMarket(provider, fetchImpl), store: extras.simStore })
    }
    switch (provider) {
      case 'binance': return new BinanceAdapter({ apiKey: c.apiKey!, apiSecret: c.apiSecret! }, { market: (c.market as 'spot' | 'usdm') ?? 'spot', accountId, fetch: fetchImpl })
      case 'okx': return new OkxAdapter({ apiKey: c.apiKey!, apiSecret: c.apiSecret!, passphrase: c.passphrase! }, { accountId, fetch: fetchImpl })
      case 'bybit': return new BybitAdapter({ apiKey: c.apiKey!, apiSecret: c.apiSecret! }, { accountId, fetch: fetchImpl })
      case 'coinbase': return new CoinbaseSandboxAdapter({ accountId, fetch: fetchImpl })
      case 'ibkr': return new IbkrGatewayAdapter({ accountId, fetch: fetchImpl })
      case 'alpaca':
        if (!alpacaEnabled(env)) throw new HelmError('UNSUPPORTED_OPERATION', 'Alpaca is not in the official track list and is disabled (HELM_ENABLE_ALPACA)', { provider: 'alpaca' })
        return new AlpacaPaperAdapter({ keyId: c.keyId!, secretKey: c.secretKey! }, { accountId, fetch: fetchImpl })
    }
  }
}

export function providerCatalog(env: NodeJS.ProcessEnv = process.env) {
  return Object.values(PROVIDER_INFO).map(p => ({ ...p, enabled: p.id !== 'alpaca' || alpacaEnabled(env) }))
}
