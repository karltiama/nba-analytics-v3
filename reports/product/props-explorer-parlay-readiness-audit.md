# STEP 14P.E0 — Props Explorer Functional + Parlay Readiness Audit

Generated: 2026-09-16  
Status: **audit only — no Parlay Explorer implementation**

This step inspected current routes, handlers, serving code, entitlements, and related product surfaces. It did not create `/parlay-explorer`, Add to Parlay, persistence, sharing, live ingestion, model tuning, or navigation changes. No real OpenAI or BDL calls were made.

---

## Executive Result

**Primary architecture recommendation: `HYBRID`.**

Props Explorer already solves **single-prop discovery and research**. A future multi-leg workflow should not clone that board, and it should not swallow the board either.

- Props Explorer should keep discovering, filtering, inspecting, and (later) handing off a selected offer.
- A small **Parlay Workspace** should own assembled legs, cross-leg context, and Why This Could Fail.
- Parlay XRay should remain the screenshot import path into that same canonical parlay + the same analysis engine.

| Decision | Value |
| --- | --- |
| Architecture | **HYBRID** |
| PROPS_EXPLORER | **KEEP** |
| MARKET_MOVEMENT | **REUSE** |
| CANONICAL_PARLAY_FROM_PROP_ROW | **PARTIAL** |
| PARLAY_ANALYSIS_REUSE | **READY** |
| XRAY_ANALYSIS_PIPELINE | **UNCHANGED** |
| PARLAY_EXPLORER | **NOT_IMPLEMENTED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| SCHEMA_MIGRATION | **NONE** |

Do not start E1 until this recommendation is reviewed.

---

## Current Product Role

Props Explorer is the **authenticated player-prop research board**.

It is designed to answer: *which player-prop offers exist for this ET date or game, at which book / side / line, and what can I inspect next?*

Implemented today:

- Discover available over/under player props for a slate or game.
- Filter by date, game, player name, market, side, and sportsbook.
- Inspect book-specific line and odds (not a consensus-only board).
- Open on-demand book comparison + certified Market Movement.
- Open a player preview and jump to full player research.
- Save a bookmark or add a live offer to Paper.

It is **not** a parlay builder. It does not assemble legs, score parlays, or explain Why This Could Fail. After finding an interesting prop, the current next actions are Save, Compare, Paper, player profile, or leave.

---

## Route / Surface Map

| Route | Purpose | Data source | User actions | Auth / entitlement | Current status |
| --- | --- | --- | --- | --- | --- |
| `/betting/props-explorer` | Primary prop discovery board | Live: `analytics.player_props_current`. Historical: `research.prop_decision_lines`. Games picker: `/api/betting/games?scope=explorer`. | Date, game, filters, sort, pagination, Save, Compare, Paper, player preview, market panel | HTML session-gated. API `requireBettingAuth`. Board itself is **unrestricted once signed in**. Compare shopping/movement are Pro-gated | **IMPLEMENTED** |
| `/api/betting/props-explorer` | Paginated board serving | Same tables as above + live EV compute | Query params | Auth required | **IMPLEMENTED** |
| `/api/betting/props-explorer/market` | On-demand shopping + Market Movement | Historical books: `research.prop_decision_lines`. Live books: `analytics.player_prop_lines`. Movement: `analytics.player_prop_market_movement` | Compare drawer/sidebar | Auth required. `line_shopping_detail` and `market_movement` sanitized | **IMPLEMENTED** |
| `/betting/saved` | Saved research bookmarks | `public.user_saved_props` | Open player/game/explorer, Compare, remove | Auth required | **IMPLEMENTED** |
| `/betting/players/[playerId]` | Deeper player research | Analytics player stats + `/api/betting/players/:id/props` (`player_props_current`) | Tabs, trend/game log, live prop sidebar | Session-gated. Props sidebar is live-current only | **IMPLEMENTED** |
| `/betting/games/[gameId]` | Matchup / historical game research | Game details, injuries, historical explorer modules. Live props fetched but usually not the product board | View matchup, Open Props Explorer | Session-gated | **IMPLEMENTED**; leftover live prop list is **PARTIAL / overlap** |
| `/betting` Dashboard | Slate discovery | Games + odds | Date/filter, View matchup, View props | Session-gated. Dead Filters icon is dashboard-only | **IMPLEMENTED** |
| `/betting/paper` | Paper tracking | Paper bets created from Explorer rows | Review open/settled | Auth required. Historical Explorer rows cannot be papered | **IMPLEMENTED** |
| `/betting/research` | Internal SQL prop-eval | `research.v_prop_eval_units` | Date window, exact prop type | Session-gated; not in primary nav; stale visual shell | **PARTIAL / admin-ish** |
| `/parlay-xray` | Screenshot → confirm → analyze | XRay extraction (public disabled) + historical replay | Upload/preview/confirm/analyze | Session-gated. Analysis certified; extraction disabled in public | **IMPLEMENTED**; not a discovery board |
| `/betting/bet-slip-analyzer` | Legacy analyzer URL | Redirects to XRay | None | Redirect | **DEAD as product**; redirect **IMPLEMENTED** |
| Landing `/` Props preview | Marketing snapshot | Static demo rows | Link to Props Explorer | Public | **PLACEHOLDER / marketing** |
| Historical Explorer (inside game detail) | Final-game box/advanced/role/timeline/lines | Game research modules | Inspect certified history | Session-gated | **IMPLEMENTED**; **not** a player-prop board |
| Admin Model Lab player/game explorer | Modeling inspection | Model-lab adapters | Admin only | Admin | **OUT OF PRODUCT SCOPE** |
| `/parlay-explorer` | Future parlay workspace | — | — | — | **NOT_IMPLEMENTED** |
| Dedicated Market Movement page | Standalone movement product | — | — | — | **NOT_IMPLEMENTED** (embedded only) |

