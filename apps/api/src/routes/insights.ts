/** Read-only views for the companion: audit log, voice history, protection plans, diagnostics. */
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ENDPOINT_RULES } from '@helm/shared'
import { toJsonSafe } from '@helm/portfolio'
import { LocalWhisperSTT } from '@helm/voice-engine'
import { requireUser, requireUserOrDevice } from '../auth'
import type { AppCtx } from '../app'
import { listAccounts } from '../engine/accounts'

export const insightRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  const { prisma } = ctx
  const any = requireUserOrDevice(prisma)
  const user = requireUser(prisma)
  const Page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })

  app.get('/v1/audit', { preHandler: user }, async req => {
    const { limit } = Page.parse(req.query)
    const rows = await prisma.auditEvent.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' }, take: limit })
    return { events: rows.map(r => ({ id: r.id, actor: r.actor, action: r.action, subject: r.subject, detail: r.detail, at: r.createdAt })) }
  })

  app.get('/v1/voice/history', { preHandler: any }, async req => {
    const { limit } = Page.parse(req.query)
    const rows = await prisma.voiceCommand.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' }, take: limit })
    return toJsonSafe({ commands: rows.map(r => ({ id: r.id, transcript: r.transcript, sttProvider: r.sttProvider, confidence: r.confidence, intent: (r.intent as { intent?: string } | null)?.intent ?? null, outcome: r.outcome, at: r.createdAt })) })
  })

  app.get('/v1/protection', { preHandler: any }, async req => {
    const rows = await prisma.protectionPlan.findMany({ where: { userId: req.userId! }, orderBy: { updatedAt: 'desc' }, take: 100 })
    return toJsonSafe({ plans: rows.map(r => ({ id: r.id, accountId: r.accountId, instrumentId: r.instrumentId, entryOrderId: r.entryOrderId, source: r.source, protectionOrderId: r.protectionOrderId, stopOffsetPercent: r.stopOffsetPercent, stopPrice: r.stopPrice, protectedQuantity: r.protectedQuantity, state: r.state, history: r.history, updatedAt: r.updatedAt })) })
  })

  app.get('/v1/diagnostics', { preHandler: user }, async req => {
    const checks: Array<{ id: string; label: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string; ms?: number }> = []
    const time = async (fn: () => Promise<void>) => { const t = Date.now(); await fn(); return Date.now() - t }
    try { const ms = await time(async () => { await prisma.$queryRaw`SELECT 1` }); checks.push({ id: 'db', label: 'Database', status: 'PASS', detail: 'Postgres reachable', ms }) } catch { checks.push({ id: 'db', label: 'Database', status: 'FAIL', detail: 'Postgres unreachable' }) }
    checks.push({ id: 'live', label: 'Live trading', status: 'PASS', detail: 'Disabled. Signed requests are only allowed to demo, paper and sandbox hosts.' })
    const stt = (process.env.HELM_STT_PROVIDER ?? 'deterministic')
    if (stt === 'local') {
      const l = new LocalWhisperSTT({ url: process.env.HELM_STT_LOCAL_URL })
      const t0 = Date.now(); const ok = await l.health()
      checks.push({ id: 'stt', label: 'Speech-to-text', status: ok ? 'PASS' : 'WARN', detail: ok ? 'Local faster-whisper sidecar reachable (127.0.0.1)' : 'Local STT sidecar down: commands fall back to the labelled TEST STT', ms: Date.now() - t0 })
    } else checks.push({ id: 'stt', label: 'Speech-to-text', status: 'WARN', detail: `Provider "${stt}" — TEST STT is scripted and labelled` })
    const t1 = Date.now()
    const accts = await listAccounts(prisma, ctx.key, ctx.adapters, req.userId!)
    const accMs = Date.now() - t1
    for (const a of accts) {
      const st = a.connection.state
      checks.push({ id: `acct:${a.account.id}`, label: a.account.alias, status: st === 'CONNECTED' || st === 'READ_ONLY' ? 'PASS' : st === 'LIMITED' ? 'WARN' : 'FAIL', detail: `${a.account.provider} · ${a.account.environment} · ${st}${a.connection.reasons.length ? ` — ${a.connection.reasons.join('; ')}` : ''}`, ms: accMs })
    }
    if (!accts.some(a => a.account.provider === 'okx')) checks.push({ id: 'okx', label: 'OKX Demo', status: 'WARN', detail: 'Not connected. Connect an OKX Demo Trading key (key, secret, passphrase) on Exchanges. Adapter verified with mocks + public endpoints; a logged-in OKX Demo run by the HELM team is NOT RUN.' })
    const devices = await prisma.device.count({ where: { userId: req.userId!, revokedAt: null } })
    checks.push({ id: 'devices', label: 'Paired glasses', status: devices ? 'PASS' : 'WARN', detail: devices ? `${devices} active device(s)` : 'No G2 paired yet' })
    return { at: new Date().toISOString(), checks, guard: Object.fromEntries(Object.entries(ENDPOINT_RULES).map(([k, r]) => [k, { signedHostsAllowed: r.authenticated ?? [], requiredAuthHeader: r.requiredAuthHeader?.name ?? null, loopbackOnly: !!r.loopbackOnly }])), build: { node: process.version } }
  })
}
