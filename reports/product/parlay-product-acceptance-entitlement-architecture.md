# STEP 14P.E6 — Parlay Product Acceptance + Court Context Entitlement Architecture

Generated: 2026-09-16  
Status: **YELLOW — hybrid architecture is coherent; certified Flows A/B complete; Free/Pro matrix is defined; XRay still presents itself as an analysis destination, and current entitlement code would contradict the matrix if implemented as-is**

Walked in a running local app (`localhost:3000`) on 2026-09-16:

- Landing `/`
- Props Explorer historical `date=2026-04-02&game_id=18447934` (LAL @ OKC)
- Add to Parlay → mobile **View Parlay** overlay → **Open Workspace** → **Analyze with Court Context**
- Parlay XRay `?preview=replay` → correct `Luka Doncik` → **Confirm historical replay** → auto-nav Workspace
- Billing `/billing`

No runtime code, schema, Stripe, OpenAI, or BDL changes.

---

## Executive Result

Court Context now has a **defensible product shape**:

| Surface | Role |
| --- | --- |
| **Props Explorer** | Discover / compare / research / select exact offers |
| **Parlay XRay** | Import an existing slip (upload → review → Confirm) |
| **Parlay Workspace** | Examine the parlay as a whole, then analyze on demand |

Both certified flows converge on the same transient Workspace and the same Court Context pipeline. Workspace has a real reason to exist. Confirm remains the XRay trust boundary. Analysis is explicit. Historical vs live is honest when the user reaches Workspace.

The remaining gap is **product clarity, not architecture**:

1. XRay still looks like the analysis product (hero, StageList **Results**, design panel, quota copy that says “XRay analyses”).
2. Workspace results are a full research report. A user should not need to read every block to understand the slip.
3. Existing Free/Pro code is a **line-shopping + AI briefing** package. It does not describe the parlay product, and it already contradicts itself (WOWY is listed as Pro copy while `/wowy` is public).
4. Public XRay extraction remains disabled, so Flow B is not a consumer path yet.

**Do not implement the entitlement matrix in this step.** Polish the Free workflow first so Pro has something worth deepening.

| Decision | Value |
| --- | --- |
| ARCHITECTURE | **HYBRID** |
| PROPS_EXPLORER | **KEEP** |
| PARLAY_XRAY | **POLISH** |
| PARLAY_WORKSPACE | **POLISH** |
| PROPS_TO_WORKSPACE_FLOW | **NEEDS_POLISH** |
| XRAY_TO_WORKSPACE_FLOW | **NEEDS_POLISH** |
| FREE_EXPERIENCE | **DEFINED** |
| PRO_EXPERIENCE | **DEFINED** |
| ENTITLEMENT_MATRIX | **DEFINED** |
| SAFETY_QUOTAS_SEPARATED_FROM_PRODUCT_LIMITS | **YES** |
| PRICING | **UNCHANGED** (`$10/month` is PLANNING_ASSUMPTION) |
| PUBLIC_EXTRACTION | **DISABLED** |
| CURRENT_LIVE_ANALYSIS | **NOT_IMPLEMENTED** |
| PARLAY_PERSISTENCE | **NOT_IMPLEMENTED** |
| MEASURED_CORRELATION | **NOT_IMPLEMENTED** |
| MODEL_TUNING | **FROZEN** |
| REAL_OPENAI_CALLS_THIS_STEP | **0** |
| REAL_BDL_CALLS_THIS_STEP | **0** |
| PRODUCT_RUNTIME_CHANGES | **NONE** |
| SCHEMA_MIGRATION | **NONE** |
| NEXT_RECOMMENDED_STEP | **PRODUCT_POLISH_UI_QA** |

---

## Certified Product State

Unchanged from the E5 certified snapshot, plus this E6 product reading.

**ARCHITECTURE:** HYBRID

**PROPS EXPLORER — KEEP**

- existing single-prop discovery/research surface
- exact book / side / line offers
- Compare owns Market Movement
- Save / Compare / Paper preserved
- Add to Parlay certified

**PARLAY WORKSPACE — SHARED_DESTINATION_CERTIFIED**

- transient in-memory canonical parlay state
- Props Explorer → Workspace certified (walked)
- XRay → Workspace certified (walked, historical replay)
- review shell
- historical Analyze explicitly user-triggered
- shared Court Context analysis pipeline
- no persistence
- not in primary nav

**PARLAY XRAY**

- extraction v2.1 certified
- review / correction / Confirm boundary certified
- canonical resolution certified
- XRay → Workspace handoff certified
- same wager identity across XRay and Props certified
- same basketball analysis across XRay and Props certified
- public extraction disabled
- current/live analysis not implemented

**HISTORICAL ANALYSIS**

- same-game only
- SAME_DATE_MULTI_GAME not supported
- MULTI_DATE not supported
- Decision Close semantics certified
- 3-Hour Pre-Tip comparison only
- no outcome leakage detected
- no numeric confidence
- no measured correlation
- no win probability
- no EV recommendation
- **runtime coverage is the certified X3F fixture only** (`18447934`, LAL @ OKC, cutoff `2026-04-03T01:30:00.000Z`). Matching audit window `2026-04-02` → `2026-05-02` is documented, not a full-season consumer product.

**MODELING:** 70/30 production control unchanged. PTS C / REB C frozen shadow candidates. Model D not promoted. WOWY availability adjustment inconclusive. Context Engine contract certified. Prospective protocol certified. Model tuning frozen. Shadow scoring disabled. Injury collection disabled. Provider entitlement blocked.

**PROVIDER:** no active BDL subscription. Live/current provider-dependent integration intentionally paused.

**PERSISTENCE:** parlay persistence not implemented.

**FREE / PRO:** architecture defined in this report; **not implemented** as product policy.

