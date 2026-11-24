# HELM — Research notes

Collected 2026-11-24 (IST). Every claim below has a source; re-check sources before submission because organiser pages can change.

## 1. Hackathon (DoraHacks — Even Realities × TVM Ventures)

Sources: https://dorahacks.io/hackathon/even-realities/detail ("Heads Up: Even Realities Hackathon by TVM Ventures & Daos Hub"; detail, rules and tracks tabs, fetched 2026-11-24) · organiser announcement https://x.com/RavenNetworkHQ/status/2123353683572281559

| Fact | Value |
|---|---|
| Submission deadline | **2026-11-29 23:59 Dubai (GMT+4)** = **2026-11-30 01:29 IST**. DoraHacks shows "2026/11/29 19:59" (UTC) |
| Build week | Nov 23 – Nov 29 |
| Judging | Nov 30 – Dec 1 |
| Demo Day | Dec 3, 14:00–18:00 Dubai |
| Prize pool | 10,000 USD (USDT), plus up to 10 pairs of G2 glasses and a Community Partner Award; Demo Day at Daos Hub, Dubai |
| Team size | 1–4 |
| Track | **Exchanges & Stocks** — listed partner apps: **Binance, OKX, Bybit, Coinbase, Interactive Brokers** |

**Provider eligibility for this track:** Binance ✅ · OKX ✅ · Bybit ✅ · Coinbase ✅ · Interactive Brokers ✅ · **Alpaca ❌ (not listed)**. HELM ships the Alpaca paper adapter but keeps it **off by default** (`HELM_ENABLE_ALPACA=false`) and labels it "not track-eligible".

**Submission requirements:** a **public** GitHub/GitLab repo with a setup README; a demo video of up to 3 min (simulator or real G2); a short description; optional ≤5 feature requests to Even Realities; optional `.ehpk` build.
**Rules that matter for HELM:** the README must say what existed before Nov 23. Money safety: testnet, paper or read-only only. No financial advice. No committed secrets.
**Judging weights:** Usefulness on G2 30% · Read & write 25% · Technical execution 20% · UX for display + voice 15% · Business potential & safety 10%.
**G2 constraints from the brief:**
- One app on screen at a time, with no background display.
- Bring your own STT; the SDK hands over raw PCM.
- Use a backend.
- Network origins must be whitelisted in `app.json`, and CORS must pass.
- Google sign-in does not work in the WebView, so use a pairing code (HELM does this).

## 2. Even Hub platform

Sources:
- https://www.npmjs.com/package/@evenrealities/even_hub_sdk (0.0.16)
- https://www.npmjs.com/package/@evenrealities/evenhub-simulator (0.9.5)
- https://www.npmjs.com/package/@evenrealities/evenhub-cli (0.2.0)
- https://www.npmjs.com/package/@evenrealities/pretext
- https://github.com/even-realities (templates; the "minimal" template was the starting point for apps/glasses)
- https://hub.evenrealities.com/docs

- **Display:** 576×288 in 4-bit greyscale, shown green. Firmware font with 27 px line height.
- **Containers:** at most 12 per page (≤8 text/list, ≤4 image). Exactly one has `isEventCapture=1`. Names are ≤16 chars.
- **Calls:**
  - `createStartUpPageContainer` runs once and returns 0 on success.
  - `rebuildPageContainer` is a full redraw.
  - `textContainerUpgrade` updates in place without flicker, up to 2000 chars.
- **Images:** 20–288 wide and 20–144 tall. Send PNG bytes via `updateImageRawData`, one push at a time.
- **Lists:** 1–20 items of ≤64 chars.
- **Events:**
  - A tap arrives with **no** `eventType`, because protobuf omits CLICK=0. Double-tap = 3.
  - List selection index 0 arrives as `undefined`.
  - Treat a missing eventType as CLICK (HELM `eventTypeOf`).
- **Audio:** `audioControl(true, AudioInputSource.Glasses)` gives 16 kHz PCM and needs the `g2-microphone` permission.
- **Storage:** `bridge.setLocalStorage`/`getLocalStorage` is the persistence the SDK documents.
- **Simulator automation** (`--automation-port`): `GET /api/ping`, `GET /api/screenshot/glasses` (RGBA PNG), `GET /api/console`, `POST /api/input {action: up|down|click|double_click}`.
- **Packaging:** `evenhub pack app.json dist -o x.ehpk`. `package_id` must be lowercase reverse-domain.

**Observed in the simulator here (2026-11-24):**
- After a WebView reload, `createStartUpPageContainer` returns 1 because the host still holds the page. HELM now falls back to `rebuildPageContainer`.
- `✓` is not in the firmware font and is silently dropped. `●` `◐` `○` `→` `·` render.
- WebView `localStorage` survived a simulator restart. HELM writes the token to bridge storage first and mirrors it there.
- The simulator needs `libwebkit2gtk-4.1-0` on Linux.

## 3. Providers (demo / paper / sandbox only)

| Provider | Environment HELM uses | Base URL(s) | Auth / signing | Source |
|---|---|---|---|---|
| Binance | Demo Trading | REST `https://demo-api.binance.com/api`; WS API `wss://demo-ws-api.binance.com/ws-api/v3`; USDⓈ-M `https://demo-fapi.binance.com` | `X-MBX-APIKEY` header plus `signature` = hex HMAC-SHA256 of the query/body. The doc vector is reproduced in tests (`c8db5682…6b71`) | https://developers.binance.com/docs/binance-spot-api-docs/demo-mode/general-info · https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security · https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info |
| OKX | Demo trading | `https://www.okx.com` with header `x-simulated-trading: 1` (the guard rejects requests without it) | `OK-ACCESS-SIGN` = base64 HMAC-SHA256 of `ts+METHOD+path+body`, plus a passphrase. Error 50101 means the key doesn't match the environment. `GET /api/v5/account/config` → `perm` | https://www.okx.com/docs-v5/en/#overview-demo-trading-services · https://www.okx.com/docs-v5/en/#overview-rest-authentication |
| Bybit | Demo Trading | `https://api-demo.bybit.com`; private WS `wss://stream-demo.bybit.com` | `X-BAPI-SIGN` = hex HMAC of `ts+key+recvWindow+payload`. Demo has no WS trade and only a subset of endpoints. `/v5/account/demo-apply-money` | https://bybit-exchange.github.io/docs/v5/demo · https://bybit-exchange.github.io/docs/v5/guide#authentication |
| Coinbase | Advanced Trade **static sandbox** | `https://api-sandbox.coinbase.com/api/v3/brokerage` | No auth. Responses are static mocks, and the `X-Sandbox` header picks error variants. **Not a real execution environment**, so HELM marks it LIMITED and orders `simulatedStatic` | https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/sandbox |
| Interactive Brokers | Paper account via Client Portal Gateway | `https://localhost:5000/v1/api` (loopback only) | Gateway browser session. Paper accounts start with `DU`. `/iserver/auth/status`, `/tickle`. Order "reply" prompts must be answered explicitly | https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/ |
| Alpaca (not track-eligible) | Paper | `https://paper-api.alpaca.markets` | `APCA-API-KEY-ID`/`SECRET`. Paper account numbers start `PA` | https://docs.alpaca.markets/docs/paper-trading |

`evidence/live-public-check.json` holds a real run against the public and sandbox endpoints. It made no authenticated calls and passed 12/12 (Binance demo clock, depth and exchangeInfo; OKX book and instruments; Bybit demo clock and book; Coinbase static sandbox; the guard blocking a production DELETE).
