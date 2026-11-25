import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import type { PrismaClient } from '@prisma/client'
import { ZodError } from 'zod'
import { HelmError, assertLiveTradingDisabled } from '@helm/shared'
import { makeAdapterFactory, type AdapterFactory } from './registry'
import { authRoutes } from './routes/auth'
import { pairingRoutes } from './routes/pairing'
import { connectionRoutes } from './routes/connections'
import { metaRoutes } from './routes/meta'
import { engineRoutes } from './routes/engine'
import { uxRoutes } from './routes/ux'
import { recipeRoutes } from './routes/recipes'
import { insightRoutes } from './routes/insights'
import { setMarketFetch } from './engine/market'
import type { FetchLike } from '@helm/connectors'

export interface AppDeps {
  prisma: PrismaClient
  credentialKey: Buffer
  adapterFactory?: AdapterFactory
  corsOrigins?: string[]
  logger?: boolean
  rateLimitMax?: number
  /** Multiplies per-route limits (tests only). */
  rateLimitScale?: number
  /** Public market-data fetch override (tests). */
  marketFetch?: FetchLike
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  assertLiveTradingDisabled() // refuse to boot with live trading enabled
  const app = Fastify({ logger: deps.logger ? { redact: ['req.headers.authorization', 'req.body.credentials', 'req.body.password'] } : false, bodyLimit: 64 * 1024 })
  await app.register(cors, { origin: deps.corsOrigins ?? defaultCorsOrigins(), credentials: false, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] })
  await app.register(rateLimit, { max: deps.rateLimitMax ?? 120, timeWindow: '1 minute' })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Invalid request', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } })
    if (err instanceof HelmError) {
      const status = err.code === 'UNSUPPORTED_OPERATION' ? 422 : err.code === 'ENVIRONMENT_MISMATCH' || err.code === 'LIVE_TRADING_DISABLED' || err.code === 'ACCESS_RESTRICTED' ? 403 : err.code === 'RATE_LIMITED' ? 429 : err.code === 'RISK_POLICY_VIOLATION' ? 422 : err.code === 'STALE_PROPOSAL' ? 409 : 400
      return reply.code(status).send({ error: err.toJSON() })
    }
    const e = err as { statusCode?: number; message?: string; helm?: { code: string; message: string } }
    if (e.helm && e.statusCode) return reply.code(e.statusCode).send({ error: e.helm })
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: 'REQUEST_ERROR', message: e.message } })
    app.log.error(err)
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal error' } })
  })

  if (deps.marketFetch) setMarketFetch(deps.marketFetch)
  const scale = deps.rateLimitScale ?? 1
  const ctx: AppCtx = { prisma: deps.prisma, key: deps.credentialKey, adapters: deps.adapterFactory ?? makeAdapterFactory(), rl: (max: number, timeWindow = '1 minute') => ({ rateLimit: { max: max * scale, timeWindow } }) }
  await app.register(metaRoutes(ctx))
  await app.register(authRoutes(ctx))
  await app.register(pairingRoutes(ctx))
  await app.register(connectionRoutes(ctx))
  await app.register(engineRoutes(ctx))
  await app.register(uxRoutes(ctx))
  await app.register(recipeRoutes(ctx))
  await app.register(insightRoutes(ctx))
  return app
}

export type AppCtx = { prisma: PrismaClient; key: Buffer; adapters: AdapterFactory; rl: (max: number, timeWindow?: string) => { rateLimit: { max: number; timeWindow: string } } }

const LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173']

/** Local companion + glasses, plus any comma-separated HELM_CORS_ORIGINS (hosted companion). */
export function defaultCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.HELM_CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return [...new Set([...LOCAL_ORIGINS, ...extra])]
}

