/**
 * Physical PostgreSQL envelopes for the scoreboard collector and game-status sync.
 *
 * A JSON payload length is not a database bound. The byte constants below are the
 * disposable PostgreSQL 17 measurements in storage-growth-s2b.test.ts, doubled and
 * rounded up to an 8 KiB page. WAL is not part of pg_database_size and is not included.
 */

export const PHYSICAL_BOUND_PAGE_BYTES = 8192;
export const PHYSICAL_BOUND_SAFETY_FACTOR = 2;

/** One initial attempt plus the three retries the limiter allows when the env is unset. */
export const LEDGER_MAX_ATTEMPTS = 4;
export const MAX_ACCEPTED_RATE_LIMIT_RETRIES = LEDGER_MAX_ATTEMPTS - 1;
export const LEDGER_MAX_ID = 128;
export const LEDGER_MAX_TOKEN = 64;
export const LEDGER_MAX_SCOPE_ID = 128;
export const LEDGER_MAX_PATH = 2048;
export const LEDGER_MAX_ERROR = 500;
export const LEDGER_MAX_KEY = 1024;
export const LEDGER_MAX_HASH = 64;
export const LEDGER_MAX_TIMESTAMP = 40;

/**
 * Season types this collector can enable today: preseason, and regular when both flags are on.
 * Play-in and playoffs stay refused by the flags. A third enabled type has no measured bound.
 */
export const SCOREBOARD_MAX_SEASON_TYPES = 2;
export const SCOREBOARD_MAX_PAGES = 3;
export const SCOREBOARD_MAX_GAMES_PER_PAGE = 100;
/** Fetched pages plus stored games in the three-day window whose polling state changes. */
export const SCOREBOARD_MAX_GAMES_PER_SEASON_TYPE = 400;
export const SCOREBOARD_MAX_PLAYERS_PER_GAME = 60;
export const SCOREBOARD_MAX_ODDS_PAGES = 3;
export const SCOREBOARD_MAX_ODDS_ROWS = SCOREBOARD_MAX_ODDS_PAGES * SCOREBOARD_MAX_GAMES_PER_PAGE;
export const SCOREBOARD_MAX_NAME = 80;
export const SCOREBOARD_MAX_ABBR = 16;
export const SCOREBOARD_MAX_CLOCK = 16;
export const SCOREBOARD_MAX_STATUS = 80;
export const SCOREBOARD_MAX_REQUEST_ID = LEDGER_MAX_ID;
export const SCOREBOARD_MAX_TIMESTAMP = LEDGER_MAX_TIMESTAMP;
export const SCOREBOARD_MAX_LEDGER_ROWS =
  (SCOREBOARD_MAX_SEASON_TYPES * (SCOREBOARD_MAX_PAGES + 1) + SCOREBOARD_MAX_ODDS_PAGES) * LEDGER_MAX_ATTEMPTS;

/** Frequent mode only. full_season has unbounded pages and stays refused. */
export const GAME_STATUS_MAX_QUERIES = 3;
export const GAME_STATUS_MAX_PAGES = 3;
export const GAME_STATUS_MAX_GAMES_PER_PAGE = 100;
export const GAME_STATUS_MAX_GAMES = GAME_STATUS_MAX_QUERIES * GAME_STATUS_MAX_PAGES * GAME_STATUS_MAX_GAMES_PER_PAGE;
export const GAME_STATUS_MAX_STATUS = 80;
export const GAME_STATUS_MAX_VENUE = 240;
export const GAME_STATUS_MAX_ID = 32;
export const GAME_STATUS_MAX_SEASON = 16;
export const GAME_STATUS_MAX_TIMESTAMP = LEDGER_MAX_TIMESTAMP;
export const GAME_STATUS_MAX_LEDGER_ROWS = GAME_STATUS_MAX_QUERIES * GAME_STATUS_MAX_PAGES * LEDGER_MAX_ATTEMPTS;

