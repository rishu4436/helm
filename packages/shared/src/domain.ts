import { z } from 'zod'
import type { Decimal } from './decimal'
import type { Environment, ProviderId } from './providers'
import type { Instrument, InstrumentId, ProductType } from './instruments'

export type Side = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT' | 'TAKE_PROFIT_MARKET' | 'TAKE_PROFIT_LIMIT'
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'DAY'
export type AccountType = 'spot' | 'futures_usdm' | 'unified' | 'brokerage' | 'portfolio'

/** Provider-qualified identity: provider + environment + provider account id. */
export interface ExchangeAccount {
  id: string // HELM internal id
  userId: string
  provider: ProviderId
  environment: Environment
  accountType: AccountType
  providerAccountId: string
  alias: string
  createdAt: string
}

export interface Balance {
  accountId: string
  asset: string
  free: Decimal
  locked: Decimal
  total: Decimal
  asOf: string
  source: ProviderId
}

export interface AssetValuation {
  asset: string
  amount: Decimal
  reportingCurrency: string
  /** null = HELM could not obtain a trustworthy rate: show as unvalued, never guess. */
  value: Decimal | null
  rate: Decimal | null
  rateSource: string | null
  rateTimestamp: string | null
  method: 'direct_quote' | 'cross_rate' | 'stablecoin_par' | 'unvalued'
}

export type PositionSide = 'LONG' | 'SHORT' | 'NET'
export type PositionMode = 'one_way' | 'hedge'
export type MarginMode = 'cross' | 'isolated' | 'cash'

export interface Position {
  accountId: string
  instrumentId: InstrumentId
  provider: ProviderId
  product: ProductType
  side: PositionSide
  /** Signed for NET positions (negative = short). Units per Instrument.quantityUnit. */
  quantity: Decimal
  entryPrice: Decimal | null
  markPrice: Decimal | null
  notional: Decimal | null
  unrealizedPnl: Decimal | null
  realizedPnl: Decimal | null
  leverage: Decimal | null
  liquidationPrice: Decimal | null
  marginMode: MarginMode | null
  positionMode: PositionMode | null
  /** Set only where balances EXCLUDE the position's isolated margin (HELM simulator); avoids double counting. */
  isolatedMargin?: Decimal | null
  asOf: string
  raw?: unknown
}

export type OrderStatus =
  | 'DRAFT' | 'VALIDATED' | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'SUBMITTING'
  | 'ACCEPTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED'
  | 'UNKNOWN' | 'RECONCILING'

export interface Order {
  accountId: string
  provider: ProviderId
  instrumentId: InstrumentId
  providerOrderId: string | null
  clientOrderId: string
  side: Side
  type: OrderType
  timeInForce: TimeInForce | null
  quantity: Decimal | null
  quoteQuantity: Decimal | null
  price: Decimal | null
  stopPrice: Decimal | null
  reduceOnly: boolean
  status: OrderStatus
  filledQuantity: Decimal
  avgFillPrice: Decimal | null
  createdAt: string
  updatedAt: string
  /** True for Coinbase static sandbox responses: these are mocked, never real fills. */
  simulatedStatic?: boolean
  /** True for HELM local-simulator orders: fills computed by HELM from public prices, never sent to an exchange. */
  simulatedLocal?: boolean
  raw?: unknown
}

export interface Fill {
  accountId: string
  provider: ProviderId
  instrumentId: InstrumentId
  providerOrderId: string
  providerTradeId: string
  side: Side
  price: Decimal
  quantity: Decimal
  fee: Decimal | null
  feeAsset: string | null
  isMaker: boolean | null
  timestamp: string
  simulatedStatic?: boolean
  simulatedLocal?: boolean
  raw?: unknown
}

/** Execution = one provider-reported execution event (may aggregate fills). */
export interface Execution {
  orderClientId: string
  providerOrderId: string | null
  status: OrderStatus
  fills: Fill[]
  reportedAt: string
}

export interface OrderBookLevel { price: Decimal; quantity: Decimal }
export interface OrderBook {
  provider: ProviderId
  instrumentId: InstrumentId
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  timestamp: string
  receivedAt: string
}