Props Explorer is **not** only one page. The board is canonical, but Compare, Saved, player research, game matchup, Paper, and the dashboard “View props” CTA are part of the same research journey.

---

## Functional Inventory

Legend: **I** implemented · **P** partial · **PH** placeholder · **D** dead/unwired.

| Capability | Status | Data-backed? | Historical / live | Interactive? | Working? | Dead UI? | Free / Pro | Reusable for parlay? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Search by player name | I | Yes, SQL `ILIKE` | Both | Yes, every keystroke writes URL | Yes, no debounce | No | UNRESTRICTED | Yes, discovery |
| Date / slate selection | I | Yes, ET calendar | Both | Yes, URL `date` | Yes. Empty live “today” auto-falls back to yesterday once | No | UNRESTRICTED | Yes |
| Game selection | I | `/api/betting/games` | Both (`picker=calendar` historical) | Yes, URL `game_id` | Yes | No | UNRESTRICTED | Yes |
| Player selection | I | Row click opens preview; name filter is text search | Preview is recent game log, not historical-as-of | Yes | Yes | No | UNRESTRICTED | Partial — preview is not a wager |
| Market selection | I | SQL `prop_type ILIKE` | Both | Yes | Yes | No | UNRESTRICTED | Yes |
| Side filter | I | SQL `side` | Both | Yes | Yes | No | UNRESTRICTED | Yes |
| Sportsbook chips | I | SQL `ANY(books)` | Both | Yes | Yes. Unselected = all books | No | UNRESTRICTED | Yes |
| Line / odds display | I | Row fields | Both | Display | Yes, book-specific | No | UNRESTRICTED | Yes |
| Sorting | I | SQL for snapshot/odds; client after EV compute for EV/confidence | Live EV sorts only | Yes | Yes, with 2500-row EV cap | No | UNRESTRICTED | Low |
| Min EV filter | I | Client filter after live EV compute | Live only; disabled historical | Yes | Partial pagination correctness | No | UNRESTRICTED | No |
| Movement on board | D | — | — | No | N/A | No movement column | Pro only after Compare | Reuse via Compare contract |
| Movement in Compare | I | `player_prop_market_movement` | Certified historical 3-Hour → Close | Open Compare | Yes | No | FREE summary / PRO full | Yes |
| Historical snapshots on board | I | `decision_at` as `snapshotAt` | Historical = last pre-tip close | Display | Yes | No | UNRESTRICTED | Yes as Decision Close offer |
| Player modal / preview | I | `/api/betting/players/:id/game-log-preview` | Recent games, not slate-as-of | Sidebar xl / drawer smaller | Yes | No | UNRESTRICTED | Research only |
| Full player research | I | Player page | Live props sidebar from `player_props_current` | External link | Yes | No | UNRESTRICTED | Research only |
| Game context panel | I | `/api/betting/games/:id/details` + AI summary POST | Game stats / injuries | xl sticky only | Yes when a game is in context | Hidden <1280px | AI briefing Pro | Context, not a leg |
| Navigation | I | `research-journey` hrefs | Both | Yes | Yes | No | UNRESTRICTED | Yes |
| Mobile | P | Same board | Both | Horizontal table scroll + drawers | Usable, dense | No | — | Selection is awkward |
| Empty / loading / error | I | Empty copy helper | Both | Display | Yes | No | — | Copy reusable |
| Pagination | I | `limit` default 100 max 200 + offset | Both | Prev/Next | Yes. Next enabled when `rows.length === limit` | No | UNRESTRICTED | Yes |
| URL state | I | All main filters | Both | Shareable | Yes | No | UNRESTRICTED | Yes |
| Save research | I | `user_saved_props` | Stores `marketContext` + `dateEt` | Toggle | Yes, signed-in | No | UNRESTRICTED | Bookmark ≠ parlay |
| Paper add | I | Paper API | Live future tip only | Add | Yes | Disabled historical | UNRESTRICTED | Proof that a wager object exists |
| Add to Parlay | PH | — | — | — | No | No | NOT IMPLEMENTED | Future entry |
| Parlay builder | D | — | — | — | No | XRay preview has disabled “Open in Parlay Explorer” | NOT IMPLEMENTED | — |
| Advanced metrics toggle | I | EV/proj fields | Live meaningful; historical null | Client toggle | Yes | No | UNRESTRICTED | No |
| Dashboard Filters icon | D | — | Dashboard only | Button has no handler | Dead | **Yes** | — | Do not copy |

### IMPLEMENTED

Discovery board, URL filters, book-specific rows with over and under, Compare shopping, certified Market Movement, player preview, save, paper (live), empty/loading/error, pagination.

### PARTIAL

Mobile density; min-EV pagination; game-detail leftover live prop list; player-page live prop sidebar (separate query, not Explorer serving); historical labels say “closing line” not “Decision Close”; Market Movement comparison label is “Close” not “Decision Close”.

### PLACEHOLDER

Landing table preview. XRay disabled “Open in Parlay Explorer (coming later)” in design preview only.

### DEAD / UNWIRED

Dashboard `FilterBar` Filters button (`aria-label="Filters"`, no `onClick`). No Props Explorer Filters control is dead — that prior note is the dashboard icon. `/betting/research` is wired but not a product nav destination. `/betting/bet-slip-analyzer` redirects to XRay.

