'use client'
import { useEffect, useState } from 'react'
import { api, type Manifest } from '@/lib/api'
import { EnvPill } from '../components'

const ROWS: Array<[string, (m: Manifest) => boolean | string]> = [
  ['Spot', m => m.spot], ['Futures / perps', m => m.futures], ['Stocks', m => m.stocks],
  ['Market orders', m => m.orderTypes.includes('MARKET')], ['Limit orders', m => m.orderTypes.includes('LIMIT')],
  ['Stop orders', m => m.orderTypes.some(o => o.startsWith('STOP'))], ['Take-profit orders', m => m.orderTypes.some(o => o.startsWith('TAKE_PROFIT'))],
  ['Reduce-only', m => m.reduceOnly], ['Hedge mode', m => m.hedgeMode], ['Margin', m => m.margin], ['Amend / cancel-replace', m => m.cancelReplace],
  ['Market streams', m => m.streaming.market], ['Account streams', m => m.streaming.account],
  ['Execution', m => m.simulation === 'demo_matching_engine' ? 'demo engine' : m.simulation === 'paper_broker' ? 'paper broker' : 'static mock'],
]

export default function Capabilities() {
  const [ms, setMs] = useState<Array<Manifest & { note?: string }>>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<{ manifests: Manifest[] }>('/v1/capabilities', { auth: false }).then(r => setMs(r.manifests)).catch(e => setErr(e.message)) }, [])
  const name = (m: Manifest) => `${m.provider}${m.provider === 'binance' ? (m.futures ? ' USDⓈ-M' : ' Spot') : ''}`
  return (
    <div className="pt-10">
      <h1 className="text-3xl font-semibold">Capability matrix</h1>
      <p className="mt-2 max-w-3xl text-graphite-300">What each HELM adapter is built to do in its hackathon environment, from the providers&apos; documentation. A connected account&apos;s real permissions are verified separately and can be narrower.</p>
      {err && <p className="mt-4 text-down">{err}</p>}
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-graphite-300"><th className="p-3">Capability</th>{ms.map(m => <th key={name(m)} className="p-3 capitalize"><div>{name(m)}</div><div className="mt-1"><EnvPill env={m.environment} /></div></th>)}</tr></thead>
          <tbody>
            {ROWS.map(([label, f]) => (
              <tr key={label} className="border-t border-graphite-800">
                <td className="p-3 text-graphite-300">{label}</td>
                {ms.map(m => { const v = f(m); return <td key={name(m)} className="p-3">{typeof v === 'string' ? <span className="text-xs">{v}</span> : v ? <span className="text-up">●</span> : <span className="text-graphite-700">—</span>}</td> })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 space-y-2 text-xs text-graphite-500">{ms.map(m => <p key={name(m)}><b className="capitalize text-graphite-300">{name(m)}:</b> {m.restrictions.join(' · ')}</p>)}</div>
    </div>
  )
}
