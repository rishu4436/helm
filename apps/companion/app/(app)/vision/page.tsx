'use client'
import { useMemo, useState } from 'react'
import * as T from '@helm/glasses/src/screens/trade'
import type { Receipt } from '@helm/glasses/src/api'
import { useApi } from '@/lib/hooks'
import { Btn, Card, ErrorNote, G2Screen, PageHeader, Segmented, Skeleton } from '../../ui'
import { useShell } from '../../shell'

type Key = 'home' | 'overview' | 'holdings' | 'watchlist' | 'pulse' | 'compass' | 'receipts' | 'receipt' | 'emergency'
const TABS: Array<[Key, string]> = [['home', 'Home'], ['overview', 'Overview'], ['holdings', 'Positions'], ['watchlist', 'Watchlist'], ['pulse', 'Pulse'], ['compass', 'Compass'], ['receipts', 'Receipts'], ['emergency', 'Emergency']]
const FROM_HOME: Record<string, Key> = { Overview: 'overview', 'Positions & holdings': 'holdings', Watchlist: 'watchlist', Pulse: 'pulse', 'Exposure Compass': 'compass', Receipts: 'receipts', 'Emergency review': 'emergency' }

export default function Vision() {
  const { me } = useShell()
  const [key, setKey] = useState<Key>('home')
  const [sel, setSel] = useState(0)
  const [rIdx, setRIdx] = useState(0)
  const port = useApi<{ portfolio: unknown }>('/v1/portfolio', { poll: 15000 })
  const comp = useApi<{ compass: unknown; netLiquidationUsd: string }>('/v1/shield/compass', { poll: 15000 })
  const pulse = useApi<{ events: Array<{ kind: string; severity: number; reason: string; count: number }> }>('/v1/pulse', { poll: 15000 })
  const rec = useApi<{ receipts: Receipt[] }>('/v1/receipts', { poll: 15000 })
  const em = useApi<{ items: Array<{ kind: string; detail: string; instrumentId: string }> }>('/v1/emergency', { poll: 15000 })
  const wl = useApi<{ items: Array<{ asset: string; price: string | null }> }>('/v1/markets/watchlist', { poll: 15000 })
  const err = port.error ?? comp.error ?? pulse.error ?? rec.error ?? em.error ?? wl.error
  const spec = useMemo(() => {
    switch (key) {
      case 'home': return T.homeScreen(me?.displayName ?? me?.email ?? 'you', false)
      case 'overview': return port.data ? T.overviewScreen(port.data.portfolio) : null
      case 'holdings': return port.data ? T.holdingsScreen(port.data.portfolio) : null
      case 'watchlist': return wl.data ? T.watchlistScreen(wl.data.items) : null
      case 'pulse': return pulse.data ? T.pulseScreen(pulse.data.events) : null
      case 'compass': return comp.data ? T.compassScreen(comp.data.compass, comp.data.netLiquidationUsd) : null
      case 'receipts': return rec.data ? T.receiptsScreen(rec.data.receipts) : null
      case 'receipt': return rec.data?.receipts[rIdx] ? T.receiptScreen(rec.data.receipts[rIdx]) : null
      case 'emergency': return em.data ? T.emergencyScreen(em.data.items) : null
    }
  }, [key, me, port.data, wl.data, pulse.data, comp.data, rec.data, em.data, rIdx])
  const len = spec?.lists?.[0]?.items.length ?? 0
  function open(k: Key) { setKey(k); setSel(0) }
  function tap() {
    if (key === 'home') { const k = FROM_HOME[T.HOME_ITEMS[sel]]; if (k) open(k); else open('home'); return }
    if (key === 'receipts' && rec.data?.receipts.length) { setRIdx(sel); setKey('receipt'); return }
    if (key === 'receipt') return open('home')
    void Promise.all([port.reload(), comp.reload(), pulse.reload(), rec.reload(), em.reload(), wl.reload()])
  }
  return (
    <div>
      <PageHeader kicker="GLASSES" title="Vision" subtitle="A live mirror of what your G2 shows right now. These are the same screen builders the glasses run (576×288, monochrome green), fed with your real demo-account data." actions={<Btn href="/devices">Pair glasses</Btn>} />
      <ErrorNote error={err} />
      <div className="mb-5"><Segmented value={key === 'receipt' ? 'receipts' : key} onChange={v => open(v)} options={TABS} testId="vision-tabs" /></div>
      <div className="grid items-start gap-6 xl:grid-cols-[600px_1fr]">
        <div>
          {spec ? <div className="max-w-full overflow-x-auto"><G2Screen spec={spec} selected={sel} testId="vision-g2" caption={`screen: ${spec.key} · live data`} /></div> : <div style={{ width: 576, height: 288 }} className="max-w-full"><Skeleton h="h-[288px]" /></div>}
          <div className="mt-3 flex flex-wrap gap-2" aria-label="R1 ring">
            <Btn onClick={() => setSel(s => Math.max(0, s - 1))} disabled={!len} testId="vision-up">Swipe ↑</Btn>
            <Btn onClick={() => setSel(s => Math.min(len - 1, s + 1))} disabled={!len} testId="vision-down">Swipe ↓</Btn>
            <Btn variant="amber" onClick={tap} testId="vision-tap">Tap</Btn>
            <Btn onClick={() => open('home')} testId="vision-back">Double-tap</Btn>
          </div>
        </div>
        <Card title="How the lens is built">
          <ul className="space-y-2 text-sm text-graphite-300">
            <li>• Every screen is a pure function of an API payload, unit-tested to fit the G2 display and SDK limits (≤ 4 text boxes, 20 list rows, byte-clipped rows).</li>
            <li>• Swipe moves the selection, tap opens, double-tap goes back — the same gestures as the R1 ring and the temple touchpads.</li>
            <li>• The lens never shows a stop as active unless the exchange lists it; receipts show exchange-confirmed fills only.</li>
            <li>• Trading from the glasses always runs impact → risk → confirm, with Cancel selected by default. This mirror is read-only: start trades from the Terminal or Voice Studio.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
