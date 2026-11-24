'use client'
import { useMemo, useState } from 'react'
import { accountPickScreen, compassScreen, confirmScreen, errorScreen, heardScreen, holdingsScreen, homeScreen, HOME_ITEMS, impactScreen, overviewScreen, pulseScreen, receiptScreen, receiptsScreen, riskScreen } from '@helm/glasses/src/screens/trade'
import type { Acct, PreviewResp, Receipt, VoiceResp } from '@helm/glasses/src/api'
import { parseDeterministic } from '@helm/voice-engine/parser'
import { G2Screen } from '../ui'

/**
 * Landing-page demo. Everything here is SIMULATED SAMPLE DATA computed in the browser:
 * it never calls the HELM API or any exchange. The screens are the real G2 screen builders.
 */
const PX: Record<string, number> = { BTC: 97250, ETH: 3420, SOL: 182.4, BNB: 655 }
const ACCTS: Acct[] = [
  { id: 's-bin', alias: 'Binance (sample)', provider: 'binance', environment: 'demo', environmentLabel: 'SAMPLE', state: 'CONNECTED', canTrade: true, products: ['spot', 'perp'], label: 'SIMULATED SAMPLE DATA' },
  { id: 's-byb', alias: 'Bybit (sample)', provider: 'bybit', environment: 'demo', environmentLabel: 'SAMPLE', state: 'CONNECTED', canTrade: true, products: ['spot', 'perp'], label: 'SIMULATED SAMPLE DATA' },
]
const PORT = {
  accounts: [{ alias: 'Binance (sample)', valueUsd: '5012', environment: 'demo' }, { alias: 'Bybit (sample)', valueUsd: '24870', environment: 'demo' }],
  exposures: [{ asset: 'BTC', netDirectionalUsd: '1945', spotUsd: '0' }, { asset: 'ETH', netDirectionalUsd: '-684', spotUsd: '0' }, { asset: 'USDT', netDirectionalUsd: '0', spotUsd: '27250' }],
  positions: [{ instrumentId: 'bybit:perp:BTC-USDT', side: 'LONG', quantity: '0.02', unrealizedPnl: '14.20', accountId: 's-byb' }, { instrumentId: 'binance:perp:ETH-USDT', side: 'SHORT', quantity: '-0.2', unrealizedPnl: '-3.10', accountId: 's-bin' }],
}
const COMPASS = { largestDirectional: { asset: 'BTC', direction: 'LONG', netUsd: '1945' }, largestExchange: { alias: 'Bybit (sample)', sharePct: '83' }, unprotected: [{}], nearRisk: [], marginWarnings: [], rose: [{ asset: 'BTC', sharePct: '74', direction: 'LONG' }, { asset: 'ETH', sharePct: '26', direction: 'SHORT' }] }
const PULSE = [{ kind: 'UNPROTECTED', severity: 4, reason: 'ETH short on Binance has no stop', count: 1 }, { kind: 'MOVE', severity: 2, reason: 'BTC +1.2% in 15 min', count: 1 }, { kind: 'SPREAD', severity: 1, reason: 'SOL spread 4.1bp on Bybit', count: 2 }]

type St = { s: 'home' | 'overview' | 'holdings' | 'compass' | 'pulse' | 'receipts' | 'heard' | 'pick' | 'impact' | 'risk' | 'confirm' | 'receipt' | 'msg'; sel: number; voice?: VoiceResp; intent?: ReturnType<typeof parseDeterministic>; acct?: Acct; preview?: PreviewResp; receipt?: Receipt; msg?: [string, string] }

