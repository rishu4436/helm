# HELM UX 2.0: research and baseline audit

Written on branch `feature/helm-ux-v2` (Nov 2026). It records what HELM looked like before UX 2.0, which problems we found, and what the redesign is based on. Section 4 lists the platform facts we verified ourselves, as opposed to facts we took from the docs.

## 1. Sources read

| Source | What we took from it |
|---|---|
| Even Hub docs (hub.evenrealities.com/docs) and `even-realities/everything-evenhub` (design guidelines, glasses-ui, SDK reference, simulator skills) | 576×288 monochrome-green canvas, a container model (text, list and image containers; exactly one captures events), ≤4 image containers, images 20–288 × 20–144, the list event model (`listEvent.currentSelectItemIndex`), the text-capture swipe events, and the guidance to keep screens short with one primary action |
| Apple HIG: Designing for watchOS | Glanceable first screen, "a few seconds per interaction", one primary action per view, progressive disclosure into detail, no dense tables |
| Android: Design for wearables (Wear OS) | Tiles/cards answering one question each, a predictable card order, a "launch to the most relevant thing" home, avoiding deep hierarchies |
| OKX API v5 docs | Demo Trading uses the production host with the `x-simulated-trading: 1` header and a Demo-Trading API key + secret + passphrase. Compliance/IP restriction codes (51155/51156 compliance, 50110 IP) and outage codes (50001/50013/50026). 50004 means the endpoint timed out and the outcome is unknown |

## 2. Architecture before UX 2.0 (main @ 2a4a131^)

- `apps/glasses/src/main.ts` was one ~330-line state machine with a `State` union and a global `stack`. Navigation, data loading and SDK events were all mixed together.
- `screens/trade.ts` held pure screen builders: `HOME_ITEMS`, an **11-item flat menu** (Overview, Positions & holdings, Watchlist, Voice command, Trade, Pulse, Exposure Compass, Receipts, Emergency review, Protect positions, Accounts).
- `render.ts` rebuilt a whole page per screen. Its structure signature covered text/list geometry only, and images were limited to the wordmark and pairing code.
- The companion's Vision page and the landing demo each had **their own** simplified copy of the navigation, so the three experiences drifted apart.
- OKX was hard-coded as BLOCKED in 6 companion places and in API diagnostics. The reason was the developer's location (India), which is not a property of the provider.

## 3. Usability problems found (baseline)

1. **The menu came first.** After pairing, the first useful screen was an 11-item list. Portfolio value took one tap; the unprotected-position warning took 10 gestures (Protect positions is item 10).
2. **Information you could not act on.** Positions & holdings was a text list. A position could not be opened, and protecting one meant going back to Home → Protect positions.
3. **Silent truncation.** Lists were capped at 20 rows with no continuation, so holdings past row 20 could not be reached.
4. **Trading was BTC-only, with presets.** Glasses Trade always started at BTC with fixed presets. There was no asset choice, no custom size and no futures/side choice except through voice.
5. **Dense previews.** Impact → Risk → Confirm took three screens even for routine orders, and the material numbers were spread across them.
6. **Pulse was a passive feed.** An old "unprotected" event looked current after a stop was placed, there was no ack/dismiss, and events had no actions.
7. **Jargon.** Exposure Compass, Pulse, reduce-only, reconciliation, ALLOW/WARN/BLOCK and slippage were shown to beginners without explanation.
8. **Voice was a dead end.** Voice lived behind its own menu item and did not know what was on screen, so "close half of this" could not work.
9. **Graphics stopped at the wordmark and pairing code.** There was no allocation, range, bar or sparkline rendering, and image content changes went undetected because the signature was geometry-only.
10. **Three experiences out of sync** (glasses, Vision, landing demo).
11. **OKX looked globally blocked** to every visitor.
12. **No onboarding.** A new user landed in the menu.

## 4. Platform facts verified (not assumed)

| Fact | How we verified it |
|---|---|
| SDK `@evenrealities/even_hub_sdk` **0.0.16** is installed | `apps/glasses/package.json`, lockfile |
| Event types: 0 click, 1 scroll-top (swipe up), 2 scroll-bottom (swipe down), 3 double-click, 4/5 foreground enter/exit, 6 abnormal exit, 7 system exit | SDK typings (`OsEventTypeList`); mapped in `nav/events.ts`, unit-tested |
| List taps arrive as `listEvent` with `currentSelectItemIndex`, and **undefined means row 0** | Simulator 0.9.5 logs from the baseline run; tested in `controller.test.ts` |
| Swipes on a text-capture container arrive as `textEvent` 1/2; list scrolling is handled by the firmware | Same |
| List rows must be **≤63 UTF-8 bytes** (64 made 0.9.5 reject the rebuild); `@ ( ) _` were rejected in list rows | Baseline findings, kept in `listSafe` / `clipBytes` |
| Glyphs missing from the firmware font: ✓ Ⓢ ₹ (pretext `getAdvW(cp)===0`) | `screens/v2.test.ts` glyph check over every reachable screen |
| ≤12 containers, ≤4 images, image 20–288 × 20–144, exactly one capture container | Enforced by `validateSpec`; violations are rejected before any SDK call |

Physical G2 hardware and Bluetooth latency were **not** tested. All "device" results in this upgrade come from the official simulator or from unit tests.

## 5. Baseline test results (before any edit)

- `vitest run`: **278/278** passed.
- Companion Playwright: **46/46** passed in 5.4 min (`evidence/ux-v2/before/playwright-baseline.txt`).
- Typecheck: one pre-existing error (`apps/api/src/engine.test.ts(26,23) TS2538`), fixed in UX 2.0 commit 9023607.

## 6. Design decisions

- **Five destinations** (Home, Portfolio, Markets, Trade, Activity) presented as a native list on Home, with "More" holding Shield/Portfolio Risk, Compass, Emergency, Recipes, Settings and Help. A tab carousel was rejected because list scrolling is firmware-owned and there is no horizontal gesture; swipes on a text container are used only where a screen captures text (Quick Deck, the amount stepper).
- **Home = glance**: scope, value, open P/L, position count, health, the highest-priority actionable alert as row 1, and freshness. An adaptive mode (first-time / spot / futures / multi / risk) is chosen from data and preferences, never from a single session.
- **One shared Controller** (`apps/glasses/src/nav/controller.ts`) runs on the glasses, in Vision (read-only LiveBackend) and on the landing page (SampleBackend), so the three can no longer drift.
- **Confirm safety is unchanged or stronger**: Cancel is the default; confirm is accepted only as a list tap on row 1 of the rendered confirm screen whose ack is bound to that proposal; tokens are single-use; previews expire after 45 s; an unknown outcome leads to "Verifying with exchange", never a retry.
- **Privacy mode** hides portfolio balances only. The order's own size and cost always show before confirmation, because confirming blind is unsafe.
