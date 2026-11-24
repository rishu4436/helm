import {
  AlpacaPaperAdapter, BinanceAdapter, BybitAdapter, CoinbaseSandboxAdapter, IbkrGatewayAdapter, OkxAdapter, type FetchLike,
} from '@helm/connectors'
import { HelmError, PROVIDER_INFO, type ExchangeAdapter, type ProviderId } from '@helm/shared'
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

export type AdapterFactory = (provider: ProviderId, creds: Record<string, string>, accountId: string) => ExchangeAdapter

export function alpacaEnabled(env: NodeJS.ProcessEnv = process.env) { return env.HELM_ENABLE_ALPACA === 'true' }

export function makeAdapterFactory(fetchImpl?: FetchLike, env: NodeJS.ProcessEnv = process.env): AdapterFactory {
  return (provider, c, accountId) => {
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
