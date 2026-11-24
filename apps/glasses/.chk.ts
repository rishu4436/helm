import { readFileSync } from 'node:fs'
import * as T from './src/screens/trade'
import { validateSpec } from './src/layout'
const tok = readFileSync('/workspace/helm-stt/.tok-dev','utf8').trim()
const pf = (await (await fetch('http://localhost:4000/v1/portfolio',{headers:{authorization:`Bearer ${tok}`}})).json()).portfolio
const s=T.holdingsScreen(pf); console.log(JSON.stringify(validateSpec(s)), s.texts.find(t=>t.name==='context')?.text); s.lists![0]!.items.forEach(i=>console.log(Buffer.byteLength(i), i))
