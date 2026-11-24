import { Decimal, HelmError, dec, floorToStep, roundToTick, type Instrument, type ProtectionState, type Side } from '@helm/shared'

/**
 * Trade-to-Protect state machine. Protection is only PROTECTED when the provider confirms the
 * protective order exists (accepted/open). Entry filled + protection failed ⇒ UNPROTECTED (never hidden).
 */
export const PROTECTION_TRANSITIONS: Record<ProtectionState, ProtectionState[]> = {
  PLANNED: ['ENTRY_SUBMITTED', 'PROTECTION_SUBMITTED', 'CANCELED', 'FAILED'],
  ENTRY_SUBMITTED: ['ENTRY_PARTIAL', 'ENTRY_FILLED', 'FAILED', 'CANCELED'],
  ENTRY_PARTIAL: ['ENTRY_PARTIAL', 'ENTRY_FILLED', 'PROTECTION_SUBMITTED', 'UNPROTECTED', 'CANCELED'],
  ENTRY_FILLED: ['PROTECTION_SUBMITTED', 'UNPROTECTED'],
  PROTECTION_SUBMITTED: ['PROTECTED', 'UNPROTECTED'],
  PROTECTED: ['UNPROTECTED', 'PROTECTION_SUBMITTED', 'CANCELED'],
  UNPROTECTED: ['PROTECTION_SUBMITTED', 'CANCELED'],
  CANCELED: [],
  FAILED: [],
}

export interface ProtectionHistoryEntry { from: ProtectionState | null; to: ProtectionState; at: string; note?: string }

export class ProtectionWorkflow {
  readonly history: ProtectionHistoryEntry[]
  constructor(private _state: ProtectionState = 'PLANNED', history?: ProtectionHistoryEntry[], private readonly now = () => new Date()) {
    this.history = history ?? [{ from: null, to: _state, at: now().toISOString() }]
  }
  get state() { return this._state }
  to(next: ProtectionState, note?: string) {
    if (!PROTECTION_TRANSITIONS[this._state].includes(next)) throw new HelmError('ORDER_REJECTED', `Illegal protection transition ${this._state} → ${next}`)
    this.history.push({ from: this._state, to: next, at: this.now().toISOString(), note })
    this._state = next
  }
}

/** Stop price for a protective stop `pct` percent away from the entry, on the safe side of the tick. */
export function protectiveStopPrice(entry: Decimal, entrySide: Side, pct: Decimal, tick: Decimal): Decimal {
  if (pct.lte(0) || pct.gte(50)) throw new HelmError('INVALID_QUANTITY', 'Stop offset must be between 0 and 50 percent')
  const raw = entrySide === 'BUY' ? entry.mul(dec(1).minus(pct.div(100))) : entry.mul(dec(1).plus(pct.div(100)))
  // Long stop (SELL) rounds down (further from price is never tighter than asked); short stop (BUY) rounds up.
  return roundToTick(raw, tick, entrySide === 'BUY' ? 'BUY' : 'SELL')
}

/** Protective quantity derives from ACTUAL fills, minus base-asset fees, capped by what is free. */
export function protectiveQuantity(args: { filledQty: Decimal; baseFee?: Decimal; freeBase?: Decimal | null; instrument: Instrument }): Decimal {
  let q = args.filledQty.minus(args.baseFee ?? 0)
  if (args.freeBase !== undefined && args.freeBase !== null) q = Decimal.min(q, args.freeBase)
  q = floorToStep(Decimal.max(q, 0), args.instrument.lotSize)
  return q.lt(args.instrument.minQty) ? dec(0) : q
}

/** Deterministic, venue-safe client order id for a proposal (≤36 chars, [A-Za-z0-9_-]). */
export function clientOrderIdFor(proposalId: string, leg: 'e' | 's' = 'e'): string {
  return `helm${leg === 's' ? 'st' : 'en'}${proposalId.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 36)
}

/** Material market change between preview and confirmation (basis points of the preview price). */
export function materialChange(previewPrice: Decimal | null, freshPrice: Decimal | null, maxBps: Decimal = dec(50)): { material: boolean; movedBps: Decimal | null } {
  if (!previewPrice || !freshPrice || previewPrice.isZero()) return { material: true, movedBps: null }
  const moved = freshPrice.minus(previewPrice).abs().div(previewPrice).mul(10000)
  return { material: moved.gt(maxBps), movedBps: moved }
}
