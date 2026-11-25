import Link from 'next/link'
import { PROVIDER_INFO } from '@helm/shared'
import { HelmMark } from '../brand'
import { LandingDemo } from './demo'
import { TryDemoButton } from './try-demo'

const FLOW = ['Observe', 'Understand', 'Prepare', 'Check risk', 'Confirm', 'Execute', 'Verify']
const SAFETY: Array<[string, string]> = [
  ['Demo, paper and sandbox only', 'Signed requests are hard-restricted to an allow-list of demo / paper / sandbox hosts. A production host is refused before any network call.'],
  ['Every order is previewed', 'Impact, fees, exposure change and Shield policy checks first. Each preview carries a single-use 45-second confirm token.'],
  ['Protection is never assumed', 'A stop shows as active only after the exchange lists it. If a stop can’t be placed, the receipt says so.'],
  ['No blind retries', 'If an exchange times out, HELM reconciles by client order id instead of resubmitting.'],
  ['“Which exchange?”', 'An ambiguous command never guesses a venue. “Close everything” is never broadcast — it becomes an itemized, reduce-only review.'],
  ['Funds never move', 'Trade-only keys. HELM never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permission.'],
]
const STATUS: Record<string, [string, string]> = {
  binance: ['DEMO', 'Live in the flagship demo (Spot + USDⓈ-M).'], bybit: ['DEMO', 'Live in the flagship demo (Unified).'],
  okx: ['DEMO', 'Demo Trading key + secret + passphrase; x-simulated-trading on every request.'], coinbase: ['STATIC SANDBOX', 'Predefined mocked responses — never shown as fills.'],
  ibkr: ['PAPER', 'Via local Client Portal Gateway.'], alpaca: ['DISABLED', 'Not in the track app list.'],
}

export default function Landing() {
  return (
    <div className="pt-16">
      <section className="grid items-center gap-12">
        <div className="max-w-3xl">
          <div className="mb-5 flex items-center gap-3 text-xs font-semibold tracking-[0.25em] text-amber-helm"><HelmMark size={20} /> FOR EVEN REALITIES G2</div>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">Every exchange.<br />One glance.<br /><span className="text-amber-helm">Nothing executes unseen.</span></h1>
          <p className="mt-6 max-w-2xl text-lg text-graphite-300">HELM is a trading command center for your G2 glasses. It connects the exchange accounts you already have, shows the exposure that matters, and turns a spoken command into a previewed, risk-checked order you confirm with a deliberate tap.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <TryDemoButton label="Try the demo" />
            <a href="#demo" className="btn btn-ghost">Interactive glasses demo</a>
            <Link href="/login?mode=register" className="btn btn-ghost">Create a HELM account</Link>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-graphite-400">One click creates a guest session with simulated Binance, Bybit and OKX accounts — labelled SIMULATED, no API keys, nothing sent to any exchange.</p>
          <p className="mt-6 text-xs text-graphite-500">Hackathon build · live trading is switched off · not financial advice.</p>
        </div>
      </section>

      <section id="demo" className="mt-20 scroll-mt-20">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-graphite-300">INTERACTIVE DEMO</h2>
        <p className="mb-6 mt-2 max-w-2xl text-graphite-300">Drive the glasses with a simulated R1 ring. The screens are HELM&apos;s real G2 layouts at 576×288; the numbers are simulated sample data.</p>
        <LandingDemo />
      </section>

      <section id="how" className="mt-24 scroll-mt-20">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-graphite-300">HOW IT WORKS — EVERY ACTION, THE SAME SEVEN STEPS</h2>
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
          {FLOW.map((s, i) => <li key={s} className="card px-4 py-3"><div className="num text-xs text-amber-helm">{String(i + 1).padStart(2, '0')}</div><div className="mt-1 font-medium">{s}</div></li>)}
        </ol>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[['Speak', 'Hold the ring and talk. Local speech-to-text (faster-whisper on the HELM server) and a deterministic parser — no LLM decides your trade.'], ['Review', 'Impact, fees, exposure change and Shield checks on the lens. A companion web app shows the same preview in full.'], ['Verify', 'Receipts show exchange-confirmed fills, protection state and any orphan stops HELM cleaned up.']].map(([t, d]) => <div key={t} className="card p-5"><div className="font-semibold">{t}</div><p className="mt-2 text-sm text-graphite-300">{d}</p></div>)}
        </div>
      </section>

      <section id="safety" className="mt-24 scroll-mt-20">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-graphite-300">SAFETY, BY CONSTRUCTION</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{SAFETY.map(([t, d]) => <div key={t} className="card p-5"><div className="font-semibold">{t}</div><p className="mt-2 text-sm text-graphite-300">{d}</p></div>)}</div>
      </section>

      <section id="exchanges" className="mt-24 scroll-mt-20">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-graphite-300">EXCHANGES</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.values(PROVIDER_INFO).map(p => { const [tag, line] = STATUS[p.id]; return (
            <div key={p.id} className="card p-5">
              <div className="flex items-center justify-between"><div className="font-semibold">{p.name}</div><span className={`pill ${tag === 'DEMO' || tag === 'PAPER' ? 'bg-up/15 text-up' : tag === 'BLOCKED' ? 'bg-down/15 text-down' : 'bg-graphite-700 text-graphite-300'}`}>{tag}</span></div>
              <div className="mt-1 text-xs uppercase tracking-wider text-graphite-500">{p.assetClasses.join(' · ').replace(/_/g, ' ')}</div>
              <p className="mt-3 text-sm text-graphite-300">{line}</p>
            </div>) })}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-3"><TryDemoButton label="Try the demo" /><Link href="/login?mode=register" className="btn btn-ghost">Create a HELM account</Link><Link href="/login" className="btn btn-ghost">Sign in</Link></div>
      </section>
    </div>
  )
}
