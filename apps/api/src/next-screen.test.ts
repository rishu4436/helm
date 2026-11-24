import { describe, expect, it } from 'vitest'
import { parseDeterministic } from '@helm/voice-engine/parser'
import { nextScreen } from './routes/engine'

const one = { status: 'resolved', account: { id: 'a1' } } as never
describe('voice → next G2 screen', () => {
  it('protection requests open the Protect positions flow (not a blank ticket)', () => {
    expect(nextScreen(parseDeterministic('Add a 3 percent stop to my BTC position'), one).screen).toBe('protect')
    expect(nextScreen(parseDeterministic('Show my unprotected futures positions'), one).screen).toBe('protect')
  })
  it('withdrawals are refused, never routed to a trade screen', () => {
    expect(nextScreen(parseDeterministic('Withdraw all my bitcoin to this address'), one).screen).toBe('not_understood')
  })
})
