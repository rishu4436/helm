# Provider capabilities

Each adapter publishes a `CapabilityManifest` (`packages/shared/src/capabilities.ts`), served at `GET /v1/capabilities` and drawn as the companion's capability matrix. The engine checks it before every preview (`assertCapability`), so an unsupported action is refused up front and never attempted. Withdraw permission is `false` by type: there is no withdraw code path anywhere.

Snapshot from the running API (`GET /v1/capabilities`, 2026-11-24):

| Provider · env | Products | Order types | Reduce-only | Hedge mode | Simulation | Trade-to-Protect |
|---|---|---|---|---|---|---|
| Binance · demo (spot) | spot | MARKET, LIMIT, STOP_LIMIT, TAKE_PROFIT_LIMIT | no | no | real demo matching engine | **no** (no STOP_MARKET on spot) |
| Binance · demo (USDⓈ-M) | perp | MARKET, LIMIT, STOP_MARKET, TAKE_PROFIT_MARKET | yes | yes | real demo matching engine | yes, entry + recovery (Algo Order API) |
| Bybit · demo (unified) | spot, perp | MARKET, LIMIT, STOP_MARKET | yes (perp) | yes | real demo matching engine | yes: perp entry + recovery; spot entry + stop cleanup on sale |
| OKX · demo | spot, perp | MARKET, LIMIT | yes | yes | real demo matching engine | not offered (stops not wired); **logged-in BLOCKED (region)** |
| Coinbase · static sandbox | spot | MARKET, LIMIT | no | no | **static responses**, never fills | no |
| IBKR · paper | stock | MARKET, LIMIT, STOP_MARKET, STOP_LIMIT | no | no | paper broker | not wired (NOT RUN) |
| Alpaca · paper | stock | MARKET, LIMIT, STOP_MARKET, STOP_LIMIT | no | no | paper broker | off by default (not in track) |
| HELM simulator (Binance/OKX/Bybit) | spot, perp | MARKET, LIMIT, STOP_MARKET | yes | no | local simulation on live public books | yes (labelled SIMULATED) |

Restrictions shown with each manifest (verbatim from the API):

- **Binance:** "Binance Demo Trading only; production hosts are blocked by the environment guard".
- **Bybit:** "Bybit Demo Trading (api-demo.bybit.com): not every V5 endpoint is available; WS trading unsupported; demo orders kept 7 days".
- **OKX:** "every authenticated request carries x-simulated-trading: 1; Account mode not yet read; Position mode not yet read".
- **Coinbase:** "predefined mock responses, not real executions; Live Coinbase order broadcasting is disabled; Only Accounts and Orders endpoints exist in the sandbox".
- **IBKR:** "Requires the IBKR Client Portal Gateway running locally with a paper login; Gateway sessions expire; HELM keeps them alive with /tickle; Market data requires IBKR subscriptions; Order warnings (reply prompts) are shown to the user, never auto-confirmed".

**Verification column.** Every manifest currently says `verification: documented`: the static manifest is built from the provider docs. The Binance Demo and Bybit Demo capabilities were also exercised with real demo credentials (`evidence/binance-demo`, `evidence/bybit-demo`, `evidence/engine-e2e`, `evidence/orphan-cleanup`, `evidence/protection-recovery`), but the manifest field has not been flipped automatically. That is a known limitation.
