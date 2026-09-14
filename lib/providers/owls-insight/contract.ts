/**
 * Owls Insight historical player-prop contract.
 *
 * Sources (documentation only — no live API calls were made):
 * - https://owlsinsight.com/docs (fetched 2026-09-14)
 * - https://owlsinsight.com/terms (effective 2026-08-24)
 * - owls-insight-ts README (npm 0.51.0)
 * - owls-insight Python SDK README (PyPI 0.18.0)
 *
 * Field names below that are not in those documents are not claimed as confirmed.
 */

export const OWLS_DOCS_URL = 'https://owlsinsight.com/docs';
export const OWLS_TERMS_URL = 'https://owlsinsight.com/terms';
export const OWLS_DEFAULT_BASE_URL = 'https://api.owlsinsight.com';
export const OWLS_PROVIDER = 'owls_insight';
export const OWLS_LEAGUE = 'nba';

export const OWLS_ARCHIVE_SCHEMA = 'owls_historical_player_props.v1';
export const OWLS_GAMES_ARCHIVE_SCHEMA = 'owls_historical_games.v1';
export const OWLS_SNAPSHOT_ARCHIVE_SCHEMA = 'owls_historical_prop_snapshots.v1';
export const OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA = 'owls_historical_closing_odds.v1';
export const OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA = 'owls_historical_public_betting.v1';

export const OWLS_SOURCE_PREFIX = 'owls_insight';
export const OWLS_FIXTURE_SOURCE_PREFIX = 'owls_insight_fixture';

export const OWLS_ENTITY_PLAYER_PROPS = 'historical_player_props';
export const OWLS_ENTITY_PROP_SNAPSHOTS = 'historical_prop_snapshots';
export const OWLS_ENTITY_GAMES = 'historical_games';
export const OWLS_ENTITY_CLOSING_ODDS = 'historical_closing_odds';
export const OWLS_ENTITY_PUBLIC_BETTING = 'historical_public_betting';

export const OWLS_PROTECTED_SOURCES = ['existing_ingestion', 'balldontlie'] as const;
export const OWLS_PROTECTED_ENTITIES = [
  'player_props_raw_v2',
  'opening_player_props',
  'player_prop_snapshots',
] as const;

/** Documented REST paths. Do not invent additional paths. */
export const OWLS_PATHS = {
  docsMeta: '/api/v1/docs/meta',
  historyCoverage: '/api/v1/history/coverage',
  historyGames: '/api/v1/history/games',
  historyOdds: '/api/v1/history/odds',
  historyProps: '/api/v1/history/props',
  historyPlayerProps: '/api/v1/history/player-props',
  historyStats: '/api/v1/history/stats',
  historyClosingOdds: '/api/v1/history/closing-odds',
  historyPublicBetting: '/api/v1/history/public-betting',
} as const;

export const OWLS_AUTH_HEADER = 'Authorization';
export const OWLS_AUTH_SCHEME = 'Bearer';

export const OWLS_RATE_LIMIT_HEADERS = {
  remainingMinute: 'X-RateLimit-Remaining-Minute',
  remainingMonth: 'X-RateLimit-Remaining-Month',
  resetMinute: 'X-RateLimit-Reset-Minute',
  resetMonth: 'X-RateLimit-Reset-Month',
} as const;

/** Page size from docs. */
export const OWLS_PAGE_LIMITS = {
  historyGames: { default: 50, max: 100 },
  historyOdds: { default: 1000, max: 5000 },
  historyProps: { default: 1000, max: 5000 },
  historyPlayerProps: { default: 50, max: 100 },
  historyClosingOdds: { default: 50, max: 100 },
  historyPublicBetting: { default: 50, max: 100 },
} as const;

/** Hard caps for the /history/closing-odds feasibility probe. Never raise these in a live probe. */
export const OWLS_CLOSING_ODDS_PROBE_CAPS = {
  maxRequests: 20,
  maxRows: 2_000,
  maxCompressedBytes: 10 * 1024 * 1024,
  maxConcurrency: 1,
  maxGames: 3,
  pageLimit: 100,
  maxPagesPerGame: 5,
} as const;

/** Hard caps for the full /history/closing-odds backfill. Stop if projected requests exceed this. */
export const OWLS_CLOSING_ODDS_BACKFILL_CAPS = {
  maxProjectedRequests: 50_000,
  maxPagesPerGame: 10,
  maxConcurrency: 2,
  pageLimit: 100,
} as const;

/** Hard caps for the /history/public-betting probe and backfill. Stop if projected requests exceed 25,000. */
export const OWLS_PUBLIC_BETTING_BACKFILL_CAPS = {
  maxProjectedRequests: 25_000,
  maxPagesPerGame: 10,
  maxConcurrency: 2,
  pageLimit: 100,
} as const;