---

## Props → Workspace Acceptance

Walked on historical LAL @ OKC (2026-04-02). Viewport below `xl`, so the mobile tray path was the actual path.

### Stage map

| Stage | Purpose | User decision | What changes | What does not | Friction / confusion |
| --- | --- | --- | --- | --- | --- |
| Discover | Browse exact book/side/line offers | Filters, player click, Compare | URL + table | Parlay store | Dense board. Historical EV column shows **UNAVAILABLE**. Four peer row actions. |
| Add to Parlay | Attach this visible offer | Click `+ Parlay` (a11y **Add to Parlay**) | In-memory leg; notice **Added to parlay**; tray appears | Saved / Paper / Compare / analysis | Label `+ Parlay` vs Paper **Add**. No “next: open Workspace” teaching. |
| Tray | Confirm the slip before leaving the board | Remove / Clear / **View Parlay** (mobile) / **Open Workspace** (desktop) | Tray contents | No analysis | **Mobile extra step.** Desktop tray is `hidden xl:block`. Below xl, **Open Workspace** is inside the overlay only. |
| Workspace review | Examine the parlay as a whole | Remove / Clear / Add More Props / Analyze | Selection edits | Results until Analyze | Copy is thin: “Review your selected props before running Court Context analysis.” Source **Built from Props Explorer** is good. |
| Analyze | Explicit historical Court Context | **Analyze with Court Context** | Busy **Running historical analysis…** then shared results | Canonical identity | Busy string is the only progress. Results eyebrow **HISTORICAL ANALYSIS** while page title stays Parlay Workspace. |

### Rubric

| Criterion | Rating | Evidence |
| --- | --- | --- |
| CLARITY | **NEEDS_POLISH** | User knows they are on Props Explorer. After add, next action is not named on the notice. Mobile CTA is **View Parlay**, not **Open Workspace**. |
| EFFORT | **NEEDS_POLISH** | Desktop: add → Open Workspace (good). Mobile: add → View Parlay → Open Workspace (one extra tap, accepted in E3, still felt). |
| TRUST | **CLEAR** | Historical board copy: “Last pre-tip closing lines… Not a live sportsbook board.” Workspace snapshot **Decision Close**. Live analysis blocked with “Current-season Court Context analysis is not enabled yet.” |
| INFORMATION HIERARCHY | **NEEDS_POLISH** | Board is offer-first (correct). Results after Analyze dump coverage grids before the story. |
| DENSITY | **NEEDS_POLISH** | Row: Save · Compare · Paper **Add** · `+ Parlay`. Results: every section expanded. |
| CONTINUITY | **NEEDS_POLISH** | Store survives client nav (walked). Feels like one workflow once Workspace opens. Getting there is under-signaled. |
| DISTINCT PURPOSE | **CLEAR** | Explorer stays a board. Workspace is not a second prop table. |

**Flow verdict: NEEDS_POLISH** — architecturally one workflow; teaching and mobile handoff need polish.

---

## XRay → Workspace Acceptance

Walked certified `?preview=replay` (not public extraction). Corrected OCR `Luka Doncik` → `Luka Doncic`. Confirm auto-navigated to Workspace with four Decision Close legs, OCR provenance on the corrected leg, **Imported from Parlay XRay**.

### Stage map

| Stage | Purpose | User decision | What changes | What does not | Friction / confusion |
| --- | --- | --- | --- | --- | --- |
| Upload / fixture | Import an existing slip | File, or certified replay fixture | Local image | Analysis | Public extract kill-switched. Quota still shows **8 of 10 XRay analyses remaining today** on a replay that did not extract. |
| Review / edit | Trust what was read | Edit / accept / fix OCR | Leg fields | Workspace | Confirm disabled until confirmation fields clear. Accept-as-shown on a typo is the wrong path; Edit is the right one. Two “Confirm” words (accept checkbox vs page Confirm). |
| Confirm | Trust boundary | **Confirm historical replay** | `confirmed=true`; resolve identity | Analysis must not run here | StageList still says analysis uses confirmed legs / **Results**. Hero still promises context/risk on this page. |
| Handoff | Canonical offers into Workspace | Auto-nav or **Review in Workspace** | Store `source=xray` | Analyze not started | Resolving copy is brief. Retry CTA exists if auto-nav lags. |
| Workspace → Analyze | Same as Flow A | Analyze | Shared results | Identity | Source label and OCR provenance are the only XRay-specific review chrome — correct. |

### Rubric

| Criterion | Rating | Evidence |
| --- | --- | --- |
| CLARITY | **NEEDS_POLISH** | Confirm copy is excellent (“Confirm is the boundary between what XRay read and analyzing these confirmed legs”). Hero + StageList **Results** + idle **XrayAnalysisPanel** (“strongest/riskiest”) still imply this page *is* the analyzer. |
| EFFORT | **CLEAR** | Review → fix OCR → Confirm → Workspace is the right number of steps for a trust boundary. |
| TRUST | **CLEAR** at Confirm; **NEEDS_POLISH** around it | Historical Replay banner is honest. Public Confirm does not invent history. Design-preview links remain on the page in non-prod. |
| INFORMATION HIERARCHY | **NEEDS_POLISH** | Upload, stage list, extracted legs, waiting panel, and empty analysis panel compete before Confirm. |
| DENSITY | **CONFUSING** on the XRay page | User is asked to import a slip while staring at an empty “complete breakdown” with Why this parlay could fail already on screen. |
| CONTINUITY | **CLEAR** after Confirm | Auto-nav + **Imported from Parlay XRay** + OCR “Screenshot read / Confirmed” make the handoff legible. |
| DISTINCT PURPOSE | **NEEDS_POLISH** | Role is import. Presentation still competes with Workspace. |