---

## Data Sources

| Source | Purpose | Live / historical | Coverage | Canonical IDs? | Line | Side | Book | Game ID | Player ID | Snapshot type |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `analytics.player_props_current` | Explorer live board | Live / current | Latest known row per game/player/book/prop/side/line from snapshot ingest | Analytics `game_id` + `player_id`. Sportsbook raw text. `prop_type` raw | Yes | Yes | Yes | Yes (int in schema; served as text/number) | Yes (int) | Current `snapshot_at` — **not** 3-Hour, **not** Decision Close |
| `research.prop_decision_lines` | Explorer historical board + historical shopping | Historical | Last pre-tip O/U per game/player/book/prop/side | Same analytics IDs | Yes | Yes | Yes | Yes | Yes | `decision_at` = **Decision Close proxy**. Not Opening. Not 3-Hour |
| `research.v_prop_decision_lines` | Materialized + live-raw fallback view | Historical / unmaterialized Final | Not queried by Explorer serving (table is) | Same | Yes | Yes | Yes | Yes | Yes | Same close proxy |
| `analytics.player_prop_lines` | Live Compare shopping | Live, 30-minute freshness | Latest snapshot per game/player/market | Same | Yes | Yes | Yes | Yes | Yes | Current comparable board |
| `analytics.player_prop_market_movement` | Certified Market Movement + XRay replay | Historical certified | v1 vendors: DK/FD/MGM/Caesars. v1 markets: PTS/REB/AST/3PT/PR/PA/PRA | `game_id`, `player_id`, canonical `vendor`, `prop_type` | Yes (ref + close) | Over **and** under odds on the movement row | Canonical vendor | Yes | Yes | **3-Hour Pre-Tip** (`3_hour_pre_tip`) → **Decision Close** (`decision_close`) |
| `analytics.games` / `analytics.players` | Date context, names, game picker | Both | Join only | Yes | — | — | — | Yes | Yes | — |
| `public.user_saved_props` | Bookmarks | Frozen snapshot of selected offer | User-scoped | Same as row at save time | Yes | Yes | Yes | Yes | Yes | Stored `snapshot_at` + `market_context` |
| `/api/betting/games/:id/player-props` | Leftover matchup list | Live | **One preferred book** (default DraftKings), O/U pivoted | Player/game | Yes | Over+under odds on **one** line row | One vendor | Yes | Yes | Current |
| `/api/betting/players/:id/props` | Player-page sidebar | Live | Current table, optional one game | Same | Yes | Yes | Yes | Yes | Yes | Current |
| `research.v_prop_eval_units` | Internal eval | Historical + actuals | Depends on raw archive | Same | Yes | Yes | Yes | Yes | Yes | Decision snapshot + result |
| Raw `player_prop_snapshots_v2` / S3 archive | Ingest / archive | Not product-read by Explorer | Broader than serving | Provider-gated at ingest | Yes | Yes | Yes | Yes | Provider then analytics | Snapshot stream |

Explorer does **not** read `analytics.player_prop_market_movement` for the table. Movement is on-demand after Compare.

---

## Historical Semantics

Certified player-prop vocabulary:

- **3-Hour Pre-Tip** = reference (`3_hour_pre_tip`)
- **Decision Close** = comparison (`decision_close`)
- Do **not** call historical 3-hour data Opening
- Game-odds Opening Snapshot is a different product (`opening_snapshot`)

### Where Explorer is correct

- Historical board source is last pre-tip close, not opening and not 3-hour.
- Copy says “Last pre-tip closing lines… Not a live sportsbook board.”
- Tests lock `lineLabel === 'Historical closing line'` and forbid current/live wording.
- Empty historical copy says archived closing lines, not a live board.
- Saved research persists `market_context` so a close bookmark cannot later present as a live offer.
- Market Movement API kinds remain `3_hour_pre_tip` / `decision_close`.
- Explorer never labels historical 3-hour as Opening.

### Inconsistencies (do not fix in E0 except as documentation)

| Surface | Shown label | Certified name | Severity |
| --- | --- | --- | --- |
| Explorer board / serving | Historical closing line / Closing time / Closed | Decision Close | P2 copy. Semantics are close, name is not certified |
| Market Movement UI | 3-Hour Pre-Tip → **Close**; row labels 3-Hour / Close | Decision Close | P2. Kind is correct; XRay uses Decision Close |
| XRay | 3-Hour Pre-Tip / Decision Close | Certified | Correct |
| Game matchup lines copy | Closing or stored… Not certified Opening Snapshot Market Movement | Correctly distinguishes **game odds** Opening Snapshot | Correct, easy to misread as player-prop Opening |
| Player preview / player page | Recent form, live current props | Not as-of historical | P1 product gap if user is researching a past slate |

Explorer’s historical board is Decision Close, not 3-Hour. 3-Hour appears only after Compare, and only for Market Movement v1 markets/books.

---

## Market Movement Integration

**Answer: A + D, not B.**

- **A.** Movement is embedded in Props Explorer’s Compare panel (`PropsExplorerMarketPanel` → `MarketMovementSection`).
- **B.** There is **no** standalone Market Movement route.
- **C.** Overlap exists with XRay’s market-movement **display** of replay snapshots, not a second Explorer implementation.
- **D.** Shared infrastructure already exists: `lib/betting/market-movement.ts`, `market-movement-server.ts`, `market-movement-api.ts`, `market-movement-present.ts`, `MarketMovementSection`.

