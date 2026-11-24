import Link from 'next/link'
import { PROVIDER_INFO } from '@helm/shared'
import { HelmMark } from './components'

const FLOW = ['Observe', 'Understand', 'Prepare', 'Check risk', 'Confirm', 'Execute', 'Verify']

export default function Landing() {
  const providers = Object.values(PROVIDER_INFO)
  return (
    <div className="pt-16">
      <section className="grid items-center gap-12 md:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="mb-5 flex items-center gap-3 text-xs font-semibold tracking-[0.25em] text-amber-helm"><HelmMark size={20} /> FOR EVEN REALITIES G2</div>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">One interface.<br />Every supported exchange.<br /><span className="text-amber-helm">Hands-free.</span></h1>
          <p className="mt-6 max-w-xl text-lg text-graphite-300">HELM connects the exchange and brokerage accounts you already have and puts the one number that matters in front of your eyes. Ask by voice, review the impact, confirm with a deliberate tap. Funds never leave your exchange.</p>
          <div className="mt-8 flex gap-3">
            <Link href="/login" className="btn btn-amber">Create a HELM account</Link>
            <Link href="/capabilities" className="btn btn-ghost">See what each exchange supports</Link>
          </div>
          <p className="mt-6 text-xs text-graphite-500">Hackathon build: signed requests are hard-restricted to demo, paper and sandbox environments. No financial advice.</p>
        </div>
        <figure>
          <div className="g2-glass relative aspect-[2/1] w-full overflow-hidden rounded-2xl border border-graphite-800 p-6">
            <div className="g2-text flex h-full flex-col justify-between text-[15px] leading-[1.6]">
              <div className="flex justify-between"><span>ALL EXCHANGES</span><span>3 accts</span></div>
              <div>
                <div className="text-2xl">BTC exposure  +0.42</div>
                <div className="opacity-80">Binance DEMO long 0.30 · OKX DEMO spot 0.12</div>
                <div className="opacity-80">1 position unprotected</div>
              </div>
              <div className="opacity-70">tap: review · hold: speak · double-tap: back</div>
            </div>
          </div>
          <figcaption className="mt-3 text-xs text-graphite-500">Design illustration of a 576×288 monochrome G2 card (not live data). Real screens render through the Even Hub SDK.</figcaption>
        </figure>
      </section>

      <section className="mt-24">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-graphite-300">EVERY ACTION, THE SAME SEVEN STEPS</h2>
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
          {FLOW.map((s, i) => (
            <li key={s} className="card px-4 py-3"><div className="num text-xs text-amber-helm">{String(i + 1).padStart(2, '0')}</div><div className="mt-1 font-medium">{s}</div></li>
          ))}
        </ol>
      </section>

      <section className="mt-20">
        <h2 className="text-sm font-semibold tracking-[0.2em] text-graphite-300">CONNECT WHAT YOU ALREADY USE</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map(p => (
            <div key={p.id} className="card p-5">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{p.name}</div>
                <span className={`pill ${p.trackEligible ? 'bg-up/15 text-up' : 'bg-graphite-700 text-graphite-300'}`}>{p.trackEligible ? 'track app' : 'disabled'}</span>
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-graphite-500">{p.assetClasses.join(' · ').replace(/_/g, ' ')} — {p.hackathonEnvironment.replace('_', ' ')}</div>
              <p className="mt-3 text-sm text-graphite-300">{p.notes}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
