# Lineups 2025 Full Archive (Step 8B)

- Generated: 2026-09-09T12:53:30.569Z
- Verdict: **GREEN — 2025 starter archive complete and product-useful**
- Postgres writes: false
- Started 2022: false

## Safety State
- Trial mode / 13s / concurrency 1 / frozen / season pin 2025
- Postgres expected 342846611; after=342846611; unchanged=true

## Target Definition
- 1322 games from cached BDL inventory (excluded 21681993)
- Dates 2025-10-21 → 2026-06-13; RS=1237; post=85

## Characterization Reuse
{
  "characterizationPrefix": "raw/source=balldontlie/league=nba/season=2025/entity=lineups/_characterization_25game",
  "reusableValid": 25,
  "alreadyCanonical": 837,
  "needCopy": 0,
  "needFetch": 485,
  "expectedReusableUpTo": 25,
  "expectedNewIfAll25Reused": 1297
}

## Time Gate
{
  "trialElapsedHours": 22.89,
  "trialRemainingHours": 25.11,
  "protectedReserveHours": 6,
  "usableAfterReserveHours": 19.11,
  "reusableResponses": 25,
  "requiredProviderRequests": 485,
  "projectedCrawlMs": 6305000,
  "projectedCrawlHours": 1.751,
  "projectedRemainingAfterCrawlHours": 23.359,
  "maxAllowedHours": 6,
  "proceed": true
}

## Acquisition Result
- target=1322 reused=0 newlyRequested=485
- successful=1322 zero=0 failed=[]
- records=28833 HTTP=485 429s=0 retries=0
- wallClockMs=6544986

## Full-Season Starter Certification
- valid 5+5: 1320 / 1322
- exactly5=2642 fewer=2 more=0 dup=0 null=0
- reliability: EXCELLENT (99.85%)

## Availability Limitation
The lineup endpoint does NOT reliably distinguish active bench, DNP, inactive, or absent roster members. Certified product signal is starter vs listed non-starter only.

## S3
{
  "canonicalPrefix": "raw/source=balldontlie/league=nba/season=2025/entity=lineups",
  "characterizationPrefixPreserved": true,
  "gameObjects": 1322,
  "gameObjectBytes": 24431769,
  "manifestBytes": 0,
  "runBytes": 873,
  "totalBytes": 24432642,
  "totalMb": 23.3,
  "step8AProjectionMb": 13.4
}

## Product Interpretation
{
  "roleCheck": {
    "recommendation": "recommended",
    "reason": "Explicit per-game starter=true is unique versus logs/stints/injuries/Advanced Stats."
  },
  "opportunityCheck": {
    "recommendation": "scoped",
    "reason": "Replacement context exists when an Out/Inactive player is not among the five starters and the game is valid 5+5. Not a causal usual-starter model."
  },
  "historicalExplorer": {
    "recommendation": "recommended",
    "reason": "Starting five display is the primary product use of this archive."
  },
  "wowy": {
    "recommendation": "not_from_this_endpoint",
    "reason": "Records are player-game listings, not five-man units or possessions."
  },
  "availability": {
    "recommendation": "not_from_this_endpoint",
    "reason": "The lineup endpoint does NOT reliably distinguish active bench, DNP, inactive, or absent roster members. Certified product signal is starter vs listed non-starter only."
  }
}

## Trial Time Remaining
{
  "elapsedHours": 24.709,
  "remainingHours": 23.291,
  "protectedReserveHours": 6,
  "usableRemainingHours": 17.291,
  "characterizationPlusArchiveHours": 1.818,
  "optional2022Hours": [
    1.8,
    2
  ],
  "doNotStart2022": true,
  "nextStep": "final trial audit / objective review"
}

Do NOT start 2022. Next: final trial audit.
