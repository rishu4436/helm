import type { PrismaClient, Prisma } from '@prisma/client'
import { redact } from '@helm/shared'

export async function audit(prisma: PrismaClient, e: { userId?: string | null; actor: string; action: string; subject?: string; detail?: Record<string, unknown>; ip?: string }) {
  await prisma.auditEvent.create({ data: { userId: e.userId ?? null, actor: e.actor, action: e.action, subject: e.subject, detail: redact(e.detail ?? {}) as Prisma.InputJsonValue, ip: e.ip } })
}
