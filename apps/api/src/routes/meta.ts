import type { FastifyPluginAsync } from 'fastify'
import { BinanceAdapter, BybitAdapter, CoinbaseSandboxAdapter, IbkrGatewayAdapter, OkxAdapter, AlpacaPaperAdapter } from '@helm/connectors'
import { ENDPOINT_RULES } from '@helm/shared'
import { providerCatalog } from '../registry'
import type { AppCtx } from '../app'

export const metaRoutes = (ctx: AppCtx): FastifyPluginAsync => async app => {
  app.get('/health', async () => {
    let db = 'ok'
    try { await ctx.prisma.$queryRaw`SELECT 1` } catch { db = 'error' }
    return { status: db === 'ok' ? 'ok' : 'degraded', db, liveTrading: false, time: new Date().toISOString() }
  })

  app.get('/v1/providers', async () => ({ providers: providerCatalog() }))

  /** Static capability matrix (documented capabilities, before any account is connected). */
  app.get('/v1/capabilities', async () => {
    const dummy = { apiKey: 'x', apiSecret: 'x', passphrase: 'x' }
    const manifests = [
      new BinanceAdapter(dummy, { market: 'spot', accountId: '-' }).getCapabilities(),
      new BinanceAdapter(dummy, { market: 'usdm', accountId: '-' }).getCapabilities(),
      new OkxAdapter(dummy, { accountId: '-' }).getCapabilities(),
      new BybitAdapter(dummy, { accountId: '-' }).getCapabilities(),
      new CoinbaseSandboxAdapter({ accountId: '-' }).getCapabilities(),
      new IbkrGatewayAdapter({ accountId: '-' }).getCapabilities(),
      new AlpacaPaperAdapter({ keyId: 'x', secretKey: 'x' }, { accountId: '-' }).getCapabilities(),
    ].map(m => ({ ...m, permissions: { read: true, trade: m.simulation !== 'static_responses', withdraw: false }, note: 'Documented capability; actual permissions are verified per connected account' }))
    return { manifests, endpointRules: ENDPOINT_RULES }
  })
}
