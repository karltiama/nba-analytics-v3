# Official NBA injury-report existence inventory (Phase 1A)

Generated: **2026-09-17T02:35:19.333Z**
Window: **2023-10-23 → 2026-06-14** (inclusive).
Method: **HEAD only**. No PDF bodies downloaded. No S3. No Postgres.

## Finding status

| Finding | Status | Note |
| --- | --- | --- |
| F1 snapshot count | **PARTIAL** | HTTP 200 PDF paths among probed tokens |
| F2 token / family density | **PARTIAL** | Tokens that returned at least one 200; :15/:45 mass-expand skipped |
| F3 T−60 vs `analytics.games.start_time` | **OPEN** | Not joined in this slice. Phase 1B. |

## 1. Control cases

Control anchors **matched** prior observations for the explicit 2025-12-06 and 2026-03-18 tokens.

| Date | Token | Prior expected | Actual | Exists | Bytes | Match |
| --- | --- | --- | --- | --- | ---: | --- |
| 2025-12-06 | `11AM` | 200 | 200 | true | 70271 | yes |
| 2025-12-06 | `05PM` | 200 | 200 | true | 85939 | yes |
| 2026-03-18 | `05PM` | 403 | 403 | false | 1 | yes |
| 2026-03-18 | `05_30PM` | 200 | 200 | true | 88590 | yes |

Control-date successful tokens:
- 2023-10-24: 7 × 200 (05PM, 06PM, 07PM, 08PM, 09PM, 10PM, 11PM)
- 2024-10-22: 16 × 200 (01PM, 02PM, 03PM, 04PM, 05PM, 06PM, 07PM, 08AM, 08PM, 09AM, 09PM, 10AM, 10PM, 11AM, 11PM, 12PM)
- 2025-12-06: 16 × 200 (01PM, 02PM, 03PM, 04PM, 05PM, 06PM, 07PM, 08AM, 08PM, 09AM, 09PM, 10AM, 10PM, 11AM, 11PM, 12PM)
- 2026-03-18: 34 × 200 (01_00PM, 01_30PM, 02_00PM, 02_30PM, 03_00PM, 03_30PM, 04_00PM, 04_30PM, 05_00PM, 05_15PM, 05_30PM, 05_45PM, 06_00PM, 06_30PM, 07_00PM, 07_30PM, 08_00AM, 08_00PM, 08_30AM, 08_30PM, 09_00AM, 09_00PM, 09_30AM, 09_30PM, 10_00AM, 10_00PM, 10_30AM, 10_30PM, 11_00AM, 11_00PM, 11_30AM, 11_30PM, 12_00PM, 12_30PM)
- 2026-06-14: 0 × 200 (none)

## 2. How many PDF paths returned HTTP 200?

**14497** URLs classified as existing PDFs (HTTP 200 + PDF/octet-stream Content-Type).

| Result | Count |
| --- | ---: |
| Attempted URLs | 20721 |
| 200 (exists) | 14497 |
| 403 | 6224 |
| 404 | 0 |
| 429 | 0 |
| redirect | 0 |
| 5xx | 0 |
| timeout | 0 |
| network | 0 |
| other | 0 |

403 means the path was not served to this HEAD request. It is **not** “empty report” or “no injuries that day.”

## 3. Successful PDFs by Court Context season

Season labels use the July cutoff in `lib/season.ts` (`calendarSeasonStartYear`: Jan–Jun → previous start year).

| Season | Dates scanned | 200 PDFs | 403 | 404 | Other | First 200 date | Last 200 date |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2023 | 252 | 3626 | 1431 | 0 | 0 | 2023-10-24 | 2024-06-17 |
| 2024 | 365 | 3983 | 2435 | 0 | 0 | 2024-07-07 | 2025-06-22 |
| 2025 | 349 | 6888 | 2358 | 0 | 0 | 2025-07-04 | 2026-06-13 |

## 4. Tokens that returned at least one 200

| Token | Family | n200 | First date | Last date | % of dates that had any report |
| --- | --- | ---: | --- | --- | ---: |
| `08AM` | hourly | 557 | 2023-10-25 | 2025-12-22 | 77.1 |
| `05PM` | hourly | 556 | 2023-10-24 | 2025-12-21 | 77 |
| `07PM` | hourly | 556 | 2023-10-24 | 2025-12-21 | 77 |
| `08PM` | hourly | 556 | 2023-10-24 | 2025-12-21 | 77 |
| `09PM` | hourly | 556 | 2023-10-24 | 2025-12-21 | 77 |
| `10PM` | hourly | 556 | 2023-10-24 | 2025-12-21 | 77 |
| `11PM` | hourly | 556 | 2023-10-24 | 2025-12-21 | 77 |
| `09AM` | hourly | 556 | 2023-10-25 | 2025-12-21 | 77 |
| `10AM` | hourly | 556 | 2023-10-25 | 2025-12-21 | 77 |
| `06PM` | hourly | 555 | 2023-10-24 | 2025-12-21 | 76.9 |
| `01PM` | hourly | 555 | 2023-10-25 | 2025-12-21 | 76.9 |
| `02PM` | hourly | 555 | 2023-10-25 | 2025-12-21 | 76.9 |
| `03PM` | hourly | 555 | 2023-10-25 | 2025-12-21 | 76.9 |
| `04PM` | hourly | 555 | 2023-10-25 | 2025-12-21 | 76.9 |
| `11AM` | hourly | 555 | 2023-10-25 | 2025-12-21 | 76.9 |
| `12PM` | hourly | 555 | 2023-10-25 | 2025-12-21 | 76.9 |
| `01_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `02_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `02_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `03_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `03_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `04_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `04_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `05_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `05_15PM` | quarter | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `05_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `05_45PM` | quarter | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `06_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `06_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `07_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `07_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `08_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `08_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `09_00AM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `09_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `09_30AM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `09_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `10_00AM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `10_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `10_30AM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `10_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `11_00AM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `11_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `11_30AM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `11_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `12_00PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `12_30PM` | minute | 165 | 2025-12-22 | 2026-06-13 | 22.9 |
| `01_00PM` | minute | 164 | 2025-12-22 | 2026-06-13 | 22.7 |
| `08_00AM` | minute | 164 | 2025-12-23 | 2026-06-13 | 22.7 |
| `08_30AM` | minute | 164 | 2025-12-23 | 2026-06-13 | 22.7 |

