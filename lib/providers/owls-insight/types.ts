export type OwlsMode = 'dry-run' | 'fixture' | 'execute';

export type OwlsUnitStatus =
  | 'PENDING'
  | 'FETCHING'
  | 'ARCHIVED'
  | 'NORMALIZED'
  | 'FAILED'
  | 'SKIPPED';

/** Per-game acquisition outcome. Empty HTTP 200 is not a sportsbook-market absence. */
export type OwlsAcquisitionState =
  | 'POPULATED'
  | 'EMPTY_PROVIDER_HISTORY'
  | 'GAME_MAPPING_FAILED'
  | 'REQUEST_FAILED'
  | 'ARCHIVE_FAILED';

export type OwlsGameAcquisition = {
  court_context_game_id: string;
  state: OwlsAcquisitionState;
  rows: number;
  event_id: string | null;
  error: string | null;
  game_date?: string | null;
  game_type?: 'regular' | 'play_in' | 'playoff' | null;
};

export type IdentityClass = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

export type OwlsEndpointName =
  | 'history_games'
  | 'history_player_props'
  | 'history_props'
  | 'history_coverage'
  | 'history_closing_odds'
  | 'history_odds'
  | 'history_public_betting';

export type OwlsRequest = {
  method: 'GET';
  path: string;
  query: Record<string, string | number | boolean | undefined>;
};

export type OwlsResponseMetadata = {
  status: number;
  headers: Record<string, string>;
  durationMs: number;
};

export type OwlsPage = {
  request: OwlsRequest;
  url: string;
  body: unknown;
  metadata: OwlsResponseMetadata;
  rowCount: number;
  pageIndex: number;
  offset: number;
  limit: number;
  exhausted: boolean;
};

export type CourtContextGame = {
  courtContextGameId: string;
  season: string;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamName?: string;
  awayTeamName?: string;
  status?: string;
  venue?: string | null;
  phase?: 'regular' | 'play_in' | 'playoff';
};

export type OwlsGameLike = {
  providerGameId: string;
  season?: string | null;
  startTime?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  raw: unknown;
};

export type GameMappingResult = {
  status: IdentityClass;
  providerGameId: string;
  courtContextGameId: string | null;
  candidates: string[];
  reason: string;
};

export type PlayerMappingResult = {
  status: IdentityClass;
  providerPlayerId: string | null;
  providerPlayerName: string;
  courtContextPlayerId: string | null;
  candidates: string[];
  reason: string;
};

export type NormalizedOwlsPropRow = {
  provider: 'owls_insight';
  provider_game_id: string | null;
  provider_player_id: string | null;
  provider_player_name: string | null;
  court_context_game_id: string | null;
  court_context_player_id: string | null;
  game_match: IdentityClass | null;
  player_match: IdentityClass | null;
  season: string | null;
  game_start_time: string | null;
  snapshot_type: string;
  snapshot_at: string | null;
  book: string | null;
  prop_type: string | null;
  court_context_prop: string | null;
  side: string | null;
  line: number | null;
  american_odds: number | null;
  decimal_odds: number | null;
  opening_line: number | null;
  closing_line: number | null;
  opening_price: number | null;
  closing_price: number | null;
  source_archive_key: string;
  backfill_run_id: string;
};

export type OwlsArchiveEnvelope = {
  schema: string;
  provider: 'owls_insight';
  backfill_run_id: string;
  requested_at: string;
  archived_at: string;
  request: OwlsRequest;
  response_metadata: OwlsResponseMetadata;
  row_count: number;
  checksum: string;
  page_index: number;
  offset: number;
  limit: number;
  provider_game_id: string | null;
  court_context_game_id?: string | null;
  season: string | null;
  game_date: string | null;
  fixture: boolean;
  fetched_at?: string;
  payload: unknown;
};

export type CheckpointUnit = {
  unit_id: string;
  endpoint: OwlsEndpointName;
  provider_game_id: string | null;
  court_context_game_id: string | null;
  season: string | null;
  game_date: string | null;
  page_index: number;
  offset: number;
  limit: number;
  status: OwlsUnitStatus;
  archive_key: string | null;
  checksum: string | null;
  row_count: number;
  error: string | null;
  updated_at: string;
};

export type BackfillRun = {
  run_id: string;
  started_at: string;
  completed_at: string | null;
  phase: number;
  mode: OwlsMode;
  target_seasons: string[];
  endpoint: OwlsEndpointName;
  games_attempted: number;
  games_completed: number;
  requests_attempted: number;
  requests_successful: number;
  requests_retried: number;
  status_429: number;
  status_503: number;
  rows: number;
  failures: number;
  s3_objects: number;
  mapping_matched: number;
  mapping_ambiguous: number;
  mapping_unmatched: number;
};

export type ProgressSnapshot = {
  season: string | null;
  gamesComplete: number;
  gamesTotal: number;
  populatedGames: number;
  emptyProviderHistory: number;
  mappingFailed: number;
  requests: number;
  requestsSuccessful: number;
  requestsRetried: number;
  rowsArchived: number;
  failures: number;
  pagesComplete: number;
  status429: number;
  status503: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  avgRequestsPerGame: number | null;
  avgSecondsPerGame: number | null;
};

export type ValidationReport = {
  run_id: string;
  phase: number;
  games_requested: number;
  games_returned: number;
  games_matched: number;
  games_ambiguous: number;
  games_unmatched: number;
  players_returned: number;
  players_matched: number;
  players_ambiguous: number;
  players_unmatched: number;
  prop_rows: number;
  books: string[];
  prop_types: string[];
  coverage: Record<string, number>;
  opening_availability: number;
  closing_availability: number;
  price_availability: number;
  api_requests: number;
  retries: number;
  status_429: number;
  status_503: number;
  s3_objects: number;
  checksum_failures: number;
  archive_failures: number;
  stop_reasons: string[];
};

export type ReconcileReport = {
  run_id: string;
  expected_objects: number;
  actual_objects: number;
  missing: string[];
  checksum_mismatch: string[];
  failed_pages: string[];
  incomplete_games: string[];
  ok: boolean;
};
