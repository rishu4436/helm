/** Read-only: per demo account, open positions and open orders as the venue reports them (via HELM). Prints no secrets. */
import { demoSession } from './demo-session'
const s = await demoSession()
const pf = (await s.call('GET', '/v1/portfolio')).body.portfolio
const em = (await s.call('GET', '/v1/emergency')).body.items as Array<{ kind: string; instrumentId: string; detail: string }>
for (const a of pf.accounts) if (a.environment === 'demo') console.log(`${a.alias}: positions=${a.positions} openOrders=${a.openOrders} state=${a.state}`)
console.log(`emergency items (all accounts): ${em.length}`, em.map(i => `${i.kind} ${i.instrumentId}`))
await s.close()
