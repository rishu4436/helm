import type { OrderRequest, ValidationResult } from '@helm/shared'

/** Provider-agnostic instrument rule checks (lot size, tick, min notional). */
export function validateAgainstInstrument(req: OrderRequest): ValidationResult {
  const problems: string[] = []
  const ins = req.instrument
  if (ins.status !== 'trading') problems.push(`${ins.providerSymbol} is not trading`)
  if (!req.quantity && !req.quoteQuantity) problems.push('quantity or quote quantity required')
  if (req.quantity) {
    if (req.quantity.lte(0)) problems.push('quantity must be positive')
    if (req.quantity.lt(ins.minQty)) problems.push(`quantity below minimum ${ins.minQty.toFixed()}`)
    if (ins.maxQty && req.quantity.gt(ins.maxQty)) problems.push(`quantity above maximum ${ins.maxQty.toFixed()}`)
    if (!req.quantity.mod(ins.lotSize).isZero()) problems.push(`quantity must be a multiple of ${ins.lotSize.toFixed()}`)
  }
  if (req.price) {
    if (req.price.lte(0)) problems.push('price must be positive')
    if (!req.price.mod(ins.tickSize).isZero()) problems.push(`price must be a multiple of tick ${ins.tickSize.toFixed()}`)
  }
  if ((req.type === 'LIMIT' || req.type === 'STOP_LIMIT' || req.type === 'TAKE_PROFIT_LIMIT') && !req.price) problems.push('limit price required')
  if ((req.type.startsWith('STOP') || req.type.startsWith('TAKE_PROFIT')) && !req.stopPrice) problems.push('trigger price required')
  if (ins.minNotional && req.quantity && req.price && req.quantity.mul(req.price).lt(ins.minNotional)) problems.push(`order value below minimum ${ins.minNotional.toFixed()}`)
  if (ins.minNotional && req.quoteQuantity && req.quoteQuantity.lt(ins.minNotional)) problems.push(`order value below minimum ${ins.minNotional.toFixed()}`)
  return { ok: problems.length === 0, problems }
}

/** Exchanges report precision as decimal places or steps; normalise "4" → 0.0001. */
export function stepFromPrecision(p: number): string {
  return p <= 0 ? '1' : `0.${'0'.repeat(p - 1)}1`
}
