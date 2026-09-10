# Plays characterization (Step 9D)

Generated: 2026-09-09T17:36:39.018Z

**Step verdict:** GREEN — Plays add substantial unique Court Context value

**Rotation reconstruction:** ROTATIONS_RECONSTRUCTABLE

**Product value:** HIGH_VALUE_FULL_ARCHIVE

Do NOT launch a full Plays archive. Do NOT start 2022.

Machine-readable: `reports/trial/plays-characterization.json`

## Safety State
{
  "trialMode": true,
  "delayMs": 13000,
  "minDelayMs": 12000,
  "concurrency": 1,
  "lockActiveBefore": false,
  "lockHeldByOther": false,
  "dataMode": "replay",
  "offseasonMode": true,
  "cronDryRun": true,
  "frozen": true,
  "currentAnalyticsSeason": "2025",
  "dbBytesBefore": 342846611,
  "dbMb": 326.96,
  "unexpectedServing": [],
  "acquisitionWritesPostgres": false
}

## Existing Implementation Audit
{
  "goatPlaysClientExisted": false,
  "playsTs": false,
  "reused": [
    "BdlArchiveClient",
    "trial-limiter",
    "acquisition-lock",
    "archiveJsonObjectToS3",
    "lineups-2025 starters"
  ],
  "openapiPath": "/nba/v1/plays",
  "docsCurlPath": "/v1/plays",
  "primaryPath": "/nba/v1/plays",
  "fallbackPath": "/v1/plays",
  "note": "No existing Plays client or possession model. Minimal characterization using archive client."
}

## Sample Selection
[
  {
    "gameId": "18447938",
    "date": "2026-04-03",
    "matchup": "IND @ CHA",
    "phase": "regular_season_normal",
    "reasonSelected": "Typical regulation RS game (margin>=10, not OT)",
    "traits": [
      "normal_rs"
    ],
    "postseason": false,
    "homeScore": 129,
    "awayScore": 108,
    "margin": 21,
    "period": 4,
    "hasProps": true,
    "injuryOutN": 7,
    "maxMin": null,
    "homeTeamId": "4",
    "awayTeamId": "12",
    "homeAbbr": "CHA",
    "awayAbbr": "IND",
    "startTime": "2026-04-03T23:00:00.000Z"
  },
  {
    "gameId": "18447939",
    "date": "2026-04-03",
    "matchup": "MIN @ PHI",
    "phase": "regular_season_normal",
    "reasonSelected": "Second typical regulation RS game",
    "traits": [
      "normal_rs"
    ],
    "postseason": false,
    "homeScore": 115,
    "awayScore": 103,
    "margin": 12,
    "period": 4,
    "hasProps": true,
    "injuryOutN": 2,
    "maxMin": null,
    "homeTeamId": "23",
    "awayTeamId": "18",
    "homeAbbr": "PHI",
    "awayAbbr": "MIN",
    "startTime": "2026-04-03T23:00:00.000Z"
  },
  {
    "gameId": "18446819",
    "date": "2025-10-21",
    "matchup": "HOU @ OKC",
    "phase": "overtime",
    "reasonSelected": "OT sample period=6 max_min=n/a",
    "traits": [
      "overtime"
    ],
    "postseason": false,
    "homeScore": 125,
    "awayScore": 124,
    "margin": 1,
    "period": 6,
    "hasProps": false,
    "injuryOutN": 0,
    "maxMin": null,
    "homeTeamId": "21",
    "awayTeamId": "11",
    "homeAbbr": "OKC",
    "awayAbbr": "HOU",
    "startTime": "2025-10-21T23:30:00.000Z"
  },
  {
    "gameId": "18446826",
    "date": "2025-10-22",
    "matchup": "PHI @ BOS",
    "phase": "close",
    "reasonSelected": "Final margin <=5",
    "traits": [
      "close"
    ],
    "postseason": false,
    "homeScore": 116,
    "awayScore": 117,
    "margin": 1,
    "period": 4,
    "hasProps": false,
    "injuryOutN": 0,
    "maxMin": null,
    "homeTeamId": "2",
    "awayTeamId": "23",
    "homeAbbr": "BOS",
    "awayAbbr": "PHI",
    "startTime": "2025-10-22T23:30:00.000Z"
  },
  {
    "gameId": "18446845",
    "date": "2025-10-24",
    "matchup": "UTA @ SAC",
    "phase": "close",
    "reasonSelected": "Second close game, margin <=5",
    "traits": [
      "close"
    ],
    "postseason": false,
    "homeScore": 105,
    "awayScore": 104,
    "margin": 1,
    "period": 4,
    "hasProps": false,
    "injuryOutN": 0,
    "maxMin": null,
    "homeTeamId": "26",
    "awayTeamId": "29",
    "homeAbbr": "SAC",
    "awayAbbr": "UTA",
    "startTime": "2025-10-25T02:00:00.000Z"
  },
  {
    "gameId": "18447205",
    "date": "2025-12-21",
    "matchup": "CHI @ ATL",
    "phase": "high_scoring",
    "reasonSelected": "High combined score 150-152",
    "traits": [
      "high_event"
    ],
    "postseason": false,
    "homeScore": 150,
    "awayScore": 152,
    "margin": 2,
    "period": 4,
    "hasProps": false,
    "injuryOutN": 0,
    "maxMin": null,
    "homeTeamId": "1",
    "awayTeamId": "5",
    "homeAbbr": "ATL",
    "awayAbbr": "CHI",
    "startTime": "2025-12-21T20:30:00.000Z"
  },
  {
    "gameId": "18447951",
    "date": "2026-04-05",
    "matchup": "WAS @ BKN",
    "phase": "injury_replacement",
    "reasonSelected": "Local Out snapshots near tip=21; overlap with lineup archive",
    "traits": [
      "injury",
      "lineup"
    ],
    "postseason": false,
    "homeScore": 121,
    "awayScore": 115,
    "margin": 6,
    "period": 4,
    "hasProps": true,
    "injuryOutN": 21,
    "maxMin": null,
    "homeTeamId": "3",
    "awayTeamId": "30",
    "homeAbbr": "BKN",
    "awayAbbr": "WAS",
    "startTime": "2026-04-05T19:30:00.000Z"
  },
  {
    "gameId": "18447934",
    "date": "2026-04-02",
    "matchup": "LAL @ OKC",
    "phase": "prop_research",
    "reasonSelected": "Overlaps research.prop_decision_lines",
    "traits": [
      "props"
    ],
    "postseason": false,
    "homeScore": 139,
    "awayScore": 96,
    "margin": 43,
    "period": 4,
    "hasProps": true,
    "injuryOutN": 1,
    "maxMin": null,
    "homeTeamId": "21",
    "awayTeamId": "14",
    "homeAbbr": "OKC",
    "awayAbbr": "LAL",
    "startTime": "2026-04-03T01:30:00.000Z"
  },
  {
    "gameId": "21682722",
    "date": "2026-04-24",
    "matchup": "BOS @ PHI",
    "phase": "early_playoffs",
    "reasonSelected": "Early postseason window",
    "traits": [
      "playoffs_early"
    ],
    "postseason": true,
    "homeScore": 100,
    "awayScore": 108,
    "margin": 8,
    "period": 4,
    "hasProps": true,
    "injuryOutN": 1,
    "maxMin": null,
    "homeTeamId": "23",
    "awayTeamId": "2",
    "homeAbbr": "PHI",
    "awayAbbr": "BOS",
    "startTime": "2026-04-24T23:00:00.000Z"
  },
  {
    "gameId": "21713529",
    "date": "2026-05-20",
    "matchup": "SAS @ OKC",
    "phase": "later_postseason",
    "reasonSelected": "Later postseason game",
    "traits": [
      "playoffs_later"
    ],
    "postseason": true,
    "homeScore": 122,
    "awayScore": 113,
    "margin": 9,
    "period": 4,
    "hasProps": false,
    "injuryOutN": 0,
    "maxMin": null,
    "homeTeamId": "21",
    "awayTeamId": "27",
    "homeAbbr": "OKC",
    "awayAbbr": "SAS",
    "startTime": "2026-05-21T00:30:00.000Z"
  }
]

