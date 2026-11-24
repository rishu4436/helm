import { CapabilityError } from './errors'
import type { AccountType, OrderType } from './domain'
import type { Environment, ProviderId } from './providers'
import type { ProductType } from './instruments'

export const ADAPTER_OPERATIONS = [
  'connect', 'disconnect', 'getConnectionState', 'getCapabilities',
  'getBalances', 'getEquity', 'getPositions', 'getOpenOrders', 'getOrderHistory', 'getFills',
  'getMarketSnapshot', 'getOrderBook', 'getInstruments',
  'validateOrder', 'previewOrder', 'submitOrder', 'cancelOrder', 'amendOrder', 'reconcileOrder',
  'setLeverage', 'subscribeAccount', 'subscribeMarket',
] as const
export type AdapterOperation = (typeof ADAPTER_OPERATIONS)[number]

export interface CapabilityManifest {
  provider: ProviderId
  environment: Environment
  accountTypes: AccountType[]
  permissions: { read: boolean; trade: boolean; withdraw: false }
  products: ProductType[]
  spot: boolean
  futures: boolean
  stocks: boolean
  orderTypes: OrderType[]
  reduceOnly: boolean
  hedgeMode: boolean
  margin: boolean
  cancelReplace: boolean
  streaming: { market: boolean; account: boolean }
  /** demo = real matching engine; static = canned responses (Coinbase sandbox) */
  simulation: 'demo_matching_engine' | 'paper_broker' | 'static_responses' | 'local_simulation'
  operations: AdapterOperation[]
  restrictions: string[]
  /** Facts below this line were verified against docs/endpoints, not live credentials, unless stated. */
  verification: 'documented' | 'verified_with_credentials'
}

export function supports(m: CapabilityManifest, op: AdapterOperation): boolean {
  return m.operations.includes(op)
}

export function assertCapability(m: CapabilityManifest, op: AdapterOperation): void {
  if (!supports(m, op)) throw new CapabilityError(m.provider, op)
}

export function assertOrderTypeSupported(m: CapabilityManifest, type: OrderType): void {
  if (!m.orderTypes.includes(type)) throw new CapabilityError(m.provider, `order type ${type}`)
}

export function assertTradeable(m: CapabilityManifest): void {
  if (!m.permissions.trade) throw new CapabilityError(m.provider, 'trading', 'connection is read-only')
}
