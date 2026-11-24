/** After a demo run: cancel HELM's own resting demo stop/limit orders and report remaining positions/orders (itemized). */
import { demoSession } from './demo-session'
const s = await demoSession()
const open = await s.prisma.order.findMany({ where: { status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] }, environment: { in: ['demo', 'simulated'] } } })
for (const o of open) { const r = await s.call('POST', `/v1/orders/${o.id}/cancel`, { confirm: true }); console.log(`cancel ${o.type} ${o.instrumentId} → ${r.status} ${r.body.receipt?.status ?? r.body.error?.code}`) }
const em = await s.call('GET', '/v1/emergency')
console.log('remaining:', JSON.stringify(em.body.items.map((i: any) => `${i.kind} ${i.instrumentId} ${i.detail}`)))
await s.close()
