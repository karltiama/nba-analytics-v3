# Court Context Free / Pro Policy

Status: frozen product policy (STEP 14P.E14). Runtime access still comes from `lib/entitlements/capabilities.ts`. Readiness is checked before plan. This document does not enable a feature, checkout, or a provider.

Marks used below:

- `CURRENT_AVAILABLE` — implemented and allowed for the stated tier today
- `FUTURE_POLICY` — tier direction only; readiness still denies it
- `INTERNAL_ONLY` — not a customer feature for either tier

Registry `planAccess: FREE` means Free includes it, so Pro includes it too. `BOTH` is the same runtime rule. `PRO` is the only plan gate, and only after readiness is `AVAILABLE`.

## Product Principle

FREE = UNDERSTAND. PRO = COMPARE, MONITOR, AUTOMATE, AND GO DEEPER.

Do not paywall trust, factual safety information, or the fundamental Court Context workflow. Monetize depth, comparison, history, automation, monitoring, convenience, and capacity.

Court Context stays research-first. Do not use: Premium picks, Pro winners, VIP bets, Locks, Guaranteed edges, Beat the books.

User-facing tier language:

- Free: "Understand"
- Pro: "Compare, monitor, and go deeper"

## Free Philosophy

Free keeps the complete core workflow: identify a prop, add it to a parlay, open Workspace, see supported historical context, and see why the parlay could fail. Warnings about duplicates, conflicts, missing data, and unsupported analysis stay on Free.

## Pro Philosophy

Pro adds available depth on top of that workflow: full line shopping, deeper and per-book Market Movement, and AI research briefings. Future Pro value is richer comparison, monitoring, automation, and capacity. Pro never unlocks a capability whose readiness is not `AVAILABLE`.

## Current Available Free

`CURRENT_AVAILABLE`. Existing registry ids. Free and Pro.

| Policy name | Registry id |
| --- | --- |
| Props Explorer core | `PROPS_BROWSE`, `PROPS_COMPARE` |
| Exact prop research | `PROPS_BROWSE` |
| Player research | `PLAYER_RESEARCH_BASIC` |
| Game research | `GAME_RESEARCH_BASIC` |
| Add to Parlay | `PARLAY_BUILD` |
| Parlay Workspace | `PARLAY_WORKSPACE` |
| Basic context analysis | `PARLAY_STRUCTURAL_ANALYSIS` |
| Why This Could Fail | `PARLAY_WHY_THIS_COULD_FAIL` |
| Duplicate, conflict, and structural dependency warnings | `PARLAY_STRUCTURAL_ANALYSIS` |
| Missing, unavailable, and unsupported-analysis warnings | `PARLAY_WHY_THIS_COULD_FAIL`, `PARLAY_STRUCTURAL_ANALYSIS` |
| Basic historical context | `PARLAY_HISTORICAL_CONTEXT` |
| Basic game-level WOWY | `WOWY_BASIC` |
| Source and coverage labels | included with the research surfaces above; no separate sellable id |
| Basic Market Movement | `MARKET_MOVEMENT_BASIC` |
| Screenshot correction and confirm | `XRAY_CORRECTION`, `XRAY_CONFIRM` |
| Upload UI and workspace handoff shell | `XRAY_UPLOAD_UI`, `XRAY_WORKSPACE_HANDOFF` |

`PLAYER_RESEARCH_ADVANCED`, `GAME_RESEARCH_ADVANCED`, and `PARLAY_ADVANCED_CONTEXT` are `FUTURE_POLICY`, readiness `NOT_READY`, plan `PRO`. They are not part of Free core.

## Current Available Pro

`CURRENT_AVAILABLE`. Pro only. These ids stay authoritative. No aliases.

| Policy name | Registry id |
| --- | --- |
| Full line shopping | `LINE_SHOPPING_DETAIL` |
| Deep Market Movement, including per-book history when snapshots exist | `MARKET_MOVEMENT_DEEP` |
| AI research briefings | `AI_BRIEFING` |

There is no separate per-book capability id. Per-book movement is `MARKET_MOVEMENT_DEEP`.

## Never Paywall

A user must never see "We found an important risk, upgrade to see it."

Never charge to reveal:

- exact wager identity
- OCR and user correction (`XRAY_CORRECTION`, `XRAY_CONFIRM`)
- duplicate warnings
- logical conflict warnings
- missing-data warnings
- unavailable-context warnings
- unsupported-analysis warnings
- factual source and coverage labels
- basic injury and availability facts once that feed is live (`AVAILABILITY_CONTEXT` is `neverPaywall`; it is still provider-blocked)
- basic structural same-player and same-game dependencies (`PARLAY_STRUCTURAL_ANALYSIS`)
- Why This Could Fail (`PARLAY_WHY_THIS_COULD_FAIL`)

`neverPaywall` capabilities cannot use `planAccess: PRO`. If readiness is not `AVAILABLE`, the result is a readiness denial with no upgrade CTA.