Duplication to avoid:

- Do not build a second movement math module.
- Do not re-query `player_prop_market_movement` inside a future builder if XRay replay/context already matched the leg.
- Do not revive legacy Opened → Closed (`summarizePropMovement` was removed from serving).

A future selected parlay leg **can reuse the same Market Movement contract** (`getPlayerMarketMovement({ gameId, playerId, propType })` plus optional `selectedSide`). That call is stored historical data, not a paid provider.

---

## Canonical Identity Readiness

Do **not** create a second identity system. Reuse XRay resolution + `normalizeVendor` / `canonicalizePropType` / analytics player and game IDs.

For a representative Explorer row:

| Field | Classification | Evidence |
| --- | --- | --- |
| Canonical player id | **ALREADY_PRESENT** as analytics `playerId`; **MISSING** `entityId` / `nbaPlayerId` | Board and Compare pass `playerId`. XRay catalog also has `entityId` |
| Game id | **ALREADY_PRESENT** | `gameId` on every row. Type is mixed string/number |
| Market | **ALREADY_PRESENT** as `propType`; **DERIVABLE** to `CanonicalPropType` when alias/allowlist matches; **MISSING** for `turnovers` and any unmatched string | Explorer filter includes steals/blocks/turnovers; MM v1 and XRay canonical sets are narrower |
| Side | **ALREADY_PRESENT** | `over` / `under` on the row |
| Line | **ALREADY_PRESENT** | `lineValue` |
| Sportsbook | **ALREADY_PRESENT** as raw text; **DERIVABLE** via `canonicalizeSportsbook` for v1 books; **AMBIGUOUS** for BetRivers/Fanatics/etc. | Filter chips include non-v1 books; XRay resolver only accepts v1 vendors |
| Source / snapshot kind | **DERIVABLE** | `marketContext` + `sourceTable` + `snapshotAt`. No explicit `3_hour_pre_tip` \| `decision_close` \| `live_current` on the row |
| Odds | **ALREADY_PRESENT** | `oddsAmerican` tied to that side |
| Selectable wager object | **ALREADY_PRESENT** | `ExplorerRow` / `PropsExplorerMarketSelection` / paper POST / saved POST |

**Overall: PARTIAL.** The row is enough to start a canonical leg **without paid calls**. It is not already `CanonicalParlayLegResolution` / `ExtractedParlayLeg`. An adapter is required.

---

## Side / Book / Line Model

### Side

- Both Over and Under are present as **separate rows**.
- Side is encoded on the row (`side`) and filterable.
- Odds are tied to that side, not to a line-only object.
- Compare shopping keeps the selected side and also reports best over/under lines.

### Book / line

- The board is **not** consensus-only.
- DraftKings 27.5, FanDuel 28.5, and BetMGM 27.5 can appear as distinct rows.
- Sportsbook chips restrict which books are listed; they do not collapse them.
- Compare (Pro) lists comparable books at the selected market.

### Selectable wager

Yes. Paper and Save already serialize:

`gameId, playerId, sportsbook, propType, side, lineValue, oddsAmerican, snapshotAt`

A future Add to Parlay can preserve **book, line, side, snapshot** from the row without inventing them. Snapshot **kind** still needs to be labeled from `marketContext` (live current vs Decision Close). 3-Hour is not on the board row.

---

## Filters

| Filter | Visible? | Functional? | Server / client | Changes data? | URL state? | Stale/dead? | Useful for discovery? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Date prev/next/Today | Yes | Yes | Server (date → source) | Yes | `date` | No | Yes |
| Game | Yes | Yes | Server; games list client fetch | Yes | `game_id` | No | Yes |
| Player name | Yes | Yes | Server `ILIKE` | Yes | `player_name` | No debounce | Yes |
| Prop type | Yes | Yes | Server | Yes | `prop_type` | No | Yes |
| Side | Yes | Yes | Server | Yes | `side` | No | Yes |
| Min EV | Yes | Live only | Client after EV | Live yes | `min_ev` | Disabled historical | Weak for parlays |
| Sort + direction | Yes | Yes | SQL or post-EV | Yes | `sort`, `dir` | Historical hides EV/confidence | Medium |
| Sportsbooks | Yes | Yes | Server | Yes | `sportsbook` CSV | No | Yes |
| `market_type` | No | API default `over_under` | Server | Implicit | Not in UI | Hidden, not dead | Keep default |
| `limit` / `offset` | Pagination UI | Yes | Server | Yes | Yes | No | Yes |
| Advanced metrics | Yes | Client column toggle | Client | Display only | No | No | No |
| Dashboard Filters icon | Dashboard only | No | — | No | No | **DEAD** | Do not copy |

The previously noted dead Filters control is **`components/betting/FilterBar.tsx`**, not Props Explorer.

---

## Current User Flow

**ENTRY**

- Primary nav “Props Explorer”
- Dashboard GameCard “View props”
- Matchup page “Open Props Explorer”
- Saved Research empty CTA / row links
- Landing preview (marketing)

**DISCOVERY**

- Default date = today ET. If live today is empty and no filters/date were set, the client **rewrites to yesterday once**.
- Table of book-specific offers.

**FILTER**

- Date, game, player, market, side, books, sort. URL is the state.

**INSPECT**

- Row values: player, prop, side, line, book, odds, value badge, confidence, timestamp.
- Optional advanced EV/projection columns (live).
- Compare opens shopping + Market Movement.

**DEEPER RESEARCH**

- Player name → preview (trend + log).
- External link → `/betting/players/:id?from=explorer&...`
- Game context / AI briefing when a game id is in context (xl only).

