import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Credential encryption at rest: AES-256-GCM with a per-record random IV and the record's
 * owner/connection id bound as additional authenticated data (a ciphertext copied to another
 * user's row will not decrypt). Key comes from HELM_CREDENTIAL_KEY (32 bytes, base64).
 */
export interface SealedSecret { v: 1; iv: string; tag: string; ct: string }

export function loadKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error('HELM_CREDENTIAL_KEY is not set')
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('HELM_CREDENTIAL_KEY must decode to 32 bytes')
  return k
}

export function seal(key: Buffer, plaintext: string, aad: string): SealedSecret {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }
}

export function unseal(key: Buffer, s: SealedSecret, aad: string): string {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'))
  d.setAAD(Buffer.from(aad, 'utf8'))
  d.setAuthTag(Buffer.from(s.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()]).toString('utf8')
}

/** Show only enough of a key to identify it: "abcd…wxyz". */
export function fingerprint(apiKey: string): string {
  return apiKey.length <= 8 ? '••••' : `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`
}

// ---------- device pairing + session tokens ----------

/** Unambiguous alphabet (no 0/O/1/I/L) for codes read off a 576×288 display. */
const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export function newPairingCode(length = 6): string {
  let s = ''
  for (let i = 0; i < length; i++) s += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]
  return s
}
export function normalisePairingCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function newOpaqueToken(bytes = 32): string { return randomBytes(bytes).toString('base64url') }
/** Tokens are stored only as SHA-256 hashes, peppered with HELM_SESSION_SECRET when set. */
export function hashToken(token: string): string {
  const h = createHash('sha256')
  const pepper = process.env.HELM_SESSION_SECRET
  if (pepper) h.update(pepper)
  return h.update(token).digest('hex')
}
export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex'), b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
