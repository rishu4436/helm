'use client'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { useApi } from '@/lib/hooks'
import { ist, qty, sym, usd } from '@/lib/format'
import type { FullReceipt } from '@/lib/types'
import { Btn, Card, Empty, ErrorNote, Modal, PageHeader, Pill, Segmented, Skeleton } from '../../ui'
import { ReceiptView } from '../../trade-flow'

function History() {
  const q = useSearchParams()
  const rc = useApi<{ receipts: FullReceipt[] }>('/v1/receipts')
  const [env, setEnv] = useState<'all' | 'demo' | 'sim'>('all')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState<FullReceipt | null>(null)
  const list = (rc.data?.receipts ?? []).filter(r => (env === 'all' || (env === 'demo' ? r.environment === 'demo' || r.environment === 'paper' : !(r.environment === 'demo' || r.environment === 'paper'))) && (status === 'all' || r.status === status))
  useEffect(() => { const id = q.get('order'); if (id && rc.data) setOpen(rc.data.receipts.find(r => r.orderId === id) ?? null) }, [q, rc.data])
  const [exported, setExported] = useState<string | null>(null)
  function exportCsv() {
    const rows = [['created_ist', 'account', 'environment', 'instrument', 'side', 'type', 'status', 'filled_qty', 'avg_price', 'exchange_order_id', 'confirmed_via', 'protection'], ...list.map(r => [ist(r.createdAt), r.account, r.environmentLabel, r.instrumentId, r.side, r.type, r.status, r.filledQuantity, r.avgFillPrice ?? '', r.providerOrderId ?? '', r.confirmedVia ?? '', r.protection?.state ?? ''])]
    const blob = new Blob([rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'helm-receipts.csv'; a.click(); URL.revokeObjectURL(a.href)
    setExported(`Exported ${rows.length - 1} receipt(s) to helm-receipts.csv`)
  }
  const statuses = ['all', ...Array.from(new Set((rc.data?.receipts ?? []).map(r => r.status)))]
  return (
    <div>
      <PageHeader kicker="HISTORY & RECEIPTS" title="Every order, with its full story" subtitle="Each receipt shows what you confirmed, what the exchange reported, the fills, fees, protection and every state change. SIMULATED and STATIC SANDBOX results are labelled and never presented as exchange fills."
        actions={<><Segmented value={env} onChange={setEnv} options={[['all', 'All'], ['demo', 'Demo exchanges'], ['sim', 'SIM / sandbox']]} testId="hist-env" /><select className="input h-9 w-40 py-1" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">{statuses.map(s => <option key={s}>{s}</option>)}</select><Btn onClick={exportCsv} disabled={!list.length}>Export CSV</Btn></>} />
      {exported && <p role="status" className="mb-3 text-xs text-up" data-testid="export-status">{exported}</p>}
      <ErrorNote error={rc.error} onRetry={rc.reload} />
      <Card pad={false}>
        {!rc.data ? <div className="p-5"><Skeleton /></div> : list.length === 0 ? <div className="p-5"><Empty title="No receipts match" action={<Btn href="/terminal" variant="amber">Place a demo trade</Btn>} /></div> : (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>When</th><th>Instrument</th><th>Account</th><th>Side</th><th>Status</th><th className="r">Filled</th><th className="r">Avg price</th><th>Protection</th><th>Via</th><th></th></tr></thead>
            <tbody>{list.map(r => (
              <tr key={r.orderId} data-testid="receipt-row"><td className="whitespace-nowrap text-xs text-graphite-300">{ist(r.createdAt)}</td><td className="font-medium">{sym(r.instrumentId).label}{r.reduceOnly ? <span className="ml-1 text-[10px] text-graphite-500">RO</span> : null}</td><td className="text-xs">{r.account} <span className="text-graphite-500">{r.environmentLabel}</span></td><td>{r.side}</td><td><Pill v={r.status} /></td><td className="r num">{qty(r.filledQuantity)}</td><td className="r num">{usd(r.avgFillPrice)}</td><td>{r.protection ? <Pill v={r.protection.state} /> : <span className="text-xs text-graphite-500">—</span>}</td><td className="text-xs text-graphite-500">{r.confirmedVia ?? '—'}</td><td className="text-right"><Btn variant="quiet" onClick={() => setOpen(r)}>Receipt</Btn></td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
      <Modal open={!!open} title="Receipt" wide onClose={() => setOpen(null)}>{open && <ReceiptView r={open} />}</Modal>
    </div>
  )
}
export default function Page() { return <Suspense><History /></Suspense> }
