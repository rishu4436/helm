'use client'
import { useCallback, useState } from 'react'
import { LiveBackend } from '@helm/glasses/src/nav/live'
import { setApiBase } from '@helm/glasses/src/api'
import { API, getToken } from '@/lib/api'
import { Btn, Card, PageHeader } from '../../ui'
import { GlassesSim } from '../../glasses-sim'

/** Vision: the real G2 app (same controller and screens) on your live demo data. Read-only: Confirm never executes here. */
export default function Vision() {
  const [seed, setSeed] = useState(0)
  const make = useCallback(() => { setApiBase(API); return new LiveBackend(() => getToken() ?? '', false, 'companion') }, [seed]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader kicker="GLASSES" title="Vision" subtitle="The real G2 app, running here on your connected demo accounts: the same navigation and the same 576×288 screens. Read-only: previews work, Confirm never executes from this mirror." actions={<><Btn onClick={() => setSeed(s => s + 1)} testId="vision-restart">Restart</Btn><Btn href="/devices">Pair glasses</Btn></>} />
      <div className="grid items-start gap-6 xl:grid-cols-[600px_1fr]">
        <GlassesSim key={seed} make={make} autoFocus ids={{ screen: 'vision-g2', up: 'vision-up', down: 'vision-down', tap: 'vision-tap', double: 'vision-back' }} caption={v => `screen: ${v.name} · live demo data · read-only mirror`} />
        <Card title="How to use it">
          <ul className="space-y-2 text-sm text-graphite-300">
            <li>• <b>Swipe</b> moves the highlight, <b>tap</b> opens, <b>double-tap</b> goes back. The same gestures as the R1 ring and the temple touchpads. Keyboard: ↑ ↓ Enter Esc.</li>
            <li>• Home leads with what needs attention. Portfolio, positions, holdings, markets and activity are each one or two taps away.</li>
            <li>• Values come from your exchange demo accounts. A stop shows as active only when the exchange lists it.</li>
            <li>• This mirror can build and preview orders but cannot confirm them. Confirm on the glasses or in Terminal; Cancel is always selected first.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
