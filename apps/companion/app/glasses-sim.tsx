'use client'
/**
 * Interactive G2 simulator for the web: runs the SAME navigation Controller the glasses run, against any HelmBackend
 * (SampleBackend for the landing demo, a read-only LiveBackend for Vision). Only the real G2 gestures exist here:
 * swipe up / swipe down / tap / double-tap (temple touchpad or R1 ring). Keyboard: ↑ ↓ Enter Esc.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScreenSpec } from '@helm/glasses/src/layout'
import type { RenderAck } from '@helm/glasses/src/render'
import { Controller, type Host } from '@helm/glasses/src/nav/controller'
import type { HelmBackend } from '@helm/glasses/src/nav/backend'
import { SampleBackend } from '@helm/glasses/src/nav/sample'
import { G2Screen } from './ui'

export type SimHandle = { say(t: string): Promise<void> }
type Ids = Partial<Record<'screen' | 'up' | 'down' | 'tap' | 'double', string>>
export function GlassesSim({ make, caption, testId = 'g2sim', ids = {}, autoFocus = false, onView, handle }: { make: () => HelmBackend; caption?: (v: { name: string; backend: string }) => string; testId?: string; ids?: Ids; autoFocus?: boolean; onView?: (name: string) => void; handle?: React.MutableRefObject<SimHandle | null> }) {
  const [spec, setSpec] = useState<ScreenSpec | null>(null)
  const [sel, setSel] = useState(0)
  const [view, setView] = useState({ name: 'starting', backend: '' })
  const [exited, setExited] = useState(false)
  const ctl = useRef<Controller | null>(null)
  const selRef = useRef(0)
  const specRef = useRef<ScreenSpec | null>(null)
  const gen = useRef(0)
  const box = useRef<HTMLDivElement>(null)

  const boot = useCallback(() => {
    const host: Host = {
      render: async s => {
        const prev = specRef.current
        // Firmware behaviour: a rebuilt list (new screen or different rows) starts at row 0; in-place text updates keep the selection.
        const capList = s.lists?.find(l => l.capture)
        const prevList = prev?.lists?.find(l => l.capture)
        if (!prev || prev.key !== s.key || capList?.items.join('|') !== prevList?.items.join('|')) { selRef.current = 0; setSel(0) }
        specRef.current = s; setSpec(s)
        const ack: RenderAck = { ok: true, key: s.key, bind: s.bind, generation: ++gen.current, mode: 'rebuild', degraded: false, images: [], ms: 0 }
        return ack
      },
      exit: () => setExited(true),
      log: () => undefined,
      onView: v => { setView({ name: v.name, backend: v.backend }); onView?.(v.name) },
    }
    const c = new Controller(make(), host)
    c.practiceFactory = () => new SampleBackend('practice')
    ctl.current = c
    if (handle) handle.current = { say: async t => { await c.say(t) } }
    setExited(false)
    void c.start()
  }, [make, onView, handle])
  useEffect(() => { boot() }, [boot])
  useEffect(() => { if (autoFocus) box.current?.focus() }, [autoFocus])

  const list = spec?.lists?.find(l => l.capture)
  const swipe = (dir: 'up' | 'down') => {
    if (list) { // the firmware scrolls list selection itself
      const n = Math.max(0, Math.min(list.items.length - 1, selRef.current + (dir === 'down' ? 1 : -1)))
      selRef.current = n; setSel(n)
    } else void ctl.current?.input({ kind: 'swipe', dir })
  }
  const tap = () => { void ctl.current?.input(list ? { kind: 'tap', source: 'list', index: selRef.current, name: list.name } : { kind: 'tap', source: 'sys' }) }
  const dbl = () => { void ctl.current?.input({ kind: 'double' }) }
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowUp') swipe('up'); else if (k === 'ArrowDown') swipe('down'); else if (k === 'Enter' || k === ' ') tap(); else if (k === 'Escape' || k === 'Backspace') dbl(); else return
    e.preventDefault()
  }
  return (
    <div ref={box} tabIndex={0} onKeyDown={onKey} className="outline-none focus-visible:ring-2 focus-visible:ring-amber-helm/50 rounded-[20px]" data-testid={testId} aria-label="G2 simulator: arrow keys swipe, Enter taps, Escape double-taps">
      <div className="max-w-full overflow-x-auto">
        {exited ? <div className="g2-glass flex items-center justify-center rounded-[18px] border border-graphite-800 text-sm text-graphite-300" style={{ width: 576, height: 288, maxWidth: '100%' }}><div className="text-center"><p>HELM closed (double-tap on Home exits on the glasses).</p><button type="button" className="btn btn-ghost mt-3" onClick={boot} data-testid={`${testId}-restart`}>Reopen</button></div></div>
          : spec ? <G2Screen spec={spec} selected={sel} testId={ids.screen ?? `${testId}-screen`} caption={caption ? caption(view) : `screen: ${view.name}`} />
            : <div className="g2-glass rounded-[18px] border border-graphite-800" style={{ width: 576, height: 288, maxWidth: '100%' }} />}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="G2 gestures">
        <button type="button" className="btn btn-ghost" onClick={() => swipe('up')} disabled={!!list && sel <= 0} title={list && sel <= 0 ? 'Already at the top row' : undefined} data-testid={ids.up ?? `${testId}-up`}>Swipe ↑</button>
        <button type="button" className="btn btn-ghost" onClick={() => swipe('down')} disabled={!!list && sel >= list.items.length - 1} title={list && sel >= list.items.length - 1 ? 'Already at the last row' : undefined} data-testid={ids.down ?? `${testId}-down`}>Swipe ↓</button>
        <button type="button" className="btn btn-amber" onClick={tap} data-testid={ids.tap ?? `${testId}-tap`}>Tap</button>
        <button type="button" className="btn btn-ghost" onClick={dbl} data-testid={ids.double ?? `${testId}-double`}>Double-tap</button>
        <span className="text-xs text-graphite-500">Keys: ↑ ↓ · Enter = tap · Esc = double-tap</span>
      </div>
    </div>
  )
}
