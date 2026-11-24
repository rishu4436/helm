/**
 * Secret check that pattern scanners can't do: unseal each stored exchange credential IN MEMORY and search the full git
 * history (every patch, all refs), the working tree and evidence/ for the literal values. Prints only names and counts.
 */
import { execFileSync } from 'node:child_process'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { loadKey, unseal, type SealedSecret } from '@helm/security'
config({ path: new URL('../.env', import.meta.url).pathname, quiet: true } as never)
const key = loadKey(process.env.HELM_CREDENTIAL_KEY)
const prisma = new PrismaClient()
const conns = await prisma.exchangeConnection.findMany({ include: { credential: true } })
const secrets: Array<{ label: string; v: string }> = []
for (const c of conns) if (c.credential) {
  const creds = JSON.parse(unseal(key, c.credential.sealed as unknown as SealedSecret, `${c.userId}:${c.id}`)) as Record<string, string>
  for (const [k, v] of Object.entries(creds)) if (typeof v === 'string' && v.length >= 8) secrets.push({ label: `${c.provider}.${k}`, v })
}
for (const n of ['HELM_CREDENTIAL_KEY', 'HELM_DEMO_PASSWORD']) if (process.env[n]) secrets.push({ label: n, v: process.env[n]! })
const hist = execFileSync('git', ['log', '--all', '-p', '--no-color', '--binary'], { maxBuffer: 1 << 30 }).toString('latin1')
const tree = execFileSync('git', ['grep', '-I', '-c', '-e', '^'], { maxBuffer: 1 << 28 }).toString() // forces index read
let hits = 0
for (const s of secrets) {
  const inHist = hist.includes(s.v)
  let inTree = false
  try { execFileSync('git', ['grep', '-q', '-F', '-e', s.v]); inTree = true } catch { /* not found */ }
  if (inHist || inTree) hits++
  console.log(`${s.label.padEnd(28)} history:${inHist ? 'FOUND' : 'clean'} tree:${inTree ? 'FOUND' : 'clean'}`)
}
console.log(`\n${secrets.length} secret values checked; ${hits} found; tree files indexed: ${tree.split('\n').length - 1}`)
await prisma.$disconnect()
process.exit(hits ? 1 : 0)
