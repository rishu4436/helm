import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { HelmError } from '@helm/shared'

/**
 * Single-use, expiring confirmation tokens bound to a hash of the exact proposal contents.
 * The glasses/companion receive the token with the preview; confirming requires the same
 * token, before expiry, exactly once, and for an unchanged proposal.
 */
export interface ConfirmationGrant { token: string; proposalHash: string; expiresAt: number }

export function hashProposal(p: unknown): string {
  return createHash('sha256').update(canonicalJson(p)).digest('hex')
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (typeof (v as { toFixed?: unknown }).toFixed === 'function' && (v as { constructor: { name: string } }).constructor?.name?.includes('Decimal')) return JSON.stringify((v as { toFixed(): string }).toFixed())
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`
}

export class ConfirmationRegistry {
  private readonly grants = new Map<string, ConfirmationGrant & { used: boolean }>()
  constructor(private readonly ttlMs = 30_000, private readonly now: () => number = Date.now) {}

  issue(proposal: unknown): ConfirmationGrant {
    const g = { token: randomBytes(24).toString('base64url'), proposalHash: hashProposal(proposal), expiresAt: this.now() + this.ttlMs }
    this.grants.set(g.token, { ...g, used: false })
    return g
  }

  /** Consumes the token. Throws STALE_PROPOSAL on expiry, replay, unknown token or changed proposal. */
  consume(token: string, proposal: unknown): void {
    const g = this.grants.get(token)
    if (!g) throw new HelmError('STALE_PROPOSAL', 'Unknown confirmation token')
    if (g.used) throw new HelmError('STALE_PROPOSAL', 'Confirmation token already used')
    g.used = true // burn first so a failed check can't be retried with the same token
    if (this.now() > g.expiresAt) throw new HelmError('STALE_PROPOSAL', 'Confirmation expired')
    const a = Buffer.from(g.proposalHash, 'hex'), b = Buffer.from(hashProposal(proposal), 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HelmError('STALE_PROPOSAL', 'Proposal changed since preview')
  }
}
