import type { Prisma, PrismaClient } from '@prisma/client'
import type { PulseKind, Severity } from '@helm/pulse'

export async function emitPulse(prisma: PrismaClient, e: { userId: string; kind: PulseKind; severity: Severity; provider?: string | null; accountId?: string | null; instrumentId?: string | null; reason: string; context?: Record<string, unknown>; dedupeKey: string }) {
  await prisma.pulseEvent.upsert({
    where: { userId_dedupeKey: { userId: e.userId, dedupeKey: e.dedupeKey } },
    create: { userId: e.userId, kind: e.kind, severity: e.severity, provider: (e.provider ?? null) as never, accountId: e.accountId ?? null, instrumentId: e.instrumentId ?? null, reason: e.reason, context: (e.context ?? {}) as Prisma.InputJsonValue, dedupeKey: e.dedupeKey },
    update: { severity: e.severity, reason: e.reason, context: (e.context ?? {}) as Prisma.InputJsonValue, createdAt: new Date(), dismissedAt: null },
  })
}