export const OWLS_PUBLIC_BETTING_PROBE_CAPS = {
  maxRequests: 12,
  maxRows: 2_000,
  maxCompressedBytes: 10 * 1024 * 1024,
  maxConcurrency: 1,
  maxGames: 3,
  pageLimit: 100,
  maxPagesPerGame: 5,
} as const;

/**
 * Documented /history/closing-odds books (28). Distinct from player-props (4)
 * and /history/props snapshots (20).
 */
export const OWLS_CLOSING_ODDS_BOOKS = [
  'pinnacle',
  'pinnacle_mqtt',
  'ps3838',
  'fanduel',
  'draftkings',
  'betmgm',
  'bet365',
  'caesars',
  'hardrock',
  '1xbet',
  'kalshi',
  'polymarket',
  'novig',
  'betonline',
  'circa',
  'south_point',
  'westgate',
  'wynn',
  'stations',
  'betr',
  '5dimes',
  'bovada',
  'sportsbetting_ag',
  'mybookie',
  'topbet',
  'gtbets',
  'statsllc',
  'consensus',
] as const;

/** Documented closing-odds provenance values. Not interchangeable. */
export const OWLS_CLOSING_ODDS_SOURCES = [
  'yahoo',
  'oddsshark',
  'espn',
  'football-data',
  'live-derived',
] as const;

/** Hard caps for the /history/props feasibility probe. Never raise these in a live probe. */
export const OWLS_SNAPSHOT_PROBE_CAPS = {
  maxRequests: 50,
  maxRows: 5_000,
  maxCompressedBytes: 25 * 1024 * 1024,
  maxConcurrency: 1,
  maxGames: 4,
  existenceLimit: 1,
  expandLimit: 25,
  maxPropsSnapshotsToProbe: 50_000,
  bannedGameIds: ['21716138'],
} as const;

/**
 * History in-flight caps by documented paid tier.
 * Bench and Rookie: historical archive "Not included".
 */
export const OWLS_HISTORY_IN_FLIGHT = {
  bench: 0,
  rookie: 0,
  mvp: 3,
  hallOfFame: 4,
} as const;

export const OWLS_DEFAULT_HISTORY_CONCURRENCY = 2;
export const OWLS_HARD_CAP_HISTORY_CONCURRENCY = OWLS_HISTORY_IN_FLIGHT.hallOfFame;

export const OWLS_GENERAL_REST_LIMITS = {
  bench: { reqPerMinute: 20, concurrent: 1, reqPerMonth: 10_000 },
  rookie: { reqPerMinute: 120, concurrent: 5, reqPerMonth: 75_000 },
  mvp: { reqPerMinute: 400, concurrent: 15, reqPerMonth: 300_000 },
  hallOfFame: { reqPerMinute: 1000, concurrent: 20, reqPerMonth: Number.POSITIVE_INFINITY },
} as const;

/** Documented HISTORY_CONCURRENCY 429 Retry-After seconds. */
export const OWLS_HISTORY_CONCURRENCY_RETRY_AFTER_SECONDS = 2;

export const OWLS_DEFAULT_TIMEOUT_MS = 30_000;
export const OWLS_DEFAULT_MAX_RETRIES = 5;

/**
 * Historical closing player-prop books for GET /api/v1/history/player-props.
 * Distinct from the 20-book list on /history/props snapshots.
 */
export const OWLS_HISTORICAL_PLAYER_PROP_BOOKS = [
  'draftkings',
  'caesars',
  'betmgm',
  'espnbet',
] as const;

export const OWLS_HISTORY_PROPS_BOOKS = [
  'pinnacle',
  'pinnacle_mqtt',
  'ps3838',
  'fanduel',
  'draftkings',
  'betmgm',
  'bet365',
  'caesars',
  'hardrock',
  '1xbet',
  'kalshi',
  'polymarket',
  'novig',
  'betonline',
  'circa',
  'south_point',
  'westgate',
  'wynn',
  'stations',
  'betr',
] as const;

export const OWLS_HISTORY_GAMES_GAME_TYPES = [
  'regular',
  'playoff',
  'allstar',
  'preseason',
  'playin',
] as const;

/**
 * Documented propType values on /history/player-props (65 total).
 * Court Context NBA subset is mapped in PROP_MAPPING.
 */
