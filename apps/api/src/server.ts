import { PrismaClient } from '@prisma/client'
import { loadKey } from '@helm/security'
import { buildApp } from './app'

const prisma = new PrismaClient()
const app = await buildApp({ prisma, credentialKey: loadKey(process.env.HELM_CREDENTIAL_KEY), logger: true, rateLimitMax: process.env.HELM_RATE_LIMIT_MAX ? Number(process.env.HELM_RATE_LIMIT_MAX) : undefined })
const port = Number(process.env.API_PORT ?? 4000)
await app.listen({ port, host: '127.0.0.1' })
