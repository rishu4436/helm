import {
  CreateStartUpPageContainer, ImageContainerProperty, ImageRawDataUpdate, ListContainerProperty, ListItemContainerProperty,
  RebuildPageContainer, TextContainerProperty, TextContainerUpgrade, type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { structureSignature, validateSpec, type ScreenSpec } from './layout'
import { drawCode, drawWordmark } from './wordmark'

/**
 * Renders ScreenSpecs efficiently: identical structure → flicker-free textContainerUpgrade of
 * only the changed containers; otherwise a full rebuild. Image pushes are serialised.
 */
export class Renderer {
  private started = false
  private sig = ''
  private lastText = new Map<number, string>()
  private imageQueue: Promise<unknown> = Promise.resolve()
  constructor(private readonly bridge: EvenAppBridge) {}

  async show(spec: ScreenSpec): Promise<void> {
    const errs = validateSpec(spec)
    if (errs.length) { console.error('[HELM] invalid screen', spec.key, errs); return }
    const sig = structureSignature(spec)
    if (this.started && sig === this.sig) {
      for (const t of spec.texts) {
        if (this.lastText.get(t.id) !== t.text) {
          await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: t.id, containerName: t.name, content: t.text }))
          this.lastText.set(t.id, t.text)
        }
      }
      return
    }
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
        if (!ok) { console.error('[HELM] createStartUpPageContainer failed', r); return }
      }
      this.started = true
    } else {
      const ok = await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject, imageObject }))
      if (!ok) { console.error('[HELM] rebuildPageContainer failed', spec.key); return }
    }
    this.sig = sig
    this.lastText = new Map(spec.texts.map(t => [t.id, t.text]))
    for (const img of spec.images ?? []) {
      const bytes = img.draw === 'wordmark' ? await drawWordmark(img.w, img.h) : await drawCode(img.draw.code, img.w, img.h)
      this.imageQueue = this.imageQueue.then(() => this.bridge.updateImageRawData(new ImageRawDataUpdate({ containerID: img.id, containerName: img.name, imageData: bytes })))
      const res = await this.imageQueue
      if (res !== 'success') console.warn('[HELM] image', res)
    }
    console.log(`[HELM] screen ${spec.key}`)
  }
}