/** Scheduled window that was measured. A longer window has no physical bound. */
export const NIGHTLY_MAX_FORWARD_DAYS = 14;
export const NIGHTLY_MAX_GAMES_PER_DATE = 15;
export const NIGHTLY_MAX_BOX_DATES = 2;
export const NIGHTLY_MAX_UNIQUE_DATES = NIGHTLY_MAX_FORWARD_DAYS + 2;
export const NIGHTLY_MAX_SCHEDULE_GAMES = NIGHTLY_MAX_UNIQUE_DATES * NIGHTLY_MAX_GAMES_PER_DATE;
export const NIGHTLY_MAX_FINAL_GAMES = NIGHTLY_MAX_BOX_DATES * NIGHTLY_MAX_GAMES_PER_DATE;
/**
 * Measured 2026-11-19 maximum was 36 stat lines, all unique players, in game 21718143.
 * Four lines of room above that maximum. This does not raise the 900-line total.
 */
export const NIGHTLY_MAX_PLAYERS_PER_GAME = 40;
/** Previously 30 finals times 30 players. The measured pull was 140 lines, so the total stays 900. */
export const NIGHTLY_MAX_STAT_LINES = 900;
export const NIGHTLY_MAX_TEAMS = 30;
/** Previously 30 players times 10 periods. The measured maximum was 58 lines in one game. */
export const NIGHTLY_MAX_PERIOD_LINES_PER_GAME = 300;
export const NIGHTLY_MAX_STATUS = 32;
export const NIGHTLY_MAX_CLOCK = 16;
export const NIGHTLY_MAX_NAME = 64;
export const NIGHTLY_MAX_VENUE = 120;
/** Measured 2026-11-19 maxima: player 258 bytes, team 151 bytes. Both fit 512. */
export const NIGHTLY_MAX_PLAYER_JSON_BYTES = 512;
export const NIGHTLY_MAX_TEAM_JSON_BYTES = 512;
/** Measured 2026-11-19 maximum nested game document was 619 bytes. 768 leaves 149 bytes. */
export const NIGHTLY_MAX_GAME_JSON_BYTES = 768;
export const NIGHTLY_MAX_JSON_BYTES = NIGHTLY_MAX_PLAYER_JSON_BYTES;

/** Default injury page cap. A configured page count above this has no measured bound. */
export const INJURY_ADMITTED_MAX_PAGES = 20;
export const INJURY_MAX_ROWS_PER_PAGE = 100;
export const INJURY_MAX_ROWS = INJURY_ADMITTED_MAX_PAGES * INJURY_MAX_ROWS_PER_PAGE;
export const INJURY_MAX_STATUS = 80;
export const INJURY_MAX_DESCRIPTION = 500;
export const INJURY_MAX_RETURN = 64;
export const INJURY_MAX_PLAYER_ID = 32;
export const INJURY_MAX_PAYLOAD_BYTES = 2048;

export type LedgerRowShape = {
  request_id: string;
  pull_run_id: string;
  provider: string;
  league: string;
  endpoint_family: string;
  endpoint_path: string;
  scope_kind: string;
  scope_id: string;
  season_type_requested?: string | null;
  page_index: number;
  attempt: number;
  parent_request_id?: string | null;
  controller_enqueued_at?: string | null;
  request_started_at: string;
  response_received_at?: string | null;
  body_completed_at?: string | null;
  transport_error?: string | null;
  body_sha256?: string | null;
  envelope_sha256?: string | null;
  s3_key?: string | null;
  archived_at?: string | null;
  archive_error?: string | null;
  parse_error?: string | null;
  collector_name: string;
  collector_version: string;
};

export function textFits(value: string | null | undefined, max: number): boolean {
  return value == null || value.length <= max;
}

export function conservativePhysicalBound(measuredWorstBytes: number, relationCount: number): number {
  if (!Number.isSafeInteger(measuredWorstBytes) || measuredWorstBytes < 0) {
    throw new Error('measured physical growth is not a non-negative integer');
  }
  if (!Number.isSafeInteger(relationCount) || relationCount < 1) {
    throw new Error('relation count is not a positive integer');
  }
  const pageFloor = relationCount * PHYSICAL_BOUND_PAGE_BYTES;
  const doubled = measuredWorstBytes * PHYSICAL_BOUND_SAFETY_FACTOR;
  const raw = Math.max(doubled, pageFloor);
  if (!Number.isSafeInteger(raw)) throw new Error('physical growth bound overflows');
  return Math.ceil(raw / PHYSICAL_BOUND_PAGE_BYTES) * PHYSICAL_BOUND_PAGE_BYTES;
}