## Acquisition Result
{
  "pathUsed": "/nba/v1/plays",
  "paginationObserved": false,
  "didNotSendPerPage": true,
  "plannedHttp": 10,
  "httpAttempts": 0,
  "httpSuccess": 0,
  "pages": 10,
  "gamesFetched": 10,
  "status429": 0,
  "retries": 0,
  "retryAfterUsed": 0,
  "wallClockMs": 2844,
  "minimumMs": null,
  "averageMs": null,
  "maximumMs": null,
  "stoppedReason": null,
  "perGame": [
    {
      "gameId": "18447938",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 468,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18447939",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 485,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18446819",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 595,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18446826",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 503,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18446845",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 458,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18447205",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 537,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18447951",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 443,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "18447934",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 452,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "21682722",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 444,
      "truncated": false,
      "path": "/nba/v1/plays"
    },
    {
      "gameId": "21713529",
      "reused": true,
      "status": [
        200
      ],
      "pages": 1,
      "rows": 501,
      "truncated": false,
      "path": "/nba/v1/plays"
    }
  ],
  "liveAcquisition": {
    "note": "First execute wrote 10 S3 objects then crashed on a report-only ReferenceError. Certify reused those objects (0 extra BDL HTTP).",
    "httpAttempts": 10,
    "httpSuccess": 10,
    "status429": 0,
    "retries": 0,
    "wallClockMs": 134508,
    "path": "/nba/v1/plays",
    "paginationObserved": false,
    "pagesPerGame": 1
  }
}

## Response Schema
{
  "topLevelUnion": [
    "away_score",
    "clock",
    "coordinate_x",
    "coordinate_y",
    "game_id",
    "home_score",
    "order",
    "participants",
    "period",
    "period_display",
    "score_value",
    "scoring_play",
    "shooting_play",
    "team",
    "team.abbreviation",
    "team.city",
    "team.conference",
    "team.division",
    "team.full_name",
    "team.id",
    "team.name",
    "text",
    "type",
    "wallclock"
  ],
  "documented": [
    "game_id",
    "order",
    "type",
    "text",
    "home_score",
    "away_score",
    "period",
    "period_display",
    "clock",
    "scoring_play",
    "shooting_play",
    "score_value",
    "team",
    "coordinate_x",
    "coordinate_y",
    "wallclock",
    "participants"
  ],
  "additional": []
}

## Event Grain
{
  "likely": "(game_id, order)",
  "games": [
    {
      "gameId": "18447938",
      "events": 468,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 468
    },
    {
      "gameId": "18447939",
      "events": 485,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 485
    },
    {
      "gameId": "18446819",
      "events": 595,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 595
    },
    {
      "gameId": "18446826",
      "events": 503,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 503
    },
    {
      "gameId": "18446845",
      "events": 458,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 458
    },
    {
      "gameId": "18447205",
      "events": 537,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 537
    },
    {
      "gameId": "18447951",
      "events": 443,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 443
    },
    {
      "gameId": "18447934",
      "events": 452,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 452
    },
    {
      "gameId": "21682722",
      "events": 444,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 444
    },
    {
      "gameId": "21713529",
      "events": 501,
      "duplicateOrders": 0,
      "missingOrderValues": 0,
      "nullGameIds": 0,
      "orderUnique": true,
      "orderChronological": true,
      "firstOrder": 1,
      "lastOrder": 501
    }
  ]
}

