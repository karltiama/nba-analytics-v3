/**
 * Compact historical season Role Profile contract (Step 12F).
 * Client-safe: no fs/S3. Grain is player + season — never this game.
 * Attach onto existing box-score players only.
 */

export const PLAYER_ROLE_PROFILE_SEASONS = ['2023', '2024', '2025'] as const;

export const PLAYER_ROLE_PROFILE_SOURCE = 'bdl_season_averages_targeted_archive';

export type PlayerRoleProfileSeason = (typeof PLAYER_ROLE_PROFILE_SEASONS)[number];

/**
 * Certified archive scales (Step 9B/9C):
 * - playtype poss_pct: 0–1 share of offensive possessions (0.28 = 28%)
 * - playtype ppp: points per possession (1.163)
 * - drives / drive_pts / passes_made / potential_ast: per-game rates
 * - zone FGA: per-game attempts; zone FG%: 0–1 fractions
 *
 * Missing playtype is qualification, not zero role.
 * Do not serve playtype gp (qualifying games, not season GP).
 */
export type HistoricalPlayerRoleProfile = {
  season: string;
  isolationPossPct: number | null;
  isolationPpp: number | null;
  pnrBallHandlerPossPct: number | null;
  pnrBallHandlerPpp: number | null;
  pnrRollManPossPct: number | null;
  pnrRollManPpp: number | null;
  drivesPerGame: number | null;
  drivePointsPerGame: number | null;
  passesPerGame: number | null;
  potentialAssistsPerGame: number | null;
  restrictedAreaFga: number | null;
  restrictedAreaFgPct: number | null;
  paintNonRaFga: number | null;
  paintNonRaFgPct: number | null;
  midrangeFga: number | null;
  midrangeFgPct: number | null;
  cornerThreeFga: number | null;
  cornerThreeFgPct: number | null;
  aboveBreakThreeFga: number | null;
  aboveBreakThreeFgPct: number | null;
};

export type HistoricalRoleProfileServingRow = HistoricalPlayerRoleProfile & {
  playerId: string;
};

/** Three captured playtypes omit spot-up/transition. Do not invent a universal role label. */
export const PRIMARY_ROLE_LABEL_POLICY = 'omit' as const;

export function isRoleProfileServingSeason(
  season: string | number | null | undefined
): boolean {
  return PLAYER_ROLE_PROFILE_SEASONS.includes(String(season ?? '') as PlayerRoleProfileSeason);
}

/** UI must use the Final contract flag, not season number. */
export function shouldShowHistoricalRoleProfile(
  availability: { roleProfile?: boolean } | null | undefined
): boolean {
  return availability?.roleProfile === true;
}

export function emptyPlayerRoleProfile(season = ''): HistoricalPlayerRoleProfile {
  return {
    season,
    isolationPossPct: null,
    isolationPpp: null,
    pnrBallHandlerPossPct: null,
    pnrBallHandlerPpp: null,
    pnrRollManPossPct: null,
    pnrRollManPpp: null,
    drivesPerGame: null,
    drivePointsPerGame: null,
    passesPerGame: null,
    potentialAssistsPerGame: null,
    restrictedAreaFga: null,
    restrictedAreaFgPct: null,
    paintNonRaFga: null,
    paintNonRaFgPct: null,
    midrangeFga: null,
    midrangeFgPct: null,
    cornerThreeFga: null,
    cornerThreeFgPct: null,
    aboveBreakThreeFga: null,
    aboveBreakThreeFgPct: null,
  };
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapServingRoleProfileRow(row: {
  player_id?: unknown;
  season?: unknown;
  isolation_poss_pct?: unknown;
  isolation_ppp?: unknown;
  pnr_ball_handler_poss_pct?: unknown;
  pnr_ball_handler_ppp?: unknown;
  pnr_roll_man_poss_pct?: unknown;
  pnr_roll_man_ppp?: unknown;
  drives_per_game?: unknown;
  drive_points_per_game?: unknown;
  passes_per_game?: unknown;
  potential_assists_per_game?: unknown;
  restricted_area_fga?: unknown;
  restricted_area_fg_pct?: unknown;
  paint_non_ra_fga?: unknown;
  paint_non_ra_fg_pct?: unknown;
  midrange_fga?: unknown;
  midrange_fg_pct?: unknown;
  corner_three_fga?: unknown;
  corner_three_fg_pct?: unknown;
  above_break_three_fga?: unknown;
  above_break_three_fg_pct?: unknown;
}): HistoricalRoleProfileServingRow {
  return {
    playerId: String(row.player_id ?? ''),
    season: String(row.season ?? ''),
    isolationPossPct: finiteOrNull(row.isolation_poss_pct),
    isolationPpp: finiteOrNull(row.isolation_ppp),
    pnrBallHandlerPossPct: finiteOrNull(row.pnr_ball_handler_poss_pct),
    pnrBallHandlerPpp: finiteOrNull(row.pnr_ball_handler_ppp),
    pnrRollManPossPct: finiteOrNull(row.pnr_roll_man_poss_pct),
    pnrRollManPpp: finiteOrNull(row.pnr_roll_man_ppp),
    drivesPerGame: finiteOrNull(row.drives_per_game),
    drivePointsPerGame: finiteOrNull(row.drive_points_per_game),
    passesPerGame: finiteOrNull(row.passes_per_game),
    potentialAssistsPerGame: finiteOrNull(row.potential_assists_per_game),
    restrictedAreaFga: finiteOrNull(row.restricted_area_fga),
    restrictedAreaFgPct: finiteOrNull(row.restricted_area_fg_pct),
    paintNonRaFga: finiteOrNull(row.paint_non_ra_fga),
    paintNonRaFgPct: finiteOrNull(row.paint_non_ra_fg_pct),
    midrangeFga: finiteOrNull(row.midrange_fga),
    midrangeFgPct: finiteOrNull(row.midrange_fg_pct),
    cornerThreeFga: finiteOrNull(row.corner_three_fga),
    cornerThreeFgPct: finiteOrNull(row.corner_three_fg_pct),
    aboveBreakThreeFga: finiteOrNull(row.above_break_three_fga),
    aboveBreakThreeFgPct: finiteOrNull(row.above_break_three_fg_pct),
  };
}

export function roleProfileByPlayerId(
  rows: HistoricalRoleProfileServingRow[]
): Map<string, HistoricalPlayerRoleProfile> {
  const map = new Map<string, HistoricalPlayerRoleProfile>();
  for (const row of rows) {
    if (!row.playerId) continue;
    const { playerId: _playerId, ...profile } = row;
    map.set(row.playerId, profile);
  }
  return map;
}

/**
 * Default Context player: first certified starter (away then home), else first box
 * player in existing away-then-home order. Not “player of the game.”
 */
export function defaultRoleProfilePlayerId(args: {
  starters?: { available: boolean; home: { playerId: string }[]; away: { playerId: string }[] } | null;
  box: { away: { playerId: string }[]; home: { playerId: string }[] };
}): string | null {
  const starters = args.starters;
  if (
    starters?.available &&
    starters.away.length === 5 &&
    starters.home.length === 5
  ) {
    return starters.away[0]?.playerId ?? starters.home[0]?.playerId ?? null;
  }
  return args.box.away[0]?.playerId ?? args.box.home[0]?.playerId ?? null;
}
