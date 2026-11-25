/** Even Hub event envelope → controller Input. Pure, unit-tested; mirrors the SDK input docs + simulator behaviour. */
import type { Input } from './controller'

// OsEventTypeList values (SDK 0.0.16): 0 click, 1 scroll top (swipe up), 2 scroll bottom (swipe down), 3 double click,
// 4/5 foreground enter/exit, 6 abnormal exit, 7 system exit.
type Env = { eventType?: number | null } | undefined | null
export interface HubEventLike {
  listEvent?: { eventType?: number | null; currentSelectItemIndex?: number | null; currentSelectItemName?: string | null } | null
  textEvent?: { eventType?: number | null } | null
  sysEvent?: { eventType?: number | null } | null
}
export type Lifecycle = 'foreground' | 'background' | 'exit'
export function toInput(e: HubEventLike): Input | Lifecycle | null {
  const t = (x: Env) => (x ? (x.eventType ?? 0) : null)
  const lt = t(e.listEvent), tt = t(e.textEvent), st = t(e.sysEvent)
  const any = lt ?? tt ?? st
  if (any === 4) return 'foreground'
  if (any === 5) return 'background'
  if (any === 6 || any === 7) return 'exit'
  if (lt !== null) {
    if (lt === 3) return { kind: 'double' }
    if (lt === 0) return { kind: 'tap', source: 'list', index: e.listEvent!.currentSelectItemIndex ?? 0, name: e.listEvent!.currentSelectItemName ?? undefined }
    return null // list scrolling is handled by the firmware highlight
  }
  if (tt !== null) {
    if (tt === 1) return { kind: 'swipe', dir: 'up' }
    if (tt === 2) return { kind: 'swipe', dir: 'down' }
    if (tt === 3) return { kind: 'double' }
    if (tt === 0) return { kind: 'tap', source: 'text' }
    return null
  }
  if (st !== null) {
    if (st === 3) return { kind: 'double' }
    if (st === 0) return { kind: 'tap', source: 'sys' }
    if (st === 1) return { kind: 'swipe', dir: 'up' }
    if (st === 2) return { kind: 'swipe', dir: 'down' }
  }
  return null
}