## Not-Ready Feature Rule

Tier eligibility never overrides readiness. `NOT_READY`, `PROVIDER_BLOCKED`, `INTERNAL_RESEARCH`, and `DISABLED` / kill switch deny Free and Pro. `showUpgrade` stays false. Copy may say unavailable. It may not say Upgrade to Pro.

## Live Analysis

`FUTURE_POLICY`. Registry: `CURRENT_LIVE_ANALYSIS`. Readiness: `NOT_READY`. Plan when certified: Free and Pro (`BOTH`).

Free must be able to complete Props → Workspace → Analyze → Why This Could Fail. Pro may later add deeper modules around that same analysis. Not enabled.

`CURRENT_LIVE_ANALYSIS`: `NOT_IMPLEMENTED`.

## Parlay XRay

`FUTURE_POLICY`. Registry: `XRAY_EXTRACTION`. Readiness: `DISABLED` (kill switch). Plan: both tiers, with different commercial allowances when extraction is certified.

Intended commercial launch limits, status `PREPARED_NOT_ACTIVE`:

- Free: 3 screenshot imports / day
- Pro: 10 screenshot imports / day

`XRAY_COMMERCIAL_POLICY`: `PREPARED_NOT_ACTIVE`.

These numbers are `COMMERCIAL_LIMIT` metadata on the registry. `evaluateCapability` does not read them. They do not bypass:

- global technical limit
- cooldown
- dedupe
- in-flight protections
- kill switch

Technical safety defaults live in `lib/parlay-xray/extraction/config.ts` and remain spend and abuse controls. Public extraction stays disabled. `PUBLIC_EXTRACTION`: `DISABLED`.

Correction, confirm, and the upload shell stay Free when their own readiness is `AVAILABLE`.

## Sharing

`FUTURE_POLICY`. Not a registry capability. Do not build it in this step.

When built, Free and Pro:

- prop sharing
- parlay sharing
- branded share links
- branded share cards

Sharing is distribution, not a Pro gate. Readiness: `NOT_READY`. `SHARING_POLICY`: `PREPARED_NOT_ACTIVE`.

## Sportsbook Handoff

`FUTURE_POLICY`. Not a registry capability. Do not build adapters or affiliate logic.

`BASIC_SPORTSBOOK_HANDOFF` is Free and Pro (open in DraftKings, FanDuel, BetMGM). Readiness: `NOT_READY`. `SPORTSBOOK_HANDOFF_POLICY`: `PREPARED_NOT_ACTIVE`.

## Line Shopping

`CURRENT_AVAILABLE` for the Pro module that exists today.

- Free: basic awareness and limited comparison where the product already allows it (`PROPS_COMPARE`, `MARKET_MOVEMENT_BASIC`)
- Pro: full cross-book line shopping (`LINE_SHOPPING_DETAIL`), including supported books, best price, and richer sort and filter as that module already works

Do not weaken `LINE_SHOPPING_DETAIL`. Future per-book historical comparison stays inside `MARKET_MOVEMENT_DEEP` until a separate module is certified.

## Arbitrage

`FUTURE_POLICY`. Not a registry capability. Do not implement calculation or UI. Do not claim arbitrage exists.

When synchronized prices support it:

- Free: basic market-discrepancy indication or a limited preview
- Pro: full scanner (qualifying opportunities, theoretical margin, books, freshness, filters, sorting, handoff, continuous scanning)

Readiness: `NOT_READY`. `ARBITRAGE_POLICY`: `PREPARED_NOT_ACTIVE`.

## Saved Parlays

`FUTURE_POLICY`. Registry: `SAVED_PARLAYS`. Readiness: `NOT_READY`. Plan when built: both tiers.

Proposed commercial limits, status `PROPOSED_NOT_ACTIVE`, not enforced:

- Free: 5
- Pro: 50

Do not enforce these before saved-parlay persistence exists. `SAVED_PARLAY_POLICY`: `PREPARED_NOT_ACTIVE`.

## Alerts

`FUTURE_POLICY`. Registry: `ALERTS`. Readiness: `NOT_READY`. Plan: `PRO` until a specific essential Free alert is certified. Free is none for now. Pro is full configurable research and market alerts later. Do not promise line-movement, discrepancy, or saved-research alerts as available. `ALERT_POLICY`: `PREPARED_NOT_ACTIVE`.

## Historical Research

`CURRENT_AVAILABLE`: `PARLAY_HISTORICAL_CONTEXT` and public game-level `WOWY_BASIC` stay Free.

`FUTURE_POLICY`: `ADVANCED_HISTORY` stays `NOT_READY` and `PRO` (longer history, richer filters, per-book history, comparison views). No current module was reclassified into this bucket.

## Injury / Availability

`FUTURE_POLICY`. Registry: `AVAILABILITY_CONTEXT`. Readiness: `PROVIDER_BLOCKED`. Plan: Free and Pro. `neverPaywall: true`.

