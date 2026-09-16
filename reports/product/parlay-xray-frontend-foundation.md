# Parlay XRay Frontend Foundation

**Step:** 14P.X1 — Parlay XRay product surface + frontend foundation  
**Date:** 2026-09-15  
**Canonical route:** `/parlay-xray`

## Executive Result

Parlay XRay now exists as a flagship Court Context surface at `/parlay-xray`. The page matches the attached visual reference in layout, hierarchy, and personality: left hero, upload card, extracted-leg panel, XRay insight band, leg-by-leg research list, summary, and “why this parlay could fail.”

Production does **not** pretend screenshot extraction or analysis exists. Upload → local preview → “ready for extraction / extraction unavailable.” Analysis cards, confidence scores, and player names are not fabricated from the image. A development-only `?preview=1` / `?preview=partial` fixture exists for layout review and is labeled as fictional.

**GREEN — Parlay XRay frontend foundation is implemented and ready for screenshot extraction/backend integration**

## Existing Bet-Slip Analyzer Audit

| Asset | State | Reuse decision |
|---|---|---|
| `/betting/bet-slip-analyzer` | Parked stub with leftover dark copy (“feature has been moved…”) | **Redirects to `/parlay-xray`**. Route file kept. |
| `components/betting/bet-slip/UploadPanel.tsx` | Dark neon dropzone, silent validation | **Not reused.** Concepts only (click + drag, jpeg/png/webp). |
| `components/betting/bet-slip/ReviewEditor.tsx` | Dark form, always-required fields | **Not reused.** New correction UX with known / unknown / needs_confirmation. |
| `components/betting/bet-slip/AnalysisResults.tsx` | EV, model P, confidence, independence note | **Not reused.** Casino / certainty language conflicts with XRay positioning. |
| `lib/betting/bet-slip/schema.ts` | Zod extraction + analyze body | **Not the XRay contract.** Too extraction-shaped; missing field status. Leave in place for a future extraction adapter. |
| `lib/betting/bet-slip/openai-extract.ts` + `/api/betting/bet-slip/parse` | OpenAI vision, auth, 6 MB | **Not wired.** This step forbids OCR. Treat as uncertified leftover, not production XRay. |
| `/api/betting/bet-slip/analyze` + `parlay-summary.ts` | Independent-leg EV product | **Not wired.** Combined odds in XRay are price math only, and only when every leg has known American odds. |
| `player-resolve.ts` | Roster fuzzy match | Future extraction adapter. Not used in this slice. |

The parked page was **not** a useful live implementation. Building a second public analyzer would have duplicated a stub. Canonical product is XRay; the old path is a redirect.

## Canonical Route Decision

**C + B:** new canonical route `/parlay-xray`, old route retained as an internal redirect.

- Flagship research tools already live outside `/betting/*` (`/wowy`, `/teams`). XRay follows that pattern.
- `/xray` was rejected as less scannable in nav.
- `/betting/bet-slip-analyzer` still exists and `redirect()`s to `/parlay-xray` (not deleted).
- Shell: `BettingAppShell` + Header, same as WOWY.
- Not session-gated in middleware (same as `/wowy`). Future extraction that calls a paid API should auth at the handler.

## Visual Reference Interpretation

Used the mockup for:

- Three-column hero (copy / upload / extracted legs)
- Mint CTA, teal ink, white cards, `#DCE9EA` borders, editorial headline
- Compact screenshot preview with Replace / Remove
- Leg rows with headshot, matchup, side+line, odds
- Six-card XRay band
- Leg-by-leg + summary + failure notes

Not copied from the mockup:

- “Instant” insights, PDF upload, `+846`, `42%–58%` confidence, “Legs Positive,” “Favorable / Risky” as bet advice, working Parlay Explorer, hardcoded market movement, fake correlation coefficients

## Scope / Safety

| In this step | Explicitly not done |
|---|---|
| Route, nav, upload, preview, contracts, states, layout, fixture, tests | OCR / screenshot extraction |
| Transient client state | Database, S3, Supabase Storage |
| Structural overlap from confirmed slip fields | Measured historical correlation |
| Disabled Explorer CTA in **dev preview only** | Parlay Explorer product |
| Minimal Umami events (surface only) | Bet-content telemetry |

