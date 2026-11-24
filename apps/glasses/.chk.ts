import { readFileSync } from 'node:fs'
import * as T from './src/screens/trade'
import { validateSpec } from './src/layout'
const tok = readFileSync('/workspace/helm-stt/.tok-dev','utf8').trim()
const ev = (await (await fetch('http://localhost:4000/v1/pulse',{headers:{authorization:`Bearer ${tok}`}})).json()).events
const s = T.pulseScreen(ev); console.log(s.key, JSON.stringify(validateSpec(s)))
for (const t of s.texts) console.log(' ', t.name, JSON.stringify(t.text))
for (const l of s.lists??[]) l.items.forEach(i=>console.log(' item', Buffer.byteLength(i), JSON.stringify(i)))
