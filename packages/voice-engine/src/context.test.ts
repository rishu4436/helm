import { describe, expect, it } from 'vitest'
import { resolveContextual, type VAccount, type VPosition } from './context'

const A: VAccount[] = [
  { id: 'bin', alias: 'Binance Demo', provider: 'binance', environment: 'demo', canTrade: true, products: ['spot', 'perp'] },
  { id: 'byb', alias: 'Bybit Demo', provider: 'bybit', environment: 'demo', canTrade: true, products: ['spot', 'perp'] },
  { id: 'okx', alias: 'OKX Demo', provider: 'okx', environment: 'demo', canTrade: true, products: ['spot', 'perp'] },
]
const P: VPosition[] = [
  { accountId: 'byb', instrumentId: 'bybit:perp:BTC-USDT:USDT', side: 'LONG', quantity: '0.01' },
  { accountId: 'bin', instrumentId: 'binance:perp:ETH-USDT:USDT', side: 'SHORT', quantity: '-1' },
]
const btcKey = 'byb|bybit:perp:BTC-USDT:USDT|LONG'
const r = (t: string, ctx: Parameters<typeof resolveContextual>[1] = { screen: 'home' }, pos = P) => resolveContextual(t, ctx, A, pos).action

describe('contextual voice resolver', () => {
  it('read-only navigation', () => {
    expect(r('show my portfolio')).toMatchObject({ kind: 'navigate', target: 'portfolio' })
    expect(r('which positions need attention')).toMatchObject({ kind: 'navigate', target: 'unprotected' })
    expect(r('show my OKX account')).toMatchObject({ kind: 'navigate', target: 'account', accountId: 'okx' })
    expect(r('show my BTC holdings')).toMatchObject({ kind: 'navigate', target: 'holdings', asset: 'BTC' })
    expect(r('show positions on bybit')).toMatchObject({ kind: 'navigate', target: 'positions', accountId: 'byb' })
    expect(r('show my last receipt')).toMatchObject({ kind: 'navigate', target: 'receipt' })
    expect(r('compare binance and okx for btc')).toMatchObject({ kind: 'navigate', target: 'venues', asset: 'BTC', providers: ['binance', 'okx'] })
  })
  it('compare without an asset asks (or uses the asset on screen)', () => {
    expect(r('compare binance and okx')).toMatchObject({ kind: 'clarify', field: 'asset' })
    expect(r('compare binance and okx', { screen: 'market', asset: 'ETH' })).toMatchObject({ kind: 'navigate', target: 'venues', asset: 'ETH' })
  })
  it('"this position" binds to the selected position only', () => {
    expect(r('close half of this position', { screen: 'focus', positionKey: btcKey })).toMatchObject({ kind: 'propose', ticket: { accountId: 'byb', instrumentId: 'bybit:perp:BTC-USDT:USDT', side: 'SELL', fraction: '0.5', reduceOnly: true } })
    expect(r('add a three percent stop', { screen: 'focus', positionKey: btcKey })).toMatchObject({ kind: 'protect', accountId: 'byb', stopOffsetPercent: '3' })
    expect(r('show my liquidation distance', { screen: 'focus', positionKey: btcKey })).toMatchObject({ kind: 'navigate', target: 'liquidation', positionKey: btcKey })
  })
  it('stale position context is rejected, never re-targeted', () => {
    expect(r('close half of this position', { screen: 'focus', positionKey: btcKey }, P.slice(1))).toMatchObject({ kind: 'reject' })
    expect(r('show my portfolio', { screen: 'account', accountId: 'gone' })).toMatchObject({ kind: 'reject' })
  })
  it('draft edits change only what was said', () => {
    const draft = { accountId: 'bin', asset: 'BTC', product: 'perp' as const, side: 'BUY' as const, notional: '100', leverage: '3' }
    expect(r('make it fifty dollars instead', { screen: 'review', draft })).toMatchObject({ kind: 'propose', ticket: { ...draft, notional: '50' } })
    expect(r('change the leverage to two', { screen: 'review', draft })).toMatchObject({ kind: 'propose', ticket: { ...draft, leverage: '2' } })
    expect(r('use my bybit account', { screen: 'review', draft })).toMatchObject({ kind: 'propose', ticket: { ...draft, accountId: 'byb' } })
    expect(r('change the leverage to two', { screen: 'review', draft: { ...draft, product: 'spot', leverage: undefined } })).toMatchObject({ kind: 'reject' })
  })
  it('never guesses an account, asset or size', () => {
    expect(r('prepare a hundred dollar BTC buy')).toMatchObject({ kind: 'clarify', field: 'account' })
    expect(r('prepare a hundred dollar BTC buy on bybit')).toMatchObject({ kind: 'propose', ticket: { accountId: 'byb', asset: 'BTC', notional: '100', side: 'BUY' } })
    expect(r('buy some bitcoin on bybit')).toMatchObject({ kind: 'reject' })
    expect(r('prepare a 50 dollar buy', { screen: 'market' })).toMatchObject({ kind: 'clarify', field: 'asset' })
    expect(r('prepare a 50 dollar buy on binance', { screen: 'market', asset: 'SOL' })).toMatchObject({ kind: 'propose', ticket: { asset: 'SOL', accountId: 'bin' } })
  })
  it('closing without context resolves a unique matching position or asks', () => {
    expect(r('close half of my BTC long on bybit')).toMatchObject({ kind: 'propose', ticket: { accountId: 'byb', fraction: '0.5', reduceOnly: true } })
    const two = [...P, { accountId: 'okx', instrumentId: 'okx:perp:BTC-USDT:USDT', side: 'LONG', quantity: '0.02' }]
    expect(r('close half of my BTC position', { screen: 'home' }, two)).toMatchObject({ kind: 'clarify', field: 'position' })
  })
  it('refuses withdrawals and transfers', () => {
    expect(r('withdraw all my bitcoin')).toMatchObject({ kind: 'reject' })
    expect(r('transfer my usdt to another exchange')).toMatchObject({ kind: 'reject' })
  })
})
