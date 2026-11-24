# Product spec (as built)

**HELM G2** is one heads-up command center for every demo and paper trading account you hold: Binance, Bybit, OKX, Coinbase (sandbox) and Interactive Brokers (paper). You glance at the whole book, ask by voice or ring, and nothing is sent until you have seen the impact and confirmed.

## Who it is for

Active traders who spread positions across venues and lose track of total exposure, open stops and which account holds what. The glasses give them a glance-and-confirm surface. The companion website is the setup and deep-dive surface.

## Core principles

1. **Demo, paper and sandbox only.** Live trading is hard-disabled (see `SECURITY.md`).
2. **Preview before every order.** Each order shows its impact and risk first, then needs an explicit confirmation on a single-use 45 s token. On the glasses the default selection is Cancel.
3. **Provider truth.** HELM reports fills, positions and protection only as the exchange reports them. A stop is "protected" only when the venue lists it. Coinbase static-sandbox responses are labelled and never shown as fills.
4. **No blind retries.** A timeout becomes "outcome unknown" and is reconciled, never resubmitted.
5. **Ambiguity asks.** If more than one account fits a command, HELM asks "Which exchange?".
6. **Nothing is broadcast.** "Close everything" becomes an itemized review where each item is a reduce-only order with its own preview and confirm.

## Features

| Area | Glasses | Companion |
|---|---|---|
| Pairing | 6-character code shown large on the display, 5-min TTL | Devices page approves the code |
| Overview | All-exchange net value, demo vs SIM/sandbox split, top assets | Dashboard and portfolio |
| Positions & holdings | List of positions and holdings across venues | Positions, orders, itemized emergency review |
| Watchlist / venues | Live public prices; venue compare (bid/ask/spread) | Market intelligence |
| Trade | Ticket presets → Trade Impact → Risk check → Confirm → Receipt | Terminal (preview → "I reviewed" → confirm) |
| Trade-to-Protect | Entry with a stop distance; **Protect positions** for existing unprotected perps | `/protect`: how it works, unprotected positions with Preview stop, plan history |
| Shield | Risk verdict on every preview | Policy editor, Exposure Compass, scenario lab |
| Pulse | Prioritised events (fills, stops live, failures, closes) | Pulse feed with dismiss |
| Voice | Mic → local STT → intent → next screen | Voice Studio (mic, spoken samples, typed) |
| Emergency | Itemized cancel/close list, never broadcast | Same, with per-item previews |
| Recipes | — | Versioned multi-step routines; trade steps become previews |
| Vision | — | Live mirror of the G2 screens with ring controls |
| Security / diagnostics | — | Sessions, key fingerprints, guard hosts, audit log, health of every dependency |

## Out of scope (on purpose)

Live trading, withdrawals and transfers, storing exchange passwords or 2FA, automated trading without a human confirmation, and financial advice.