## Event-Type Inventory
{
  "distinctTypes": [
    "Alley Oop Dunk Shot",
    "Alley Oop Layup Shot",
    "Away from Play Foul",
    "Back Court Turnover",
    "Bad Pass\nTurnover",
    "Challenge",
    "Coach's Challenge (Overturned)",
    "Coach's Challenge (Stands)",
    "Coach's Challenge (Supported)",
    "Coach's Challenge (replaycenter)",
    "Cutting Dunk Shot",
    "Cutting Finger Roll Layup Shot",
    "Cutting Layup Shot",
    "Defensive 3-Seconds Technical",
    "Defensive Goaltending",
    "Defensive Rebound",
    "Delay of Game",
    "Double Lane",
    "Driving Dunk Shot",
    "Driving Finger Roll Layup",
    "Driving Floating Bank Jump Shot",
    "Driving Floating Jump Shot",
    "Driving Hook Shot",
    "Driving Jump Shot Bank",
    "Driving Layup Shot",
    "Dunk Shot",
    "End Game",
    "End Period",
    "Fade Away Bank Jump Shot",
    "Fade Away Jump Shot",
    "Finger Roll Layup",
    "Flagrant Foul Type 1",
    "Floating Jump Shot",
    "Flopping Technical",
    "Free Throw - 1 of 1",
    "Free Throw - 1 of 2",
    "Free Throw - 1 of 3",
    "Free Throw - 2 of 2",
    "Free Throw - 2 of 3",
    "Free Throw - 3 of 3",
    "Free Throw - Flagrant 1 of 1",
    "Free Throw - Technical",
    "Full Timeout",
    "Heave Jump Shot",
    "Hook Driving Bank",
    "Hook Shot",
    "Hook Turnaround Bank",
    "Jump Shot",
    "Jump Shot Bank",
    "Jumpball",
    "Kicked Ball",
    "Kicked Ball Turnover",
    "Lane",
    "Layup Driving Reverse",
    "Layup Running Reverse",
    "Layup Shot",
    "Layup Shot Putback",
    "Loose Ball Foul",
    "Lost Ball Turnover",
    "Offensive Charge",
    "Offensive Foul",
    "Offensive Foul Turnover",
    "Offensive Goaltending Turnover",
    "Offensive Rebound",
    "Out of Bounds - Bad Pass Turnover",
    "Out of Bounds - Lost Ball Turnover",
    "Out of Bounds - Step Turnover",
    "Palming Turnover",
    "Personal Foul",
    "Personal Take Foul",
    "Pullup Bank Jump Shot",
    "Pullup Jump Shot",
    "Putback Dunk Shot",
    "Ref-Initiated Review (Overturned)",
    "Ref-Initiated Review (Stands)",
    "Ref-Initiated Review (Supported)",
    "Reverse Layup Shot",
    "Running Alley Oop Dunk Shot",
    "Running Alley Oop Layup Shot",
    "Running Dunk Shot",
    "Running Finger Roll Layup",
    "Running Jump Shot",
    "Running Layup Shot",
    "Running Pullup Jump Shot",
    "Shooting Foul",
    "Shot Clock Turnover",
    "Step Back Bank Jump Shot",
    "Step Back Jump Shot",
    "Substitution",
    "Technical Foul",
    "Tip Dunk Shot",
    "Tip Shot",
    "Traveling",
    "Turnaround Bank Jump Shot",
    "Turnaround Fade Away Jump Shot",
    "Turnaround Fadeaway Bank Jump Shot",
    "Turnaround Hook Shot",
    "Turnaround Jump Shot"
  ],
  "counts": {
    "Defensive Rebound": 682,
    "Substitution": 626,
    "Jump Shot": 578,
    "Offensive Rebound": 368,
    "Pullup Jump Shot": 214,
    "Shooting Foul": 200,
    "Free Throw - 1 of 2": 189,
    "Free Throw - 2 of 2": 188,
    "Driving Layup Shot": 167,
    "Full Timeout": 121,
    "Personal Foul": 112,
    "Bad Pass\nTurnover": 98,
    "Step Back Jump Shot": 93,
    "Driving Floating Jump Shot": 70,
    "Running Layup Shot": 67,
    "Lost Ball Turnover": 61,
    "Running Jump Shot": 55,
    "Free Throw - 1 of 1": 48,
    "Fade Away Jump Shot": 45,
    "End Period": 42,
    "Driving Finger Roll Layup": 42,
    "Loose Ball Foul": 41,
    "Cutting Layup Shot": 38,
    "Offensive Foul Turnover": 36,
    "Out of Bounds - Bad Pass Turnover": 33,
    "Tip Shot": 32,
    "Turnaround Fade Away Jump Shot": 30,
    "Offensive Foul": 30,
    "Turnaround Jump Shot": 29,
    "Running Dunk Shot": 28,
    "Layup Shot Putback": 27,
    "Layup Shot": 27,
    "Running Pullup Jump Shot": 26,
    "Driving Dunk Shot": 25,
    "Jumpball": 25,
    "Floating Jump Shot": 25,
    "Driving Floating Bank Jump Shot": 22,
    "Out of Bounds - Lost Ball Turnover": 20,
    "Cutting Dunk Shot": 19,
    "Layup Driving Reverse": 15,
    "Turnaround Hook Shot": 14,
    "Traveling": 14,
    "Driving Hook Shot": 13,
    "Shot Clock Turnover": 13,
    "Coach's Challenge (Overturned)": 12,
    "Alley Oop Dunk Shot": 11,
    "Running Finger Roll Layup": 11,
    "Tip Dunk Shot": 10,
    "End Game": 10,
    "Personal Take Foul": 10,
    "Kicked Ball": 9,
    "Heave Jump Shot": 8,
    "Dunk Shot": 8,
    "Defensive Goaltending": 8,
    "Running Alley Oop Dunk Shot": 7,
    "Hook Shot": 7,
    "Free Throw - 1 of 3": 7,
    "Free Throw - 2 of 3": 7,
    "Free Throw - 3 of 3": 7,
    "Pullup Bank Jump Shot": 6,
    "Offensive Charge": 6,
    "Free Throw - Technical": 6,
    "Out of Bounds - Step Turnover": 5,
    "Jump Shot Bank": 5,
    "Reverse Layup Shot": 5,
    "Back Court Turnover": 4,
    "Alley Oop Layup Shot": 4,
    "Challenge": 4,
    "Coach's Challenge (replaycenter)": 4,
    "Putback Dunk Shot": 4,
    "Hook Driving Bank": 3,
    "Delay of Game": 3,
    "Running Alley Oop Layup Shot": 3,
    "Finger Roll Layup": 3,
    "Away from Play Foul": 3,
    "Driving Jump Shot Bank": 3,
    "Defensive 3-Seconds Technical": 3,
    "Layup Running Reverse": 3,
    "Ref-Initiated Review (Supported)": 3,
    "Turnaround Fadeaway Bank Jump Shot": 2,
    "Ref-Initiated Review (Overturned)": 2,
    "Fade Away Bank Jump Shot": 2,
    "Technical Foul": 2,
    "Coach's Challenge (Supported)": 2,
    "Double Lane": 2,
    "Coach's Challenge (Stands)": 2,
    "Flagrant Foul Type 1": 1,
    "Free Throw - Flagrant 1 of 1": 1,
    "Hook Turnaround Bank": 1,
    "Ref-Initiated Review (Stands)": 1,
    "Offensive Goaltending Turnover": 1,
    "Palming Turnover": 1,
    "Turnaround Bank Jump Shot": 1,
    "Flopping Technical": 1,
    "Lane": 1,
    "Cutting Finger Roll Layup Shot": 1,
    "Step Back Bank Jump Shot": 1,
    "Kicked Ball Turnover": 1
  },
  "groups": {
    "rebound": [
      "Defensive Rebound",
      "Offensive Rebound"
    ],
    "substitution": [
      "Substitution"
    ],
    "made_shot": [
      "Jump Shot",
      "Step Back Jump Shot",
      "Driving Layup Shot",
      "Running Jump Shot",
      "Pullup Jump Shot",
      "Running Layup Shot",
      "Driving Dunk Shot",
      "Driving Floating Jump Shot",
      "Fade Away Jump Shot",
      "Turnaround Jump Shot",
      "Cutting Layup Shot",
      "Layup Shot Putback",
      "Driving Hook Shot",
      "Turnaround Fade Away Jump Shot",
      "Alley Oop Dunk Shot",
      "Running Pullup Jump Shot",
      "Turnaround Hook Shot",
      "Running Alley Oop Dunk Shot",
      "Running Dunk Shot",
      "Turnaround Fadeaway Bank Jump Shot",
      "Heave Jump Shot",
      "Driving Finger Roll Layup",
      "Layup Driving Reverse",
      "Driving Floating Bank Jump Shot",
      "Hook Driving Bank",
      "Fade Away Bank Jump Shot",
      "Hook Turnaround Bank",
      "Tip Dunk Shot",
      "Hook Shot",
      "Pullup Bank Jump Shot",
      "Dunk Shot",
      "Running Alley Oop Layup Shot",
      "Layup Shot",
      "Finger Roll Layup",
      "Floating Jump Shot",
      "Running Finger Roll Layup",
      "Cutting Dunk Shot",
      "Alley Oop Layup Shot",
      "Jump Shot Bank",
      "Putback Dunk Shot",
      "Reverse Layup Shot",
      "Driving Jump Shot Bank",
      "Turnaround Bank Jump Shot",
      "Cutting Finger Roll Layup Shot",
      "Layup Running Reverse",
      "Step Back Bank Jump Shot"
    ],
    "foul": [
      "Personal Foul",
      "Shooting Foul",
      "Loose Ball Foul",
      "Flagrant Foul Type 1",
      "Technical Foul",
      "Away from Play Foul",
      "Personal Take Foul",
      "Defensive 3-Seconds Technical",
      "Flopping Technical"
    ],
    "free_throw": [
      "Free Throw - 1 of 2",
      "Free Throw - 2 of 2",
      "Free Throw - 1 of 1",
      "Free Throw - Flagrant 1 of 1",
      "Free Throw - 1 of 3",
      "Free Throw - 2 of 3",
      "Free Throw - 3 of 3",
      "Free Throw - Technical"
    ],
    "timeout": [
      "Full Timeout"
    ],
    "other": [
      "Tip Shot",
      "Delay of Game",
      "End Game",
      "Defensive Goaltending",
      "Offensive Charge",
      "Kicked Ball",
      "Double Lane",
      "Lane"
    ],
    "turnover": [
      "Lost Ball Turnover",
      "Bad Pass\nTurnover",
      "Out of Bounds - Lost Ball Turnover",
      "Offensive Foul",
      "Offensive Foul Turnover",
      "Shot Clock Turnover",
      "Back Court Turnover",
      "Out of Bounds - Step Turnover",
      "Out of Bounds - Bad Pass Turnover",
      "Traveling",
      "Offensive Goaltending Turnover",
      "Palming Turnover",
      "Kicked Ball Turnover"
    ],
    "period_boundary": [
      "End Period"
    ],
    "jump_ball": [
      "Jumpball"
    ],
    "review": [
      "Ref-Initiated Review (Overturned)",
      "Coach's Challenge (Overturned)",
      "Challenge",
      "Coach's Challenge (replaycenter)",
      "Ref-Initiated Review (Stands)",
      "Coach's Challenge (Supported)",
      "Ref-Initiated Review (Supported)",
      "Coach's Challenge (Stands)"
    ]
  }
}

