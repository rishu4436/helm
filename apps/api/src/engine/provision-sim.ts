import type { Prisma } from '@prisma/client'
import { HelmError, type SimVenue } from '@helm/shared'
import { PrismaSimStore } from './accounts'
import { isSimVenue, simulatorEnabled } from '../registry'
import type { AppCtx } from '../app'

export const DEMO_SIM_ACCOUNTS: Array<{ provider: SimVenue; alias: string }> = [
  { provider: 'binance', alias: 'Binance (SIMULATED)' },
  { provider: 'bybit', alias: 'Bybit (SIMULATED)' },
  { provider: 'okx', alias: 'OKX (SIMULATED)' },
]

export const GUEST_EMAIL_DOMAIN = '@guest.helm.local'
export const isGuestEmail = (email: string) => email.endsWith(GUEST_EMAIL_DOMAIN)

export type SimProvision = {
  id: string
  provider: SimVenue
  alias: string
  environment: 'simulated'
  state: string
  reasons: string[]
}

/** Create one HELM-simulated venue account (no exchange keys). Always labelled SIMULATED. */
export async function provisionSimulatedAccount(ctx: AppCtx, userId: string, provider: SimVenue, alias: string): Promise<SimProvision> {
  if (!simulatorEnabled()) throw new HelmError('UNSUPPORTED_OPERATION', 'HELM simulator disabled (HELM_ENABLE_SIMULATOR=false)')
  if (!isSimVenue(provider)) throw new HelmError('UNSUPPORTED_OPERATION', `No simulator for ${provider}`, { provider })
  const { prisma } = ctx
  const conn = await prisma.exchangeConnection.create({ data: { userId, provider, environment: 'simulated', alias, state: 'RECONNECTING' } })
  const adapter = ctx.adapters(provider, {}, conn.id, { environment: 'simulated', simStore: new PrismaSimStore(prisma, conn.id) })
  const health = await adapter.connect()
  const manifest = adapter.getCapabilities()
  if (health.state === 'ERROR') {
    await prisma.exchangeConnection.update({ where: { id: conn.id }, data: { state: health.state, stateReasons: health.reasons, lastCheckedAt: new Date(), deletedAt: new Date() } })
    throw Object.assign(new Error('Could not start this simulated account (public market data unavailable)'), { statusCode: 422, helm: { code: 'CONNECTION_FAILED', message: 'Could not start this simulated account (public market data unavailable)', reasons: health.reasons } })
  }
  await prisma.$transaction(async tx => {
    await tx.exchangeConnection.update({ where: { id: conn.id }, data: { state: health.state, stateReasons: health.reasons, lastCheckedAt: new Date() } })
    const acct = await tx.tradingAccount.create({ data: { id: conn.id, userId, connectionId: conn.id, provider, environment: 'simulated', accountType: 'unified', providerAccountId: `${provider}:sim`, alias } })
    await tx.accountCapability.create({ data: { accountId: acct.id, manifest: JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue } })
    await tx.providerHealth.create({ data: { connectionId: conn.id, state: health.state, reasons: health.reasons } })
  })
  return { id: conn.id, provider, alias, environment: 'simulated', state: health.state, reasons: health.reasons }
}