/**
 * Worst committed cluster-size delta on disposable PostgreSQL 17, and the heap and
 * index relations that delta can allocate a page in. The reservation bound is
 * computed from those two. storage-growth-s2b.test.ts fails if a fresh run disagrees.
 */
export const SCOREBOARD_MEASURED_WORST_BYTES = 14_589_952;
export const SCOREBOARD_MEASURED_RELATION_COUNT = 18;
export const SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  SCOREBOARD_MEASURED_WORST_BYTES,
  SCOREBOARD_MEASURED_RELATION_COUNT
);

export const GAME_STATUS_MEASURED_WORST_BYTES = 1_212_416;
export const GAME_STATUS_MEASURED_RELATION_COUNT = 10;
export const GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  GAME_STATUS_MEASURED_WORST_BYTES,
  GAME_STATUS_MEASURED_RELATION_COUNT
);

/**
 * Worst committed cluster-size delta on disposable PostgreSQL 17 after the
 * 2026-11-19 caps: 40 players per game, 900 stat lines, 768-byte game documents,
 * and 512-byte player and team documents. Doubled and page-rounded to 4,718,592.
 * WAL is not part of pg_database_size and is not included.
 * storage-growth-s2c.test.ts fails if a fresh run disagrees.
 * This is larger than the deployed 4,259,840 reservation and is not approved for production.
 */
export const NIGHTLY_MEASURED_WORST_BYTES = 2_359_296;
export const NIGHTLY_MEASURED_RELATION_COUNT = 46;
export const NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  NIGHTLY_MEASURED_WORST_BYTES,
  NIGHTLY_MEASURED_RELATION_COUNT
);

export const INJURY_MEASURED_WORST_BYTES = 7_536_640;
export const INJURY_MEASURED_RELATION_COUNT = 25;
export const INJURY_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  INJURY_MEASURED_WORST_BYTES,
  INJURY_MEASURED_RELATION_COUNT
);

/**
 * Scheduled odds: two dates, three pages each, 100 rows per page.
 * A larger page, date, or payload has no measured bound and is refused.
 * storage-growth-s2d.test.ts fails if a fresh run disagrees.
 */
export const ODDS_MAX_DATES_PER_INVOCATION = 2;
export const ODDS_MAX_PAGES_PER_DATE = 3;
export const ODDS_MAX_PAGES_PER_INVOCATION = ODDS_MAX_PAGES_PER_DATE * ODDS_MAX_DATES_PER_INVOCATION;
export const ODDS_MAX_ROWS_PER_PAGE = 100;
export const ODDS_MAX_ROWS_PER_DATE = ODDS_MAX_PAGES_PER_DATE * ODDS_MAX_ROWS_PER_PAGE;
export const ODDS_MAX_ROWS_PER_INVOCATION = ODDS_MAX_ROWS_PER_DATE * ODDS_MAX_DATES_PER_INVOCATION;
export const ODDS_MAX_VENDOR_CHARS = 64;
export const ODDS_MAX_PAYLOAD_BYTES = 2048;

export const ODDS_MEASURED_WORST_BYTES = 409_600;
export const ODDS_MEASURED_RELATION_COUNT = 19;
export const ODDS_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  ODDS_MEASURED_WORST_BYTES,
  ODDS_MEASURED_RELATION_COUNT
);

/**
 * Props controller claims at most one wave. The worker writes one game.
 * Ten pages of 3,000 observations is the measured envelope. A larger batch is refused.
 */
export const PROPS_MAX_GAMES_PER_CONTROLLER = 15;
export const PROPS_MAX_RECORDS_PER_WORKER = 1;
export const PROPS_MAX_PAGES_PER_GAME = 10;
export const PROPS_MAX_ROWS_PER_PAGE = 3000;
export const PROPS_MAX_ROWS_PER_GAME = PROPS_MAX_PAGES_PER_GAME * PROPS_MAX_ROWS_PER_PAGE;
export const PROPS_MAX_VENDOR_CHARS = 64;
export const PROPS_MAX_PROP_TYPE_CHARS = 40;
export const PROPS_MAX_PLAYER_NAME_CHARS = 80;
export const PROPS_MAX_SIDE_CHARS = 16;
export const PROPS_MAX_MARKET_CHARS = 16;
export const PROPS_MAX_RAW_JSON_BYTES = 512;

