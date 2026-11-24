export const PROVIDERS = ['binance', 'okx', 'bybit', 'coinbase', 'ibkr', 'alpaca'] as const
export type ProviderId = (typeof PROVIDERS)[number]

/**
 * Environments. `live` exists only so it can be detected and refused.
 * - demo:          exchange-operated demo trading with a real simulated matching engine (Binance, OKX, Bybit)
 * - paper:         broker paper account (IBKR paper, Alpaca paper)
 * - sandbox_static: predefined mocked responses (Coinbase Advanced Trade sandbox) — never real fills
 */
export const ENVIRONMENTS = ['demo', 'paper', 'sandbox_static', 'live'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export interface ProviderInfo {
  id: ProviderId
  name: string
  assetClasses: Array<'crypto_spot' | 'crypto_derivatives' | 'stocks'>
  /** Environment HELM uses for this provider during the hackathon. */
  hackathonEnvironment: Exclude<Environment, 'live'>
  /** Whether the provider is in the official DoraHacks "Exchanges & Stocks" track app list (verified 2026-11-24). */
  trackEligible: boolean
  connectionMethod: 'api_key' | 'api_key_passphrase' | 'static_sandbox' | 'local_gateway'
  notes: string
}

export const PROVIDER_INFO: Record<ProviderId, ProviderInfo> = {
  binance: {
    id: 'binance', name: 'Binance', assetClasses: ['crypto_spot', 'crypto_derivatives'],
    hackathonEnvironment: 'demo', trackEligible: true, connectionMethod: 'api_key',
    notes: 'Demo Trading keys from demo.binance.com. Spot: demo-api.binance.com, USDⓈ-M: demo-fapi.binance.com.',
  },
  okx: {
    id: 'okx', name: 'OKX', assetClasses: ['crypto_spot', 'crypto_derivatives'],
    hackathonEnvironment: 'demo', trackEligible: true, connectionMethod: 'api_key_passphrase',
    notes: 'Demo Trading API key + secret + passphrase; every request carries x-simulated-trading: 1.',
  },
  bybit: {
    id: 'bybit', name: 'Bybit', assetClasses: ['crypto_spot', 'crypto_derivatives'],
    hackathonEnvironment: 'demo', trackEligible: true, connectionMethod: 'api_key',
    notes: 'Demo Trading key created inside the Demo Trading account; REST api-demo.bybit.com.',
  },
  coinbase: {
    id: 'coinbase', name: 'Coinbase Advanced Trade', assetClasses: ['crypto_spot'],
    hackathonEnvironment: 'sandbox_static', trackEligible: true, connectionMethod: 'static_sandbox',
    notes: 'Static sandbox (api-sandbox.coinbase.com) returns predefined mocked responses. Never shown as real fills.',
  },
  ibkr: {
    id: 'ibkr', name: 'Interactive Brokers', assetClasses: ['stocks'],
    hackathonEnvironment: 'paper', trackEligible: true, connectionMethod: 'local_gateway',
    notes: 'Client Portal Gateway on localhost with a paper-account login; HELM never sees the brokerage password.',
  },
  alpaca: {
    id: 'alpaca', name: 'Alpaca', assetClasses: ['stocks'],
    hackathonEnvironment: 'paper', trackEligible: false, connectionMethod: 'api_key',
    notes: 'NOT in the official Exchanges & Stocks track app list. Disabled by default (HELM_ENABLE_ALPACA) pending organizer permission.',
  },
}
