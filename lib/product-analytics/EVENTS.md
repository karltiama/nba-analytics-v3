# Product events — Market Movement v1

Tiny Umami-compatible helper (`trackEvent`). No-op when `window.umami` is missing.

Do not send names, emails, account IDs, odds payloads, or player display names.

## `market_movement_viewed`

- **Trigger:** Certified Market Movement is resolved and rendered (`ok`, `empty`, or `unsupported_prop`). Not during loading/skeleton.
- **Once per:** `game_id` + `player_id` (internal key only) + `prop_type` + `detail` + `movement_status`. Same market rerender does not fire again. A different game, player, or prop may fire again.
- **Properties:** `game_id` (string), `prop_type`, `detail` (`summary` | `full`), `movement_status`, `consensus_book_count` (integer)
- **Purpose:** Are people seeing Market Movement? Do Free (`summary`) and Pro (`full`) both encounter it? How often is the market unavailable?

## `market_movement_upgrade_clicked`

- **Trigger:** Free/summary user clicks the Market Movement Founding Pro upgrade link.
- **Properties:** `surface` = `market_movement`
- **Purpose:** Are Free users interested enough to click through to `/billing`?
- Navigation to `/billing` must not wait on tracking.

Do **not** implement `market_movement_books_expanded` (rows are not collapsible).

# Product events — Historical Explorer v2

Same `trackEvent` helper. Capability flags and IDs only. No player names, user identity, box arrays, PBP, or odds.

## `historical_game_viewed`

- **Trigger:** A historical Final experience has resolved and rendered. Not the live/upcoming matchup page.
- **Once per:** `game_id`. Same game rerender does not fire again. A different Final may fire again.
- **Properties:** `game_id`, `season`, `starters_available`, `advanced_available`, `role_profile_available`, `timeline_available` (booleans)
- **Purpose:** Are people opening historical games, and with which modules available?

## `historical_player_opened`

- **Trigger:** The user explicitly changes the Season Role player selector. Default first-player render is not “opened.”
- **Properties:** `game_id`, `season`, `surface` = `season_role`
- **Purpose:** Are people using Context?

## `historical_timeline_opened`

- **Trigger:** The user navigates to Timeline (sticky nav or scrolling the section into the active slot). Once per `game_id`.
- **Properties:** `game_id`, `mode` (`key` | `full`) — first open is Key Events default
- **Purpose:** Are people opening Timeline?

# Product events — Parlay XRay

Surface-only. Do **not** send filenames, OCR text, player names, lines, odds, or analysis copy.

## `parlay_xray_viewed`

- **Trigger:** Parlay XRay page mounts.
- **Properties:** `surface` = `parlay_xray`

## `parlay_xray_upload_started`

- **Trigger:** First file-picker / drag interaction on the page.
- **Properties:** `surface` = `parlay_xray`

## `parlay_xray_upload_selected`

- **Trigger:** A screenshot passes client validation and is kept in local preview state.
- **Properties:** `surface` = `parlay_xray`

## `parlay_xray_extract_started`

- **Trigger:** User starts screenshot extraction.
- **Properties:** `surface` = `parlay_xray`

## `parlay_xray_extract_completed`

- **Trigger:** Screenshot extraction returns a handled result category.
- **Properties:** `surface` = `parlay_xray`, `result_category`

## `parlay_xray_extract_failed`

- **Trigger:** Screenshot extraction returns a failed result category or client catch.
- **Properties:** `surface` = `parlay_xray`, `result_category`

## `parlay_xray_open_workspace`

- **Trigger:** Confirmed XRay legs are handed to Parlay Workspace.
- **Properties:** `surface` = `parlay_xray`, `action` = `open_workspace`
- Do **not** send OCR text, player, market, line, book, odds, or the parlay.

## `parlay_workspace_analysis_started`

- **Trigger:** User clicks Analyze with Court Context.
- **Properties:** `surface` = `parlay_workspace`, `source` = `xray` | `props_explorer` | `mixed`, `action` = `analysis_started`
- Do **not** send OCR text, player, market, line, book, odds, full parlay, or analysis text.