**Public Flow B:** not launch-ready. `SCREENSHOT_EXTRACTION_AVAILABLE = false`, `PARLAY_XRAY_EXTRACTION_ENABLED` defaults false, extract copy “Screenshot analysis is temporarily unavailable.”

**Certified Flow B:** completable. Confirm boundary holds.

**Flow verdict: NEEDS_POLISH**

---

## Props Explorer Role

Reconfirmed: **DISCOVER · COMPARE · RESEARCH · SELECT**.

Add to Parlay is a natural extension of SELECT. It does not duplicate Compare (Market Movement) or Save (persisted research) or Paper (paper book). Destinations are distinct; **visual hierarchy is not**.

Recommended action hierarchy (do not implement in E6):

1. **Primary on the offer:** the exact book / side / line (the row itself).
2. **Select:** Add to Parlay (`+ Parlay`) — once a user is building, this is the continuation.
3. **Research:** Compare (opens Market Movement).
4. **Keep:** Save.
5. **Separate product:** Paper **Add** — keep, but stop pairing it visually with Parlay. Historical Paper is already disabled; that is honest.

Add to Parlay should not become a giant primary CTA on every row. It should be **the obvious continuation after Compare**, not a fourth equal `text-[10px]` sibling.

---

## XRay Role

Reconfirmed: **IMPORT AN EXISTING SLIP**.

Not: build a parlay, browse props, generate parlays, or run analysis.

The intended loop is already in waiting copy and is the right product:

Upload → Review what XRay read → Correct mistakes → **Confirm** → Workspace.

Confirm must remain an explicit trust boundary. It currently does.

Copy that blurs extraction / confirmation / analysis (recommend polish later, not E6 rewrites):

- Hero: “review each leg — the context, risk, sample quality, and uncertainty”
- StageList always includes **Results**
- Extract messages: “before analysis can run”
- Quota: “XRay analyses remaining today”
- Idle `XrayAnalysisPanel`: strongest/riskiest / WOWY evidence
- Post-confirm: “Analysis uses these confirmed legs” on the XRay page after analysis moved to Workspace

---

## Workspace Role

Reconfirmed: **ASSEMBLE / REVIEW → UNDERSTAND CROSS-LEG CONTEXT → ANALYZE**.

Not: another prop board. Not: a sportsbook bet slip. Not: a prediction generator.

Does it communicate why it exists? **Partially.** The H1 + “Review your selected props before running Court Context analysis” is accurate and too small. Ideal mental model: **“This is where I examine the parlay as a whole.”** Source lines (**Built from Props Explorer** / **Imported from Parlay XRay**) already help.

| Section | Feeling |
| --- | --- |
| Review leg cards | Useful. Exact identity. Decision Close. OCR provenance when needed. |
| Same player / same game badges + summary counts | Useful Layer A. Slightly duplicated across cards and aside. |
| Empty state | Points only to Explore Props. Misses “or import a slip in Parlay XRay.” |
| Analyze CTA | Clear when READY. Honest UNAVAILABLE reasons. |
| Results `XrayParlaySummary` | **TOO EARLY / TOO TECHNICAL** as currently ordered: coverage 1/1 grids and “What XRay knows” appear before the story, even on a Props-built parlay. |
| Per-leg Market / Form / Minutes / Matchup | Valuable Layer B. Should be secondary / expandable. |
| Missing WOWY / Projection / Availability cards | Honest. Repeated again in Why this could fail and Data limitations. |
| `game 18447934` in leg subtitle | **DEV_ONLY** for consumers. |

---

## Workflow Friction

1. **Mobile Props path is two hops** (View Parlay → Open Workspace). Intentional; still the main Flow A friction.
2. **Four peer Explorer actions** (Save / Compare / Paper Add / + Parlay).
3. **Hard reload empties Workspace.** Correct for transient state; unexplained to the user.
4. **XRay page density before Confirm** (upload + stages + empty analysis).
5. **Quota copy on a non-extracting replay.**
6. **Results are fully expanded.** No accordion. One-leg and four-leg slips get the same wall.
7. **Workspace empty state ignores XRay** as an entry.
8. **Transient store + public Workspace URL** means a pasted `/parlay-workspace` is empty. Fine technically; confusing if nabbed from nav later.

---

## Results Information Hierarchy

Observed on Flow A after Analyze (Ajay Mitchell Over 12.5 Points, DraftKings, Decision Close):

Order today: eyebrow HISTORICAL ANALYSIS → Shared context sentence → 10 count tiles → Data coverage 7-source grid → Shared context cards → Why this parlay could fail → Supporting parlay context → Legs needing review → Leg context (indicators + four blocks + supporting/counter + missing trio + Why this could fail + data limitations + replay footer).

Recommended hierarchy (do not remove data in E6):

| Rank | Content | Placement |
| --- | --- | --- |
| **PRIMARY** | Slip sentence (what kind of parlay this is) | Keep first |
| **PRIMARY** | Why this parlay could fail | Move up; this is the Court Context differentiator |
| **PRIMARY** | Structural dependencies (same player / game / team / conflict) | Keep visible; merge with pre-Analyze badges so they do not feel like a second product |
| **SECONDARY** | Per-leg one-line read (form vs line, 3-Hour → Close, minutes vs season) | Visible summary row |
| **EXPANDABLE** | Full recent form / minutes / matchup tables | Default collapsed after the one-line read |
| **EXPANDABLE** | Data coverage grid, market-position counts | Researchers; not the first screen |
| **EXPANDABLE** | Missing WOWY / projection / availability | Keep honest; once per slip, not once per section |
| **DEV_ONLY** | Raw game ids, cutoff ISO timestamps, design strongest/riskiest panel, `preview=` fixtures | Hide from consumer default |

