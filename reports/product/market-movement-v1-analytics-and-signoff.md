# Market Movement v1 — Step 11G analytics and signoff

Status: **historical Props Market Movement v1 feature + telemetry contract are complete.** Events no-op until Umami website env is set in a deployment (ops, not product work).

Date: 2026-09-09 (ET)

This is **not** live 2026–27 Market Movement. Game-odds UI and Historical Explorer were not started.

---

## Safety / Scope

| Guard | Result |
| --- | --- |
| BDL HTTP | **0** |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Database schema | unchanged |
| Serving writes / backfill / S3 | none |
| API contract / market math | unchanged |
| Entitlements / billing | unchanged (upgrade still `/billing`) |
| UI redesign | none — MM card layout unchanged |
| Game-odds MM / Historical Explorer / Role / Opportunity / WOWY / live ingestion | not started |

Analytics instrumentation only, plus an optional env-gated Umami script tag (no new npm provider).

---

## Analytics Audit

Searched for Umami, `window.umami`, `trackEvent`, Vercel Analytics, PostHog, Mixpanel, GA, root-layout scripts, and analytics env vars.

Findings:

- **No** Umami (or other product-event) script in `app/layout.tsx` before this step.
- **No** `track(...)` / `trackEvent` helper.
- **No** `@vercel/analytics` (or other analytics) package in `package.json`.
- `lib/analytics/*` is **NBA data access**, not product telemetry.
- No pageview tracking was already installed.

---

## Existing Provider

There was **no** event-capable provider in the running app.

This step does **not** add GA/PostHog/Mixpanel. It adds:

1. A tiny `trackEvent` helper that calls `window.umami.track` **if present**.
2. An optional `<Script>` that loads Umami **only when** `NEXT_PUBLIC_UMAMI_WEBSITE_ID` and `NEXT_PUBLIC_UMAMI_SRC` are both set.

Local/dev with unset env: no script, `trackEvent` is a silent no-op. Production capture is one env pair away. No second provider.

---

## Analytics Helper

`lib/product-analytics/track-event.ts` (not under `lib/analytics`, which is NBA queries).

```ts
trackEvent(name, properties?)
```

- Browser/SSR safe (`globalThis.umami`)
- Missing provider / blocked script → no-op
- Provider throw → swallowed (UI and `/billing` navigation continue)
- Properties sanitized to primitives (drop nested objects, `undefined`, `NaN`)
- Components do not call `window.umami` directly

Optional script: `components/product-analytics/UmamiScript.tsx` in root layout.

---

## Event Definitions

Source of truth: `lib/product-analytics/EVENTS.md`

### `market_movement_viewed`

Fired when certified Market Movement is **resolved and rendered**.

| Property | Type |
| --- | --- |
| `game_id` | string |
| `prop_type` | canonical prop key |
| `detail` | `summary` \| `full` (from API, not inferred from copy) |
| `movement_status` | `ok` \| `empty` \| `unsupported_prop` |
| `consensus_book_count` | integer |

Purpose: are people seeing MM? Do Free and Pro both encounter it? How often is it unavailable?

### `market_movement_upgrade_clicked`

Fired on the Market Movement Founding Pro upgrade click only (not shopping upgrade).

| Property | Value |
| --- | --- |
| `surface` | `market_movement` |

Purpose: are Free users interested enough to go to billing?

**Not implemented:** `market_movement_books_expanded` (rows are not collapsible). No per-book / hover / scroll events.

---

## View Event Semantics

Once-per-identity gate:

`game_id | player_id | prop_type | detail | status`

- Same market rerender → **no** second event (`player_id` is used only in the key, **not** sent as a property).
- Different game, player, or prop → new event.
- Selected Over/Under change does **not** change the key.
- Integration: `useEffect` in `MarketMovementSection` only.

Loading: `MarketMovementSection` is **not mounted** while the panel shows “Loading certified history…”. Loading is not a `movement_status`.

---

## Upgrade Event

`FoundingProUpgradeLink` still `href=/billing`, default copy **Upgrade to Founding Pro**. Optional `onClick` is wrapped in try/catch so tracking failure cannot block navigation. Only the MM card passes the MM tracker; shopping’s upgrade link is unchanged.

---

## Privacy / Data Minimization

Viewed payload keys are exactly the five listed above. Tests assert no player name, odds, email, or nested objects. `player_id` is not sent. No full URL. No account IDs.

---

## Free / Pro Instrumentation

| Experience | `detail` |
| --- | --- |
| Free (`summarizePlayerMarketMovementForFree`) | `summary` |
| Pro | `full` |