function makePreview(i: ReturnType<typeof parseDeterministic>, a: Acct): PreviewResp {
  const asset = i.asset ?? 'BTC', px = PX[asset] ?? 100, notional = Number(i.notional ?? 100), perp = i.product === 'perp' || !!i.leverage || !!i.stopOffsetPercent
  const side = i.side ?? 'BUY', stop = i.stopOffsetPercent
  const cur = asset === 'BTC' ? 1945 : asset === 'ETH' ? -684 : 0
  return {
    proposalId: 'sample', confirmToken: 'sample', expiresAt: new Date(Date.now() + 45000).toISOString(), canConfirm: true, label: 'SIMULATED SAMPLE DATA · nothing is sent',
    account: { id: a.id, alias: a.alias, provider: a.provider, environmentLabel: 'SAMPLE', connectionState: 'CONNECTED' },
    order: { instrument: `${a.provider}:${perp ? 'perp' : 'spot'}:${asset}-USDT`, side, type: 'MARKET', quantity: (notional / px).toFixed(asset === 'BTC' ? 3 : 2), leverage: perp ? (i.leverage ?? '2') : undefined },
    preview: { estimatedPrice: String(px), estimatedNotional: String(notional), estimatedFee: (notional * 0.0005).toFixed(3), estimatedSlippageBps: '0.6', requiredMargin: perp ? String(notional / Number(i.leverage ?? 2)) : null, remainingBuyingPower: String(5012 - notional), estimateNotes: [],
      impact: { asset, currentExposureUsd: String(cur), proposedExposureUsd: String(cur + (side === 'BUY' ? notional : -notional)), currentPositionQty: '0', proposedPositionQty: '0', spreadBps: '0.4', liquidation: { current: null, proposed: null, note: '' } },
      protection: stop ? { stopOffsetPercent: stop, estimatedStopPrice: String(px * (1 + (side === 'BUY' ? -1 : 1) * Number(stop) / 100)), supported: true, note: '' } : null },
    risk: { verdict: notional > 1000 ? 'WARN' : 'ALLOW', findings: notional > 1000 ? [{ rule: 'max_notional', verdict: 'WARN', message: 'Above your $1,000 per-order comfort limit' }] : [], policyVersion: 1 },
  }
}
function makeReceipt(p: PreviewResp): Receipt {
  return { orderId: 'sample', account: p.account.alias, provider: p.account.provider, environmentLabel: 'SAMPLE', label: 'SIMULATED sample — no order exists', instrumentId: p.order.instrument, side: p.order.side, type: 'MARKET', status: 'FILLED', providerOrderId: null, quantity: p.order.quantity ?? null, quoteQuantity: null, filledQuantity: p.order.quantity ?? '0', avgFillPrice: p.preview.estimatedPrice, fills: [{ price: p.preview.estimatedPrice ?? '0', qty: p.order.quantity ?? '0', fee: p.preview.estimatedFee, feeAsset: 'USDT' }], protection: p.preview.protection ? { state: 'ACTIVE (sample)', stopPrice: p.preview.protection.estimatedStopPrice, protectedQuantity: p.order.quantity ?? '0' } : null, fillTruth: 'sample', events: [] }
}
const SAMPLE_RECEIPTS = [makeReceipt(makePreview({ ...parseDeterministic('long 150 dollars of btc on bybit with a 3% stop') }, ACCTS[1]))]