A user should be able to answer **“what could go wrong with this slip?”** in one screen.

---

## Why This Could Fail

**Yes — this is the clearest Court Context differentiator** if it stays concrete, slip-level, and Free.

Walked evidence (1-leg Ajay):

- Parlay-level: “Availability gap across the parlay — Historical availability context is unavailable for all 1 legs.”
- Leg-level: “6 of the previous 10 games finished below 12.5.” plus availability gap again.

| Question | Answer |
| --- | --- |
| Concrete? | **Yes** when it cites form counts, line vs close, concentration. Availability-only on a 1-leg slip is weaker. |
| Repetitive with dependency cards? | **Yes, partially.** Shared-game concentration appears as a dependency card *and* a fail note. Missing WOWY/availability appear as coverage, missing cards, uncertainties, and fail bullets. |
| Surfaces missing-context? | **Yes**, and that is correct. Do not hide gaps. |
| Too negative? | Tone is amber + “Not a prediction.” Supporting parlay context exists but sits below the fail block. A 1-leg “parlay could fail” availability note feels padded. |
| Prominent for Free? | **Yes. NEVER_PAYWALL.** This is how Free proves Court Context is not a picks engine. |

Do not rewrite the engine in E6. Polish placement: one parlay-level fail story first; per-leg fail inside the leg; missing-data once.

---

## Structural vs Advanced Context

| Layer | What it is | Entitlement |
| --- | --- | --- |
| **A — STRUCTURAL** | Same player, same game, same team, exact duplicate, logical conflict | **FREE**. Trust/safety. Already computed from identity. |
| **B — MARKET / FORM CONTEXT** | 3-Hour → Decision Close, recent production vs line, minutes/role, matchup | **FREE** at the one-line / Why-this-could-fail level. **PRO** for deeper windows, per-book movement, and extra historical range once coverage exists. |
| **C — ADVANCED CONTEXT** | Verified availability, certified WOWY signal, frozen model projections, deeper Context Engine | **NOT_READY**. Do not sell. When live: **PRO**. |

Layer C is **not currently live** in Workspace packets (walked: WOWY 0/1, Projection 0/1, Availability 0/1 on the certified Ajay replay).

---

## Current Entitlement Implementation Audit

Central registry: `lib/entitlements/types.ts`. Plans `free` / `founding_pro`. Feature keys flip **all true iff `isPro`**.

| Area | Classification | Notes |
| --- | --- | --- |
| Plan resolution | **CENTRALIZED** | `resolveEntitlementFromRow` fail-closed to Free |
| Stripe → `user_entitlements` | **CENTRALIZED** | `/api/billing/*` |
| `line_shopping_detail` | **CENTRALIZED** | Server sanitize + client CTA |
| `market_movement` | **CENTRALIZED** | Free `summary` (close consensus, no 3-Hour numbers / per-book); Pro `full` |
| `ai_briefing` | **CENTRALIZED** | `requireEntitlement` on slate + game APIs |
| `advanced_history` | **HARDCODED** key; **NOT_IMPLEMENTED** gate | Copy: “when that surface ships” |
| `wowy` | **HARDCODED** copy; **NOT_IMPLEMENTED** gate | `/wowy` public; upgrade copy claims Pro |
| `alerts` | **HARDCODED** key; **NOT_IMPLEMENTED** | |
| Props Explorer board | **PARTIAL** | Session on `/betting/*`; no plan key |
| Paper | **NOT_IMPLEMENTED** as entitlement | Auth only |
| Saved props | **NOT_IMPLEMENTED** as entitlement | Auth only |
| XRay extraction | **PARTIAL** | Auth + `isPro` for **safety quota only**; no `FEATURE_KEYS` entry |
| Workspace analysis | **NOT_IMPLEMENTED** | No paywall, no quota |
| Parlay Add / tray | **NOT_IMPLEMENTED** | |
| Feature-flag service | **NOT_IMPLEMENTED** | Env kill switches only |

**Server is authoritative** for shopping / MM / AI / XRay extract. Client CTAs are presentation.

This registry is a **pre-parlay Founding Pro package**. Implementing E6 by flipping the existing all-or-nothing Pro map would be the wrong architecture.

---

## Safety Quotas vs Product Limits

These are **different systems**. Do not conflate.

### TECHNICAL SAFETY LIMIT (current code)

From `lib/parlay-xray/extraction/config.ts` defaults:

| Guardrail | Default |
| --- | --- |
| Kill switch | `PARLAY_XRAY_EXTRACTION_ENABLED=false` |
| Free daily extract | 3 / UTC day |
| Pro daily extract | 10 / UTC day |
| Global daily | 100 |
| In-flight / user | 1 |
| Cooldown | 45s |
| Dedupe TTL | 24h |
| Soft selection cap | 12 legs (`PARLAY_SELECTION_SOFT_CAP`) — also **not product policy** |

Repo comments already say so (`parlay-xray-controlled-paid-canary.md`: “Free/Pro daily limits remain safety defaults, not product policy”).

### PRODUCT PLAN LIMIT (this architecture)

| Meter | Product stance |
| --- | --- |
| XRay screenshot extraction | Meter expensive vision separately. Numeric Free/Pro caps are **not finalized**. Safety defaults are conservative relative to measured cost. |
| Workspace Analyze | Not metered today (client historical fixture). Do not invent a Pro analysis cap until a real analysis cost exists. |
| DB-backed Explorer browse / structural grouping | Not metered. |

---

## XRay Cost Evidence

No OpenAI calls this step. Measured unique paid vision calls (`gpt-4o-mini`, low detail) from existing reports:

| Report | Range |
| --- | --- |
| Controlled paid canary | $0.000834 (1 call) |
| Extraction quality benchmark | $0.000745–$0.000934 (mean $0.000812) |
| v2 targeted retest | $0.000661–$0.001256 |
| v2.1 real-market retest | $0.001051–$0.001154 |

**MEASURED EXTRACTION COST RANGE:** about **$0.00066 – $0.00126** per unique paid call.

Benchmark projection (extraction only, not policy): Free 3/day ≈ $0.07/user/month; Pro 10/day ≈ $0.24/user/month.

**Cost alone does not justify treating 3 vs 10 as the Court Context Free/Pro product.** Future provider/context costs may differ. Do not infer total product cost from extraction.

---

## Entitlement Design Principles

Adopted:

1. **Free must demonstrate Court Context** — a user can finish a real Props → Workspace → Analyze loop and see Why This Could Fail.
2. **Do not cripple basic factual context** to create a paywall.
3. **Pro saves time and deepens research** — more history, more capacity, more workflow, more advanced modules.
4. **Meter expensive AI/provider operations separately** from inexpensive DB-backed research.
5. **Do not charge for unavailable or incomplete functionality.**
6. **Do not paywall basic trust/safety information.**
7. **Missing-data warnings are never paywalled.**
8. **Structural dependency warnings stay broadly accessible.**
9. **Historical depth can differentiate tiers** once coverage is real.
10. **Saved workflow/convenience can differentiate later** — do not sell saved parlays now.
11. **Exact wager identity is always visible** (player, market, side, line, book, snapshot kind).
12. **OCR correction and Confirm are never paywalled.**
13. **Do not claw back surfaces already public** (historical WOWY page) just to manufacture Pro.
14. **Safety quotas ≠ plan marketing.**

---

## Court Context Free / Pro Matrix

Classifications are **product architecture**, not shipped gates.

| Surface | Capability | Class |
| --- | --- | --- |
| Landing / public | Product overview | **BOTH** (public) |
| Dashboard | Core dashboard | **FREE** (auth) |
| Props Explorer | Browse props | **FREE** |
| Props Explorer | Basic filters | **FREE** |
| Props Explorer | Books / lines on the selected offer | **FREE** |
| Props Explorer | Compare (open the market panel) | **BOTH** |
| Props Explorer | Market Movement — close consensus / availability | **FREE** |
| Props Explorer | Market Movement — 3-Hour + per-book | **PRO** |
| Props Explorer | Deeper history | **PRO** when a real expanded-history surface ships; today **NOT_READY** |
| Parlay | Add to Parlay | **FREE** |
| Parlay | Workspace review | **FREE** |
| Parlay | Layer A structural dependencies | **FREE** |
| Parlay | Why This Could Fail | **FREE** |
| Parlay | Historical Layer B one-line context (form / 3-Hour→Close / minutes / matchup) | **FREE** |
| Parlay | Deeper Layer B research (extra windows, expanded coverage) | **PRO** when coverage exists |
| Parlay | Layer C advanced context | **NOT_READY** |
| XRay | Upload UI | **BOTH** (page public) |
| XRay | Extraction | **BOTH** when enabled, **metered separately**; currently kill-switched |
| XRay | Manual correction | **FREE** / **NEVER_PAYWALL** |
| XRay | Confirm | **FREE** / **NEVER_PAYWALL** |
| XRay | Workspace handoff | **FREE** |
| XRay | Analysis | Same as Workspace analysis |
| Player research | Standard player page | **FREE** |
| Player research | Advanced history / context | **PRO** when shipped; **NOT_READY** as a distinct paid module |
| Game research | Standard game page | **FREE** |
| Game research | Advanced context | **PRO** when shipped |
| WOWY | Historical WOWY page | **FREE** (already public — do not claw back) |
| WOWY | Deeper / injury-conditioned WOWY | **NOT_READY** (inconclusive) |
| Context Check | Public/shared content | **NOT_READY** |
| Context Check | Admin studio | **INTERNAL_RESEARCH** |
| Projections | Current production projection on Explorer | **FREE** |
| Projections | Frozen PTS C / REB C | **INTERNAL_RESEARCH** |
| Projections | Future advanced projections | **NOT_READY** |
| Market Movement | Basic close / status | **FREE** |
| Market Movement | Historical depth | **PRO** |
| Saved | Saved props | **FREE** (already live for auth users) |
| Saved | Saved parlays | **NOT_READY** (future **PRO**) |
| Saved | Analysis history | **NOT_READY** (future **PRO**) |
| Paper | Paper book | **FREE** (already live; not an entitlement key) |
| AI briefing | Slate / matchup synthesis | **PRO** (already gated; expensive) |
| Alerts | Line / research alerts | **NOT_READY** |

---

## Complete Free Experience

A Free user should complete **meaningful Court Context** without hitting a paywall first.

**Minimum complete workflow (defined):**

1. Sign in (Props Explorer is under `/betting`).
2. Props Explorer — browse an exact offer (book / side / line visible).
3. Add to Parlay.
4. Open Workspace.
5. See Layer A (same player / same game).
6. Analyze with Court Context (when eligibility is READY).
7. Read Why This Could Fail + a short Layer B read.

**Second Free workflow (when extraction is enabled, not now):**

XRay upload → limited safety-metered extract → correct OCR (never paywalled) → Confirm → Workspace → same basic analysis.

Do **not** paywall before the user has seen a concrete fail/context note.

Numeric XRay/Analyze caps are **not finalized**. Do not market 3/day vs 10/day as the Free/Pro story.

Auth friction: Props requires login. That is acceptable if landing does not oversell live picks. XRay HTML is public; extract API requires auth — a reasonable conversion moment **after** the user understands they are importing a slip, not before.

---

## Pro Value Proposition