export const PROPS_CONTROLLER_MEASURED_WORST_BYTES = 57_344;
export const PROPS_CONTROLLER_MEASURED_RELATION_COUNT = 7;
export const PROPS_CONTROLLER_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  PROPS_CONTROLLER_MEASURED_WORST_BYTES,
  PROPS_CONTROLLER_MEASURED_RELATION_COUNT
);

export const PROPS_WORKER_MEASURED_WORST_BYTES = 60_694_528;
export const PROPS_WORKER_MEASURED_RELATION_COUNT = 26;
export const PROPS_WORKER_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  PROPS_WORKER_MEASURED_WORST_BYTES,
  PROPS_WORKER_MEASURED_RELATION_COUNT
);

/**
 * One raw write unit, measured on disposable PostgreSQL 17 in storage-growth-s4a.test.ts.
 * The worst step is a 250-row insert with the maximum accepted payload and indexes.
 * Duplicate retries added no database bytes. WAL is not included: one later step allocated
 * a single 16,777,216-byte segment. This does not replace the full-game worker bound.
 */
export const PROPS_WRITE_UNIT_ROWS = 250;
export const PROPS_WRITE_UNIT_MEASURED_WORST_BYTES = 360_448;
export const PROPS_WRITE_UNIT_MEASURED_RELATION_COUNT = 19;
export const PROPS_WRITE_UNIT_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  PROPS_WRITE_UNIT_MEASURED_WORST_BYTES,
  PROPS_WRITE_UNIT_MEASURED_RELATION_COUNT
);

/**
 * Serving publication only, measured on disposable PostgreSQL 17 in storage-growth-s4b.test.ts
 * after the raw rows were already stored. The worst step is the 30,000-row atomic board
 * replacement: current-table upsert plus preferred-line refresh in one transaction.
 * Raw relation growth during that transaction was zero. Two runs differed by index-page
 * splits; the bound uses the higher insert, 37,052,416 bytes. A rolled-back publication
 * still left more than 17 million database bytes. WAL is not included.
 * The full-game worker bound stays in place for callers that have not adopted this measurement.
 */
export const PROPS_PUBLICATION_MEASURED_RELATION_COUNT = 26;
export const PROPS_PUBLICATION_BRACKETS = [
  { rows: 250, measuredWorstBytes: 401_408 },
  { rows: 500, measuredWorstBytes: 761_856 },
  { rows: 1_000, measuredWorstBytes: 1_343_488 },
  { rows: 2_000, measuredWorstBytes: 2_547_712 },
  { rows: 5_000, measuredWorstBytes: 6_201_344 },
  { rows: PROPS_MAX_ROWS_PER_GAME, measuredWorstBytes: 37_052_416 },
] as const;
export const PROPS_PUBLICATION_MEASURED_WORST_BYTES = 37_052_416;
export const PROPS_PUBLICATION_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  PROPS_PUBLICATION_MEASURED_WORST_BYTES,
  PROPS_PUBLICATION_MEASURED_RELATION_COUNT
);

/** Attempt counter, pull completion, and game-run status. Measured delta 16,384 bytes. */
export const PROPS_PULL_CONTROL_MEASURED_WORST_BYTES = 16_384;
export const PROPS_PULL_CONTROL_PHYSICAL_GROWTH_BOUND_BYTES = conservativePhysicalBound(
  PROPS_PULL_CONTROL_MEASURED_WORST_BYTES,
  PROPS_PUBLICATION_MEASURED_RELATION_COUNT
);

export function propPublicationBound(rowCount: number): number {
  if (!Number.isInteger(rowCount) || rowCount < 0 || rowCount > PROPS_MAX_ROWS_PER_GAME) {
    throw new Error('prop publication size is outside the enforced maximum');
  }
  const bracket = PROPS_PUBLICATION_BRACKETS.find((item) => rowCount <= item.rows) ?? PROPS_PUBLICATION_BRACKETS[PROPS_PUBLICATION_BRACKETS.length - 1]!;
  return conservativePhysicalBound(bracket.measuredWorstBytes, PROPS_PUBLICATION_MEASURED_RELATION_COUNT);
}