export function LandingDemo() {
  const [st, setSt] = useState<St>({ s: 'home', sel: 0 })
  const [say, setSay] = useState('Long 150 dollars of BTC with a 3% stop')
  const [log, setLog] = useState<string[]>([])
  const spec = useMemo(() => {
    switch (st.s) {
      case 'home': return homeScreen('you', true)
      case 'overview': return overviewScreen(PORT)
      case 'holdings': return holdingsScreen(PORT)
      case 'compass': return compassScreen(COMPASS, '29882')
      case 'pulse': return pulseScreen(PULSE)
      case 'receipts': return receiptsScreen(SAMPLE_RECEIPTS)
      case 'heard': return heardScreen(st.voice!)
      case 'pick': return accountPickScreen(ACCTS)
      case 'impact': return impactScreen(st.preview!)
      case 'risk': return riskScreen(st.preview!)
      case 'confirm': return confirmScreen(st.preview!)
      case 'receipt': return receiptScreen(st.receipt!)
      case 'msg': return errorScreen(st.msg![0], st.msg![1])
    }
  }, [st])
  const listLen = spec.lists?.[0]?.items.length ?? 0
  const note = (m: string) => setLog(l => [m, ...l].slice(0, 5))
  function speak(text = say) {
    const intent = parseDeterministic(text)
    const trade = ['PLACE_ORDER'].includes(intent.intent)
    const acct = intent.provider ? ACCTS.find(a => a.provider === intent.provider) : undefined
    const v: VoiceResp = { transcript: text, sttProvider: 'typed', sttLabel: 'demo', intent: { intent: intent.intent, asset: intent.asset ?? null, side: intent.side ?? null, product: intent.product ?? null, notional: intent.notional ?? null, quantity: intent.quantity ?? null, fraction: intent.fraction ?? null, leverage: intent.leverage ?? null, stopOffsetPercent: intent.stopOffsetPercent ?? null, provider: intent.provider ?? null },
      resolution: acct ? { status: 'resolved', account: acct } : { status: 'needs_account', question: 'Which exchange?' },
      next: { screen: intent.intent === 'UNKNOWN' ? 'not_understood' : trade ? (acct ? 'impact' : 'account_pick') : 'query', message: intent.intent === 'UNKNOWN' ? 'Not a HELM command. Nothing happens.' : trade ? (acct ? undefined : 'Which exchange?') : 'Opens the matching read-only screen' } }
    setSt({ s: 'heard', sel: 0, voice: v, intent, acct })
    note(`Parsed “${text}” → ${intent.intent}`)
  }
  function tap() {
    const s = st
    if (s.s === 'home') { const item = HOME_ITEMS[s.sel]; const map: Record<string, St['s']> = { Overview: 'overview', 'Positions & holdings': 'holdings', Pulse: 'pulse', 'Exposure Compass': 'compass', Receipts: 'receipts' }
      if (map[item]) return setSt({ s: map[item], sel: 0 })
      if (item === 'Voice command' || item === 'Trade') return speak()
      return setSt({ s: 'msg', sel: 0, msg: [item.toUpperCase(), 'Available in the real app. This landing demo covers overview, positions, Pulse, Compass, receipts and the voice → confirm flow.'] }) }
    if (s.s === 'heard') {
      if (s.voice!.next.screen === 'impact') return setSt({ ...s, s: 'impact', preview: makePreview(s.intent!, s.acct!) })
      if (s.voice!.next.screen === 'account_pick') return setSt({ ...s, s: 'pick', sel: 0 })
      if (s.voice!.next.screen === 'query') { const m: Record<string, St['s']> = { QUERY_POSITIONS: 'holdings', QUERY_EXPOSURE: 'compass', QUERY_PORTFOLIO: 'overview', QUERY_BALANCE: 'overview', QUERY_UNPROTECTED: 'compass' }; return setSt({ s: m[s.intent!.intent] ?? 'overview', sel: 0 }) }
      return setSt({ s: 'home', sel: 0 })
    }
    if (s.s === 'pick') { const a = ACCTS[s.sel]; note(`Chose ${a.alias}`); return setSt({ ...s, s: 'impact', acct: a, preview: makePreview(s.intent!, a) }) }
    if (s.s === 'impact') return setSt({ ...s, s: 'risk' })
    if (s.s === 'risk') return setSt({ ...s, s: 'confirm', sel: 0 })
    if (s.s === 'confirm') {
      if (s.sel === 0) { note('Cancelled — Cancel is the default selection'); return setSt({ s: 'home', sel: 0 }) }
      note('Confirmed (simulated) — sample receipt only'); return setSt({ ...s, s: 'receipt', receipt: makeReceipt(s.preview!) })
    }
    setSt({ s: 'home', sel: 0 })
  }
  const back = () => { setSt({ s: 'home', sel: 0 }); note('Double-tap: back') }
  const move = (d: number) => setSt({ ...st, sel: Math.max(0, Math.min(listLen - 1, st.sel + d)) })
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[600px_1fr]">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-amber-helm"><span className="pill bg-amber-helm/15 text-amber-helm">SIMULATED SAMPLE DATA</span><span className="text-graphite-500">runs in your browser · nothing is sent</span></div>
        <div className="max-w-full overflow-hidden"><G2Screen spec={spec} selected={st.sel} testId="landing-g2" caption={`Real HELM G2 screen builder: ${spec.key}. Sample numbers, not an account.`} /></div>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Simulated R1 ring">
          <button className="btn btn-ghost" onClick={() => move(-1)} disabled={st.sel <= 0} data-testid="ring-up">Swipe ↑</button>
          <button className="btn btn-ghost" onClick={() => move(1)} disabled={st.sel >= listLen - 1} data-testid="ring-down">Swipe ↓</button>
          <button className="btn btn-amber" onClick={tap} data-testid="ring-tap">Tap</button>
          <button className="btn btn-ghost" onClick={back} data-testid="ring-back">Double-tap</button>
        </div>
      </div>
      <div className="space-y-4">
        <div className="card p-5">
          <div className="text-xs font-semibold tracking-[0.2em] text-graphite-300">SAY SOMETHING (TYPED)</div>
          <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); speak() }}>
            <input className="input" value={say} onChange={e => setSay(e.target.value)} aria-label="Command" data-testid="demo-say" />
            <button className="btn btn-amber" type="submit" data-testid="demo-speak">Speak</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">{['Buy 100 dollars of BTC on Bybit', 'Short 200 dollars of ETH on Binance with a 2% stop', 'Show all my positions', 'Withdraw all my bitcoin'].map(t => <button key={t} className="btn btn-quiet text-xs" onClick={() => { setSay(t); speak(t) }}>“{t}”</button>)}</div>
          <p className="mt-3 text-xs text-graphite-500">Parsed by HELM&apos;s real deterministic grammar parser (no model). Leave out the exchange and HELM asks <em>Which exchange?</em> — it never guesses. Withdrawals aren&apos;t a HELM command.</p>
        </div>
        <div className="card p-5 text-sm">
          <div className="text-xs font-semibold tracking-[0.2em] text-graphite-300">WHAT JUST HAPPENED</div>
          {log.length ? <ul className="mt-2 space-y-1 text-graphite-300">{log.map((l, i) => <li key={i}>• {l}</li>)}</ul> : <p className="mt-2 text-graphite-500">Swipe and tap the ring buttons, or speak a command. On Confirm, Cancel is selected by default — swipe down to reach Confirm.</p>}
        </div>
      </div>
    </div>
  )
}