### AVAILABLE NOW (actually shipped — may be marketed only as current)

- Exact best-book / line shopping detail
- Full Market Movement (3-Hour Pre-Tip + per-book) when snapshots exist
- AI research briefings as supporting synthesis, not picks
- Higher XRay **safety** extract headroom (not a locked product promise)

### NEAR-TERM (after polish + real coverage — do not sell today)

- Deeper historical windows on Workspace / Compare once SQL coverage is wired beyond X3F
- More analysis capacity if/when analysis has real cost
- First-run teaching of the hybrid loop
- Honest plan copy aligned to this matrix

### FUTURE (do not appear on the billing page now)

- Saved parlays / analysis history
- Live / current Workspace and XRay analysis
- Certified WOWY-in-packet / verified availability
- Advanced Context Engine modules
- Sharing
- Alerts

Pro is **depth, history, convenience, capacity** — not a lock-of-the-day generator.

---

## Never-Paywall Capabilities

**NEVER_PAYWALL**

- Exact wager identity
- Historical vs live / Decision Close vs current-season honesty
- Missing-data and unavailable-source warnings
- Structural conflicts and same-player / same-game grouping
- Why This Could Fail (parlay + leg)
- OCR review, edit, and Confirm
- Workspace as the place to examine the slip (the shell, not every deep module)

---

## Possible Pro Capabilities

**POSSIBLE_PRO**

- Additional daily AI extraction volume (separate from safety floor)
- 3-Hour + per-book Market Movement in Explorer Compare (already gated)
- Deeper historical research windows once they exist
- Advanced context modules once certified
- AI briefings (already gated)
- Saved parlays / history / convenience (future)
- Extra analysis capacity if analysis becomes provider-backed

---

## Not-Ready Capabilities

| Capability | Class |
| --- | --- |
| CURRENT_LIVE_ANALYSIS | **NOT_READY** |
| MEASURED_CORRELATION | **NOT_READY** |
| AVAILABILITY_CONTEXT | **BLOCKED_BY_PROVIDER** |
| INJURY_WOWY | **INCONCLUSIVE / NOT_READY** |
| PTS C / REB C | **INTERNAL_FROZEN_SHADOW_CANDIDATES** |
| PARLAY_PERSISTENCE | **NOT_READY** |
| SHARING | **NOT_READY** |
| SAME_DATE_MULTI_GAME / MULTI_DATE analysis | **NOT_READY** |
| Win probability / EV / numeric confidence | **NOT_IMPLEMENTED** (do not add) |
| Auto-generated parlays / wager recommendations | **NOT_IMPLEMENTED** (do not add) |
| Public XRay extraction | **DISABLED** |
| Context Check as a consumer product | **NOT_READY** |
| Alerts | **NOT_READY** |

These must **not** appear as currently purchasable Pro promises.

---

## Historical Analysis Limitation

Current Workspace analysis is **SAME_GAME Decision Close** with **injectable X3F coverage only**.

Do not position this as broad full-season consumer coverage. The matching audit window `2026-04-02` → `2026-05-02` is a research bound, not a product catalog. Other historical games show: “Historical Court Context analysis is not available for one or more selected offers.”

**Readiness:** internally certified fixture. **Not** a general historical parlay product.

---

## Authentication Experience

| Surface | Before login | Account required |
| --- | --- | --- |
| Landing `/` | Yes (demo cards) | No |
| `/parlay-xray` HTML | Yes | Extract API: **yes** (“Sign in to analyze a screenshot.”) |
| `/parlay-workspace` HTML | Yes | No HTML gate; empty without in-memory selection |
| `/wowy`, `/teams` | Yes | No |
| `/betting/*` including Props Explorer | Redirect `/login?next=` | **Yes** |
| `/billing` | Redirect | **Yes** |

Account creation: `/signup` or Google. Landing **Start Winning Now** → `/betting?onboard=1` (forces login).

Natural conversion moments (no dark patterns):

1. After the user understands XRay is an importer, extract requires sign-in.
2. After Compare, Founding Pro unlocks 3-Hour / best book (already the MM upgrade click).
3. After a Free Analyze, if/when a deeper history module exists.
4. Billing, only after the user has seen Court Context work.

Unnecessary friction: requiring login **before** Props means Free cannot demo the board from landing without an account. Acceptable if landing is honest. Today landing oversells (see Billing / Trust).

---

## Billing Surface

Walked `/billing` (Stripe test mode, Founding Pro already on the session):

- Title: Founding Pro plan and Stripe-hosted billing
- Notice: **Stripe test mode. No live charges.**
- Production would show: **Founding Pro is not available for live purchase yet.**
- Price: **$10/month** (`FOUNDING_PRO_PRICE_CONCEPT`)
- Bullets: best sportsbook, best O/U line, deeper comparison, movement history, AI briefings

**Stale / inconsistent vs the parlay product:**

- No Workspace, XRay, Why This Could Fail, or structural analysis
- Positioning is “Stop checking multiple sportsbooks manually” — shopping, not Court Context
- WOWY upgrade copy exists in `UPGRADE_COPY` while `/wowy` is free
- `advanced_history` / `alerts` promised “when that surface ships”
- Landing footer **NBAEdge** / metadata **NBA Analytics** vs in-app **Court Context**
- Landing CTA **Start Winning Now** and hero **injuries** while injuries are blocked and this is not a picks product

Do not change Stripe or production pricing in E6.

---

## Pricing Assumptions

`FOUNDING_PRO_PRICE_CONCEPT = '$10/month'` is a **PLANNING_ASSUMPTION**, not a locked production price. Live checkout is disabled on Vercel Production.

The proposed Free/Pro split is coherent with a low-cost consumer sub: Free proves context; Pro sells shopping depth, AI synthesis, and future history/convenience. Extraction cost at measured rates does not require a high price. Do not forecast revenue here.

