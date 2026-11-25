import {
  CreateStartUpPageContainer, ImageContainerProperty, ImageRawDataUpdate, ListContainerProperty, ListItemContainerProperty,
  RebuildPageContainer, TextContainerProperty, TextContainerUpgrade, type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { clipBytes, imagePrint, structureSignature, validateSpec, type ImageBox, type ScreenSpec } from './layout'

/** The G2 firmware font lacks some glyphs (e.g. Ⓢ in "USDⓈ-M", ✓); map them to safe ASCII. */
export const g2safe = (t: string) => t.replace(/Ⓢ/g, 'S').replace(/✓/g, '+').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")

/** Simulator 0.9.5 rejected a rebuild whose list items held '@', '(', ')' or '_' (bisected 2026-11-24); keep list items plain. */
export const listSafe = (t: string) => g2safe(t).replace(/ @ /g, ' at ').replace(/[()]/g, '').replace(/_/g, ' ')

/** Apply the same glyph/byte sanitising the device path uses (shared with the companion mirror). */
export function sanitize(spec: ScreenSpec): ScreenSpec {
  return { ...spec, texts: spec.texts.map(t => ({ ...t, text: g2safe(t.text) })), lists: spec.lists?.map(l => ({ ...l, items: l.items.map(i => clipBytes(listSafe(i))) })) }
}

export interface RenderAck {
  ok: boolean
  key: string
  bind?: string
  generation: number
  mode: 'startup' | 'rebuild' | 'update' | 'noop' | 'skipped' | 'failed'
  /** Some images failed and their text fallback is showing instead. */
  degraded: boolean
  images: Array<{ name: string; result: string; ms: number }>
  error?: string
  ms: number
}

/** The subset of the Even Hub bridge the renderer uses (so tests can pass a fake). */
export type RenderBridge = Pick<EvenAppBridge, 'createStartUpPageContainer' | 'rebuildPageContainer' | 'textContainerUpgrade' | 'updateImageRawData'>
export type Raster = (img: ImageBox) => Promise<Uint8Array>

/**
 * Renderer v2.
 *  - Every bridge call runs on ONE serial queue (the SDK requires serial calls; concurrent image sends fail).
 *  - Each show() gets a generation id; work for an older generation is skipped, and pending image transfers
 *    abort as soon as a newer screen is requested, so a slow chart can never overwrite a newer screen.
 *  - Identical structure → only changed text containers are upgraded, and only images whose CONTENT
 *    fingerprint changed are re-sent (geometry-only signatures used to miss changed chart data).
 *  - Rasterised images are cached by fingerprint.
 *  - Validation failures, startup failures, rejected rebuilds and rejected images are reported explicitly
 *    through the returned RenderAck and onRenderFail — never silently.
 */
export class Renderer {
  private started = false
  private sig = ''
  private lastText = new Map<number, string>()
  private lastImg = new Map<number, string>()
  private cache = new Map<string, Uint8Array>()
  private queue: Promise<unknown> = Promise.resolve()
  private requested = 0
  private last: RenderAck | null = null
  onRenderFail: ((key: string, reason: string) => void) | null = null
  log: (m: string) => void = m => console.log(m)

  constructor(private readonly bridge: RenderBridge, private readonly raster: Raster = defaultRaster) {}

  /** The most recent COMPLETED render (what the wearer is actually looking at). */
  get current(): RenderAck | null { return this.last }
  get latestGeneration() { return this.requested }

  show(input: ScreenSpec): Promise<RenderAck> {
    const gen = ++this.requested
    const run = this.queue.then(() => this.render(input, gen), () => this.render(input, gen))
    this.queue = run.catch(() => undefined)
    return run
  }

  private stale(gen: number) { return gen !== this.requested }

  private async render(input: ScreenSpec, gen: number): Promise<RenderAck> {
    const t0 = now()
    const base = { key: input.key, bind: input.bind, generation: gen, degraded: false, images: [] as RenderAck['images'] }
    if (this.stale(gen)) return { ...base, ok: false, mode: 'skipped', error: 'superseded', ms: 0 }
    const spec = sanitize(input)
    const errs = validateSpec(spec)
    if (errs.length) return this.fail({ ...base, ok: false, mode: 'failed', error: `invalid: ${errs.join('; ')}`, ms: now() - t0 })
    const sig = structureSignature(spec)
    let mode: RenderAck['mode']
    try {
      if (this.started && sig === this.sig) {
        mode = 'noop'
        for (const t of spec.texts) {
          if (this.lastText.get(t.id) === t.text) continue
          const ok = await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: t.id, containerName: t.name, content: t.text }))
          if (!ok) { this.sig = ''; return this.fail({ ...base, ok: false, mode: 'failed', error: `text update rejected: ${t.name}`, ms: now() - t0 }) }
          this.lastText.set(t.id, t.text); mode = 'update'
        }
      } else {
        const textObject = spec.texts.map(t => new TextContainerProperty({
          xPosition: t.x, yPosition: t.y, width: t.w, height: t.h, borderWidth: t.border ?? 0, borderColor: t.borderColor ?? 0, borderRadius: t.radius ?? 0,
          paddingLength: t.pad ?? 0, containerID: t.id, containerName: t.name, content: t.text, isEventCapture: t.capture ? 1 : 0,
        }))
        const listObject = (spec.lists ?? []).map(l => new ListContainerProperty({
          xPosition: l.x, yPosition: l.y, width: l.w, height: l.h, borderWidth: l.border ?? 0, borderColor: 8, paddingLength: 4, containerID: l.id, containerName: l.name,
          isEventCapture: l.capture ? 1 : 0,
          itemContainer: new ListItemContainerProperty({ itemCount: l.items.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: l.items }),
        }))
        const imageObject = (spec.images ?? []).map(i => new ImageContainerProperty({ xPosition: i.x, yPosition: i.y, width: i.w, height: i.h, containerID: i.id, containerName: i.name }))
        const containerTotalNum = textObject.length + listObject.length + imageObject.length
        if (!this.started) {
          const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum, textObject, listObject, imageObject }))
          if (r !== 0) {
            // After a WebView reload the host still holds our startup page; rebuild instead.
            const ok = await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject, imageObject }))
            if (!ok) return this.fail({ ...base, key: input.key, ok: false, mode: 'failed', error: `startup failed (create=${r}, rebuild=false)`, ms: now() - t0 }, 'startup')
          }
          this.started = true; mode = 'startup'
        } else {
          const ok = await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject, imageObject }))
          if (!ok) { this.sig = ''; return this.fail({ ...base, ok: false, mode: 'failed', error: 'rebuild rejected', ms: now() - t0 }) }
          mode = 'rebuild'
        }
        this.sig = sig
        this.lastText = new Map(spec.texts.map(t => [t.id, t.text]))
        this.lastImg = new Map()
      }
      // Images: send only those whose content fingerprint changed (all of them after a rebuild).
      for (const img of spec.images ?? []) {
        const fp = imagePrint(img)
        if (this.lastImg.get(img.id) === fp) continue
        if (this.stale(gen)) { base.images.push({ name: img.name, result: 'cancelled (newer screen)', ms: 0 }); continue }
        const ti = now()
        let result: string
        try {
          let bytes = this.cache.get(fp)
          if (!bytes) { bytes = await this.raster(img); this.remember(fp, bytes) }
          if (this.stale(gen)) { base.images.push({ name: img.name, result: 'cancelled (newer screen)', ms: now() - ti }); continue }
          result = String(await this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: img.id, containerName: img.name, imageData: bytes })))
        } catch (e) { result = `raster error: ${(e as Error).message ?? e}` }
        base.images.push({ name: img.name, result, ms: now() - ti })
        if (result === 'success') { this.lastImg.set(img.id, fp); if (img.altId !== undefined) await this.setText(spec, img.altId, ' ') }
        else {
          base.degraded = true
          this.log(`[HELM] image ${img.name} ${result} → text fallback`)
          if (img.alt && img.altId !== undefined) await this.setText(spec, img.altId, img.alt)
        }
      }
    } catch (e) {
      this.sig = ''
      return this.fail({ ...base, ok: false, mode: 'failed', error: `bridge error: ${(e as Error).message ?? e}`, ms: now() - t0 })
    }
    if (this.stale(gen) && base.images.some(i => i.result.startsWith('cancelled'))) {
      return { ...base, ok: false, mode: 'skipped', error: 'superseded during image transfer', ms: now() - t0 }
    }
    const ack: RenderAck = { ...base, ok: true, mode, ms: now() - t0 }
    this.last = ack
    this.log(`[HELM] screen ${spec.key} ${mode} ${Math.round(ack.ms)}ms${ack.degraded ? ' degraded' : ''}${base.images.length ? ` img:${base.images.map(i => `${i.name}=${i.result}/${Math.round(i.ms)}ms`).join(',')}` : ''}`)
    return ack
  }

  private async setText(spec: ScreenSpec, id: number, text: string) {
    const t = spec.texts.find(x => x.id === id)
    if (!t || this.lastText.get(id) === text) return
    if (await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: t.id, containerName: t.name, content: text }))) this.lastText.set(id, text)
  }

  private remember(fp: string, b: Uint8Array) {
    this.cache.set(fp, b)
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!)
  }

  private fail(ack: RenderAck, key = ack.key): RenderAck {
    this.last = ack
    this.log(`[HELM] render FAILED ${key}: ${ack.error}`)
    this.onRenderFail?.(key, ack.error ?? 'failed')
    return ack
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

async function defaultRaster(img: ImageBox): Promise<Uint8Array> {
  const { drawCode, drawWordmark } = await import('./wordmark')
  const { rasterGraphic } = await import('./gfx/raster')
  if (img.draw === 'wordmark') return drawWordmark(img.w, img.h)
  if ('code' in img.draw) return drawCode(img.draw.code, img.w, img.h)
  return rasterGraphic(img.draw.gfx, img.w, img.h)
}