export interface MarketSnapshot {
  provider: ProviderId
  instrumentId: InstrumentId
  bid: Decimal | null
  ask: Decimal | null
  last: Decimal | null
  volume24h: Decimal | null
  timestamp: string
  receivedAt: string
}

export interface PortfolioSnapshot {
  userId: string
  reportingCurrency: string
  /** Cash-equivalent value (balances, spot, stocks). Derivative notional is NOT added here. */
  netLiquidationValue: Decimal
  grossDerivativeExposure: Decimal
  unvaluedAssets: string[]
  valuations: AssetValuation[]
  positions: Position[]
  asOf: string
}

// ---------- Trade intent (typed, validated — produced by voice/LLM or UI, never executed directly) ----------

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'positive decimal string')

export const TradeIntentSchema = z.object({
  intent: z.enum(['QUERY_POSITIONS', 'QUERY_BALANCE', 'QUERY_EXPOSURE', 'QUERY_ORDERS', 'QUERY_UNPROTECTED', 'QUERY_PORTFOLIO', 'STRESS_TEST', 'COMPARE_VENUES', 'EMERGENCY_REVIEW', 'PLACE_ORDER', 'CLOSE_POSITION', 'REDUCE_POSITION', 'CANCEL_ORDER', 'PREPARE_PROTECTION', 'UNKNOWN']),
  provider: z.enum(['binance', 'okx', 'bybit', 'coinbase', 'ibkr', 'alpaca']).nullable(),
  accountId: z.string().nullable(),
  asset: z.string().max(16).nullable(),
  product: z.enum(['spot', 'perp', 'future', 'stock', 'option']).nullable(),
  side: z.enum(['BUY', 'SELL']).nullable(),
  orderType: z.enum(['MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT', 'TAKE_PROFIT_MARKET', 'TAKE_PROFIT_LIMIT']).nullable(),
  quantity: decimalString.nullable(),
  notional: decimalString.nullable(),
  fraction: decimalString.nullable(),
  leverage: decimalString.nullable(),
  limitPrice: decimalString.nullable(),
  stopOffsetPercent: decimalString.nullable(),
  shockPercent: z.string().regex(/^-?\d+(\.\d+)?$/).nullable(),
  rejectedReason: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
  clarificationNeeded: z.array(z.enum(['account', 'instrument', 'quantity', 'side', 'position', 'price'])),
  requiresConfirmation: z.literal(true),
  transcript: z.string().max(500),
})
export type TradeIntent = z.infer<typeof TradeIntentSchema>

export interface OrderRequest {
  accountId: string
  instrument: Instrument
  side: Side
  type: OrderType
  quantity?: Decimal
  quoteQuantity?: Decimal
  price?: Decimal
  stopPrice?: Decimal
  timeInForce?: TimeInForce
  reduceOnly?: boolean
  positionSide?: PositionSide
  leverage?: Decimal
  clientOrderId: string
}

export interface OrderPreview {
  id: string
  request: OrderRequest
  estimatedPrice: Decimal | null
  estimatedNotional: Decimal | null
  estimatedFee: Decimal | null
  estimatedSlippageBps: Decimal | null
  requiredMargin: Decimal | null
  remainingBuyingPower: Decimal | null
  /** Every estimate must declare where it came from. */
  estimateNotes: string[]
  createdAt: string
  expiresAt: string
  providerPreview?: unknown
}

export type RiskVerdict = 'ALLOW' | 'WARN' | 'BLOCK'
export interface RiskFinding { rule: string; verdict: RiskVerdict; message: string; limit?: string; actual?: string }
export interface RiskAssessment { verdict: RiskVerdict; findings: RiskFinding[]; policyVersion: number; assessedAt: string }

export type ProtectionState = 'PLANNED' | 'ENTRY_SUBMITTED' | 'ENTRY_PARTIAL' | 'ENTRY_FILLED' | 'PROTECTION_SUBMITTED' | 'PROTECTED' | 'UNPROTECTED' | 'CANCELED' | 'FAILED'
export interface ProtectionPlan {
  id: string
  accountId: string
  instrumentId: InstrumentId
  entryClientOrderId: string
  stopOffsetPercent: Decimal | null
  stopPrice: Decimal | null
  protectedQuantity: Decimal
  state: ProtectionState
  protectionClientOrderId: string | null
  updatedAt: string
}