**NEXT ACTION**

- Save (bookmark)
- Compare (research)
- Paper (live only)
- Leave to player or game

**Gap:** the page does **not** tell the user what to do after finding a prop they would actually bet as part of a multi-leg ticket. Save is research memory. Paper is a single-leg tracker. Compare is shopping. There is no “this is now a parlay leg” action. That gap is why Add to Parlay belongs on this row, not as a second discovery product.

---

## Mobile / Desktop

Code + prior UI audit (`reports/product/2026-27-post-redesign-ui-ux-frontend-audit.md`). This E0 step did not run a live 390px browser pass.

| Viewport | Functional notes |
| --- | --- |
| ~390px | Header hamburger. Filter grid 2 columns. Sportsbook chips wrap. Table is `overflow-x-auto` with 12+ columns; Save/Compare/Paper sit at the far right. Game context **hidden** until 1280px. Player and Compare use full-height drawers. Repeated selection requires horizontal scroll + drawer close. |
| Tablet | Same drawers below `xl`. More filter columns from `md`. Still no sticky game context. |
| Desktop ≥1280px | Sticky right rail: game context + Compare or player preview. Table remains the center of gravity. |

Product issues, not redesign work:

- P1: 390px repeated “pick legs” would be painful on the current table.
- P2: no scroll hint that more columns exist.
- P2: Compare and player drawers are exclusive in the rail; on mobile they stack as separate overlays.

---

## Free / Pro

Centralized in `lib/entitlements` (`FEATURE_KEYS`, `resolveEntitlementFromRow`, `sanitizePropMarketResearch`). Fail-closed. All listed features flip together for Founding Pro. Do not change entitlements in later parlay work without a dedicated step.

| Capability | Entitlement |
| --- | --- |
| Open Props Explorer board | UNRESTRICTED (signed-in) |
| Filters / books / sides / lines | UNRESTRICTED |
| Save research | UNRESTRICTED |
| Paper add | UNRESTRICTED (blocked on historical/completed) |
| Player preview / player page | UNRESTRICTED |
| Compare: selected offer + market range | UNRESTRICTED |
| Compare: best line / best price / book list | **PRO** `line_shopping_detail` |
| Market Movement full 3-Hour → Close + books | **PRO** `market_movement` |
| Market Consensus close median | **FREE** summary |
| AI matchup briefing in Explorer rail | **PRO** `ai_briefing` |
| Add to Parlay / builder / parlay analysis | **NOT IMPLEMENTED** |
| Advanced history / alerts feature flags | **NOT IMPLEMENTED** as Explorer capabilities |

Existing gates are **centralized**, not hardcoded in random JSX except upgrade copy components. They are **reusable** by a future parlay workspace if shopping/movement remain the same features. Do not invent a parallel Pro matrix.

---

## Props Explorer vs XRay

| | Props Explorer | Parlay XRay |
| --- | --- | --- |
| User starts with | No ticket — browsing offers | A parlay they already have |
| Input | Date/game/player/market filters | Screenshot (public extraction disabled) |
| Unit of work | One book-specific prop row | Confirmed multi-leg ticket |
| Identity | Already stored analytics IDs | Extracted text → `resolveCanonicalParlayLeg` |
| Movement | On-demand Compare | Replay match onto certified snapshots |
| Analysis | None at parlay level | Certified leg + parlay interpretation |
| Next action | Save / Paper / research | Confirm → analyze |

**Shared boundary (do not implement yet):**

1. Both produce or consume a **canonical parlay** (`ExtractedParlayLeg[]` after confirmation, then `CanonicalParlayLegResolution[]`).
2. Explorer should **not** reimplement extraction, context packets, interpretation, or Why This Could Fail.
3. XRay should **not** grow a discovery board.
4. A workspace sits between them: assembled canonical legs in, certified analysis out.

```
Props Explorer  --(selected offer adapter)-->  Canonical legs
XRay confirm     --(already canonical)------>  Canonical legs
Canonical legs   --(existing XRay engine)--->  Workspace analysis
```

---

## Props Explorer vs Future Parlay Workflow

| Capability | Props Explorer today | Future parlay need | Overlap |
| --- | --- | --- | --- |
| Prop discovery | Yes | Yes | **High — keep here** |
| Player search | Name `ILIKE` | Yes | High |
| Market filtering | Yes | Yes | High |
| Book selection | Yes, per-row | Yes | High |
| Line selection | Yes, per-row | Yes | High |
| Single-prop research | Compare + player + game | Optional | High, stay on Explorer |
| Market movement | Embedded Compare | Per selected leg | **Reuse contract** |
| Add/remove multiple legs | No | Required | **New, thin action** |
| Persistent builder | Save is not a parlay | Required | **New workspace** |
| Cross-leg dependencies | No | Required | **XRay structural already exists** |
| Same-player context | No | Required | **XRay** |
| Same-game context | Game panel is matchup/AI, not parlay | Required | **XRay** |
| Why This Could Fail | No | Required | **XRay — do not rewrite** |
| Combined data coverage | Board + MM subset | Coverage cards | **XRay** |
| Parlay-level analysis | No | Required | **XRay** |

---

## Canonical Parlay Readiness

Target shape from this step (not implemented):

```
CanonicalParlayLeg {
  player, game, market, side, line, sportsbook, source
}
```

From a representative Explorer row **without paid calls**:

