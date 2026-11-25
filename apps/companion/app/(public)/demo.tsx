'use client'
import { useCallback, useRef, useState } from 'react'
import { SampleBackend } from '@helm/glasses/src/nav/sample'
import { GlassesSim, type SimHandle } from '../glasses-sim'

/**
 * Landing-page demo: the real G2 navigation controller and screens, running in the browser against
 * SIMULATED SAMPLE DATA. It never calls the HELM API or any exchange.
 */
const EXAMPLES = ['Buy 100 dollars of BTC on Bybit', 'Protect my BTC long with a 3% stop', 'Show my ETH market', 'Withdraw all my bitcoin']

export function LandingDemo() {
  const sim = useRef<SimHandle | null>(null)
  const [say, setSay] = useState('Buy 100 dollars of BTC on Bybit')
  const [trail, setTrail] = useState<string[]>([])
  const make = useCallback(() => new SampleBackend('sample'), [])
  const onView = useCallback((name: string) => setTrail(t => (t[t.length - 1] === name ? t : [...t, name].slice(-8))), [])
  const speak = (t = say) => { if (t.trim()) void sim.current?.say(t.trim()) }
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[600px_1fr]">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-amber-helm"><span className="pill bg-amber-helm/15 text-amber-helm">SIMULATED SAMPLE DATA</span><span className="text-graphite-500">runs in your browser · nothing is sent</span></div>
        <GlassesSim make={make} handle={sim} onView={onView} ids={{ screen: 'landing-g2', up: 'ring-up', down: 'ring-down', tap: 'ring-tap', double: 'ring-back' }} caption={v => `The real HELM G2 app: ${v.name}. Sample numbers, not an account.`} />
      </div>
      <div className="space-y-4">
        <div className="card p-5">
          <div className="text-xs font-semibold tracking-[0.2em] text-graphite-300">SAY SOMETHING (TYPED)</div>
          <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); speak() }}>
            <input className="input" value={say} onChange={e => setSay(e.target.value)} aria-label="Command" data-testid="demo-say" />
            <button className="btn btn-amber" type="submit" data-testid="demo-speak">Speak</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map(t => <button key={t} type="button" className="btn btn-quiet text-xs" onClick={() => { setSay(t); speak(t) }}>“{t}”</button>)}</div>
          <p className="mt-3 text-xs text-graphite-500">HELM reads the command against what is on screen. It never guesses the exchange, asset or size: if one is missing, it asks. Withdrawals aren&apos;t a HELM command.</p>
        </div>
        <div className="card p-5 text-sm">
          <div className="text-xs font-semibold tracking-[0.2em] text-graphite-300">HOW TO DRIVE IT</div>
          <ul className="mt-2 space-y-1 text-graphite-300">
            <li>• <b>Swipe</b> moves the highlight. <b>Tap</b> opens it. <b>Double-tap</b> goes back (or cancels).</li>
            <li>• On Confirm, <b>Cancel</b> is highlighted first. Swipe down to reach Confirm, then tap.</li>
            <li>• Same gestures as the G2 temple touchpad and the R1 ring. Keyboard: ↑ ↓ Enter Esc.</li>
          </ul>
          {trail.length > 0 && <p className="mt-3 text-xs text-graphite-500" data-testid="demo-trail">Path: {trail.join(' → ')}</p>}
        </div>
      </div>
    </div>
  )
}
