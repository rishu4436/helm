/** Draws the HELM wordmark as PNG bytes; the SDK converts to 4-bit greyscale. */
export async function drawWordmark(w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
  // helm wheel glyph: ring + 8 spokes
  const cx = 44, cy = h / 2, r = 30
  g.strokeStyle = '#fff'; g.lineWidth = 5
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke()
  g.lineWidth = 4
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i
    g.beginPath(); g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8); g.lineTo(cx + Math.cos(a) * (r + 10), cy + Math.sin(a) * (r + 10)); g.stroke()
  }
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill()
  g.font = 'bold 64px "Helvetica Neue", Arial, sans-serif'
  g.textBaseline = 'middle'
  g.fillText('HELM', 96, cy + 3)
  const blob: Blob = await new Promise(res => c.toBlob(b => res(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Draws a pairing code in large, widely spaced glyphs as PNG bytes. */
export async function drawCode(code: string, w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h)
  g.fillStyle = '#fff'
  g.font = 'bold 54px "DejaVu Sans Mono", Menlo, monospace'
  g.textBaseline = 'middle'; g.textAlign = 'center'
  const step = w / code.length
  for (let i = 0; i < code.length; i++) g.fillText(code[i]!, step * i + step / 2, h / 2 + 2)
  const blob: Blob = await new Promise(res => c.toBlob(b => res(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
