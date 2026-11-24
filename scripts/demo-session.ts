/** Shared helper: in-process HELM API on helm_dev with the demo user (keys/passwords from env; never printed). */
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { loadKey } from '@helm/security'
import { buildApp } from '../apps/api/src/app'
config({ path: new URL('../.env', import.meta.url).pathname })
export const DEMO_EMAIL = 'demo@helm.local'

export async function demoSession() {
  const prisma = new PrismaClient()
  const app = await buildApp({ prisma, credentialKey: loadKey(process.env.HELM_CREDENTIAL_KEY), rateLimitMax: 10_000, rateLimitScale: 100 })
  const pw = process.env.HELM_DEMO_PASSWORD!
  let r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: DEMO_EMAIL, password: pw } })
  if (r.statusCode !== 200) r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: DEMO_EMAIL, password: pw } })
  const token = r.json().token as string
  if (!token) throw new Error(`demo login failed: ${r.statusCode}`)
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
    const x = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as never })
    return { status: x.statusCode, body: x.json() as any }
  }
  return { app, prisma, token, call, close: async () => { await app.close(); await prisma.$disconnect() } }
}