## Substitution Semantics
{
  "explicitTypeFound": true,
  "observedTypeNames": [
    "Substitution"
  ],
  "totalSubstitutionEvents": 626,
  "perGame": [
    {
      "gameId": "18447938",
      "n": 70,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 41,
          "type": "Substitution",
          "text": "Obi Toppin enters the game for Jay Huff",
          "period": 1,
          "clock": "7:22",
          "wallclock": "2026-04-03T23:19:34.000Z",
          "teamId": "12",
          "participants": [
            "3547243",
            "17896103"
          ],
          "participantCount": 2
        },
        {
          "order": 42,
          "type": "Substitution",
          "text": "Sion James enters the game for Miles Bridges",
          "period": 1,
          "clock": "7:22",
          "wallclock": "2026-04-03T23:19:34.000Z",
          "teamId": "4",
          "participants": [
            "1057384156",
            "62"
          ],
          "participantCount": 2
        },
        {
          "order": 43,
          "type": "Substitution",
          "text": "Micah Potter enters the game for Pascal Siakam",
          "period": 1,
          "clock": "7:22",
          "wallclock": "2026-04-03T23:19:34.000Z",
          "teamId": "12",
          "participants": [
            "19465584",
            "416"
          ],
          "participantCount": 2
        },
        {
          "order": 44,
          "type": "Substitution",
          "text": "Xavier Tillman enters the game for Ryan Kalkbrenner",
          "period": 1,
          "clock": "7:22",
          "wallclock": "2026-04-03T23:19:54.000Z",
          "teamId": "4",
          "participants": [
            "3547285",
            "1057384362"
          ],
          "participantCount": 2
        },
        {
          "order": 50,
          "type": "Substitution",
          "text": "Ethan Thompson enters the game for Ben Sheppard",
          "period": 1,
          "clock": "6:52",
          "wallclock": "2026-04-03T23:20:59.000Z",
          "teamId": "12",
          "participants": [
            "17896117",
            "56677861"
          ],
          "participantCount": 2
        },
        {
          "order": 51,
          "type": "Substitution",
          "text": "Kam Jones enters the game for Quenton Jackson",
          "period": 1,
          "clock": "6:52",
          "wallclock": "2026-04-03T23:20:59.000Z",
          "teamId": "12",
          "participants": [
            "1057389374",
            "44477085"
          ],
          "participantCount": 2
        },
        {
          "order": 58,
          "type": "Substitution",
          "text": "Josh Green enters the game for Brandon Miller",
          "period": 1,
          "clock": "6:21",
          "wallclock": "2026-04-03T23:22:20.000Z",
          "teamId": "4",
          "participants": [
            "3547258",
            "56677823"
          ],
          "participantCount": 2
        },
        {
          "order": 59,
          "type": "Substitution",
          "text": "Taelon Peter enters the game for Kobe Brown",
          "period": 1,
          "clock": "6:21",
          "wallclock": "2026-04-03T23:22:20.000Z",
          "teamId": "12",
          "participants": [
            "1057395638",
            "56677849"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18447939",
      "n": 46,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 60,
          "type": "Substitution",
          "text": "Naz Reid enters the game for Julius Randle",
          "period": 1,
          "clock": "6:00",
          "wallclock": "2026-04-03T23:23:50.000Z",
          "teamId": "18",
          "participants": [
            "667378",
            "387"
          ],
          "participantCount": 2
        },
        {
          "order": 61,
          "type": "Substitution",
          "text": "Bones Hyland enters the game for Donte DiVincenzo",
          "period": 1,
          "clock": "6:00",
          "wallclock": "2026-04-03T23:23:50.000Z",
          "teamId": "18",
          "participants": [
            "17896031",
            "131"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Kelly Oubre Jr. enters the game for Paul George",
          "period": 1,
          "clock": "4:58",
          "wallclock": "2026-04-03T23:25:47.000Z",
          "teamId": "23",
          "participants": [
            "360",
            "172"
          ],
          "participantCount": 2
        },
        {
          "order": 71,
          "type": "Substitution",
          "text": "Quentin Grimes enters the game for VJ Edgecombe",
          "period": 1,
          "clock": "4:58",
          "wallclock": "2026-04-03T23:25:47.000Z",
          "teamId": "23",
          "participants": [
            "17895858",
            "1057261935"
          ],
          "participantCount": 2
        },
        {
          "order": 84,
          "type": "Substitution",
          "text": "Kyle Anderson enters the game for Ayo Dosunmu",
          "period": 1,
          "clock": "3:50",
          "wallclock": "2026-04-03T23:27:55.000Z",
          "teamId": "18",
          "participants": [
            "12",
            "17895983"
          ],
          "participantCount": 2
        },
        {
          "order": 94,
          "type": "Substitution",
          "text": "Julius Randle enters the game for Rudy Gobert",
          "period": 1,
          "clock": "3:02",
          "wallclock": "2026-04-03T23:31:18.000Z",
          "teamId": "18",
          "participants": [
            "387",
            "176"
          ],
          "participantCount": 2
        },
        {
          "order": 95,
          "type": "Substitution",
          "text": "Donte DiVincenzo enters the game for Anthony Edwards",
          "period": 1,
          "clock": "3:02",
          "wallclock": "2026-04-03T23:31:18.000Z",
          "teamId": "18",
          "participants": [
            "131",
            "3547238"
          ],
          "participantCount": 2
        },
        {
          "order": 96,
          "type": "Substitution",
          "text": "Adem Bona enters the game for Joel Embiid",
          "period": 1,
          "clock": "3:02",
          "wallclock": "2026-04-03T23:31:44.000Z",
          "teamId": "23",
          "participants": [
            "1028034846",
            "145"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18446819",
      "n": 84,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 46,
          "type": "Substitution",
          "text": "Tari Eason enters the game for Jabari Smith Jr.",
          "period": 1,
          "clock": "6:40",
          "wallclock": "2025-10-21T23:55:49.000Z",
          "teamId": "11",
          "participants": [
            "38017695",
            "38017684"
          ],
          "participantCount": 2
        },
        {
          "order": 54,
          "type": "Substitution",
          "text": "Jaylin Williams enters the game for Isaiah Hartenstein",
          "period": 1,
          "clock": "6:15",
          "wallclock": "2025-10-21T23:57:28.000Z",
          "teamId": "21",
          "participants": [
            "38017706",
            "201"
          ],
          "participantCount": 2
        },
        {
          "order": 59,
          "type": "Substitution",
          "text": "Reed Sheppard enters the game for Alperen Sengun",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-10-21T23:58:41.000Z",
          "teamId": "11",
          "participants": [
            "1028028519",
            "17896062"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Clint Capela enters the game for Steven Adams",
          "period": 1,
          "clock": "4:08",
          "wallclock": "2025-10-22T00:04:15.000Z",
          "teamId": "11",
          "participants": [
            "83",
            "3"
          ],
          "participantCount": 2
        },
        {
          "order": 72,
          "type": "Substitution",
          "text": "Aaron Wiggins enters the game for Cason Wallace",
          "period": 1,
          "clock": "4:03",
          "wallclock": "2025-10-22T00:05:12.000Z",
          "teamId": "21",
          "participants": [
            "17896078",
            "56677833"
          ],
          "participantCount": 2
        },
        {
          "order": 84,
          "type": "Substitution",
          "text": "Alperen Sengun enters the game for Amen Thompson",
          "period": 1,
          "clock": "3:26",
          "wallclock": "2025-10-22T00:09:26.000Z",
          "teamId": "11",
          "participants": [
            "17896062",
            "56677825"
          ],
          "participantCount": 2
        },
        {
          "order": 85,
          "type": "Substitution",
          "text": "Alex Caruso enters the game for Chet Holmgren",
          "period": 1,
          "clock": "3:26",
          "wallclock": "2025-10-22T00:09:26.000Z",
          "teamId": "21",
          "participants": [
            "89",
            "38017685"
          ],
          "participantCount": 2
        },
        {
          "order": 90,
          "type": "Substitution",
          "text": "Brooks Barnhizer enters the game for Luguentz Dort",
          "period": 1,
          "clock": "2:21",
          "wallclock": "2025-10-22T00:10:54.000Z",
          "teamId": "21",
          "participants": [
            "1057392335",
            "666541"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18446826",
      "n": 62,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 25,
          "type": "Substitution",
          "text": "Xavier Tillman enters the game for Neemias Queta",
          "period": 1,
          "clock": "9:02",
          "wallclock": "2025-10-22T23:46:20.000Z",
          "teamId": "2",
          "participants": [
            "3547285",
            "17553967"
          ],
          "participantCount": 2
        },
        {
          "order": 46,
          "type": "Substitution",
          "text": "Josh Minott enters the game for Sam Hauser",
          "period": 1,
          "clock": "6:53",
          "wallclock": "2025-10-22T23:51:21.000Z",
          "teamId": "2",
          "participants": [
            "38017715",
            "17896060"
          ],
          "participantCount": 2
        },
        {
          "order": 47,
          "type": "Substitution",
          "text": "Anfernee Simons enters the game for Derrick White",
          "period": 1,
          "clock": "6:53",
          "wallclock": "2025-10-22T23:51:21.000Z",
          "teamId": "2",
          "participants": [
            "419",
            "473"
          ],
          "participantCount": 2
        },
        {
          "order": 48,
          "type": "Substitution",
          "text": "Quentin Grimes enters the game for Joel Embiid",
          "period": 1,
          "clock": "6:53",
          "wallclock": "2025-10-22T23:51:21.000Z",
          "teamId": "23",
          "participants": [
            "17895858",
            "145"
          ],
          "participantCount": 2
        },
        {
          "order": 49,
          "type": "Substitution",
          "text": "Adem Bona enters the game for Kelly Oubre Jr.",
          "period": 1,
          "clock": "6:53",
          "wallclock": "2025-10-22T23:51:21.000Z",
          "teamId": "23",
          "participants": [
            "1028034846",
            "360"
          ],
          "participantCount": 2
        },
        {
          "order": 69,
          "type": "Substitution",
          "text": "Derrick White enters the game for Jaylen Brown",
          "period": 1,
          "clock": "3:14",
          "wallclock": "2025-10-22T23:56:24.000Z",
          "teamId": "2",
          "participants": [
            "473",
            "70"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Kelly Oubre Jr. enters the game for Dominick Barlow",
          "period": 1,
          "clock": "3:14",
          "wallclock": "2025-10-22T23:56:24.000Z",
          "teamId": "23",
          "participants": [
            "360",
            "38017730"
          ],
          "participantCount": 2
        },
        {
          "order": 71,
          "type": "Substitution",
          "text": "Jabari Walker enters the game for Tyrese Maxey",
          "period": 1,
          "clock": "3:14",
          "wallclock": "2025-10-22T23:56:24.000Z",
          "teamId": "23",
          "participants": [
            "38017711",
            "3547254"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18446845",
      "n": 65,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 24,
          "type": "Substitution",
          "text": "Dario Saric enters the game for Isaac Jones",
          "period": 1,
          "clock": "8:51",
          "wallclock": "2025-10-25T02:16:12.000Z",
          "teamId": "26",
          "participants": [
            "407",
            "1028205331"
          ],
          "participantCount": 2
        },
        {
          "order": 50,
          "type": "Substitution",
          "text": "Ace Bailey enters the game for Kyle Filipowski",
          "period": 1,
          "clock": "5:49",
          "wallclock": "2025-10-25T02:23:51.000Z",
          "teamId": "29",
          "participants": [
            "1057260888",
            "1028035794"
          ],
          "participantCount": 2
        },
        {
          "order": 51,
          "type": "Substitution",
          "text": "Brice Sensabaugh enters the game for Svi Mykhailiuk",
          "period": 1,
          "clock": "5:49",
          "wallclock": "2025-10-25T02:23:51.000Z",
          "teamId": "29",
          "participants": [
            "56677842",
            "338"
          ],
          "participantCount": 2
        },
        {
          "order": 52,
          "type": "Substitution",
          "text": "Drew Eubanks enters the game for Domantas Sabonis",
          "period": 1,
          "clock": "5:49",
          "wallclock": "2025-10-25T02:23:51.000Z",
          "teamId": "26",
          "participants": [
            "147",
            "406"
          ],
          "participantCount": 2
        },
        {
          "order": 53,
          "type": "Substitution",
          "text": "Malik Monk enters the game for DeMar DeRozan",
          "period": 1,
          "clock": "5:49",
          "wallclock": "2025-10-25T02:23:51.000Z",
          "teamId": "26",
          "participants": [
            "324",
            "125"
          ],
          "participantCount": 2
        },
        {
          "order": 56,
          "type": "Substitution",
          "text": "Taylor Hendricks enters the game for Lauri Markkanen",
          "period": 1,
          "clock": "5:36",
          "wallclock": "2025-10-25T02:24:36.000Z",
          "teamId": "29",
          "participants": [
            "56677824",
            "297"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Russell Westbrook enters the game for Dennis Schroder",
          "period": 1,
          "clock": "4:04",
          "wallclock": "2025-10-25T02:26:18.000Z",
          "teamId": "26",
          "participants": [
            "472",
            "409"
          ],
          "participantCount": 2
        },
        {
          "order": 71,
          "type": "Substitution",
          "text": "Jusuf Nurkic enters the game for Walker Kessler",
          "period": 1,
          "clock": "4:04",
          "wallclock": "2025-10-25T02:26:18.000Z",
          "teamId": "29",
          "participants": [
            "349",
            "38017705"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18447205",
      "n": 79,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 46,
          "type": "Substitution",
          "text": "Ayo Dosunmu enters the game for Josh Giddey",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "5",
          "participants": [
            "17895983",
            "17896065"
          ],
          "participantCount": 2
        },
        {
          "order": 47,
          "type": "Substitution",
          "text": "Kevin Huerter enters the game for Nikola Vucevic",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "5",
          "participants": [
            "221",
            "460"
          ],
          "participantCount": 2
        },
        {
          "order": 48,
          "type": "Substitution",
          "text": "Zach Collins enters the game for Coby White",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "5",
          "participants": [
            "102",
            "666956"
          ],
          "participantCount": 2
        },
        {
          "order": 49,
          "type": "Substitution",
          "text": "Nickeil Alexander-Walker enters the game for Zaccharie Risacher",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "1",
          "participants": [
            "666400",
            "1028028244"
          ],
          "participantCount": 2
        },
        {
          "order": 50,
          "type": "Substitution",
          "text": "Mouhamed Gueye enters the game for Onyeka Okongwu",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "1",
          "participants": [
            "56677806",
            "3547244"
          ],
          "participantCount": 2
        },
        {
          "order": 51,
          "type": "Substitution",
          "text": "Tre Jones enters the game for Matas Buzelis",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "5",
          "participants": [
            "3547274",
            "1028025177"
          ],
          "participantCount": 2
        },
        {
          "order": 52,
          "type": "Substitution",
          "text": "Vit Krejci enters the game for Trae Young",
          "period": 1,
          "clock": "5:31",
          "wallclock": "2025-12-21T20:51:25.000Z",
          "teamId": "1",
          "participants": [
            "4197387",
            "490"
          ],
          "participantCount": 2
        },
        {
          "order": 57,
          "type": "Substitution",
          "text": "Patrick Williams enters the game for Isaac Okoro",
          "period": 1,
          "clock": "5:09",
          "wallclock": "2025-12-21T20:52:34.000Z",
          "teamId": "5",
          "participants": [
            "3547248",
            "3547247"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18447951",
      "n": 38,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 33,
          "type": "Substitution",
          "text": "Will Riley enters the game for Bub Carrington",
          "period": 1,
          "clock": "8:18",
          "wallclock": "2026-04-05T19:47:31.000Z",
          "teamId": "30",
          "participants": [
            "1057279594",
            "1028025235"
          ],
          "participantCount": 2
        },
        {
          "order": 58,
          "type": "Substitution",
          "text": "Trevon Scott enters the game for Nolan Traore",
          "period": 1,
          "clock": "4:58",
          "wallclock": "2026-04-05T19:55:34.000Z",
          "teamId": "3",
          "participants": [
            "24102396",
            "1057275262"
          ],
          "participantCount": 2
        },
        {
          "order": 59,
          "type": "Substitution",
          "text": "Tyson Etienne enters the game for Chaney Johnson",
          "period": 1,
          "clock": "4:58",
          "wallclock": "2026-04-05T19:55:34.000Z",
          "teamId": "3",
          "participants": [
            "1043947937",
            "1057846840"
          ],
          "participantCount": 2
        },
        {
          "order": 67,
          "type": "Substitution",
          "text": "Malachi Smith enters the game for Jalen Wilson",
          "period": 1,
          "clock": "4:05",
          "wallclock": "2026-04-05T19:57:10.000Z",
          "teamId": "3",
          "participants": [
            "1059753274",
            "56677722"
          ],
          "participantCount": 2
        },
        {
          "order": 69,
          "type": "Substitution",
          "text": "Ochai Agbaji enters the game for Drake Powell",
          "period": 1,
          "clock": "4:05",
          "wallclock": "2026-04-05T19:57:10.000Z",
          "teamId": "3",
          "participants": [
            "38017620",
            "1057279425"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Josh Minott enters the game for E.J. Liddell",
          "period": 1,
          "clock": "4:05",
          "wallclock": "2026-04-05T19:57:10.000Z",
          "teamId": "3",
          "participants": [
            "38017715",
            "38017663"
          ],
          "participantCount": 2
        },
        {
          "order": 136,
          "type": "Substitution",
          "text": "Bub Carrington enters the game for Anthony Gill",
          "period": 2,
          "clock": "8:18",
          "wallclock": "2026-04-05T20:16:23.000Z",
          "teamId": "30",
          "participants": [
            "1028025235",
            "3547302"
          ],
          "participantCount": 2
        },
        {
          "order": 149,
          "type": "Substitution",
          "text": "Jalen Wilson enters the game for Ochai Agbaji",
          "period": 2,
          "clock": "6:37",
          "wallclock": "2026-04-05T20:19:55.000Z",
          "teamId": "3",
          "participants": [
            "56677722",
            "38017620"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "18447934",
      "n": 49,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 47,
          "type": "Substitution",
          "text": "Rui Hachimura enters the game for Jake LaRavia",
          "period": 1,
          "clock": "6:37",
          "wallclock": "2026-04-03T01:54:54.000Z",
          "teamId": "14",
          "participants": [
            "666609",
            "38017728"
          ],
          "participantCount": 2
        },
        {
          "order": 63,
          "type": "Substitution",
          "text": "Luke Kennard enters the game for Deandre Ayton",
          "period": 1,
          "clock": "4:48",
          "wallclock": "2026-04-03T02:00:29.000Z",
          "teamId": "14",
          "participants": [
            "254",
            "22"
          ],
          "participantCount": 2
        },
        {
          "order": 64,
          "type": "Substitution",
          "text": "Cason Wallace enters the game for Chet Holmgren",
          "period": 1,
          "clock": "4:48",
          "wallclock": "2026-04-03T02:00:29.000Z",
          "teamId": "21",
          "participants": [
            "56677833",
            "38017685"
          ],
          "participantCount": 2
        },
        {
          "order": 65,
          "type": "Substitution",
          "text": "Jaxson Hayes enters the game for LeBron James",
          "period": 1,
          "clock": "4:48",
          "wallclock": "2026-04-03T02:00:29.000Z",
          "teamId": "14",
          "participants": [
            "666626",
            "237"
          ],
          "participantCount": 2
        },
        {
          "order": 66,
          "type": "Substitution",
          "text": "Jaylin Williams enters the game for Jalen Williams",
          "period": 1,
          "clock": "4:48",
          "wallclock": "2026-04-03T02:00:29.000Z",
          "teamId": "21",
          "participants": [
            "38017706",
            "38017703"
          ],
          "participantCount": 2
        },
        {
          "order": 67,
          "type": "Substitution",
          "text": "Isaiah Joe enters the game for Isaiah Hartenstein",
          "period": 1,
          "clock": "4:48",
          "wallclock": "2026-04-03T02:00:29.000Z",
          "teamId": "21",
          "participants": [
            "3547272",
            "201"
          ],
          "participantCount": 2
        },
        {
          "order": 80,
          "type": "Substitution",
          "text": "Ajay Mitchell enters the game for Luguentz Dort",
          "period": 1,
          "clock": "2:25",
          "wallclock": "2026-04-03T02:03:56.000Z",
          "teamId": "21",
          "participants": [
            "1028037477",
            "666541"
          ],
          "participantCount": 2
        },
        {
          "order": 81,
          "type": "Substitution",
          "text": "LeBron James enters the game for Austin Reaves",
          "period": 1,
          "clock": "2:25",
          "wallclock": "2026-04-03T02:03:56.000Z",
          "teamId": "14",
          "participants": [
            "237",
            "17553995"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "21682722",
      "n": 46,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 39,
          "type": "Substitution",
          "text": "Nikola Vucevic enters the game for Neemias Queta",
          "period": 1,
          "clock": "8:09",
          "wallclock": "2026-04-24T23:19:48.000Z",
          "teamId": "2",
          "participants": [
            "460",
            "17553967"
          ],
          "participantCount": 2
        },
        {
          "order": 50,
          "type": "Substitution",
          "text": "Jordan Walsh enters the game for Sam Hauser",
          "period": 1,
          "clock": "7:18",
          "wallclock": "2026-04-24T23:24:04.000Z",
          "teamId": "2",
          "participants": [
            "56677864",
            "17896060"
          ],
          "participantCount": 2
        },
        {
          "order": 51,
          "type": "Substitution",
          "text": "Payton Pritchard enters the game for Derrick White",
          "period": 1,
          "clock": "7:18",
          "wallclock": "2026-04-24T23:24:04.000Z",
          "teamId": "2",
          "participants": [
            "3547276",
            "473"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Andre Drummond enters the game for Adem Bona",
          "period": 1,
          "clock": "4:48",
          "wallclock": "2026-04-24T23:27:50.000Z",
          "teamId": "23",
          "participants": [
            "137",
            "1028034846"
          ],
          "participantCount": 2
        },
        {
          "order": 79,
          "type": "Substitution",
          "text": "Quentin Grimes enters the game for VJ Edgecombe",
          "period": 1,
          "clock": "3:46",
          "wallclock": "2026-04-24T23:29:15.000Z",
          "teamId": "23",
          "participants": [
            "17895858",
            "1057261935"
          ],
          "participantCount": 2
        },
        {
          "order": 86,
          "type": "Substitution",
          "text": "Justin Edwards enters the game for Paul George",
          "period": 1,
          "clock": "3:08",
          "wallclock": "2026-04-24T23:34:05.000Z",
          "teamId": "23",
          "participants": [
            "1028214238",
            "172"
          ],
          "participantCount": 2
        },
        {
          "order": 104,
          "type": "Substitution",
          "text": "Derrick White enters the game for Jordan Walsh",
          "period": 1,
          "clock": "47.8",
          "wallclock": "2026-04-24T23:38:06.000Z",
          "teamId": "2",
          "participants": [
            "473",
            "56677864"
          ],
          "participantCount": 2
        },
        {
          "order": 110,
          "type": "Substitution",
          "text": "Jordan Walsh enters the game for Jayson Tatum",
          "period": 1,
          "clock": "28.2",
          "wallclock": "2026-04-24T23:39:41.000Z",
          "teamId": "2",
          "participants": [
            "56677864",
            "434"
          ],
          "participantCount": 2
        }
      ]
    },
    {
      "gameId": "21713529",
      "n": 87,
      "types": [
        "Substitution"
      ],
      "sample": [
        {
          "order": 36,
          "type": "Substitution",
          "text": "Luke Kornet enters the game for Victor Wembanyama",
          "period": 1,
          "clock": "7:11",
          "wallclock": "2026-05-21T00:49:02.000Z",
          "teamId": "27",
          "participants": [
            "261",
            "56677822"
          ],
          "participantCount": 2
        },
        {
          "order": 37,
          "type": "Substitution",
          "text": "Keldon Johnson enters the game for Julian Champagnie",
          "period": 1,
          "clock": "7:11",
          "wallclock": "2026-05-21T00:49:02.000Z",
          "teamId": "27",
          "participants": [
            "666682",
            "38017649"
          ],
          "participantCount": 2
        },
        {
          "order": 38,
          "type": "Substitution",
          "text": "Alex Caruso enters the game for Chet Holmgren",
          "period": 1,
          "clock": "7:11",
          "wallclock": "2026-05-21T00:49:02.000Z",
          "teamId": "21",
          "participants": [
            "89",
            "38017685"
          ],
          "participantCount": 2
        },
        {
          "order": 39,
          "type": "Substitution",
          "text": "Jaylin Williams enters the game for Isaiah Hartenstein",
          "period": 1,
          "clock": "7:11",
          "wallclock": "2026-05-21T00:49:13.000Z",
          "teamId": "21",
          "participants": [
            "38017706",
            "201"
          ],
          "participantCount": 2
        },
        {
          "order": 51,
          "type": "Substitution",
          "text": "Ajay Mitchell enters the game for Shai Gilgeous-Alexander",
          "period": 1,
          "clock": "6:13",
          "wallclock": "2026-05-21T00:51:18.000Z",
          "teamId": "21",
          "participants": [
            "1028037477",
            "175"
          ],
          "participantCount": 2
        },
        {
          "order": 52,
          "type": "Substitution",
          "text": "Carter Bryant enters the game for Dylan Harper",
          "period": 1,
          "clock": "6:13",
          "wallclock": "2026-05-21T00:51:18.000Z",
          "teamId": "27",
          "participants": [
            "1057271360",
            "1057262518"
          ],
          "participantCount": 2
        },
        {
          "order": 53,
          "type": "Substitution",
          "text": "Jared McCain enters the game for Jalen Williams",
          "period": 1,
          "clock": "6:13",
          "wallclock": "2026-05-21T00:51:31.000Z",
          "teamId": "21",
          "participants": [
            "1028027372",
            "38017703"
          ],
          "participantCount": 2
        },
        {
          "order": 70,
          "type": "Substitution",
          "text": "Dylan Harper enters the game for Devin Vassell",
          "period": 1,
          "clock": "3:47",
          "wallclock": "2026-05-21T00:55:03.000Z",
          "teamId": "27",
          "participants": [
            "1057262518",
            "3547246"
          ],
          "participantCount": 2
        }
      ]
    }
  ],
  "note": "Substitution-like events found. In/out inferred from participants vs opening on-court set; no name parsing."
}

## Rotation Reconstruction Test
[
  {
    "gameId": "18447938",
    "substitutions": 70,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18447939",
    "substitutions": 46,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18446819",
    "substitutions": 84,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18446826",
    "substitutions": 62,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18446845",
    "substitutions": 65,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18447205",
    "substitutions": 79,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18447951",
    "substitutions": 38,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "18447934",
    "substitutions": 49,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "21682722",
    "substitutions": 46,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  },
  {
    "gameId": "21713529",
    "substitutions": 87,
    "homeEnd": 5,
    "awayEnd": 5,
    "ok": true,
    "firstFailure": null,
    "failureCount": 0,
    "failures": []
  }
]

## Participant Identity / Semantics
{
  "uniqueIds": 155,
  "mapped": 155,
  "unmapped": 0,
  "sampleIds": [
    "17896103",
    "1057384362",
    "416",
    "62",
    "44477085",
    "56677861",
    "56677823",
    "1057263194",
    "3547239",
    "56677849",
    "3547243",
    "1057384156",
    "19465584",
    "3547285",
    "17896117",
    "1057389374",
    "3547258",
    "1057395638",
    "666956",
    "105"
  ],
  "semantics": "participants is an array of integer player IDs. Role (shooter/assister/in/out) is not labeled; must be inferred from type/text/on-court state."
}

## Team Identity
[
  {
    "gameId": "18447938",
    "unknownTeams": [],
    "nullTeamEvents": 6
  },
  {
    "gameId": "18447939",
    "unknownTeams": [],
    "nullTeamEvents": 5
  },
  {
    "gameId": "18446819",
    "unknownTeams": [],
    "nullTeamEvents": 9
  },
  {
    "gameId": "18446826",
    "unknownTeams": [],
    "nullTeamEvents": 5
  },
  {
    "gameId": "18446845",
    "unknownTeams": [],
    "nullTeamEvents": 6
  },
  {
    "gameId": "18447205",
    "unknownTeams": [],
    "nullTeamEvents": 5
  },
  {
    "gameId": "18447951",
    "unknownTeams": [],
    "nullTeamEvents": 6
  },
  {
    "gameId": "18447934",
    "unknownTeams": [],
    "nullTeamEvents": 6
  },
  {
    "gameId": "21682722",
    "unknownTeams": [],
    "nullTeamEvents": 8
  },
  {
    "gameId": "21713529",
    "unknownTeams": [],
    "nullTeamEvents": 6
  }
]

## Score Reconciliation
{
  "matched": 10,
  "of": 10,
  "target": "10/10",
  "games": [
    {
      "gameId": "18447938",
      "analytics": {
        "home": 129,
        "away": 108
      },
      "lastEvent": {
        "home": 129,
        "away": 108
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 6
    },
    {
      "gameId": "18447939",
      "analytics": {
        "home": 115,
        "away": 103
      },
      "lastEvent": {
        "home": 115,
        "away": 103
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 5
    },
    {
      "gameId": "18446819",
      "analytics": {
        "home": 125,
        "away": 124
      },
      "lastEvent": {
        "home": 125,
        "away": 124
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 9
    },
    {
      "gameId": "18446826",
      "analytics": {
        "home": 116,
        "away": 117
      },
      "lastEvent": {
        "home": 116,
        "away": 117
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 5
    },
    {
      "gameId": "18446845",
      "analytics": {
        "home": 105,
        "away": 104
      },
      "lastEvent": {
        "home": 105,
        "away": 104
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 6
    },
    {
      "gameId": "18447205",
      "analytics": {
        "home": 150,
        "away": 152
      },
      "lastEvent": {
        "home": 150,
        "away": 152
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 5
    },
    {
      "gameId": "18447951",
      "analytics": {
        "home": 121,
        "away": 115
      },
      "lastEvent": {
        "home": 121,
        "away": 115
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 6
    },
    {
      "gameId": "18447934",
      "analytics": {
        "home": 139,
        "away": 96
      },
      "lastEvent": {
        "home": 139,
        "away": 96
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 6
    },
    {
      "gameId": "21682722",
      "analytics": {
        "home": 100,
        "away": 108
      },
      "lastEvent": {
        "home": 100,
        "away": 108
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 8
    },
    {
      "gameId": "21713529",
      "analytics": {
        "home": 122,
        "away": 113
      },
      "lastEvent": {
        "home": 122,
        "away": 113
      },
      "exactMatch": true,
      "unknownTeams": [],
      "nullTeamEvents": 6
    }
  ]
}

## Period / Clock Integrity
[
  {
    "gameId": "18447938",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "18447939",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "18446819",
    "periods": [
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "nullClock": 0,
    "otExpected": true
  },
  {
    "gameId": "18446826",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "18446845",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "18447205",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "18447951",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "18447934",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "21682722",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  },
  {
    "gameId": "21713529",
    "periods": [
      1,
      2,
      3,
      4
    ],
    "nullClock": 0,
    "otExpected": false
  }
]

## Wallclock Assessment
{
  "populated": 4886,
  "events": 4886,
  "populatedPct": 100,
  "duplicates": 582,
  "reversals": 0,
  "note": "Wallclock is a candidate as-of time, not assumed as true event occurrence without more evidence."
}

## Shot Coordinate Coverage
{
  "shootingPlays": 2263,
  "bothXY": 2263,
  "bothPct": 100,
  "plausibleXY": 1810,
  "sentinelXY": 453,
  "plausiblePct": 80,
  "madeXY": 1213,
  "missXY": 1050,
  "twoXY": 671,
  "threeXY": 746,
  "games": [
    {
      "gameId": "18447938",
      "shooting": 216,
      "bothXY": 216,
      "plausibleXY": 191,
      "sentinelXY": 25,
      "xRangePlausible": [
        1,
        49
      ],
      "yRangePlausible": [
        -2,
        54
      ]
    },
    {
      "gameId": "18447939",
      "shooting": 233,
      "bothXY": 233,
      "plausibleXY": 185,
      "sentinelXY": 48,
      "xRangePlausible": [
        1,
        49
      ],
      "yRangePlausible": [
        0,
        54
      ]
    },
    {
      "gameId": "18446819",
      "shooting": 258,
      "bothXY": 258,
      "plausibleXY": 202,
      "sentinelXY": 56,
      "xRangePlausible": [
        2,
        48
      ],
      "yRangePlausible": [
        -3,
        82
      ]
    },
    {
      "gameId": "18446826",
      "shooting": 232,
      "bothXY": 232,
      "plausibleXY": 176,
      "sentinelXY": 56,
      "xRangePlausible": [
        2,
        48
      ],
      "yRangePlausible": [
        0,
        29
      ]
    },
    {
      "gameId": "18446845",
      "shooting": 202,
      "bothXY": 202,
      "plausibleXY": 170,
      "sentinelXY": 32,
      "xRangePlausible": [
        1,
        49
      ],
      "yRangePlausible": [
        -1,
        40
      ]
    },
    {
      "gameId": "18447205",
      "shooting": 261,
      "bothXY": 261,
      "plausibleXY": 190,
      "sentinelXY": 71,
      "xRangePlausible": [
        1,
        49
      ],
      "yRangePlausible": [
        -2,
        30
      ]
    },
    {
      "gameId": "18447951",
      "shooting": 218,
      "bothXY": 218,
      "plausibleXY": 167,
      "sentinelXY": 51,
      "xRangePlausible": [
        1,
        48
      ],
      "yRangePlausible": [
        -3,
        27
      ]
    },
    {
      "gameId": "18447934",
      "shooting": 223,
      "bothXY": 223,
      "plausibleXY": 183,
      "sentinelXY": 40,
      "xRangePlausible": [
        2,
        49
      ],
      "yRangePlausible": [
        -3,
        74
      ]
    },
    {
      "gameId": "21682722",
      "shooting": 201,
      "bothXY": 201,
      "plausibleXY": 168,
      "sentinelXY": 33,
      "xRangePlausible": [
        0,
        50
      ],
      "yRangePlausible": [
        0,
        30
      ]
    },
    {
      "gameId": "21713529",
      "shooting": 219,
      "bothXY": 219,
      "plausibleXY": 178,
      "sentinelXY": 41,
      "xRangePlausible": [
        1,
        49
      ],
      "yRangePlausible": [
        -4,
        28
      ]
    }
  ],
  "note": "Values with abs(coord) >= 1e6 are treated as sentinels (observed near INT32 min). Court geometry is not interpreted."
}

## Shot-Map Value
{
  "rating": "moderate",
  "vsSeasonAverages": "Season Averages by_zone is season-level. Plays add event-level location only where coordinates are plausible (not sentinels), plus sequence and clutch timing."
}

## Possession Reconstruction Feasibility
POSSESSION_COMPLEX_BUT_POSSIBLE

## WOWY Feasibility
{
  "level": "High feasibility",
  "needs": [
    "in/out roles are unlabeled; reconstruction infers them from the current five",
    "period-boundary on-court checks on held-out games",
    "possession segmentation not built",
    "do not claim WOWY is solved"
  ]
}

## Existing-Data Overlap
{
  "playerGameLogs": "box totals; no event order/clock",
  "teamGameStats": "team totals",
  "advancedStats": "game-grain rates, not event sequence",
  "lineups": "starters vs listed non-starters; not substitution timeline",
  "injuries": "as-of status, not on-court minutes",
  "seasonAverages": "season zone/playtype; not game events",
  "marketArchives": "odds/props; no PBP"
}

## Unique Signals
[
  "event ordering",
  "game clock",
  "score progression",
  "game-specific shot coordinates",
  "substitution sequence",
  "event participants"
]

## Product Applications
{
  "historicalExplorer": {
    "timeline": true,
    "scoringRuns": true
  },
  "gameFlow": {
    "leadChanges": true,
    "clutchSequence": true
  },
  "roleContext": {
    "gameSpecificActions": true
  },
  "marketPlusContext": {
    "later": true
  }
}

## Full-Season Archive Estimate
{
  "notExecuted": true,
  "games": 1322,
  "observedPagesPerGame": 1,
  "observedEventsPerGame": 488.6,
  "estimatedRequests": 1322,
  "estimatedEvents": 645929,
  "providerMinutesAt13s": 286.4,
  "observedBytesPerGame": 249615,
  "estimatedS3Bytes": 329991030,
  "estimatedS3Mb": 314.7,
  "note": "Do not execute. Pagination, if present, dominates cost. Bytes are raw archived JSON including envelopes."
}

## Product Value Classification
HIGH_VALUE_FULL_ARCHIVE

## Trial Time Remaining
{
  "elapsedHours": 29.428,
  "remainingHours": 18.572,
  "protectedReserveHours": 6,
  "usableRemainingHours": 12.572
}

## Postgres Unchanged Confirmation
{
  "expectedBytes": 342846611,
  "dbBytesAfter": 342846611,
  "unchanged": true,
  "unexpectedServing": []
}

## Step Verdict
GREEN — Plays add substantial unique Court Context value