Did not touch Landing, Dashboard, GameCard, game detail, player pages, Props Explorer, Market Movement, WOWY, Context Check, Billing, Auth, AWS, Terraform, ingestion, Supabase schema, or frozen projection models.

## XRay Product Contract

`lib/parlay-xray/types.ts` is the thin frontend/domain contract.

**Leg field:** `{ value, status: 'known' | 'unknown' | 'needs_confirmation' }`. Missing screenshot data is never silently filled.

**Leg resolution:** derived from player, prop, side, and line. Odds may stay unknown without blocking resolution.

**Parlay:** `id`, `source: 'screenshot'`, ephemeral `uploadedImage`, `legs[]`, `extractionStatus`, `analysisStatus`, `createdAt`. Transient only.

**Analysis:** cards, outlooks (`favorable_context` / `mixed` / `elevated_risk` / `limited_data` / `unavailable`), optional WOWY note (game-level participation only), optional `3h_pre_tip_to_close` market-movement slot. Rendered only when `analysis.status === 'ready'`.

`SCREENSHOT_EXTRACTION_AVAILABLE = false`.

## Upload Flow

- Click-to-upload (accessible `<input type="file">`) and drag/drop
- PNG, JPG/JPEG, WebP only. **PDF is not advertised.**
- Max 10 MB
- Errors: unsupported file, file too large (product copy, no stack traces)
- Image stays on-device via `blob:` object URL; revoked on replace/remove/unmount

Production after a valid file: preview + “Screenshot extraction is not connected yet. Your image stays on this device.”

## Screenshot State

Selected file shows filename (path-stripped), thumbnail, Replace, Remove. Design preview uses a labeled placeholder, not a sportsbook screenshot.

## Extracted Leg Contract

Display: player, matchup, prop, over/under, line, odds, confirmation warning.

Edit: player, prop kind, side, line, odds. Editing a field marks it **known** (user-verified). Lightweight correction, not a sportsbook ticket form.

## Edit / Confirmation Flow

Intended future flow: Upload → Extract → Review → Confirm → Analyze.

Confirm is disabled while any leg is `needs_confirmation` or `unresolved`. Counts are always visible: detected / resolved / need confirmation.

## Analysis Presentation Contract

Six cards (overall, strongest context, elevated risk, structural overlap, market movement, key context) render **only** from analysis data. Empty production state is a single “Analysis unavailable” panel — not Curry/Tatum placeholders.

No arbitrary confidence range. Labels reserved for a future certified model: Strong support, Mixed evidence, Limited sample, Elevated risk, Data unavailable.

Leg outlooks are research language, not green=bet / red=don’t.

## Correlation Presentation

`detectStructuralDependencies()` is slip-derived only:

- same player
- same game (team + opponent, order-insensitive)
- same-team scoring environment

Labeled **structural overlap**, never a coefficient. Measured historical correlation is a separate future slot and stays unavailable.

## Risk / Failure Presentation

“Why this parlay could fail” is retained. Production copy is structural / data-quality notes from the current legs, or “none visible.” Fixture failure notes are labeled as design-preview copy.

## Parlay Explorer Handoff

**Choice A + B:** hidden in production. In `?preview=*` only, a disabled button: “Open in Parlay Explorer (coming later)” (`aria-disabled`). No `/parlay-explorer` route.

## Responsive Behavior

Desktop: 12-column hero, six insight cards, two-column analysis (list + summary).

~390px: hamburger nav; stacked order is headline → upload → screenshot → extracted legs → confirm → analysis summary → stacked leg cards (Prop / Line / Odds labels, not a shrunk table). Verified via accessibility tree at 390px width.

## Accessibility

- File input is keyboard-reachable; drag/drop has Choose file
- Replace / Remove / Edit have names; Remove has `aria-label`
- Status is text, not color-only (Needs confirmation, Unavailable, Mixed evidence)
- Focus rings on mint/teal controls
- Heading order: page `h1` “See beyond the bet slip.”, then section `h2`s (Header still exposes a chrome `h1` “Court Context”, same as WOWY)

