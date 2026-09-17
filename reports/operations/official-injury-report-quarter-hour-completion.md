# Official NBA injury-report quarter-hour completion (Phase 1A.2)

Generated: **2026-09-17T02:57:28.004Z**
Window: **2025-12-22 → 2026-06-14** (inclusive).
Method: **HEAD only**. No PDF bodies downloaded. No S3. No Postgres.
Original Phase 1A evidence was **not** overwritten.

## Finding status

| Finding | Status | Note |
| --- | --- | --- |
| F1 snapshot count | **CLOSED** | 08:00-23:45 :00/:15/:30/:45 in this window; not exhaustive outside that policy |
| F2 token / family density | **CLOSED** | Quarter-hour slots 08-23 now inventoried |
| F3 T−60 vs `analytics.games.start_time` | **OPEN** | Not joined. Phase 1B. |

## Control (non-5PM quarter-hour)

| Date | Token | Status | Exists | Reused |
| --- | --- | ---: | --- | --- |
| 2026-03-18 | `08_15AM` | 200 | true | no |
| 2026-03-18 | `08_45AM` | 200 | true | no |
| 2026-03-18 | `12_15PM` | 200 | true | no |
| 2026-03-18 | `11_15PM` | 200 | true | no |
| 2026-03-18 | `11_45PM` | 200 | true | no |
| 2025-12-22 | `09_15AM` | 200 | true | no |
| 2026-03-18 | `05_15PM` | 200 | true | yes |

## Request totals

| Result | Count |
| --- | ---: |
| Matrix URLs (date × :15/:45 token) | 5600 |
| New HEAD requests this pass | 5268 |
| Reused Phase 1A (05_15PM / 05_45PM) | 332 |
| 200 (exists) | 4104 |
| 403 | 1496 |
| 404 | 0 |
| 429 | 0 |
| redirect | 0 |
| 5xx | 0 |
| timeout | 0 |
| network | 0 |
| other | 0 |

First successful :15/:45 date: **2025-12-22**
Last successful :15/:45 date: **2026-06-13**

`:15` HTTP 200: **2051**
`:45` HTTP 200: **2053**

## Are :15 / :45 generally part of the schedule, or was 5 PM unusual?

**Broadly confirmed.** `:15` and `:45` files appear across the 08:00–23:45 window on eligible minute-family dates, not only at 5 PM.

5 PM is still special in density: `05_15PM` / `05_45PM` hit **165/165** eligible dates (100%). Other hours sit near **76%** because late-season/playoff dates often keep the `:00`/`:30` slate plus the 5 PM quarter-hour pair, and drop the rest of `:15`/`:45`. On 123 of 165 active dates the full 64-slot 15-minute grid is present.

Eligible dates = dates in this window with at least one Phase 1A `:00`/`:30` HTTP 200.

| Hour | :15 200 count | :45 200 count | eligible dates | coverage % |
| ---- | ------------: | ------------: | -------------: | ---------: |
| 08 | 125 | 125 | 165 | 75.8 |
| 09 | 126 | 126 | 165 | 76.4 |
| 10 | 126 | 126 | 165 | 76.4 |
| 11 | 126 | 126 | 165 | 76.4 |
| 12 | 126 | 127 | 165 | 76.7 |
| 13 | 126 | 126 | 165 | 76.4 |
| 14 | 126 | 126 | 165 | 76.4 |
| 15 | 126 | 126 | 165 | 76.4 |
| 16 | 126 | 126 | 165 | 76.4 |
| 17 | 165 | 165 | 165 | 100 |
| 18 | 126 | 126 | 165 | 76.4 |
| 19 | 126 | 126 | 165 | 76.4 |
| 20 | 125 | 125 | 165 | 75.8 |
| 21 | 125 | 125 | 165 | 75.8 |
| 22 | 125 | 126 | 165 | 76.1 |
| 23 | 126 | 126 | 165 | 76.4 |

## Count by token

| Token | n200 | First date | Last date |
| --- | ---: | --- | --- |
| `08_15AM` | 125 | 2025-12-23 | 2026-06-13 |
| `08_45AM` | 125 | 2025-12-23 | 2026-06-13 |
| `09_15AM` | 126 | 2025-12-22 | 2026-06-13 |
| `09_45AM` | 126 | 2025-12-22 | 2026-06-13 |
| `10_15AM` | 126 | 2025-12-22 | 2026-06-13 |
| `10_45AM` | 126 | 2025-12-22 | 2026-06-13 |
| `11_15AM` | 126 | 2025-12-22 | 2026-06-13 |
| `11_45AM` | 126 | 2025-12-22 | 2026-06-13 |
| `12_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `12_45PM` | 127 | 2025-12-22 | 2026-06-13 |
| `01_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `01_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `02_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `02_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `03_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `03_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `04_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `04_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `05_15PM` | 165 | 2025-12-22 | 2026-06-13 |
| `05_45PM` | 165 | 2025-12-22 | 2026-06-13 |
| `06_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `06_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `07_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `07_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `08_15PM` | 125 | 2025-12-22 | 2026-06-13 |
| `08_45PM` | 125 | 2025-12-22 | 2026-06-13 |
| `09_15PM` | 125 | 2025-12-22 | 2026-06-13 |
| `09_45PM` | 125 | 2025-12-22 | 2026-06-13 |
| `10_15PM` | 125 | 2025-12-22 | 2026-06-13 |
| `10_45PM` | 126 | 2025-12-22 | 2026-06-13 |
| `11_15PM` | 126 | 2025-12-22 | 2026-06-13 |
| `11_45PM` | 126 | 2025-12-22 | 2026-06-13 |

## Rate limiting

No stop condition fired. 429 count is in the table above.

## Verification

1. HEAD only; no PDF body download.
2. No S3 / Postgres / schema / WOWY / BDL / Terraform change.
3. Original Phase 1A JSON/MD/ndjson preserved.
4. F3 remains OPEN.
