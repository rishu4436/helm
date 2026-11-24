/**
 * Wires the user's REAL demo keys (from env) into HELM connections for the demo user, through the API
 * (validated, then sealed with AES-256-GCM in helm_dev). Idempotent by alias. Never prints key material.
 * Also adds the Coinbase static sandbox and HELM SIM accounts (clearly labelled). OKX: BLOCKED (region).
 */
import { demoSession } from './demo-session'
const s = await demoSession()
const existing = (await s.call('GET', '/v1/connections')).body.connections as Array<{ alias: string; state: string; environment: string }>
const want: Array<{ alias: string; payload: Record<string, unknown> | null; why?: string }> = [
  { alias: 'Binance Demo · Spot', payload: process.env.BINANCE_DEMO_API_KEY ? { provider: 'binance', credentials: { apiKey: process.env.BINANCE_DEMO_API_KEY, apiSecret: process.env.BINANCE_DEMO_API_SECRET, market: 'spot' } } : null, why: 'BINANCE_DEMO_API_KEY not set' },
  { alias: 'Binance Demo · USDⓈ-M', payload: process.env.BINANCE_DEMO_API_KEY ? { provider: 'binance', credentials: { apiKey: process.env.BINANCE_DEMO_API_KEY, apiSecret: process.env.BINANCE_DEMO_API_SECRET, market: 'usdm' } } : null, why: 'BINANCE_DEMO_API_KEY not set' },
  { alias: 'Bybit Demo · Unified', payload: process.env.BYBIT_DEMO_API_KEY ? { provider: 'bybit', credentials: { apiKey: process.env.BYBIT_DEMO_API_KEY, apiSecret: process.env.BYBIT_DEMO_API_SECRET } } : null, why: 'BYBIT_DEMO_API_KEY not set' },
  { alias: 'OKX Demo', payload: null, why: 'BLOCKED — OKX unavailable in the user’s region (India); no keys' },
  { alias: 'Coinbase Sandbox', payload: { provider: 'coinbase', credentials: {} } },
  { alias: 'Binance · SIM', payload: { provider: 'binance', simulated: true } },
  { alias: 'Bybit · SIM', payload: { provider: 'bybit', simulated: true } },
]
for (const w of want) {
  const ex = existing.find(e => e.alias === w.alias)
  if (ex) { console.log(`EXISTS  ${w.alias}: ${ex.environment} ${ex.state}`); continue }
  if (!w.payload) { console.log(`SKIP    ${w.alias}: ${w.why}`); continue }
  const r = await s.call('POST', '/v1/connections', { alias: w.alias, ...w.payload })
  console.log(r.status === 201 ? `CREATED ${w.alias}: ${r.body.connection.environment} ${r.body.connection.state} ${JSON.stringify(r.body.connection.reasons)}` : `FAILED  ${w.alias}: ${r.status} ${r.body.error?.code} ${JSON.stringify(r.body.error?.reasons ?? r.body.error?.message)}`)
}
await s.close()