**PRICING: UNCHANGED**

---

## Naming / Information Architecture

| Name | Rating | Note |
| --- | --- | --- |
| Props Explorer | **CLEAR** | Board for individual props. |
| Parlay XRay | **NEEDS_COPY_HELP** | Sounds like live analysis. Role is import. |
| Parlay Workspace | **NEEDS_COPY_HELP** | Distinct from Explorer once visited; name does not say “examine the whole parlay.” Not in nav. |
| Market Movement | **CLEAR** | Compare-owned; results use lowercase “Market movement.” |
| WOWY | **CONFUSING** in primary nav | Acronym; also a missing packet in results. |
| Context Check | **CONFUSING** for this flow | Admin editorial studio, not the parlay pipeline. |
| Props Explorer vs Workspace | **Distinct roles, weak teaching** | Easy to think Explorer *is* the workspace. |

Do not rename in E6.

---

## Navigation

Workspace is **intentionally absent** from `PRIMARY_NAV` (Dashboard, Teams, WOWY, Parlay XRay, Props Explorer, Saved, Paper, Profile). Contracts assert this.

**Now:** enter Workspace only through Props Explorer tray or XRay Confirm. Direct `/parlay-workspace` is empty after reload.

**Future IA (do not add now):**

- Keep Workspace **out of primary nav** until persistence or history exists. An empty nav item is worse than no nav item.
- When saved parlays / analysis history exist, add **Workspace via history**, not a blank builder.
- Do not make Workspace a third browsing surface.

XRay in primary nav while public extraction is off is a launch honesty issue (polish), not an E6 nav change.

---

## Mobile Acceptance

E5 **MANUAL_VIEWPORT passed (~390px)**. This walk used a below-`xl` viewport.

| Path | Remaining friction |
| --- | --- |
| Props: Add → View Parlay → Open Workspace | Extra tap. Sticky bar competes with table scroll (`pb-28`). Desktop tray never appears. |
| XRay: review/correct → Confirm → Workspace | OCR edit is usable. Page is long (hero + upload + stages + empty analysis) before the legs. |
| Workspace: review → Analyze → results | Actions stack under content (`xl:hidden`). Results are a long uncollapsible scroll. |

Do not redesign in E6. Polish target: shorter XRay chrome, collapsible results, keep the two-hop tray.

---

## Trust / Safety Copy

Certified results stay statistical/contextual. Tests forbid win probability, strongest leg, HIGH CONFIDENCE, BEST BET.

**Good (keep):**

- “This is not a win call.”
- “Not a prediction.”
- “These are not measured correlations.”
- Historical Replay “not current-season intelligence.”
- Offseason banner on betting surfaces.
- AI briefing disclaimer: no win probabilities.

**Overstatement / mixed signals (polish later):**

- Landing **Start Winning Now**
- Landing hero lists **injuries** as if live
- Landing featured games / props are **sample** (caption exists; cards still look live)
- XRay idle panel “strongest/riskiest”
- “Legs locked” (trust boundary, slightly casino)
- Quota “XRay analyses remaining”
- Explorer live **Est. EV / Est. P / Good·Fair·Bad** beside `+ Parlay` — those are Explorer research, not Workspace analysis, but they sit on the same row

Court Context must remain context, not a guaranteed picks service.

---

## Analytics Funnel

Privacy-safe Umami helper. No wager contents, OCR, names, or odds on XRay/Workspace events.

| Question | Event today |
| --- | --- |
| Props viewed | **NOT FOUND** |
| Compare opened | **NOT FOUND** |
| Add to Parlay | **NOT FOUND** |
| Workspace opened | **NOT FOUND** (only `parlay_xray_open_workspace`) |
| Workspace analyzed | `parlay_workspace_analysis_started` |
| XRay started | `parlay_xray_extract_started` (+ view/upload) |
| XRay confirmed | **NOT FOUND** |
| Upgrade viewed | **NOT FOUND** (only `market_movement_upgrade_clicked`) |
| Subscription started | **NOT FOUND** |

Minimal funnel model (do not implement in E6):

`props_explorer_viewed` → `compare_opened` → `add_to_parlay` → `workspace_opened` → `workspace_analysis_started`  
`parlay_xray_viewed` → `extract_*` → `parlay_xray_confirmed` → `parlay_xray_open_workspace` → `workspace_analysis_started`  
`upgrade_viewed` → `checkout_started` (no wager payload)

---

## Core Conversion Funnels

**FUNNEL A — Build**  
Props Discovery → Compare → Add to Parlay → Workspace → Analyze  
Conversion: after the user has seen Why This Could Fail, offer Pro depth (full MM / later history) — not before Add.

**FUNNEL B — Import**  
XRay → Upload → Review → Confirm → Workspace → Analyze  
Conversion: sign-in at extract; Pro only for additional extract volume or later depth — never for correction/Confirm.

**FUNNEL C — Research**  
Player/game/WOWY research → value experienced → natural Pro point (deeper MM, AI briefing, future history).

No dark patterns: no fake urgency, no hiding missing data, no locking identity behind Pro.

---

## UX Defect Backlog

Launch-relevant only.

### P0

- None found in certified historical identity/analysis semantics during this walk. Canonical wager identity, Decision Close, and no-prediction results held.

### P1

1. **XRay still presents an analysis destination** (StageList Results + idle strongest/riskiest panel) after analysis moved to Workspace.
2. **Landing / chrome honesty:** Start Winning Now, injuries claim, NBAEdge footer vs Court Context, XRay in nav while extraction is off.
3. **Existing Pro copy contradicts public WOWY** — entitlement implementation would ship a lie.
4. **Public Flow B cannot complete** (known kill switch; do not “fix” by enabling extraction).