export function ledgerRowRefusal(row: LedgerRowShape): string | null {
  if (!Number.isInteger(row.attempt) || row.attempt < 1 || row.attempt > LEDGER_MAX_ATTEMPTS) {
    return `ledger attempt exceeds the physical envelope of ${LEDGER_MAX_ATTEMPTS}`;
  }
  if (!Number.isInteger(row.page_index) || row.page_index < 0 || row.page_index > 9999) {
    return 'ledger page index exceeds the physical envelope';
  }
  const capped: Array<[string, string | null | undefined, number]> = [
    ['request id', row.request_id, LEDGER_MAX_ID],
    ['pull run id', row.pull_run_id, LEDGER_MAX_ID],
    ['provider', row.provider, LEDGER_MAX_TOKEN],
    ['league', row.league, LEDGER_MAX_TOKEN],
    ['endpoint family', row.endpoint_family, LEDGER_MAX_TOKEN],
    ['endpoint path', row.endpoint_path, LEDGER_MAX_PATH],
    ['scope id', row.scope_id, LEDGER_MAX_SCOPE_ID],
    ['season type', row.season_type_requested, LEDGER_MAX_TOKEN],
    ['parent request id', row.parent_request_id, LEDGER_MAX_ID],
    ['collector name', row.collector_name, LEDGER_MAX_TOKEN],
    ['collector version', row.collector_version, LEDGER_MAX_TOKEN],
    ['transport error', row.transport_error, LEDGER_MAX_ERROR],
    ['archive error', row.archive_error, LEDGER_MAX_ERROR],
    ['parse error', row.parse_error, LEDGER_MAX_ERROR],
    ['s3 key', row.s3_key, LEDGER_MAX_KEY],
    ['body hash', row.body_sha256, LEDGER_MAX_HASH],
    ['envelope hash', row.envelope_sha256, LEDGER_MAX_HASH],
    ['request started', row.request_started_at, LEDGER_MAX_TIMESTAMP],
    ['response received', row.response_received_at, LEDGER_MAX_TIMESTAMP],
    ['body completed', row.body_completed_at, LEDGER_MAX_TIMESTAMP],
    ['enqueued', row.controller_enqueued_at, LEDGER_MAX_TIMESTAMP],
    ['archived', row.archived_at, LEDGER_MAX_TIMESTAMP],
  ];
  for (const [name, value, max] of capped) {
    if (!textFits(value, max)) return `ledger ${name} exceeds the physical envelope of ${max} characters`;
  }
  return null;
}

export function ledgerParseRefusal(requestId: string, error: string | null): string | null {
  if (!textFits(requestId, LEDGER_MAX_ID)) return 'ledger request id exceeds the physical envelope';
  if (!textFits(error, LEDGER_MAX_ERROR)) return 'ledger parse error exceeds the physical envelope';
  return null;
}

export function guardAcqLedger<T extends {
  insertRow(row: LedgerRowShape): Promise<void>;
  updateArchiveOutcome(row: LedgerRowShape): Promise<void>;
  recordParseResult(requestId: string, ok: boolean, error: string | null): Promise<void>;
}>(inner: T): T {
  return {
    ...inner,
    async insertRow(row: LedgerRowShape) {
      const reason = ledgerRowRefusal(row);
      if (reason) throw new Error(reason);
      await inner.insertRow(row);
    },
    async updateArchiveOutcome(row: LedgerRowShape) {
      const reason = ledgerRowRefusal(row);
      if (reason) throw new Error(reason);
      await inner.updateArchiveOutcome(row);
    },
    async recordParseResult(requestId: string, ok: boolean, error: string | null) {
      const reason = ledgerParseRefusal(requestId, error);
      if (reason) throw new Error(reason);
      await inner.recordParseResult(requestId, ok, error);
    },
  };
}