export const OWLS_HISTORY_PLAYER_PROP_TYPES = [
  'points',
  'rebounds',
  'assists',
  'threes',
  'threes_made',
  'steals',
  'blocks',
  'turnovers',
  'field_goals',
  'points_assists',
  'pts_asts',
  'points_rebounds',
  'pts_rebs',
  'points_rebounds_assists',
  'pts_rebs_asts',
  'assists_rebounds',
  'rebs_asts',
  'steals_blocks',
  'double_double',
  'triple_double',
] as const;

export type CourtContextProp = 'PTS' | 'REB' | 'AST' | '3PM' | 'PRA' | 'PA' | 'PR' | 'RA';

export type PropMappingStatus = 'SUPPORTED' | 'NOT_SUPPORTED' | 'NEEDS_LIVE_PROBE';

export type PropMappingRow = {
  courtContext: CourtContextProp;
  owlsPropTypes: readonly string[];
  canonicalOwlsPropType: string;
  aliases: readonly string[];
  status: PropMappingStatus;
  notes: string;
};

/**
 * Map Court Context markets to documented Owls /history/player-props propType values.
 * Combo markets are listed as first-class Owls types — do not fabricate by summing components.
 */
export const COURT_CONTEXT_PROP_MAPPING: readonly PropMappingRow[] = [
  {
    courtContext: 'PTS',
    owlsPropTypes: ['points'],
    canonicalOwlsPropType: 'points',
    aliases: [],
    status: 'SUPPORTED',
    notes: 'Documented on /history/player-props and live /props NBA categories.',
  },
  {
    courtContext: 'REB',
    owlsPropTypes: ['rebounds'],
    canonicalOwlsPropType: 'rebounds',
    aliases: [],
    status: 'SUPPORTED',
    notes: 'Documented on /history/player-props and live /props NBA categories.',
  },
  {
    courtContext: 'AST',
    owlsPropTypes: ['assists'],
    canonicalOwlsPropType: 'assists',
    aliases: [],
    status: 'SUPPORTED',
    notes: 'Documented on /history/player-props and live /props NBA categories.',
  },
  {
    courtContext: '3PM',
    owlsPropTypes: ['threes', 'threes_made'],
    canonicalOwlsPropType: 'threes',
    aliases: ['threes_made'],
    status: 'SUPPORTED',
    notes:
      'Live /history/player-props probe 2026-09-14 (LAL vs BOS) returned threes, not threes_made. Keep threes_made as an alias in case other endpoints use it.',
  },
  {
    courtContext: 'PRA',
    owlsPropTypes: ['pts_rebs_asts', 'points_rebounds_assists'],
    canonicalOwlsPropType: 'pts_rebs_asts',
    aliases: ['points_rebounds_assists'],
    status: 'SUPPORTED',
    notes:
      'Documented as a distinct sportsbook combo market. Do not synthesize from PTS+REB+AST component lines.',
  },
  {
    courtContext: 'PA',
    owlsPropTypes: ['pts_asts', 'points_assists'],
    canonicalOwlsPropType: 'pts_asts',
    aliases: ['points_assists'],
    status: 'SUPPORTED',
    notes: 'Documented as a distinct sportsbook combo market.',
  },
  {
    courtContext: 'PR',
    owlsPropTypes: ['pts_rebs', 'points_rebounds'],
    canonicalOwlsPropType: 'pts_rebs',
    aliases: ['points_rebounds'],
    status: 'SUPPORTED',
    notes: 'Documented as a distinct sportsbook combo market.',
  },
  {
    courtContext: 'RA',
    owlsPropTypes: ['rebs_asts', 'assists_rebounds'],
    canonicalOwlsPropType: 'rebs_asts',
    aliases: ['assists_rebounds'],
    status: 'SUPPORTED',
    notes: 'Documented as a distinct sportsbook combo market.',
  },
];

export const CORE_PROBE_PROPS: readonly CourtContextProp[] = [
  'PTS',
  'REB',
  'AST',
  '3PM',
  'PRA',
  'PA',
  'PR',
  'RA',
];

/** Court Context season start-year → Owls season label. Confirm on live /history/games. */
export const CC_SEASON_TO_OWLS: Record<string, string> = {
  '2022': '2022-23',
  '2023': '2023-24',
  '2024': '2024-25',
  '2025': '2025-26',
};

export const TARGET_CC_SEASONS = ['2023', '2024', '2025'] as const;

/**
 * Play-in / playoff windows in America/New_York calendar dates.
 * Play-in start dates match Court Context POSTSEASON_START_ET.
 * Playoff start is the day after the typical 4-day play-in window.
 */
export const SEASON_PHASE_WINDOWS: Record<
  string,
  { playInStartEt: string; playoffStartEt: string }
