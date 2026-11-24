/** Approve a G2 pairing code as the demo user (what the Companion → Devices page does). Usage: tsx scripts/approve-pairing.ts CODE */
import { demoSession } from './demo-session'
const s = await demoSession()
const r = await s.call('POST', '/v1/pairing/approve', { code: process.argv[2], label: 'Even G2 (simulator)' })
console.log(r.status, JSON.stringify(r.body).slice(0, 200))
await s.close()
