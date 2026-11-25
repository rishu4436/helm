import { layoutGraphic, type Graphic, type Op } from './graphics'

/** Minimal Canvas 2D surface HELM paints on (the browser's CanvasRenderingContext2D satisfies it). */
export type Ctx2D = Pick<CanvasRenderingContext2D, 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'strokeRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'arc' | 'closePath' | 'fillText' | 'setLineDash' | 'save' | 'restore' | 'rect' | 'clip'>

/** Shade 0–15 → grey (the SDK maps luminance to the G2's 16 green levels; the companion tints it green). */
export const shadeColor = (s: number, tint?: [number, number, number]) => {
  const v = Math.round((Math.max(0, Math.min(15, s)) / 15) * 255)
  return tint ? `rgb(${Math.round(tint[0] * v / 255)},${Math.round(tint[1] * v / 255)},${Math.round(tint[2] * v / 255)})` : `rgb(${v},${v},${v})`
}

export function paintOps(g: Ctx2D, ops: Op[], w: number, h: number, tint?: [number, number, number]) {
  g.fillStyle = tint ? 'rgba(0,0,0,0)' : '#000'
  if (!tint) g.fillRect(0, 0, w, h)
  for (const o of ops) {
    switch (o.op) {
      case 'rect': {
        const c = shadeColor(o.shade, tint)
        if (o.style === 'fill') { g.fillStyle = c; g.fillRect(o.x, o.y, o.w, o.h) }
        else if (o.style === 'stroke') { g.strokeStyle = c; g.lineWidth = 2; g.setLineDash([]); g.strokeRect(o.x + 1, o.y + 1, Math.max(1, o.w - 2), Math.max(1, o.h - 2)) }
        else {
          g.save(); g.beginPath(); g.rect(o.x, o.y, o.w, o.h); g.clip()
          g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2; g.setLineDash([])
          if (o.style === 'hatch') { for (let d = -o.h; d < o.w; d += 6) { g.beginPath(); g.moveTo(o.x + d, o.y + o.h); g.lineTo(o.x + d + o.h, o.y); g.stroke() } }
          else { for (let yy = o.y + 2; yy < o.y + o.h; yy += 4) for (let xx = o.x + 2; xx < o.x + o.w; xx += 4) g.fillRect(xx, yy, 2, 2) }
          g.restore()
          g.strokeStyle = c; g.lineWidth = 1; g.strokeRect(o.x + 0.5, o.y + 0.5, Math.max(1, o.w - 1), Math.max(1, o.h - 1))
        }
        break
      }
      case 'line': g.strokeStyle = shadeColor(o.shade, tint); g.lineWidth = o.width; g.setLineDash(o.dash ?? []); g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(o.x2, o.y2); g.stroke(); g.setLineDash([]); break
      case 'poly': {
        g.strokeStyle = shadeColor(o.shade, tint); g.lineWidth = o.width; g.setLineDash([]); g.beginPath()
        o.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); break
      }
      case 'text': g.fillStyle = shadeColor(o.shade, tint); g.font = `${o.bold ? 'bold ' : ''}${o.size}px "Helvetica Neue", Arial, sans-serif`; g.textAlign = o.align; g.textBaseline = 'alphabetic'; g.fillText(o.text, o.x, o.y); break
      case 'marker': {
        const c = shadeColor(o.shade, tint), s = o.size
        g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 2; g.setLineDash([]); g.beginPath()
        if (o.shape === 'triangle') { g.moveTo(o.x, o.y - s); g.lineTo(o.x - s, o.y + s * 0.8); g.lineTo(o.x + s, o.y + s * 0.8); g.closePath() }
        else if (o.shape === 'square') g.rect(o.x - s, o.y - s, s * 2, s * 2)
        else if (o.shape === 'diamond') { g.moveTo(o.x, o.y - s); g.lineTo(o.x + s, o.y); g.lineTo(o.x, o.y + s); g.lineTo(o.x - s, o.y); g.closePath() }
        else if (o.shape === 'circle') g.arc(o.x, o.y, s, 0, Math.PI * 2)
        else { g.moveTo(o.x - s, o.y - s); g.lineTo(o.x + s, o.y + s); g.moveTo(o.x + s, o.y - s); g.lineTo(o.x - s, o.y + s); g.stroke(); break }
        if (o.filled) g.fill(); else g.stroke()
        break
      }
    }
  }
}

/** Draw a Graphic onto a fresh canvas and return PNG bytes (glasses WebView). */
export async function rasterGraphic(gfx: Graphic, w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  paintOps(c.getContext('2d')!, layoutGraphic(gfx, w, h), w, h)
  const blob: Blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