> = {
  '2023': { playInStartEt: '2024-04-16', playoffStartEt: '2024-04-20' },
  '2024': { playInStartEt: '2025-04-15', playoffStartEt: '2025-04-19' },
  '2025': { playInStartEt: '2026-04-14', playoffStartEt: '2026-04-18' },
};

export const FROZEN_GAME_UNIVERSE = {
  asOf: '2026-09-14',
  source: 'analytics.games status=Final',
  seasons: {
    '2023': {
      regularFinal: 1231,
      playInFinal: 6,
      playoffFinal: 82,
      totalFinal: 1319,
      totalRows: 1319,
      nonFinal: 0,
      earliestStartTime: '2023-10-24T23:30:00.000Z',
      latestStartTime: '2024-06-18T00:30:00.000Z',
    },
    '2024': {
      regularFinal: 1231,
      playInFinal: 6,
      playoffFinal: 84,
      totalFinal: 1321,
      totalRows: 1321,
      nonFinal: 0,
      earliestStartTime: '2024-10-22T23:30:00.000Z',
      latestStartTime: '2025-06-23T00:00:00.000Z',
    },
    '2025': {
      regularFinal: 1231,
      playInFinal: 6,
      playoffFinal: 85,
      totalFinal: 1322,
      totalRows: 1323,
      nonFinal: 1,
      earliestStartTime: '2025-10-21T23:30:00.000Z',
      latestStartTime: '2026-06-14T00:30:00.000Z',
      nonFinalNote: 'game_id 21681993 POR vs SAS has ISO timestamp stored as status; excluded from Final universe.',
    },
  },
} as const;

export const FIRST_PROBE_GAMES = [
  {
    courtContextGameId: '1037995',
    season: '2023',
    startTime: '2023-12-25T22:00:00.000Z',
    homeTeam: 'LAL',
    awayTeam: 'BOS',
    homeTeamName: 'Los Angeles Lakers',
    awayTeamName: 'Boston Celtics',
    why: '2023-24 Christmas Day. Star players (LeBron, Tatum). Regular-season prop coverage.',
  },
  {
    courtContextGameId: '15905067',
    season: '2023',
    startTime: '2024-06-18T00:30:00.000Z',
    homeTeam: 'BOS',
    awayTeam: 'DAL',
    homeTeamName: 'Boston Celtics',
    awayTeamName: 'Dallas Mavericks',
    why: '2023-24 NBA Finals closeout. Tatum / Luka. High book coverage expected.',
  },
  {
    courtContextGameId: '18444564',
    season: '2024',
    startTime: '2025-06-23T00:00:00.000Z',
    homeTeam: 'OKC',
    awayTeam: 'IND',
    homeTeamName: 'Oklahoma City Thunder',
    awayTeamName: 'Indiana Pacers',
    why: '2024-25 NBA Finals closeout. SGA. Distinct season from 2023-24.',
  },
  {
    courtContextGameId: '18447233',
    season: '2025',
    startTime: '2025-12-25T19:30:00.000Z',
    homeTeam: 'OKC',
    awayTeam: 'SAS',
    homeTeamName: 'Oklahoma City Thunder',
    awayTeamName: 'San Antonio Spurs',
    why: '2025-26 Christmas Day. SGA / Wembanyama. Regular-season tape vs finals tape.',
  },
  {
    courtContextGameId: '21716138',
    season: '2025',
    startTime: '2026-06-14T00:30:00.000Z',
    homeTeam: 'SAS',
    awayTeam: 'NYK',
    homeTeamName: 'San Antonio Spurs',
    awayTeamName: 'New York Knicks',
    why: '2025-26 NBA Finals Game 5. Wembanyama / Brunson.',
  },
] as const;

export const PHASES = [
  { phase: 0, name: 'prep', description: 'No trial. Code, fixtures, planning only.' },
  { phase: 1, name: 'probe', description: '3–5 game live probe.' },
  { phase: 2, name: 'week', description: 'One NBA week after probe validation.' },
  { phase: 3, name: 'month', description: 'One NBA month after week validation.' },
  { phase: 4, name: 'season', description: 'One complete season.' },
  { phase: 5, name: 'remaining', description: 'Remaining target seasons.' },
] as const;

export const STOP_CONDITION_DEFAULTS = {
  minEventMatchRate: 0.8,
  minPlayerMatchRate: 0.7,
  minCorePropTypes: 4,
  requirePrices: true,
  maxConsecutive429: 8,
  maxConsecutive503: 8,
} as const;

