import { PrismaClient } from '@prisma/client'
import { loadKey } from '@helm/security'
import { buildApp, defaultCorsOrigins } from './app'

if (process.env.NODE_ENV === 'production') {
  const session = process.env.HELM_SESSION_SECRET
  if (!session || session.length < 32) throw new Error('HELM_SESSION_SECRET must be set to at least 32 characters in production')
}

const prisma = new PrismaClient()
const app = await buildApp({
  prisma,
  credentialKey: loadKey(process.env.HELM_CREDENTIAL_KEY),
  logger: true,
  rateLimitMax: process.env.HELM_RATE_LIMIT_MAX ? Number(process.env.HELM_RATE_LIMIT_MAX) : undefined,
  corsOrigins: defaultCorsOrigins(),
})
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000)
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
await app.listen({ port, host })