Factual labels (Out, Questionable, Probable, Available) are Free and Pro once the feed is allowed. Advanced role impact and teammate-absence interpretation stay Pro only when validated (`WOWY_ADVANCED`). Ball Don't Lie live injury readiness stays a separate provider gate. This policy does not turn that feed on.

## WOWY

`CURRENT_AVAILABLE`: `WOWY_BASIC` is game-level with/without research for Free and Pro. It is not possession-level on/off and it is not a predictive injury adjustment.

`FUTURE_POLICY`: `WOWY_ADVANCED` is `NOT_READY` and `PRO` for validated availability impact. Do not sell unvalidated predictive WOWY. `ADVANCED_WOWY_POLICY`: `PREPARED_NOT_ACTIVE`.

## Correlation

`CURRENT_AVAILABLE`: structural dependency (same player, same game, same team, duplicate, conflict) is Free via `PARLAY_STRUCTURAL_ANALYSIS`.

`FUTURE_POLICY`: `MEASURED_CORRELATION` is `NOT_READY` and `PRO`. No numerical correlation score today. `CORRELATION_POLICY`: `PREPARED_NOT_ACTIVE`.

## Learned Models

`INTERNAL_ONLY`. Registry: `PTS_C_REB_C`. Readiness: `INTERNAL_RESEARCH`. Denied for Free and Pro.

If a model is later production-certified, basic production context may be Free and deeper explanation, history, or comparison may be Pro. No commercial tier is frozen beyond that. `MODEL_RESEARCH`: `INTERNAL_ONLY`.

## Prediction Markets

`FUTURE_POLICY`. Not a registry capability. Do not implement Kalshi or Polymarket. Do not advertise them as launched.

When certified:

- Free: basic prediction-market context
- Pro: deeper history, comparison, and monitoring

Readiness: `NOT_READY`. `PREDICTION_MARKET_POLICY`: `PREPARED_NOT_ACTIVE`.

## Commercial Limits

| Item | Kind | Status | Free | Pro |
| --- | --- | --- | --- | --- |
| XRay screenshot imports | `COMMERCIAL_LIMIT` | `PREPARED_NOT_ACTIVE` | 3 / day | 10 / day |
| Saved parlays | `COMMERCIAL_LIMIT` | `PROPOSED_NOT_ACTIVE` | 5 proposed | 50 proposed |

`COMMERCIAL_LIMIT` is a plan allowance. `TECHNICAL_SAFETY_LIMIT` is the XRay global cap, cooldown, dedupe, in-flight lock, and kill switch. A plan quota cannot raise or bypass a technical safety limit.

## Pricing Direction

| Price | Amount | Status |
| --- | --- | --- |
| Court Context Free | $0 | current |
| Founding Pro | $9.99 / month | current public label |
| Later standard Pro | $14.99 / month | direction only, not active, not displayed |

Public billing renders `FOUNDING_PRO_PRICE_CONCEPT` (`$9.99/month`). `$14.99/month` is not shown. Checkout stays disabled.

`PRICING_COPY_CHANGE`: public label aligned in STEP 14P.E15. Checkout and Stripe price persistence are unchanged.

`CHECKOUT`: `DISABLED`.

## Founding Pro

`FOUNDING_PRO_PRICE`: 9.99 USD / month. Public label: `$9.99/month`.

`FOUNDING_PRICE_LOCK`: keep that price while the subscription remains continuously active.

Public line: "Keep your founding price while your subscription remains active."

Billing persistence is not implemented. A later billing step would need to store the subscribed price (or Stripe Price id) on the subscription, keep charging that price across renewals, and end the lock if the subscription lapses rather than if a new list price is published. No Stripe grandfathering is built here.

## Upgrade CTA Rules

Show an upgrade CTA only when readiness is `AVAILABLE` and plan access is `PRO`.

Never show Upgrade to Pro for `NOT_READY`, `PROVIDER_BLOCKED`, `INTERNAL_RESEARCH`, or `DISABLED` / kill switch.

Live analysis unavailable → unavailable message, not an upgrade. XRay extraction disabled → Pro does not unlock it.

## Readiness Rules

Decision order:

1. Kill switch
2. Auth, when the surface is not public
3. Readiness (`INTERNAL_RESEARCH`, `PROVIDER_BLOCKED`, `NOT_READY`, `DISABLED`)
4. Plan

`commercialQuota` is ignored in that function.

## Future Review Process

Before setting any `FUTURE_POLICY` row to `AVAILABLE`:

1. Confirm the behavior exists and matches this document's tier.
2. Enforce any commercial quota in that feature's own persistence. Do not do it inside `evaluateCapability` by flipping a metadata field.
3. Keep technical safety limits stricter than, or equal to, the commercial allowance.
4. Re-read billing copy so the feature is not described as included before it is `CURRENT_AVAILABLE`.
5. Add an access test for the new readiness. Do not add a test that pretends the feature already ships.