## Development Fixture

Isolated at `lib/parlay-xray/dev-fixture.ts`. **Not** re-exported from `lib/parlay-xray/index.ts`. Loaded only after mount when `NODE_ENV !== 'production'` and `?preview=1` or `?preview=partial`.

- `?preview=1` — full designed result, all legs resolved, analysis `ready`, banner
- `?preview=partial` — 5 detected, 3 resolved, 2 need confirmation, analysis hidden

Local links appear under the page in development only.

## Tests

`npx vitest run lib/parlay-xray lib/product-analytics/__tests__/track-event.test.ts` (+ nav contracts): **62 passed**.

Coverage:

- file validation (type, size, path-stripped name)
- upload / replace / remove without fabricating legs
- edit → known + derived resolution
- partial extraction blocks confirm
- no renderable analysis without `status: 'ready'`
- structural same-game without a coefficient
- route / nav / redirect / no parse API / no 42–58% copy
- preview disabled in production
- analytics surface events

## Files Changed

- `app/parlay-xray/page.tsx`, `layout.tsx`, `ParlayXrayClient.tsx`
- `components/parlay-xray/*`
- `lib/parlay-xray/*` (+ `__tests__`)
- `lib/product-analytics/track-event.ts`, `parlay-xray-events.ts`, `EVENTS.md`
- `components/betting/primary-nav.ts`, `betting-shell-paths.ts`, `Header.tsx` (active item + tighter gap)
- `app/betting/bet-slip-analyzer/page.tsx` (redirect)
- `reports/product/parlay-xray-frontend-foundation.md`

## Backend Dependencies Not Yet Implemented

1. Production screenshot extraction (OCR / vision) with partial-leg confidence
2. Player / game / market resolution into Court Context IDs
3. XRay analysis engine (context, sample quality, WOWY game-level evidence, 3-hour pre-tip → close)
4. Auth + spend control if extraction hits a paid provider
5. Alignment of max size (UI 10 MB vs leftover parse route 6 MB)
6. Optional ephemeral upload storage **only if** a future backend cannot accept a client-held image
7. Entitlement decision (none in this slice)

Do **not** blindly mount `/api/betting/bet-slip/parse`. It is uncertified OpenAI vision and the old analyze path emits EV/confidence the product rejected.

## Remaining Work

- Screenshot extraction adapter that outputs the XRay leg contract (including `needs_confirmation`)
- Confirm → analyze API that fills the presentation contract without invented certainty
- Attach WOWY and Market Movement as optional evidence slots when matched
- Parlay Explorer as a separate feature under Features
- Nav crowding (9 primary items) if a Features menu is introduced later

## Recommended Next Step

**STEP 14P.X2 — Screenshot extraction (partial, fail-closed) that writes `ExtractedParlayLeg[]` and never auto-runs analysis.**

## Verification Checklist

1. Open `/parlay-xray` signed in. Confirm empty hero / upload / empty legs / “Analysis unavailable.” No player names.
2. Upload a PNG/JPG/WebP under 10 MB. Confirm thumbnail, filename, Replace, Remove. Confirm extraction copy says it is not connected. Confirm no fake legs.
3. Upload a PDF or a huge file. Confirm the matching product error.
4. In local dev only, open `?preview=1`. Confirm the design-preview banner, five legs, six insight cards, **no** 42–58% score, market movement unavailable, disabled Explorer CTA.
5. Open `?preview=partial`. Confirm 5 / 3 / 2 counts, Confirm disabled, analysis claims hidden.
6. Click Edit, change a player/line, confirm the field is treated as known.
7. Hit `/betting/bet-slip-analyzer` and confirm it lands on `/parlay-xray`.
8. Check ~390px: hamburger nav, stacked order, leg cards not a squeezed table.

## Step Verdict

**GREEN — Parlay XRay frontend foundation is implemented and ready for screenshot extraction/backend integration**
