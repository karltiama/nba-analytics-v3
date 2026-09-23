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
- **Properties:** `surface` = `parlay_xray`, `result_category` (canonical `XRAY_EXTRACT_RESULTS` code only)

## `parlay_xray_extract_failed`

- **Trigger:** Screenshot extraction returns a failed result category or client catch.
- **Properties:** `surface` = `parlay_xray`, `result_category`
- **Closed values:** a canonical `XRAY_EXTRACT_RESULTS` code, or `UNKNOWN` when the value is not one of those codes. Raw API text is never sent. Client catch uses `INTERNAL_ERROR`.

## `parlay_xray_open_workspace`

- **Trigger:** Confirmed XRay legs are handed to Parlay Workspace.
- **Properties:** `surface` = `parlay_xray`, `action` = `open_workspace`
- Do **not** send OCR text, player, market, line, book, odds, or the parlay.

## `parlay_workspace_analysis_started`

- **Trigger:** User clicks Analyze with Court Context.
- **Properties:** `surface` = `parlay_workspace`, `source` = `xray` | `props_explorer` | `mixed`, `action` = `analysis_started`
- Do **not** send OCR text, player, market, line, book, odds, full parlay, or analysis text.
- **Preview:** suppressed when `shouldSuppressProductPreviewAnalytics` is true (`replay`, `historical`, `1`, `partial`, `analysis`). The historical preview client does not call `trackEvent`.

Preview routes (`preview=replay`, `preview=historical`, and other XRay design preview flags) suppress `parlay_xray_viewed`, `parlay_xray_open_workspace`, and Workspace Analyze events. They do not emit `preview=true` properties.

# Product events — First-run onboarding

Surface + category only. Do **not** send wager contents, player names, sportsbook preference, or analysis text.

## `onboarding_started`

- **Trigger:** First-run dialog opens.
- **Properties:** `surface` = `onboarding`

## `onboarding_skipped` / `onboarding_completed`

- **Trigger:** Skip for now, or Continue after guidance level.
- **Properties:** `surface` = `onboarding`, `primary_intent` (category or `skipped` / `none`), `guidance_level` (category or `skipped` / `none`)

## `coachmark_seen`

- **Properties:** `surface` = `onboarding`, `coachmark_id`

## `checklist_item_completed`

- **Properties:** `surface` = `onboarding`, `item_id`

## `tour_replayed`

- **Properties:** `surface` = `onboarding`, `action` = `replay`

# Product events — Phase 1

Same `trackEvent` helper. Closed enums only. No pageview calls. No search text, names, slip contents, prices, or account identifiers.

Status: **LIVE** means a real interaction emits it. **RESERVED** means the name is not implemented. **NEEDS_SERVER_SIDE_CONFIRMATION** means the client must not guess.

## `landing_cta_clicked` — LIVE

- **Trigger:** A landing CTA that enters the product. Hero “Explore Court Context”, header Sign In / Create account / Dashboard, and feature-section links (props board, dashboard, WOWY, Parlay XRay, trending-player cards).
- **Properties:** `surface` = `landing`, `location` = `hero` | `header` | `feature_section`, `action` = `explore_court_context` | `open_dashboard` | `explore_props` | `open_wowy` | `open_parlay_xray` | `sign_in` | `sign_up`
- **Question:** Which landing intents move people into Court Context?
- **Does not capture:** the logo, footer copyright, sample matchup cards on the shared `GameCard`, or any query string. The landing footer has no product CTA, so `footer` is not a location.

## `player_search_used` — LIVE

- **Trigger:** A player search settles. Props Explorer: after the props request returns for a name of at least 2 characters, once per distinct query in the page session. WOWY: after the debounced player lookup returns, and only if that query is still current. Not on each keypress.
- **Properties:** `surface` = `props_explorer` | `wowy`, `result_count_bucket` = `0` | `1_5` | `6_plus`
- **Question:** Are people searching for players, and do those searches return anything?
- **Does not capture:** the search text. There is no player-directory search surface, so `players` is not a surface.

## `player_search_result_opened` — LIVE

