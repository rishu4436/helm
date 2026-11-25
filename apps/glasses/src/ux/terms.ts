/**
 * HELM terminology system. Beginner wording is the default; Pro keeps trading terms.
 * Simplified wording never changes financial meaning (e.g. reduce-only keeps its precise semantics in reviews).
 */
export type Mode = 'beginner' | 'pro'
const T = {
  overview: ['Home', 'Overview'],
  compass: ['Portfolio Risk', 'Exposure Compass'],
  shield: ['Portfolio Risk · HELM Shield', 'HELM Shield'],
  pulse: ['Activity & Alerts', 'Pulse'],
  unprotected: ['no stop', 'unprotected'],
  unprotectedLong: ['Position has no stop', 'Unprotected position'],
  reduceOnly: ['reduce/close only, never adds exposure', 'reduce-only'],
  reconciling: ['Verifying with exchange', 'Reconciling'],
  ALLOW: ['Within your trading limits', 'ALLOW · within policy'],
  WARN: ['Review required', 'WARN · review required'],
  BLOCK: ['Exceeds limits or cannot proceed', 'BLOCK'],
  slippage: ['est. price impact', 'slippage'],
  upnl: ['Open P/L', 'uPnL'],
  liq: ['liquidation', 'liq'],
  mark: ['now', 'mark'],
} as const
export type TermKey = keyof typeof T
export const term = (k: TermKey, m: Mode = 'beginner') => T[k][m === 'pro' ? 1 : 0]

/** Short contextual explanations (Help + beginner hints). */
export const EXPLAIN: Record<string, string> = {
  stop: 'A stop is an order resting at the exchange that closes your position if the price reaches it. It is not a guaranteed maximum loss: fills can be worse in fast markets.',
  reduceOnly: 'Reduce-only: the order can only shrink or close an existing position. It can never open or add exposure.',
  liquidation: 'Liquidation price: where the exchange would force-close a leveraged position. HELM shows it only when the exchange reports it.',
  leverage: 'Leverage multiplies both gains and losses. 2x means a 1% move changes your position value by 2% of the margin.',
  spot: 'Spot: you buy and hold the actual asset. Futures (perpetuals): you hold a leveraged contract that can be long or short.',
  limits: '"Within your limits" means the order passes the risk limits you configured. It does not mean the trade cannot lose money.',
  simulated: 'SIMULATED accounts use live public prices but fills are computed by HELM. Nothing is sent to an exchange.',
  demo: 'DEMO accounts are the exchange’s own demo trading environment: real matching engine, no real money.',
}
