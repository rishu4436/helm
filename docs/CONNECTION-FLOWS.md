# Connection flows

## Glasses pairing (no keys on the glasses)

1. The glasses call `POST /v1/pairing/start` and get `{pairingId, code, pollSecret, expiresAt}`, a **5-minute TTL** with the code drawn large as an image.
2. The user signs in on the companion → **Devices** and enters the code. `POST /v1/pairing/approve` is user-authenticated, atomic and audited.
3. The glasses poll `POST /v1/pairing/claim` with the poll secret and receive a device token (stored hashed server-side). An expired code returns 410 and the glasses show "restart pairing".
4. The device picks an active account (`POST /v1/device/active-account`). Relaunching skips pairing.

The glasses only ever hold a device token. Exchange keys never leave the API.

## Exchange connection

`POST /v1/connections {provider, alias, credentials}`, entered in the companion's provider-specific connect form, which explains exactly which permissions to grant.

1. The credentials are parsed with the provider schema: API key/secret only, plus `market: spot|usdm` for Binance. HELM **never asks for exchange passwords, 2FA codes, recovery phrases or withdrawal permission**.
2. The adapter runs `connect()`. A connection is CONNECTED only with **an authenticated account read that parses, a verified demo/paper environment, and no excessive permissions** (`deriveConnectionHealth`). HTTP 200 alone is not enough.
3. If validation fails, the row is soft-deleted and **the credentials are never stored** (422 CONNECTION_FAILED with the reasons).
4. On success the credentials are sealed with AES-256-GCM (AAD `user:connection`) and only a key fingerprint is shown. The capability manifest and health are stored, and the action is audited.

| State | Meaning |
|---|---|
| CONNECTED | Authenticated read OK, environment verified, trade permission, no dangerous scope |
| READ_ONLY | Reads OK, key cannot trade |
| LIMITED | Works with caveats: the key has withdraw/transfer scope (never CONNECTED), static sandbox, simulator, or partial capability |
| EXPIRED | Session or key expired (for example the IBKR gateway) |
| RECONNECTING / DISCONNECTED / ERROR | Transient, or the reasons are listed |

## Provider notes

- **Binance Demo:** create the keys at demo.binance.com and connect spot and USDⓈ-M as two accounts.
- **Bybit Demo:** create keys in the Demo Trading area (a unified account covers spot and linear).
- **OKX Demo:** demo-trading API keys. BLOCKED for this team (region).
- **Coinbase:** static sandbox needs no keys and is always LIMITED.
- **IBKR:** run the Client Portal Gateway on localhost, log in with a paper user, then connect. Not run.
- **HELM simulator:** `simulated: true`, no keys.

To disconnect, delete the connection in the companion (Exchanges). The sealed credential is removed with it, and devices can be revoked under Devices.
