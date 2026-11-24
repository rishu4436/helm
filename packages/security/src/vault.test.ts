import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fingerprint, hashToken, loadKey, newPairingCode, normalisePairingCode, seal, tokenMatches, unseal } from './index'

const key = randomBytes(32)
describe('credential vault', () => {
  it('round-trips and never stores plaintext', () => {
    const s = seal(key, 'super-secret-api-secret', 'user1:conn1')
    expect(JSON.stringify(s)).not.toContain('super-secret')
    expect(unseal(key, s, 'user1:conn1')).toBe('super-secret-api-secret')
  })
  it('fails when moved to another owner (AAD binding) or tampered', () => {
    const s = seal(key, 'x', 'user1:conn1')
    expect(() => unseal(key, s, 'user2:conn1')).toThrow()
    const t = { ...s, ct: Buffer.from('y').toString('base64') }
    expect(() => unseal(key, t, 'user1:conn1')).toThrow()
    expect(() => unseal(randomBytes(32), s, 'user1:conn1')).toThrow()
  })
  it('uses a fresh IV each time', () => {
    expect(seal(key, 'same', 'a').ct).not.toBe(seal(key, 'same', 'a').ct)
  })
  it('validates key material', () => {
    expect(() => loadKey(undefined)).toThrow()
    expect(() => loadKey(Buffer.from('short').toString('base64'))).toThrow(/32 bytes/)
    expect(loadKey(key.toString('base64')).length).toBe(32)
  })
  it('fingerprints keys', () => { expect(fingerprint('ABCDEFGHIJKLMNOP')).toBe('ABCD…MNOP') })
})
describe('pairing + tokens', () => {
  it('pairing codes use an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) expect(newPairingCode()).toMatch(/^[2-9A-HJKMNP-Z]{6}$/)
    expect(normalisePairingCode(' ab-c 23 ')).toBe('ABC23')
  })
  it('stores token hashes only and compares in constant time', () => {
    const h = hashToken('tok')
    expect(h).toHaveLength(64)
    expect(tokenMatches('tok', h)).toBe(true)
    expect(tokenMatches('tok2', h)).toBe(false)
  })
})
