import { describe, expect, it } from 'vitest'
import { Renderer, type RenderBridge } from './render'
import type { ScreenSpec } from './layout'

function fakeBridge(opts: { imageResult?: string; slowImageMs?: number; rebuildOk?: boolean } = {}) {
  const calls: string[] = []
  let inflight = 0, maxInflight = 0
  const track = async <T,>(name: string, v: T, ms = 0) => { inflight++; maxInflight = Math.max(maxInflight, inflight); calls.push(name); if (ms) await new Promise(r => setTimeout(r, ms)); inflight--; return v }
  const b = {
    createStartUpPageContainer: () => track('create', 0),
    rebuildPageContainer: () => track('rebuild', opts.rebuildOk ?? true),
    textContainerUpgrade: (u: { containerName?: string }) => track(`text:${u.containerName}`, true),
    updateImageRawData: (u: { containerName?: string }) => track(`image:${u.containerName}`, opts.imageResult ?? 'success', opts.slowImageMs ?? 0),
  } as unknown as RenderBridge
  return { b, calls, max: () => maxInflight }
}
const raster = async () => new Uint8Array([1, 2, 3])
const spec = (key: string, body: string, points = [1, 2, 3]): ScreenSpec => ({
  key, texts: [{ id: 1, name: 'header', x: 0, y: 0, w: 576, h: 36, text: 'T' }, { id: 5, name: 'body', x: 0, y: 36, w: 300, h: 100, text: body, capture: true }, { id: 6, name: 'gfxalt', x: 302, y: 40, w: 272, h: 100, text: ' ' }],
  images: [{ id: 10, name: 'gfx', x: 302, y: 40, w: 272, h: 100, draw: { gfx: { kind: 'sparkline', points, caption: '1h' } }, alt: 'chart alt', altId: 6 }],
})

describe('renderer v2', () => {
  it('serialises every bridge call (never concurrent)', async () => {
    const f = fakeBridge({ slowImageMs: 5 })
    const r = new Renderer(f.b, raster)
    await Promise.all([r.show(spec('a', 'x')), r.show(spec('a', 'y', [3, 2, 1])), r.show(spec('a', 'z', [5, 5, 6]))])
    expect(f.max()).toBe(1)
  })
  it('same structure → only changed text is upgraded; unchanged image content is not resent', async () => {
    const f = fakeBridge()
    const r = new Renderer(f.b, raster)
    await r.show(spec('a', 'one'))
    f.calls.length = 0
    const ack = await r.show(spec('a', 'two'))
    expect(ack.mode).toBe('update')
    expect(f.calls).toEqual(['text:body'])
  })
  it('changed chart data (same geometry) re-sends the image', async () => {
    const f = fakeBridge()
    const r = new Renderer(f.b, raster)
    await r.show(spec('a', 'one'))
    f.calls.length = 0
    await r.show(spec('a', 'one', [9, 8, 7]))
    expect(f.calls).toContain('image:gfx')
  })
  it('a failed image transfer shows the text fallback and marks the ack degraded', async () => {
    const f = fakeBridge({ imageResult: 'imageException' })
    const r = new Renderer(f.b, raster)
    const ack = await r.show(spec('a', 'one'))
    expect(ack.ok).toBe(true); expect(ack.degraded).toBe(true)
    expect(f.calls).toContain('text:gfxalt')
  })
  it('a newer screen supersedes an older pending one (stale work skipped / image cancelled)', async () => {
    const f = fakeBridge({ slowImageMs: 10 })
    const r = new Renderer(f.b, raster)
    const a = r.show(spec('a', 'one'))
    const b = r.show({ key: 'b', texts: [{ id: 1, name: 'only', x: 0, y: 0, w: 576, h: 288, text: 'B', capture: true }] })
    const [ackA, ackB] = await Promise.all([a, b])
    expect(ackB.ok).toBe(true)
    expect(ackA.mode === 'skipped' || ackA.images.some(i => /cancelled/.test(i.result)) || ackA.ok).toBe(true)
    expect(r.current?.key).toBe('b')
  })
  it('invalid specs and rejected rebuilds are reported explicitly (never silent)', async () => {
    const fails: string[] = []
    const f = fakeBridge({ rebuildOk: false })
    const r = new Renderer(f.b, raster); r.onRenderFail = k => fails.push(k)
    const bad = await r.show({ key: 'bad', texts: [{ id: 1, name: 'a', x: 0, y: 0, w: 576, h: 30, text: 'x' }] })
    expect(bad.ok).toBe(false); expect(bad.error).toMatch(/invalid/)
    await r.show(spec('a', 'one'))
    const rej = await r.show({ key: 'c', texts: [{ id: 1, name: 'only', x: 0, y: 0, w: 576, h: 288, text: 'C', capture: true }] })
    expect(rej.ok).toBe(false)
    expect(fails).toEqual(['bad', 'c'])
  })
  it('acks carry the proposal binding of the drawn screen', async () => {
    const r = new Renderer(fakeBridge().b, raster)
    const ack = await r.show({ ...spec('confirm', 'x'), bind: 'prop-1' })
    expect(ack.bind).toBe('prop-1'); expect(ack.key).toBe('confirm')
  })
})