export function scoreboardGameFits(game: {
  gameId: string;
  homeTeamId: string;
  homeAbbr: string | null;
  homeName: string | null;
  visitorTeamId: string;
  visitorAbbr: string | null;
  visitorName: string | null;
  providerStatus: string | null;
  providerStatusState: string | null;
  clock: string | null;
  gamesRequestId: string;
  boxRequestId: string | null;
  scheduledTip: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  lastChangedAt: string;
  finalObservedAt: string | null;
  boxObservedAt: string | null;
}): boolean {
  return (
    textFits(game.gameId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(game.homeTeamId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(game.visitorTeamId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(game.homeAbbr, SCOREBOARD_MAX_ABBR) &&
    textFits(game.visitorAbbr, SCOREBOARD_MAX_ABBR) &&
    textFits(game.homeName, SCOREBOARD_MAX_NAME) &&
    textFits(game.visitorName, SCOREBOARD_MAX_NAME) &&
    textFits(game.providerStatus, SCOREBOARD_MAX_STATUS) &&
    textFits(game.providerStatusState, SCOREBOARD_MAX_STATUS) &&
    textFits(game.clock, SCOREBOARD_MAX_CLOCK) &&
    textFits(game.gamesRequestId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(game.boxRequestId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(game.scheduledTip, SCOREBOARD_MAX_TIMESTAMP) &&
    textFits(game.firstObservedAt, SCOREBOARD_MAX_TIMESTAMP) &&
    textFits(game.lastObservedAt, SCOREBOARD_MAX_TIMESTAMP) &&
    textFits(game.lastChangedAt, SCOREBOARD_MAX_TIMESTAMP) &&
    textFits(game.finalObservedAt, SCOREBOARD_MAX_TIMESTAMP) &&
    textFits(game.boxObservedAt, SCOREBOARD_MAX_TIMESTAMP)
  );
}

export function scoreboardLineFits(line: {
  gameId: string;
  playerId: string;
  teamId: string;
  name: string | null;
  min: string | null;
}): boolean {
  return (
    textFits(line.gameId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(line.playerId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(line.teamId, SCOREBOARD_MAX_REQUEST_ID) &&
    textFits(line.name, SCOREBOARD_MAX_NAME) &&
    textFits(line.min, SCOREBOARD_MAX_CLOCK)
  );
}

export function gameStatusRowFits(row: {
  gameId: string;
  season: string;
  status: string | null;
  startTime: string | null;
  homeTeamId: string;
  awayTeamId: string;
  venue: string | null;
}): boolean {
  return (
    textFits(row.gameId, GAME_STATUS_MAX_ID) &&
    textFits(row.season, GAME_STATUS_MAX_SEASON) &&
    textFits(row.status, GAME_STATUS_MAX_STATUS) &&
    textFits(row.startTime, GAME_STATUS_MAX_TIMESTAMP) &&
    textFits(row.homeTeamId, GAME_STATUS_MAX_ID) &&
    textFits(row.awayTeamId, GAME_STATUS_MAX_ID) &&
    textFits(row.venue, GAME_STATUS_MAX_VENUE)
  );
}

export function injuryRecordFits(record: {
  status: string | null | undefined;
  description: string | null | undefined;
  returnDate: string | null | undefined;
  playerId: string | null | undefined;
  payloadBytes: number;
}): boolean {
  return (
    textFits(record.status, INJURY_MAX_STATUS) &&
    textFits(record.description, INJURY_MAX_DESCRIPTION) &&
    textFits(record.returnDate, INJURY_MAX_RETURN) &&
    textFits(record.playerId, INJURY_MAX_PLAYER_ID) &&
    Number.isSafeInteger(record.payloadBytes) &&
    record.payloadBytes >= 0 &&
    record.payloadBytes <= INJURY_MAX_PAYLOAD_BYTES
  );
}

export function observedGrowthVerdict(
  beforeBytes: number,
  afterBytes: number,
  boundBytes: number
): { ok: true; grewBytes: number } | { ok: false; reason: string } {
  if (!Number.isSafeInteger(beforeBytes) || beforeBytes < 0 || !Number.isSafeInteger(afterBytes) || afterBytes < 0) {
    return { ok: false, reason: 'database growth measurement is not a non-negative integer' };
  }
  if (afterBytes < beforeBytes) {
    return { ok: false, reason: 'database size fell during the write; growth is unknown' };
  }
  if (!Number.isSafeInteger(boundBytes) || boundBytes < 1) {
    return { ok: false, reason: 'physical PostgreSQL growth bound is unknown or not a positive integer' };
  }
  const grewBytes = afterBytes - beforeBytes;
  if (grewBytes > boundBytes) {
    return { ok: false, reason: 'measured database growth exceeds the reserved physical bound' };
  }
  return { ok: true, grewBytes };
}
