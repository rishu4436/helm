import type { PrismaClient } from '@prisma/client'
import { supports, type Balance, type Order, type Position } from '@helm/shared'
import { aggregate, type AccountInput, type Portfolio } from '@helm/portfolio'
import type { FetchLike } from '@helm/connectors'
import type { AdapterFactory } from '../registry'
import { listAccounts, type LoadedAccount } from './accounts'
import { priceBook } from './market'

export async function readAccount(la: LoadedAccount): Promise<AccountInput> {
  const m = la.manifest
  const errs: string[] = []
  const safe = async <T>(op: Parameters<typeof supports>[1], f: () => Promise<T[]>): Promise<T[]> => {
    if (!supports(m, op)) return []
    try { return await f() } catch (e) { errs.push(`${op}: ${(e as { code?: string }).code ?? 'ERROR'}`); return [] }
  }
  const balances = await safe<Balance>('getBalances', () => la.adapter.getBalances())
  const positions = await safe<Position>('getPositions', () => la.adapter.getPositions())
  const openOrders = await safe<Order>('getOpenOrders', () => la.adapter.getOpenOrders())
  return { account: { id: la.account.id, alias: la.account.alias, provider: la.account.provider, environment: la.account.environment, state: la.connection.state }, balances, positions, openOrders, error: errs.length ? errs.join('; ') : undefined }
}

export async function userPortfolio(prisma: PrismaClient, key: Buffer, factory: AdapterFactory, userId: string, fetchImpl?: FetchLike): Promise<{ portfolio: Portfolio; accounts: LoadedAccount[]; inputs: AccountInput[] }> {
  const accounts = await listAccounts(prisma, key, factory, userId)
  const [inputs, prices] = await Promise.all([Promise.all(accounts.map(readAccount)), priceBook(fetchImpl)])
  return { portfolio: aggregate(inputs, prices), accounts, inputs }
}
