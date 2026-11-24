import { HelmError, type OrderStatus } from '@helm/shared'

/**
 * HELM order lifecycle. Every transition is validated and produces an audit event.
 * Key safety properties:
 *  - Nothing reaches SUBMITTING without CONFIRMED (explicit user confirmation).
 *  - SUBMITTING can only resolve via provider truth (ACCEPTED/…/REJECTED) or UNKNOWN.
 *  - UNKNOWN must go through RECONCILING; it can never jump back to SUBMITTING (no blind retry).
 *  - Terminal states are final.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['VALIDATED', 'REJECTED', 'EXPIRED'],
  VALIDATED: ['AWAITING_CONFIRMATION', 'REJECTED', 'EXPIRED'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'EXPIRED', 'CANCELED'],
  CONFIRMED: ['SUBMITTING', 'EXPIRED', 'REJECTED'],
  SUBMITTING: ['ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'UNKNOWN', 'CANCELED', 'EXPIRED'],
  ACCEPTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'RECONCILING', 'UNKNOWN'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'EXPIRED', 'RECONCILING', 'UNKNOWN'],
  UNKNOWN: ['RECONCILING'],
  RECONCILING: ['ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'UNKNOWN', 'RECONCILING'],
  FILLED: [],
  CANCELED: [],
  REJECTED: [],
  EXPIRED: [],
}

export const TERMINAL: ReadonlySet<OrderStatus> = new Set(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'])

export interface LifecycleEvent { from: OrderStatus | null; to: OrderStatus; at: string; actor: 'user' | 'system' | 'provider'; reason?: string }

export class OrderLifecycle {
  private _status: OrderStatus
  readonly events: LifecycleEvent[] = []
  constructor(initial: OrderStatus = 'DRAFT', private readonly now: () => Date = () => new Date()) {
    this._status = initial
    this.events.push({ from: null, to: initial, at: now().toISOString(), actor: 'system' })
  }
  get status() { return this._status }
  get isTerminal() { return TERMINAL.has(this._status) }

  can(to: OrderStatus): boolean { return TRANSITIONS[this._status].includes(to) }

  transition(to: OrderStatus, actor: LifecycleEvent['actor'], reason?: string): LifecycleEvent {
    if (!this.can(to)) throw new HelmError('ORDER_REJECTED', `Illegal order transition ${this._status} → ${to}`)
    if (to === 'CONFIRMED' && actor !== 'user') throw new HelmError('ORDER_REJECTED', 'Only an explicit user action can confirm an order')
    if (['ACCEPTED', 'PARTIALLY_FILLED', 'FILLED'].includes(to) && actor === 'user') throw new HelmError('ORDER_REJECTED', 'Fill states come from provider truth only')
    const ev: LifecycleEvent = { from: this._status, to, at: this.now().toISOString(), actor, reason }
    this._status = to
    this.events.push(ev)
    return ev
  }

  /** May this order be (re)submitted to a provider? Only straight from CONFIRMED, exactly once. */
  get maySubmit(): boolean { return this._status === 'CONFIRMED' }
}