| Piece | Ready? | Notes |
| --- | --- | --- |
| player | Partial | Analytics id + display name. No entity/nba id on the row |
| game | Yes | `gameId` |
| market | Partial | `propType` string; canonicalize before XRay |
| side | Yes | `over` / `under` |
| line | Yes | `lineValue` |
| sportsbook | Partial | Raw; canonicalize; reject/flag non-v1 if XRay analysis requires v1 |
| source | Partial | Derive `live_current` vs `decision_close`; 3-hour is **not** the board offer |
| odds | Extra, useful | Present; XRay extracted legs also carry odds |

Missing pieces: typed source enum, canonical vendor, canonical market, XRay field-status wrapper, entity id if analysis needs it (resolvable from catalog without providers).

**Verdict: PARTIAL.** Adapter, not new ingestion.

---

## Architecture Option A — Separate

Props Explorer stays single-prop. Parlay Explorer gets its own discovery + builder + analysis.

| Lens | Assessment |
| --- | --- |
| Code duplication | **High.** Would re-copy board query, filters, book chips, serving live/historical split, Compare, player preview |
| Mental model | Two Explorers side by side |
| Navigation | 10th primary item; already 9 and crowded |
| Mobile | Second dense table |
| Reuse of Explorer | Low |
| Reuse of XRay | Possible for analysis only |
| Complexity | Highest |
| Live-data fit | Would have to duplicate the live/historical serving boundary |

Reject as primary. The discovery problem is already solved.

---

## Architecture Option B — Extend Props Explorer

Add Add to Parlay, builder, and analysis onto the current page.

| Lens | Assessment |
| --- | --- |
| Code duplication | Low for discovery |
| Mental model | One page does research **and** ticket construction **and** XRay-class analysis |
| Navigation | Simple, but the page is already a table + 3 actions + 2 drawers + AI rail |
| Mobile | Worst fit; 390px cannot host builder + analysis + table |
| Reuse of Explorer | Forced overload |
| Reuse of XRay | Risk of forking analysis into Explorer components |
| Complexity | Medium-high UI, lower routing |
| Live-data fit | Fine for picking, poor for analysis chrome |

Reject as primary. Paper/Save already show the page is at action-capacity.

---

## Architecture Option C — Hybrid

Props Explorer: discover/research → later Add to Parlay.  
Parlay workspace: assembled legs → cross-leg analysis → Why This Could Fail.  
XRay: screenshot → same canonical parlay → same workspace.

| Lens | Assessment |
| --- | --- |
| Code duplication | Lowest if workspace consumes XRay analysis and Explorer only emits legs |
| Mental model | Explorer = find a prop. Workspace = work a ticket. XRay = import a ticket |
| Navigation | One new destination, ideally not named “Explorer” |
| Mobile | Table stays a picker; workspace can be a stacked leg list (XRay already is) |
| Reuse of Explorer | Keep board, filters, Compare, identity |
| Reuse of XRay | Direct |
| Complexity | Adapter + small action + workspace shell |
| Live-data fit | Workspace takes source-neutral canonical offers; Explorer already has a live/historical serving split to feed that |

This matches the code that already exists.

---

## Recommended Product Architecture

**HYBRID.**

1. **Keep Props Explorer** as the single-prop research board. Do not redesign it for parlays.
2. **Later (not this step):** smallest Add to Parlay on a row that already is a wager object.
3. **New workspace surface** (name TBD; not implemented) owns the slip, dependencies, coverage, Why This Could Fail.
4. **XRay unchanged** as screenshot import; disabled preview CTA already points at a later workspace.
5. **Market Movement reused** via existing Compare/server contract, not a new page.
6. **Canonical adapter** maps Explorer row → XRay `ExtractedParlayLeg` with `status: known` where fields exist, then existing `resolveCanonicalParlayLeg`.

STOP. Do not start that adapter in E0.

---

## Naming / Navigation Considerations

Do **not** rename anything now.

Current primary nav (flat, no Features menu): Dashboard, Teams, WOWY, Parlay XRay, Props Explorer, Saved, Paper, Profile.

| Name | Fit |
| --- | --- |
| Parlay Explorer | Collides with Props Explorer. XRay preview already uses this string. High IA confusion |
| Parlay Builder | Honest for assembly; understates analysis |
| Parlay Lab | Sounds like Model Lab |
| Parlay Research | Sounds like `/betting/research` SQL page |
| Parlay Workspace | Best IA: place you take legs (from Explorer or XRay) to work them |

**Recommended future IA (not applied):**

- Keep **Props Explorer**
- Keep **Parlay XRay**
- Add **Parlay Workspace** (or Builder if the first slice is assembly-only)
- Do **not** add a second “Explorer”
- If nav crowding forces a Features group later, group research destinations there; do not bury XRay and Explorer under two different Explorers

XRay foundation already warned: “Nav crowding (9 primary items) if a Features menu is introduced later.” A 10th “Parlay Explorer” would make that worse.

---

## Duplication Risks

Do **not** duplicate these in a future parlay implementation:

