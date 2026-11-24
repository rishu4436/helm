# Glasses UX (Even Realities G2)

The display is 576×288, monochrome green. Input is the ring/temple: swipe up and down, **tap** to select, **double-tap** to go back or cancel. The plugin uses SDK 0.0.16 and is packed as `apps/glasses/helm.ehpk`. Screenshots of every screen below are in `evidence/g2-trade-flow/` (simulator 0.9.5, real data) and `contact-sheet.jpg`.

## Design rules

1. **Glance first.** One idea per screen: a title, a context tag (DEMO / SIM / countdown), at most about six body lines, and a one-line hint footer.
2. **The environment is always visible.** DEMO, SANDBOX and SIMULATED appear on every trade screen and receipt. SIM values are split out of "exchange funds".
3. **Safe defaults.** On the confirm screen the cursor starts on **Cancel**, and confirming needs a deliberate swipe and tap. Double-tap anywhere in the trade flow cancels, and HELM never returns into a used or expired confirmation.
4. **Honest timing.** Previews show a live 45 s countdown (flicker-free text upgrade). At 0 the preview expires, the screen says nothing was sent, and the user must start fresh.
5. **One tap, one action.** Taps during a slow venue preview are ignored, so there are never duplicate proposals.
6. **Provider truth on receipts.** FILLED with the average price, fee and fill count, protection state, orphan cleanup, "Reported by the exchange demo environment". A resting stop shows its size, never "0 BTC".

## Screen map

```
Splash → Pairing (big code + countdown) → Home
Home: Overview · Positions & holdings · Watchlist · Voice command · Trade · Pulse · Exposure Compass · Receipts · Emergency review · Protect positions · Accounts
Watchlist → Venue compare (bid/ask/spread per venue) → Which exchange? → Ticket presets
Ticket → TRADE IMPACT → RISK CHECK (ALLOW/WARN/BLOCK) → CONFIRM ORDER [Cancel | Confirm BUY on …] → Submitting → RECEIPT
Protect positions → position → stop distance (2/3/5 %) → PROTECT POSITION → RISK → CONFIRM STOP → RECEIPT
Voice command → LISTENING (mic open, tap to finish) → HEARD (transcript, STT label, intent) → next screen / Which exchange?
Emergency review → itemized CANCEL … / CLOSE … reduce-only (each its own preview and confirm)
```

## Firmware and simulator limits learned the hard way

| Limit | What HELM does |
|---|---|
| List items: the docs say 64 chars; in practice it is **≤63 UTF-8 bytes** (a 64-byte item made simulator 0.9.5 reject the whole rebuild) | `clipBytes` clips to 63 bytes with "…" |
| Simulator rejected list items containing `@ ( ) _` | `listSafe` replaces them (" @ " → " at ") |
| Font lacks Ⓢ and ✓ | Mapped to S and + |
| ≤4 text containers, ≤20 list rows | `validateSpec` refuses invalid screens before sending them |
| `createStartUpPageContainer` returns 1 after a WebView reload | Falls back to rebuild |
| A refused rebuild leaves the old screen on display | DISPLAY ERROR screen ("check Receipts before acting again") |
| Images 20–288 × 20–144 | Pairing code and wordmark are drawn within those bounds |

Text fit is verified with `@evenrealities/pretext` in the unit tests (`apps/glasses/src/screens/screens.test.ts`, 76 tests).

## Companion mirror

The companion's **Vision** page renders the same screen builders live, with ring buttons. The landing page demo uses them too, on clearly labelled simulated sample data.
