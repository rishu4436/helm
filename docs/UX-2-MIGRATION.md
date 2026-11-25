# HELM UX 2.0: migration notes

## What changed, by layer

### Database (additive only)
Migration `prisma/migrations/20261125061943_ux2_prefs_activity`:
- `UserPreference(userId PK → User cascade, data Json, updatedAt)`: glasses presentation preferences (mode, privacy, home mode, alert sensitivity, watchlist, size presets, deck order and favorites, onboarding state).
- `ActivityMark(userId, itemId unique, acknowledgedAt?, dismissedUntil?)`: ack/dismiss state for computed "current" activity items.
- `PulseEvent.acknowledgedAt` (nullable).

No column is dropped or renamed, and existing rows are untouched. Rollback (section 4) is to redeploy the previous build; the extra tables are simply unused.

### API (new routes; existing contracts kept)
| Route | Purpose |
|---|---|
| `GET/PUT /v1/preferences` | Zod-validated partial merge (strict: unknown keys such as trading limits are rejected with 400) |
| `GET /v1/activity` | `{current, recent, resolved, asOf}`. *Current* is recomputed from live state (unprotected, near liquidation, margin, disconnected accounts, unknown orders), so an old warning cannot look current |
| `POST /v1/activity/:id/ack` and `/dismiss` | Dismiss uses a 4 h cooldown. Critical items (near liquidation, unknown order) return 409 NOT_DISMISSIBLE |
| `GET /v1/markets/:asset/snapshot` | Binance Demo 24h ticker plus 24 hourly closes. No candles means no sparkline |
| `GET /v1/markets/watchlist` | Now `{asset, price, change24hPct, at}` from the 24h ticker; unknown assets come back as nulls |
| `GET /v1/markets/:asset?notional=` | Adds `impactBps` and `estCostBps` (book walk + published taker fee, labelled as an assumption). Null when the book is too thin |
| `GET /v1/portfolio` | Adds `portfolio.holdings[]` and `accounts[].availableUsd` (free stablecoin balance as reported by the venue) |
| `POST /v1/voice/command` | Accepts an optional `context` and returns `interpretation` + `action` (navigate / propose / protect / clarify / reject) alongside the legacy `intent/resolution/next` |

Other API changes:
- **Guest cleanup**: guests older than 48 h are deleted with everything they own, triggered opportunistically (at most every 10 min) from `/v1/auth/demo`.
- **OKX**: new error code `ACCESS_RESTRICTED` (51155, 51156, 50110, and a WAF/region 403/451 page), mapped to HTTP 403 and never retried. 50001/50013/50026 map to EXCHANGE_UNAVAILABLE and 50004 to ORDER_UNKNOWN. The diagnostics row no longer says "BLOCKED — India".

### Glasses app
- `main.ts` now handles only pairing; everything after authentication runs in `nav/controller.ts` with `LiveBackend`.
- Screens: `screens/v2.ts` (new), `screens/trade.ts` (kept for pairing and shared helpers).
- Graphics: `gfx/graphics.ts` (typed descriptors → deterministic draw ops) and `gfx/raster.ts` (canvas → PNG).
- Renderer: serial transfer queue, generation IDs, image content fingerprints, stale-image cancellation, text-only updates, acks, and text fallback for rejected images.

### Companion
- `app/glasses-sim.tsx` runs the real Controller. It powers **Vision** (LiveBackend, read-only: Confirm shows "READ-ONLY MIRROR") and the **landing demo** (SampleBackend, labelled SIMULATED SAMPLE DATA).
- `G2Screen` paints gfx images with the same `layoutGraphic → paintOps` code the glasses use.
- OKX gets the standard provider card with a Demo key / secret / passphrase / alias form. The region copy is removed from the landing page, connect, capabilities, markets, terminal, settings and diagnostics.
- Settings has a new "Glasses display" card. The dashboard now opens with "Needs attention" (current activity, ack/dismiss), puts positions before accounts, and shows 24h change in the watchlist.

## Backward compatibility
- Old glasses builds (pre-UX2 `.ehpk`) keep working: every route they call still exists with the same response fields, and new fields are additive.
- The voice route still returns `intent`, `resolution` and `next`.
- The watchlist still returns `price` and `at`.

## Rollback
1. Vercel: promote the previous production deployment (helm-silk-rho) in the dashboard, or redeploy `main`.
2. Render `helm-api`: deploy the previous commit on `main` (auto-deploy follows main).
3. Neon: no down-migration is needed. The new tables and column are unused by older builds. To remove them anyway: `DROP TABLE "ActivityMark"; DROP TABLE "UserPreference"; ALTER TABLE "PulseEvent" DROP COLUMN "acknowledgedAt";`, then delete the row from `_prisma_migrations`.
4. Glasses: reinstall the previous `helm.ehpk` (kept in git history).