| Area | Module |
| --- | --- |
| Prop board queries | `lib/betting/props-explorer-serving.ts`, `GET /api/betting/props-explorer` |
| Live vs historical serving split | `lib/betting/props-market-context.ts` |
| Market shopping | `lib/betting/prop-market-serving.ts`, `prop-market-compare.ts` |
| Market Movement loaders / math / UI | `lib/betting/market-movement*.ts`, `components/betting/market-movement/MarketMovementSection.tsx` |
| Canonical player / vendor / market | `lib/betting/market-movement.ts` (`normalizeVendor`, `canonicalizePropType`), `lib/parlay-xray/resolution/*`, `lib/identity/*` |
| Sportsbook normalization | `lib/parlay-xray/resolution/sportsbook.ts` |
| XRay context assembly | `lib/parlay-xray/context/*` |
| XRay leg interpretation | `lib/parlay-xray/interpretation/interpret.ts` |
| XRay parlay analysis | `lib/parlay-xray/interpretation/parlay.ts` |
| Why This Could Fail | XRay results / parlay interpretation display |
| Historical replay matching | `lib/parlay-xray/replay/*` |
| Entitlement sanitize | `lib/entitlements/sanitize-prop-market.ts` |
| Research journey URLs | `lib/betting/research-journey.ts` |

Do **not** revive `/api/betting/games/:id/player-props` as a second board. Do **not** copy `PlayerPropSelectorSidebar` as the parlay picker.

---

## Reusable Components / Services

| Item | Recommendation |
| --- | --- |
| `getPlayerPropsForExplorer` | **REUSE AS-IS** for discovery |
| `props-market-context` live/historical split | **REUSE AS-IS**; this is the future source boundary |
| `ExplorerRow` / paper / saved payload | **REFACTOR LATER** into a shared offer DTO |
| `PropsExplorerMarketPanel` | **REUSE AS-IS** for per-leg shopping |
| `MarketMovementSection` + `getPlayerMarketMovement` | **REUSE AS-IS** |
| `PropsExplorerPlayerPanel` | **PROPS-SPECIFIC**; optional research chrome, not a leg |
| `PropsExplorerGameContextPanel` | **PROPS-SPECIFIC**; do not treat AI briefing as parlay analysis |
| `FilterBar` (dashboard) | **DO NOT REUSE** (dead Filters control) |
| `PlayerPropsFilterableList` on matchup | **DO NOT REUSE** |
| `PlayerPropSelectorSidebar` | **PROPS-SPECIFIC**; live-current only |
| `canonicalizeSportsbook` / `canonicalizePropType` | **REUSE AS-IS** |
| `resolveCanonicalParlayLeg` | **REUSE AS-IS** |
| `interpretXrayLeg` / `interpretXrayParlay` | **XRAY-SPECIFIC** but **the** analysis to call |
| XRay context loaders | **XRAY-SPECIFIC**; reuse, do not rewrite |
| `sanitizePropMarketResearch` | **REUSE AS-IS** |
| `PRIMARY_NAV` | **DO NOT REUSE** as a dumping ground; IA later |
| Landing `LandingPropsTablePreview` | **DO NOT REUSE** as product UI |

---

## Current Defects

### P0

None found in this audit. Historical vs live source switching is tested and does not serve current rows for past ET dates.

### P1

1. **Game detail still fetches** `/api/betting/games/:id/player-props` on non-Final games and can render `PlayerPropsFilterableList` (preferred-book pivot) **in addition to** sending users to Props Explorer. Two boards, different shapes.
2. **Player research sidebar** reads live `player_props_current` only, even when the user arrived from a historical Explorer date (`from=explorer&date=`). Historical Decision Close is not what the sidebar shows.
3. **390px table** hides book/line/actions behind horizontal scroll; a future multi-select flow would fail here even if Add to Parlay were added.
4. **Certified label drift:** Explorer “Historical closing line” / MM UI “Close” vs XRay “Decision Close”. Not Opening, but not one vocabulary.

### P2

1. Dashboard Filters button is dead (not Explorer).
2. Player-name filter has no debounce; each keystroke `router.replace`s and refetches.
3. Empty live today silently moves to yesterday (once, no explicit date param).
4. `min_ev` is applied after fetch; pagination + EV filter can disagree with `totalMatching`.
5. Sportsbook cells show raw DB strings; Compare title-cases them.
6. `/betting/research` uses a leftover visual shell and is not in nav.
7. Explorer page has no product analytics events of its own (only Compare movement does).
8. `gameId` / `playerId` types mix number and string across UI and APIs.

Do not turn this into a cleanup sprint. None of these block the architecture decision.

---

## Leave-It-Alone List

Do not reopen during parlay work unless a later step’s contract requires it:

- Props Explorer as a research **table** (date, filters, book-specific rows)
- Live vs historical serving split and empty-state honesty
- Save research bookmark semantics (`market_context` persistence)
- Paper blocked on historical/completed games
- Certified Market Movement math, v1 vendor/market allowlist, Free consensus vs Pro detail
- Compare panel structure (selected / range / upgrade / movement)
- `research-journey` href helpers
- XRay extraction-disabled public path, canonical resolution, context packets, interpretation, Why This Could Fail
- Production 70/30 modeling, frozen shadows, WOWY park, provider entitlement block
- Dashboard GameCard CTA pair (View matchup / View props)
- Entitlement resolver

---

## Future Entry Points

Not implemented. Smallest natural fits with current UI:

| Entry | Fit | Why |
| --- | --- | --- |
| Prop row **Add to Parlay** | **Best** | Row is already a wager object; sits with Save / Compare / Paper |
| Compare panel **Add this offer** | Good | After user picked book/line via shopping |
| Player preview **Add leg** | Weak | Preview is stats, not a complete offer (side/book/odds missing from selection type) |
| Persistent **N legs selected** chip | Workspace, not Explorer chrome first | Needs a workspace to land in |
| XRay **Open in Parlay Workspace** | **Already sketched** | Disabled preview button; rename later from “Parlay Explorer” |
| Saved Research **Add to Parlay** | Later | Bookmark already has the fields |

Do **not** add these in E0.

---

## Historical / Live Boundary