- **Trigger:** Props Explorer player-name click while a search of at least 2 characters is applied, or a WOWY typeahead hit click.
- **Properties:** `surface` = `props_explorer` | `wowy`
- **Question:** Do searches turn into a chosen player?
- **Does not capture:** player name, player id, or the query. Phase 1 does not need a player id.

## `prop_opened` — LIVE

- **Trigger:** Props Explorer Compare click. Not when a row renders.
- **Properties:** `surface` = `props_explorer`, `market` = a canonical prop type or `other`
- **Question:** Which markets do people open for comparison?
- **Does not capture:** line, odds, book, player name, or search text. `checklist_item_completed` / `compare_opened` still fires.

## `prop_added_to_parlay` — LIVE

- **Trigger:** Props Explorer add succeeds (`status === 'added'`). Repeats for later legs. Duplicates and rejections do not fire.
- **Properties:** `surface` = `props_explorer`, `market` = canonical prop type or `other`
- **Question:** Are people building parlays from the explorer, and for which markets?
- **Does not capture:** leg contents. `checklist_item_completed` / `parlay_leg_added` stays as the once-per-checklist signal.

## `prop_context_opened` — LIVE

- **Trigger:** Props Explorer player-name click, which opens the player context panel.
- **Properties:** `surface` = `props_explorer`, `context_type` = `player_panel`, `market` = canonical prop type or `other`
- **Question:** Do people open prop context, not only the row?
- **Does not capture:** stat-tab changes inside the panel, player name, or the query.

## `wowy_filter_changed` — LIVE

- **Trigger:** A committed WOWY control change: season, team stint, season type, teammate presence, stat view, or with/without split. Not the landing demo, and not while typing a player name.
- **Properties:** `surface` = `wowy`, `filter` = `season` | `team_stint` | `season_type` | `teammate` | `stat_view` | `result_split`, plus a closed `value` when the value is not an identity (`2023`/`2024`/`2025`, `regular`/`playoffs`, `selected`/`cleared`, `per_game`/`per_minute`, `with`/`without`). Team stint has no value.
- **Question:** Which WOWY controls do people actually change?
- **Does not capture:** player names, player ids, team ids, or search text.

## `wowy_opened` — not added

`/wowy` is its own route. Umami’s automatic pageview already records that open. A custom event would double-count the same action.

## `context_check_opened` — LIVE

- **Trigger:** On a historical Final, the Context section becomes the active section (nav or scroll). Once per game. Not on first paint of other sections.
- **Properties:** `surface` = `historical_game`
- **Question:** Do people open historical Context (Season Role)?
- **Does not capture:** admin Context Check studio, player names, or player ids. `historical_player_opened` still records a later player change inside that section.

## `upgrade_clicked` — LIVE

- **Trigger:** Founding Pro upgrade links outside Market Movement: game briefing, slate briefing, Props Explorer game context, Props Explorer line shopping.
- **Properties:** `surface` = those four values, `plan` = `founding_pro`
- **Question:** Which upgrade prompts, besides Market Movement, get clicks?
- **Does not capture:** price, email, or Stripe ids. `market_movement_upgrade_clicked` is unchanged and is the Market Movement click.

## `checkout_started` — LIVE

- **Trigger:** Billing receives a checkout URL and is about to leave for Stripe. Not the button click, and not a failed or already-subscribed response.
- **Properties:** `surface` = `billing`, `plan` = `founding_pro`
- **Question:** Did a Founding Pro checkout handoff start?
- **Does not capture:** price, email, Stripe customer id, or checkout session id. The browser cannot confirm that Stripe collected payment. No server-side Umami call in this phase.

## `signup_started` — LIVE

- **Trigger:** Signup form submit, or Continue with Google on the signup page. Not when the form renders. Login’s Google button does not emit this.
- **Properties:** `surface` = `signup`
- **Question:** Did someone try to create an account?
- **Does not capture:** email, name, or provider account id.

## `signup_completed` — LIVE for immediate email session only

- **Trigger:** Email/password `signUp` returns a session.
- **Properties:** `surface` = `signup`
- **Question:** Did account creation finish in the browser?
- **Does not capture:** email or user id.
- **NEEDS_SERVER_SIDE_CONFIRMATION:** “Check your email” signups and Google OAuth do not emit this. Success happens after a redirect or inbox confirm, and the client cannot see it here.