export const CONFIRMED_FROM_DOCS = [
  'Base URL is https://api.owlsinsight.com.',
  'REST auth is Authorization: Bearer <api key>.',
  'GET /api/v1/history/coverage reports date ranges per sport/dataset.',
  'GET /api/v1/history/games lists archived games; sport|season|team|startDate required; gameType in regular|playoff|allstar|preseason|playin; limit default 50 max 100; offset pagination.',
  'GET /api/v1/history/props returns player-prop snapshots for one archived eventId; optional playerName, propType, book, startTime, endTime, opening=true for first snapshot; limit default 1000 max 5000.',
  'GET /api/v1/history/closing-odds returns per-sportsbook moneyline, spread and total at close for archived games, with provenance (yahoo|oddsshark|espn|football-data|live-derived). eventId or sport is required; sport alone needs startDate, book, source or season. limit default 50 max 100. 28 books including consensus/statsllc/offshore books that are not on /history/props.',
  'GET /api/v1/history/public-betting returns historical bet % and money % by side for archived games. eventId or sport+startDate. limit default 50 max 100. Not fetched in the closing-odds probe.',
  'Live 2026-09-14 /history/public-betting wrapper is { success, data: { betting, pagination:{total,limit,offset,hasMore} } }. Each betting row is one event with nested spread{homePct,awayPct} and total{overPct,underPct}. No moneyline object, no money-share fields, no capturedAt. gameDate is midnight UTC. Documented money % was not present on live rows. Provider 0 is preserved and is not rewritten to missing.',
  'GET /api/v1/history/odds is the archived snapshot tape (not the curated close). Do not use it as a substitute for /history/closing-odds.',
  'Live 2026-09-14 /history/closing-odds wrapper is { success, data: { odds, pagination:{total,limit,offset,hasMore}, dataQuality } }. Each odds row is one book with nested moneyline{home,away}, spread{home,away,homePrice,awayPrice}, total{line,overPrice,underPrice}. Live books were betmgm + consensus. Live source labels were archive-1 / archive-2, not the documented yahoo|oddsshark|espn|football-data|live-derived enum.',
  'Live 2026-09-14 /history/props wrapper is { success, data: { eventId, opening, timeRange:{start,end}, snapshots, count, limit, offset } }. Pagination is count/limit/offset on data (not data.props + data.pagination). espnbet is not a valid snapshot book.',
  'GET /api/v1/history/player-props returns historical closing player-prop lines from the backfill archive with over/under prices at close; NBA from 2022-23; books draftkings|caesars|betmgm|espnbet; limit default 50 max 100; at least one of eventId, player, startDate required.',
  'Historical closing player props are described as a separate backfilled dataset (2.6M+ lines) with opening and closing lines; book mix varies by season.',
  'History routes have a per-key in-flight cap. Over cap → 429 Retry-After: 2 code HISTORY_CONCURRENCY.',
  'History 503 with Retry-After means the query was too expensive or the archive was busy; narrow filters or smaller limit.',
  'Pagination: limit+offset, one event at a time, stop when a page is shorter than limit. Do not fan out one event across books in parallel.',
  'MVP history in-flight = 3; Hall of Fame = 4; Bench/Rookie history not included.',
  'General REST: Bench 20/min 1 concurrent; Rookie 120/min 5; MVP 400/min 15; HoF 1000/min 20.',
  'Rate-limit headers: X-RateLimit-Remaining-Minute, X-RateLimit-Remaining-Month, X-RateLimit-Reset-Minute, X-RateLimit-Reset-Month.',
  'HTTP 429 Too Many Requests; 503 Service Unavailable; 403 insufficient tier; 401 missing/invalid key.',
  'Default SDK timeout 30s.',
  'Terms §7: do not share, resell, redistribute, or sublicense API data without prior written consent.',
  'Terms §6.3: cancelling a trial ends API access immediately.',
] as const;

export const NEEDS_LIVE_TRIAL_PROBE = [
  'Exact JSON field names on /history/games, /history/props, and /history/player-props responses.',
  'Whether player-props rows include a stable provider player id or only a name.',
  'Whether threes and threes_made are the same 3PM market or distinct.',
  'Whether openingLine/closingLine (or equivalent) are present on each /history/player-props row, or only a single close line.',
  'Whether /history/props snapshots include timestamps per row and both over and under.',
  'Observed rows/game, pages/game, bytes/request — required for runtime and storage estimates.',
  'Whether Owls season labels are 2023-24 for Court Context season 2023.',
  'Actual eventId format and whether it can be reconstructed without /history/games.',
  'Coverage completeness for 2023-24, 2024-25, 2025-26 regular season vs playoffs.',
  'Whether combo markets PRA/PA/PR/RA are populated for all four historical books.',
  'Whether prices are American, decimal, or both.',
  'Trial tier (history requires MVP+).',
] as const;