Explorer **already abstracts** live vs historical at the serving layer:

- `resolvePropsMarketContext` → `live` | `historical`
- `propsServingSource` → `analytics.player_props_current` | `research.prop_decision_lines`
- Row carries `marketContext`, `lineLabel`, `sourceTable`, `paperBetAllowed`

It does **not** yet expose a source-neutral `CanonicalOffer`. The minimal future boundary:

```
CanonicalOffer {
  playerId, gameId, propType, side, lineValue, sportsbook,
  oddsAmerican?,
  source: 'live_current' | 'decision_close',  // 3-hour is movement, not the offer
  snapshotAt,
  sourceTable
}
```

Live board later continues to fill `live_current`. Historical board continues to fill `decision_close`. Movement remains a **lookup** on (game, player, market), not the selected offer itself.

Do not build live integration in this step. Ingestion remains frozen / entitlement-blocked as in current product state.

---

## Performance

| Pattern | Observation |
| --- | --- |
| Fetching | Client `useEffect` → `/api/betting/props-explorer`. Not a server component loader |
| Page size | Default 100, max 200 |
| Count + page | Two SQL queries per load |
| Live EV | Per unique player `getPlayerPropModelInputs` in chunks of 12 — **N-ish**, capped by page uniqueness |
| EV sort | Fetches up to **2500** freshest rows, computes, sorts, slices. UI warns order is approximate |
| Filters | Most applied SQL-side. `min_ev` is in-memory after compute |
| Player name | Refetch on every keystroke |
| Compare | On-demand; does not fan out across visible rows (explicitly documented) |
| Game context | On-demand details + optional AI POST when game id present |
| Saved list | Extra `/api/user/saved-props?limit=200` on mount |

Not pathological enough to optimize in E0. A future “add many legs from the same board” should keep using the existing page query, not N Compare calls per row.

---

## Analytics / Privacy

Props Explorer **board has no `trackEvent` calls.**

Market Movement (Compare) sends `market_movement_viewed`:

- `game_id`, `prop_type`, `detail`, `movement_status`, `consensus_book_count`

It does **not** send player name, line, odds, book, or search query.

Upgrade click sends `{ surface: 'market_movement' }` only.

No privacy change required. Future Add to Parlay telemetry should follow the same rule: ids/types/status, not lines/odds/queries.

---

## Test Coverage

| Area | Coverage |
| --- | --- |
| Loading / empty copy | `props-explorer-empty.test.ts` |
| Live vs historical serving | `props-explorer-serving.test.ts` |
| Market mapping / shopping | `prop-market-serving.test.ts`, `prop-market-compare.test.ts` |
| Books / movement math / present | `market-movement*.test.ts` |
| Entitlement sanitize | `sanitize-prop-market.test.ts` |
| Journey URLs | `research-journey.test.ts`, `saved-research.test.ts` |
| MM analytics privacy | `market-movement-events.test.ts` |
| Explorer page UI / filters / mobile | **None** (no page contract test analogous to XRay) |
| Empty states (frozen vs historical) | Empty copy unit tests only |
| Add to Parlay | N/A |

No large new suite was added. Existing tests already prove the historical source split that a parlay adapter must respect.

---

## Files Changed

- `reports/product/props-explorer-parlay-readiness-audit.md` (this report)
- `notes/learning-log/2026-09-16/step-14p-e0-props-explorer-parlay-readiness.mdx`

No product, API, schema, nav, XRay, or modeling files were modified.

---

## Schema Changes

**NONE.** No proposed migration.

---

## Recommended Next Step

**STEP 14P.E1 (review first, do not auto-start):** specify the Hybrid contract only:

1. Canonical offer DTO mapped from `ExplorerRow` using existing IDs + `canonicalizePropType` / `canonicalizeSportsbook`.
2. Where Add to Parlay would sit on the existing row (do not implement).
3. Workspace name/IA recommendation locked (avoid a second “Explorer”).
4. Explicit reuse of XRay analysis; XRay pipeline stays unchanged.
5. Still no builder UI, no persistence, no extraction enablement, no model reopen.

---

## Verification Checklist

1. Confirm `/parlay-explorer` still does not exist and primary nav is unchanged.
2. Skim `app/betting/props-explorer/page.tsx` and confirm Save / Compare / Paper are the only row actions.
3. Confirm `getPlayerPropsForExplorer` still reads `player_props_current` vs `prop_decision_lines` by ET date.
4. Confirm Compare still loads `/api/betting/props-explorer/market` and `MarketMovementSection`.
5. Confirm XRay still has disabled “Open in Parlay Explorer (coming later)” in design preview only.
6. Confirm this step made **0** OpenAI/BDL/AWS changes and **0** schema migrations.
7. Review the HYBRID recommendation before any E1 adapter or UI.

---

## Step Verdict

**GREEN — Props Explorer functional audit complete. Hybrid architecture recommended. Parlay Explorer not started.**

```
ARCHITECTURE: HYBRID
PROPS_EXPLORER: KEEP
MARKET_MOVEMENT: REUSE
CANONICAL_PARLAY_FROM_PROP_ROW: PARTIAL
PARLAY_ANALYSIS_REUSE: READY
XRAY_ANALYSIS_PIPELINE: UNCHANGED
PARLAY_EXPLORER: NOT_IMPLEMENTED
MODEL_TUNING: FROZEN
REAL_OPENAI_CALLS_THIS_STEP: 0
REAL_BDL_CALLS_THIS_STEP: 0
SCHEMA_MIGRATION: NONE
```
