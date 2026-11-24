import type { Prisma, PrismaClient } from '@prisma/client'
import { unseal, type SealedSecret } from '@helm/security'
import { HelmError, canSubmitOrders, type CapabilityManifest, type Environment, type ExchangeAdapter, type ProviderId } from '@helm/shared'
import type { SimLedgerState, SimStore } from '@helm/connectors'
import type { AdapterFactory } from '../registry'

export class PrismaSimStore implements SimStore {
  constructor(private readonly prisma: PrismaClient, private readonly accountId: string) {}
  async load() { const r = await this.prisma.simLedger.findUnique({ where: { accountId: this.accountId } }); return (r?.state as unknown as SimLedgerState) ?? null }
  async save(s: SimLedgerState) { await this.prisma.simLedger.upsert({ where: { accountId: this.accountId }, create: { accountId: this.accountId, state: s as unknown as Prisma.InputJsonValue }, update: { state: s as unknown as Prisma.InputJsonValue } }) }
}

export interface LoadedAccount {
  account: { id: string; alias: string; provider: ProviderId; environment: Environment; accountType: string; connectionId: string }
  connection: { id: string; state: string; reasons: string[] }
  adapter: ExchangeAdapter
  manifest: CapabilityManifest
  canTrade: boolean
}

export function makeAdapter(prisma: PrismaClient, key: Buffer, factory: AdapterFactory, userId: string, conn: { id: string; provider: string; environment: string; credential: { sealed: unknown } | null }, accountId: string): ExchangeAdapter {
  const creds = conn.credential ? JSON.parse(unseal(key, conn.credential.sealed as SealedSecret, `${userId}:${conn.id}`)) as Record<string, string> : {}
  return factory(conn.provider as ProviderId, creds, accountId, { environment: conn.environment as Environment, simStore: new PrismaSimStore(prisma, accountId) })
}

/** Load one trading account the user OWNS (tenant isolation), with its adapter. */
export async function loadAccount(prisma: PrismaClient, key: Buffer, factory: AdapterFactory, userId: string, accountId: string): Promise<LoadedAccount> {
  const a = await prisma.tradingAccount.findFirst({ where: { id: accountId, userId, connection: { deletedAt: null } }, include: { connection: { include: { credential: true } } } })
  if (!a) throw Object.assign(new HelmError('INVALID_INSTRUMENT', 'Account not found'), { statusCode: 404 })
  const adapter = makeAdapter(prisma, key, factory, userId, a.connection, a.id)
  const manifest = adapter.getCapabilities()
  const state = a.connection.state
  return {
    account: { id: a.id, alias: a.alias, provider: a.provider as ProviderId, environment: a.environment as Environment, accountType: a.accountType, connectionId: a.connectionId },
    connection: { id: a.connection.id, state, reasons: a.connection.stateReasons },
    adapter, manifest,
    canTrade: canSubmitOrders(state as never, a.environment) && a.environment !== ('live' as string),
  }
}

export async function listAccounts(prisma: PrismaClient, key: Buffer, factory: AdapterFactory, userId: string): Promise<LoadedAccount[]> {
  const rows = await prisma.tradingAccount.findMany({ where: { userId, connection: { deletedAt: null } }, select: { id: true }, orderBy: { createdAt: 'asc' } })
  return Promise.all(rows.map(r => loadAccount(prisma, key, factory, userId, r.id)))
}

/** Refresh connection health (adapters are stateless across requests). Persists the new state. */
export async function refreshHealth(prisma: PrismaClient, la: LoadedAccount) {
  const started = Date.now()
  const h = await la.adapter.connect()
  await prisma.exchangeConnection.update({ where: { id: la.connection.id }, data: { state: h.state, stateReasons: h.reasons, lastCheckedAt: new Date() } })
  await prisma.providerHealth.create({ data: { connectionId: la.connection.id, state: h.state, reasons: h.reasons, latencyMs: Date.now() - started } })
  la.connection = { id: la.connection.id, state: h.state, reasons: h.reasons }
  la.manifest = la.adapter.getCapabilities()
  la.canTrade = canSubmitOrders(h.state, la.account.environment)
  return h
}
