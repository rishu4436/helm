import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { hashToken, newOpaqueToken } from '@helm/security'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const dk = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split('$')
  if (alg !== 'scrypt' || !s || !h) return false
  const dk = await scrypt(pw, Buffer.from(s, 'base64'), 64)
  const want = Buffer.from(h, 'base64')
  return dk.length === want.length && timingSafeEqual(dk, want)
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function createSession(prisma: PrismaClient, userId: string, userAgent?: string) {
  const token = newOpaqueToken()
  const s = await prisma.authSession.create({ data: { userId, tokenHash: hashToken(token), userAgent, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } })
  return { token, sessionId: s.id, expiresAt: s.expiresAt }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null
}

declare module 'fastify' {
  interface FastifyRequest { userId?: string; sessionId?: string; deviceId?: string }
}

/** Companion user session (Bearer token; no cookies → no ambient-credential CSRF). */
export function requireUser(prisma: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req)
    if (!t) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } })
    const s = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(t) } })
    if (!s || s.revokedAt || s.expiresAt < new Date()) return reply.code(401).send({ error: { code: 'SESSION_EXPIRED', message: 'Session expired — sign in again' } })
    req.userId = s.userId
    req.sessionId = s.id
  }
}

/** Glasses device session: exchange-independent, short-lived, revocable. Never carries exchange secrets. */
export function requireDevice(prisma: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req)
    if (!t) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Pair this device first' } })
    const d = await prisma.device.findUnique({ where: { tokenHash: hashToken(t) } })
    if (!d || d.revokedAt || d.expiresAt < new Date()) return reply.code(401).send({ error: { code: 'DEVICE_REVOKED', message: 'Device not paired or revoked' } })
    req.userId = d.userId
    req.deviceId = d.id
    await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } })
  }
}

/** Either a companion session or a paired glasses device (both resolve to one userId, tenant-scoped). */
export function requireUserOrDevice(prisma: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req)
    if (!t) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in or pair a device' } })
    const h = hashToken(t)
    const s = await prisma.authSession.findUnique({ where: { tokenHash: h } })
    if (s && !s.revokedAt && s.expiresAt > new Date()) { req.userId = s.userId; req.sessionId = s.id; return }
    const d = await prisma.device.findUnique({ where: { tokenHash: h } })
    if (d && !d.revokedAt && d.expiresAt > new Date()) { req.userId = d.userId; req.deviceId = d.id; await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } }); return }
    return reply.code(401).send({ error: { code: 'SESSION_EXPIRED', message: 'Session expired or device revoked' } })
  }
}
