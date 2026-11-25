/**
 * Guest ("Try the demo") cleanup. Guests only ever hold HELM-simulated accounts. After GUEST_TTL they are deleted
 * with everything they own. Rows without an FK cascade are removed explicitly first.
 */
import type { PrismaClient } from '@prisma/client'
import { GUEST_EMAIL_DOMAIN } from './provision-sim'

export const GUEST_TTL_MS = 48 * 3600_000
let lastRun = 0

export async function cleanupGuests(prisma: PrismaClient, now = new Date(), ttlMs = GUEST_TTL_MS, max = 200): Promise<number> {
  const old = await prisma.user.findMany({ where: { email: { endsWith: GUEST_EMAIL_DOMAIN }, createdAt: { lt: new Date(now.getTime() - ttlMs) } }, select: { id: true }, take: max })
  if (!old.length) return 0
  const ids = old.map(u => u.id)
  const accts = await prisma.tradingAccount.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  await prisma.$transaction([
    prisma.orderProposal.deleteMany({ where: { userId: { in: ids } } }),
    prisma.protectionPlan.deleteMany({ where: { userId: { in: ids } } }),
    prisma.marketSubscription.deleteMany({ where: { userId: { in: ids } } }),
    prisma.idempotencyKey.deleteMany({ where: { userId: { in: ids } } }),
    prisma.simLedger.deleteMany({ where: { accountId: { in: accts.map(a => a.id) } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ])
  return ids.length
}

/** Fire-and-forget, at most every 10 minutes per process; never blocks or fails the caller. */
export function maybeCleanupGuests(prisma: PrismaClient, log?: { warn(o: unknown, m: string): void }) {
  if (Date.now() - lastRun < 600_000) return
  lastRun = Date.now()
  cleanupGuests(prisma).catch(e => log?.warn({ err: e instanceof Error ? e.message : String(e) }, 'guest cleanup failed'))
}
