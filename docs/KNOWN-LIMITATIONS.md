# Known limitations

Stated plainly; none of these are hidden in the UI.

## Not verified

- **Real G2 glasses and R1 ring:** NOT RUN. Everything was verified on Even Hub simulator 0.9.5. Font, timing, BLE latency and microphone quality on hardware are unknown.
- **Human voice:** only synthetic Kokoro TTS speech was tested, including through the simulator microphone via a virtual audio source. STT is English only (`base.en`).
- **OKX logged in:** BLOCKED (region: India). The OKX adapter is tested with mocks and public endpoints only, and Trade-to-Protect stops are not wired for OKX.
- **IBKR paper** (gateway) and **Alpaca paper:** NOT RUN live.
- **Public deployment:** none. Everything is local.

## Product gaps

- **Binance spot has no Trade-to-Protect.** The manifest has STOP_LIMIT but no STOP_MARKET, and HELM does not fake a market stop with a limit. Spot protection works on Bybit and the HELM simulator.
- **Recovery protects perps only.** For spot, use a new entry with a stop.
- After a partial spot sale that leaves the stop uncovered, HELM cancels the stop but **does not re-place a smaller one**. That would need a new confirmation, and it says so in Pulse.
- **Dust:** a spot "sell all" can leave sub-lot dust (for example 0.00006 SOL on Bybit Demo) that the venue will not accept.
- **Manifests say `verification: documented`** even for Binance/Bybit, which were verified with real demo credentials. The field is not updated automatically.
- No WebSocket streaming yet. Market data and account state are polled (portfolio cached for 3 s for display only; the trade engine never uses the cache).
- **Fees in previews** are the provider preview where available, otherwise a **labelled taker assumption** (0.1 % spot). The receipt shows the actual fee.
- The **demo user's policy raises the exposure caps** because the demo accounts are pre-funded with about $60k of BTC. Per-order caps are unchanged.
- The landing page demo covers overview, positions, Pulse, Compass, receipts and voice → confirm. Other menu items say "available in the real app".
- **Dead-button audit** clicks up to 30 buttons per page, so long lists are sampled.

## Engineering notes

- Simulator 0.9.5 rejects a rebuild when a list item is 64 UTF-8 bytes. HELM uses 63, although the docs say 64.
- Demo venues are slow at times (a preview can take about 10 s on Bybit Demo). The glasses ignore taps while a preview is in flight.
- Box resets wipe `/tmp`, so `scripts/dev-up.sh` restores the stack. Kill stale servers by PID.