### P2

1. Results hierarchy: coverage grids before Why This Could Fail; no expandable sections.
2. “What XRay knows” copy inside Workspace results.
3. `game 18447934` and ISO cutoffs in consumer chrome.
4. Duplicate missing WOWY/availability across coverage, cards, fail, limitations.
5. Explorer action-row hierarchy (Save / Compare / Paper / Parlay).
6. Workspace empty state omits XRay import.
7. Mobile extra View Parlay hop (keep unless a one-tap Open Workspace is added on the sticky bar).
8. Quota label “analyses remaining” on extraction/replay.
9. Two Confirm nouns on XRay (accept-as-shown vs Confirm legs).
10. Analytics gaps for the hybrid funnel.

---

## Leave-It-Alone List

Do **not** reopen unless a concrete defect appears:

- Canonical wager identity (`wagerIdentity` / E1 adapter)
- E2 selection semantics (exact offer, no 3-Hour in the tray, soft cap as runtime not policy)
- E3 transient Workspace state (in-memory, no persistence)
- E4 historical analyzer (`runHistoricalCanonicalParlayAnalysis`, explicit Analyze)
- E5 source convergence (one store, XRay provenance optional)
- XRay Confirm boundary (no OCR-only legs in Workspace)
- Decision Close semantics (requested line stays the selected close; 3-Hour is comparison only)
- Same-game-only historical orchestration
- Public extraction kill switch default **off**
- Modeling freeze / shadow disabled / injury collection disabled
- No win probability / EV / numeric confidence / measured correlation
- Workspace **not** in primary nav this phase

---

## Provider-Blocked Features

**BLOCKED UNTIL PROVIDER ACCESS** — not polish work:

- Fresh injuries
- Current prop context
- Live Workspace analysis
- Current XRay analysis
- Prospective model evaluation
- Verified availability context
- Live odds / nightly stats / box accumulation (schedulers currently frozen)

Do not mix these into entitlement promises or UI QA.

---

## Recommended Next Step

**A. PRODUCT POLISH / UI QA**

Rationale:

- The hybrid loop is certified. Entitlement implementation (B) would freeze today’s dense XRay page, shopping-centric billing copy, and WOWY contradiction as “the product.”
- Landing / first-run (C) still matters, but conversion polish on top of “Start Winning Now” + XRay-as-analyzer would teach the wrong loop.
- Billing copy (D) should follow polish + this matrix, not precede it.
- Pre-BDL work that actually helps: make Free Flow A scannable (results hierarchy, XRay chrome vs Workspace, landing honesty, Explorer action hierarchy). No new gates, no live analysis, no persistence.

Do not start that step in E6.

---

## Files Changed

- `reports/product/parlay-product-acceptance-entitlement-architecture.md` (this report)
- Companion canvas (visual matrix; not product runtime)
- Learning log under `notes/learning-log/2026-09-16/`

No application runtime files.

---

## Schema Changes

**SCHEMA_MIGRATION = NONE**

If a later entitlement implementation needs per-feature overrides (instead of all-keys-flip-with-`isPro`), that is future work. Do not apply now.

---

## Provider Calls

**REAL_OPENAI_CALLS_THIS_STEP = 0**  
**REAL_BDL_CALLS_THIS_STEP = 0**

Quota/headshots/profile traffic during the UI walk used the local app only. No extraction enablement. No new provider purchases.

---

## Modeling Freeze

**MODEL_TUNING: FROZEN**  
**SHADOW_SCORING: DISABLED**  
**INJURY_COLLECTION: DISABLED**

---

## Verification Checklist

1. Confirm this report’s matrix is **architecture only** — no new feature gates in `lib/entitlements`.
2. Confirm public extraction is still off (`SCREENSHOT_EXTRACTION_AVAILABLE = false`, extract env default false).
3. Confirm Workspace is still absent from `PRIMARY_NAV`.
4. On historical LAL @ OKC, complete Add to Parlay → Workspace → Analyze and see Why This Could Fail without a paywall.
5. On `?preview=replay`, Confirm still does not run analysis on the XRay page; Workspace does.
6. Billing still shows `$10/month` as concept copy; production checkout still disabled.
7. Do not treat Free 3 / Pro 10 XRay caps as launched plan policy.

---

## Step Verdict

**YELLOW**

ARCHITECTURE: **HYBRID**  
PROPS_EXPLORER: **KEEP**  
PARLAY_XRAY: **POLISH**  
PARLAY_WORKSPACE: **POLISH**  
PROPS_TO_WORKSPACE_FLOW: **NEEDS_POLISH**  
XRAY_TO_WORKSPACE_FLOW: **NEEDS_POLISH**  
FREE_EXPERIENCE: **DEFINED**  
PRO_EXPERIENCE: **DEFINED**  
ENTITLEMENT_MATRIX: **DEFINED**  
SAFETY_QUOTAS_SEPARATED_FROM_PRODUCT_LIMITS: **YES**  
PRICING: **UNCHANGED**  
PUBLIC_EXTRACTION: **DISABLED**  
CURRENT_LIVE_ANALYSIS: **NOT_IMPLEMENTED**  
PARLAY_PERSISTENCE: **NOT_IMPLEMENTED**  
MEASURED_CORRELATION: **NOT_IMPLEMENTED**  
MODEL_TUNING: **FROZEN**  
REAL_OPENAI_CALLS_THIS_STEP: **0**  
REAL_BDL_CALLS_THIS_STEP: **0**  
PRODUCT_RUNTIME_CHANGES: **NONE**  
SCHEMA_MIGRATION: **NONE**  
NEXT_RECOMMENDED_STEP: **PRODUCT_POLISH_UI_QA**