## 5. Filename-family transition

- Last successful **hourly** token date: **2025-12-22**
- First successful **minute** token date: **2025-12-22**
- Overlap dates (both families 200): **1**
- Overlap list: 2025-12-22

On **2025-12-21** the CDN still served a full **hourly** slate (16 × 200). On **2025-12-22** the only successful hourly token is `08AM`; the rest of that date is the minute-token family (plus `05_15PM` / `05_45PM`). On **2025-12-23** hourly tokens are 403 and the minute family (34 × 200 including the 5PM quarter-hour pair) continues. This is a one-day overlap, not a long dual-family period.

Dates are URL tokens, not PDF-title publication timestamps. PDFs were not downloaded.

### Quarter-hour probe (`:15` / `:45`)

Attempted 338 URLs; **330** returned 200.
Probed `05_15PM` / `05_45PM` on minute-family dates only. Mass `:15`/`:45` search across all hours was **not** expanded.

## 6. Snapshots per active day

- Dates scanned: 966
- Dates with zero successful reports: 244
- Dates with exactly one: 0
- Dates with multiple: 722
- Max reports on one date: 34
- Median reports among dates with ≥1: 16

## 7. How late in the day do successful paths appear?

These are **URL tokens**, not PDF title clocks. Title timestamps were not read (no body download).

Latest successful token counts (among dates with ≥1 report):

- `11PM`: 556
- `11_30PM`: 165
- `10AM`: 1 (2024-02-16 only; 08AM/09AM/10AM — All-Star Friday, not a typical slate)

Almost every date with any report also has a late-evening snapshot path (`11PM` in the hourly era, `11_30PM` after the filename change). That is **not** a T−60 coverage claim.

## 8. Suspicious gaps

Zero-success dates include offseasons, All-Star, and days the CDN returned only 403 for probed tokens. 403 is not proof a report never existed under an unprobed token.

Oct–Jun dates with zero successful probed PDFs: **93**.
Longest Oct–Jun zero-success streaks (≥3 consecutive calendar days):

- 2024-10-01 → 2024-10-20 (20 days)
- 2025-10-01 → 2025-10-19 (19 days)
- 2024-06-18 → 2024-06-30 (13 days)
- 2025-06-23 → 2025-06-30 (8 days)
- 2024-05-31 → 2024-06-04 (5 days)
- 2026-02-13 → 2026-02-17 (5 days)
- 2025-02-14 → 2025-02-17 (4 days)
- 2025-06-01 → 2025-06-03 (3 days)

The October streaks sit before each season’s opening-night reports (2024-10-22 and 2025-10-21 in this inventory). February streaks align with All-Star. June streaks sit after the Finals / before July summer-league files (2024-07-07 and 2025-07-04). `2023-10-23` (day before 2023 opening night) also had zero successful probed PDFs.

## 9. Rate limiting / host resistance

No stop condition fired. 429 count is in the HTTP table above.
- Warning: reused prior HEAD control records; did not re-request control URLs
- Warning: 05_15PM/05_45PM returned 200; other :15/:45 hours were not mass-probed, so snapshot count is a lower bound

## 10. Estimated raw archive size

| Metric | Value |
| --- | --- |
| 200s with Content-Length | 14497 |
| 200s missing Content-Length | 0 |
| Min | 53.2 KiB |
| Median | 75.5 KiB |
| Mean | 74.6 KiB |
| P95 | 89.8 KiB |
| Max | 104.4 KiB |
| Sum observed | 1.03 GiB |
| +25% | 1.29 GiB |
| +100% | 2.06 GiB |

HEAD Content-Length only. Files were not downloaded to validate.

## 11. Sane enough for Phase 1B?

**Yes, with F3 still OPEN.** The 200 count is finite and season-shaped. Phase 1B should join these successful tokens to Final `analytics.games.start_time` and T−60. Do not claim 5:30 PM covers every tip.

## 12. Still unknown

- F3: whether the last successful token on a date is before each game’s T−60.
- PDF title timestamps (not downloaded).
- `:15`/`:45` tokens other than `05_15PM`/`05_45PM` (not mass-probed).
- Hours before 08:00 ET.
- Whether 403 on a token means the object is absent vs forbidden.

## Verification

1. No PDF body downloaded (HEAD only; `redirect: manual`).
2. No S3 write.
3. No Postgres write.
4. No schema / migration / BDL injuries Lambda / `/wowy` / model change.
5. Date range exactly 2023-10-23 through 2026-06-14.
6. F3 remains OPEN.
