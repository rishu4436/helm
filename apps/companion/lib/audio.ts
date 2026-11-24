'use client'
/** Browser microphone → 16 kHz mono PCM16 (the same format the G2 microphones deliver), base64 for /v1/voice/command. */
export async function recordPcm16(maxMs: number, onLevel?: (v: number) => void, stopSignal?: { stop: boolean }): Promise<{ base64: string; ms: number }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  proc.onaudioprocess = e => { const d = new Float32Array(e.inputBuffer.getChannelData(0)); chunks.push(d); if (onLevel) { let s = 0; for (const x of d) s += x * x; onLevel(Math.sqrt(s / d.length)) } }
  src.connect(proc); proc.connect(ctx.destination)
  const t0 = Date.now()
  await new Promise<void>(res => { const t = setInterval(() => { if (Date.now() - t0 >= maxMs || stopSignal?.stop) { clearInterval(t); res() } }, 100) })
  proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop())
  const rate = ctx.sampleRate; await ctx.close()
  const total = chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(total)
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length }
  return { base64: floatToPcm16Base64(all, rate), ms: Date.now() - t0 }
}

export function floatToPcm16Base64(samples: Float32Array, rate: number): string {
  const n = Math.floor(samples.length * 16000 / rate), out = new Int16Array(n)
  for (let i = 0; i < n; i++) { const x = samples[Math.min(samples.length - 1, Math.floor(i * rate / 16000))]!; out[i] = Math.max(-1, Math.min(1, x)) * 32767 }
  const bytes = new Uint8Array(out.buffer); let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** A 16 kHz PCM16 WAV file → raw PCM base64 (strip the 44-byte header). */
export async function wavUrlToPcmBase64(url: string): Promise<string> {
  const b = new Uint8Array(await (await fetch(url)).arrayBuffer()).subarray(44); let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
