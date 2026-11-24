import { H, W, spaced, type ScreenSpec } from '../layout'

/** Shared frame: header strip (title + context), body, footer hint. */
function frame(key: string, title: string, context: string, body: string, hint: string, opts: { bodyBorder?: boolean } = {}): ScreenSpec {
  return {
    key,
    texts: [
      { id: 1, name: 'header', x: 0, y: 0, w: 400, h: 40, text: title, pad: 6 },
      { id: 2, name: 'context', x: 400, y: 0, w: 176, h: 40, text: context, pad: 6 },
      { id: 3, name: 'body', x: 8, y: 46, w: W - 16, h: 190, text: body, pad: 10, border: opts.bodyBorder ? 2 : 0, borderColor: 10, radius: 6, capture: true },
      { id: 4, name: 'footer', x: 0, y: H - 44, w: W, h: 44, text: hint, pad: 6 },
    ],
  }
}

export function splashScreen(status: string): ScreenSpec {
  return {
    key: 'splash',
    texts: [
      { id: 1, name: 'capture', x: 0, y: 0, w: W, h: H, text: ' ', capture: true },
      { id: 2, name: 'tagline', x: 96, y: 150, w: 384, h: 40, text: 'One interface. Every exchange.', pad: 4 },
      { id: 3, name: 'status', x: 96, y: 220, w: 384, h: 44, text: status, pad: 4 },
    ],
    images: [{ id: 10, name: 'wordmark', x: 144, y: 40, w: 288, h: 100, draw: 'wordmark' }],
  }
}

export function pairingScreen(code: string, secondsLeft: number): ScreenSpec {
  const m = Math.floor(secondsLeft / 60), s = String(secondsLeft % 60).padStart(2, '0')
  return frame('pairing', 'HELM · PAIR GLASSES', `expires ${m}:${s}`,
    `\n      ${spaced(code)}\n\nCompanion → Devices → enter code`,
    'Waiting for approval…  · double-tap: exit', { bodyBorder: true })
}

export function pairingExpiredScreen(): ScreenSpec {
  return frame('pairing-expired', 'HELM · PAIR GLASSES', 'expired', '\nCode expired.\n\nTap for a new code.', 'tap: new code · double-tap: exit')
}

export function connectionErrorScreen(reason: string): ScreenSpec {
  return frame('conn-error', 'CONNECTION ERROR', 'HELM', `\nCan't reach HELM.\n${reason}\n\nNothing was sent to any exchange.`, 'tap: retry · double-tap: exit', { bodyBorder: true })
}

export interface AccountRow { alias: string; provider: string; environment: string; state: string }

const ENV_LABEL: Record<string, string> = { demo: 'DEMO', paper: 'PAPER', sandbox_static: 'SANDBOX' }
export function accountLabel(a: AccountRow): string {
  const dot = a.state === 'CONNECTED' ? '●' : a.state === 'READ_ONLY' || a.state === 'LIMITED' ? '◐' : '○'
  return `${dot} ${a.alias} · ${ENV_LABEL[a.environment] ?? a.environment}`.slice(0, 64)
}

export function accountSelectorScreen(userName: string, accounts: AccountRow[]): ScreenSpec {
  if (accounts.length === 0) {
    return frame('accounts-empty', 'ACCOUNTS', userName.slice(0, 14), '\nNo exchange connected yet.\n\nConnect Binance, OKX, Bybit,\nCoinbase or IBKR in the Companion.', 'tap: refresh · double-tap: exit')
  }
  return {
    key: 'accounts',
    texts: [
      { id: 1, name: 'header', x: 0, y: 0, w: 400, h: 40, text: 'SELECT ACCOUNT', pad: 6 },
      { id: 2, name: 'context', x: 400, y: 0, w: 176, h: 40, text: userName.slice(0, 14), pad: 6 },
      { id: 4, name: 'footer', x: 0, y: H - 44, w: W, h: 44, text: 'swipe: move · tap: select · double-tap: back', pad: 6 },
    ],
    lists: [{ id: 3, name: 'accounts', x: 8, y: 44, w: W - 16, h: 196, items: accounts.slice(0, 20).map(accountLabel), border: 0, capture: true }],
  }
}

export function accountChosenScreen(a: AccountRow): ScreenSpec {
  return frame('account-chosen', 'ACTIVE ACCOUNT', ENV_LABEL[a.environment] ?? a.environment,
    `\n${a.alias}\n${a.provider.toUpperCase()} · ${a.state}\n\nSet as active on this device ✓`, 'double-tap: back to accounts', { bodyBorder: true })
}
