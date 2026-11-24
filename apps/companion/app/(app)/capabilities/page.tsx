'use client'
import { api, type Manifest } from '@/lib/api'
import { useEffect, useState } from 'react'
import { Btn, Card, EnvPill, ErrorNote, PageHeader, Skeleton } from '../../ui'

const ROWS: Array<[string, (m: Manifest) => boolean | string]> = [
  ['Spot', m => m.spot], ['Futures / perps', m => m.futures], ['Stocks', m => m.stocks],
  ['Market orders', m => m.orderTypes.includes('MARKET')], ['Limit orders', m => m.orderTypes.includes('LIMIT')],
  ['Stop orders', m => m.orderTypes.some(o => o.startsWith('STOP'))], ['Take-profit orders', m => m.orderTypes.some(o => o.startsWith('TAKE_PROFIT'))],
  ['Reduce-only', m => m.reduceOnly], ['Hedge mode', m => m.hedgeMode], ['Margin', m => m.margin], ['Amend / cancel-replace', m => m.cancelReplace],
  ['Market streams', m => m.streaming.market], ['Account streams', m => m.streaming.account],
  ['Execution', m => m.simulation === 'demo_matching_engine' ? 'demo engine' : m.simulation === 'paper_broker' ? 'paper broker' : 'static mock'],
]

export default function Capabilities() {
  const [ms, setMs] = useState<Manifest[]>([])
  const [err, setErr] = useState<Error | null>(null)
  useEffect(() => { api<{ manifests: Manifest[] }>('/v1/capabilities', { auth: false }).then(r => setMs(r.manifests)).catch(e => setErr(e)) }, [])
  const name = (m: Manifest) => `${m.provider}${m.provider === 'binance' ? (m.futures ? ' USDⓈ-M' : ' Spot') : ''}`
  return (
    <div>
      <PageHeader kicker="EXCHANGES" title="Capability matrix" subtitle="What each HELM adapter is built to do in its hackathon environment, from the providers' documentation. A connected account's real permissions are verified separately and can be narrower." actions={<Btn href="/connect">Back to exchanges</Btn>} />
      <ErrorNote error={err} />
      {!ms.length && !err ? <Skeleton h="h-96" /> : (
        <Card pad={false} className="overflow-x-auto">
          <table className="tbl"><thead><tr><th>Capability</th>{ms.map(m => <th key={name(m)} className="capitalize"><div>{name(m)}</div><div className="mt-1"><EnvPill env={m.provider === 'okx' ? 'blocked' : m.environment} /></div></th>)}</tr></thead>
            <tbody>{ROWS.map(([label, f]) => <tr key={label}><td className="text-graphite-300">{label}</td>{ms.map(m => { const v = f(m); return <td key={name(m)}>{typeof v === 'string' ? <span className="text-xs">{v}</span> : v ? <span className="text-up">●</span> : <span className="text-graphite-700">—</span>}</td> })}</tr>)}</tbody>
          </table>
        </Card>
      )}
      <div className="mt-6 space-y-2 text-xs text-graphite-500">{ms.map(m => <p key={name(m)}><b className="capitalize text-graphite-300">{name(m)}:</b> {m.restrictions.join(' · ')}{m.provider === 'okx' ? ' · Logged-in OKX demo is BLOCKED for this team: OKX is unavailable in India. The adapter is built and tested with mocks and public endpoints.' : ''}</p>)}</div>
    </div>
  )
}