Taken from `marketMovement.detail`.

---

## Empty / Unsupported Tracking

**Yes — all resolved certified states fire `market_movement_viewed`:**

- `ok`
- `empty` (`consensus_book_count` 0)
- `unsupported_prop`

Free empty/unsupported still uses `detail=summary`. Loading never fires.

---

## Tests Added

- Helper: provider forward, sanitize, missing provider no-op, provider throw, Umami env gate
- Viewed: Pro `full` once, Free `summary` once, rerender skip, new market fires, empty/unsupported statuses, no loading status, no names/odds
- Upgrade: event name + `surface`, `/billing` + Founding Pro copy, throw does not propagate
- Explicitly not `market_movement_books_expanded`

---

## Test Results

```
14 files, 134 passed
```

11B–11F suites plus 11G analytics tests. Lint on touched files: 0 errors. Typecheck: no errors in 11G files (unrelated repo `tsc` noise left alone).

---

## Manual Verification

Unit tests cover Pro/Free viewed, rerender, new market, upgrade, and tracker-blocked no-op. This session’s signed-in account is Pro; Free click-through was not simulated (no auth bypass). Local Umami env is unset, so the browser no-ops as designed — product UI is unchanged.

---

## Files Changed

| File | Change |
| --- | --- |
| `lib/product-analytics/track-event.ts` | **New** helper |
| `lib/product-analytics/umami.ts` | **New** env-gated script config |
| `lib/product-analytics/market-movement-events.ts` | **New** MM event mapping + once-key |
| `lib/product-analytics/EVENTS.md` | Event source of truth |
| `lib/product-analytics/__tests__/*` | Helper + MM event tests |
| `components/product-analytics/UmamiScript.tsx` | Optional Umami tag |
| `app/layout.tsx` | Mount script (no-op without env) |
| `components/betting/market-movement/MarketMovementSection.tsx` | View + upgrade instrumentation |
| `components/betting/FoundingProUpgradeLink.tsx` | Optional onClick; never blocks `/billing` |
| `components/betting/PropsExplorerMarketPanel.tsx` | Comment: loading does not mount MM section |
| `.env.example` | Optional Umami vars |
| This report + JSON + learning log | |

---

## Remaining Follow-Ups

1. **Ops:** set `NEXT_PUBLIC_UMAMI_WEBSITE_ID` + `NEXT_PUBLIC_UMAMI_SRC` in production to receive events (and pageviews). Local remains no-op until then.
2. Optional quieter `0` delta on Quiet markets (non-blocking polish from 11F).
3. Do **not** start game-odds MM UI or Historical Explorer in this step.

---

## Product Classification

**SHIP_READY**

Certified historical Props Explorer Market Movement v1 (UI + serving + telemetry contract) is complete for its intended scope. Optional Umami env is deployment configuration, not an unfinished product surface.

---

## Recommended Next Roadmap Step

**Historical Explorer v2** — do not implement it in this step.

| | Historical Explorer v2 | Game-odds Market Movement UI |
| --- | --- | --- |
| Captured GOAT data | Decision lines (~94k / 129 games), lineups, plays, season averages, advanced history — the bulk of the trial foundation | `game_odds_market_movement` **945** rows; smaller 107-game opening window |
| User value | Context for *why* a line moved (minutes, role, matchup) after we already shipped a market-facing MM card | Repeat MM pattern for spreads/totals; useful but narrower |
| Cost | Larger product surface | Smaller; reuse MM presentation |
| Dependencies | Can proceed without live ingestion; no new MM math | Should wait until player-prop MM is accepted (this signoff) |

Props Market Movement already gives a market-facing feature. Explorer v2 starts exposing the much larger historical/context corpus. Game-odds MM UI remains a later thin reuse, not the next foundation bet.

---

## Verification Checklist

1. Open a Pro MM card — UI still 3-Hour → Close; with Umami mocked/present, one `market_movement_viewed` (`detail=full`).
2. Rerender / toggle Over vs Under — no duplicate viewed event.
3. Compare a different player/game — a new viewed event.
4. Loading skeleton — no viewed event.
5. Free fixture — `detail=summary`; upgrade click fires `market_movement_upgrade_clicked` and still goes to `/billing`.
6. Block `window.umami` — MM still renders; click still navigates.

---

## Step Verdict

**GREEN — historical Props Market Movement v1 is complete and ship-ready**

STOP. Do not begin Historical Explorer or game-odds Market Movement automatically.
