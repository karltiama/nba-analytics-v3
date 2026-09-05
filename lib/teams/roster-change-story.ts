/**
 * Preseason roster-change storytelling (Phase 2.T.4A).
 *
 * Ranks Added/Departed using transparent prior-season role evidence:
 * whole-season MPG (from player_game_logs) + PPG (from player_season_averages).
 * No proprietary impact scores, transaction verbs, or star labels.
 */

import type { ContinuityPlayer, TeamRosterContinuity } from '@/lib/teams/team-roster-continuity';

/** Highlighted key changes before the compact “other” list. */
export const KEY_CHANGE_HIGHLIGHT = 3;

/**
 * Role tiers from 2025 MPG distribution (players with ≥20 GP):
 * p50≈21.5, p75≈28.2. Thresholds are descriptive prior-season role only.
 */
export const ROLE_MAJOR_MPG = 28;
export const ROLE_ROTATION_MPG = 15;

export type PriorRoleTier =
  | 'major_rotation'
  | 'rotation'
  | 'limited_role'
  | 'new_nba'
  | 'unknown';

export type PriorSeasonRoleStats = {
  playerId: string;
  /** Whole-season games in prior season (PSA preferred, else PGL count). */
  gamesPlayed: number | null;
  /** Whole-season average minutes (all teams that season). */
  mpg: number | null;
  /** Whole-season PPG from player_season_averages. */
  ppg: number | null;
};

export type RosterChangePlayerStory = {
  playerEntityId: string;
  displayName: string;
  playerId: string | null;
  roleTier: PriorRoleTier;
  roleLabel: string;
  mpg: number | null;
  ppg: number | null;
  gamesPlayed: number | null;
  /** Prior-season open-roster team abbr (added) or current other-team abbr (departed). */
  otherTeamAbbr: string | null;
};

export type RosterChangeStory = {
  available: boolean;
  priorSeason: string;
  /** Stats semantics note for tests/docs. */
  statsScope: 'whole_season_prior';
  addedKey: RosterChangePlayerStory[];
  addedOther: ContinuityPlayer[];
  departedKey: RosterChangePlayerStory[];
  departedOther: ContinuityPlayer[];
  /** Unchanged from continuity — membership counts must match. */
  returningCount: number;
  addedCount: number;
  departedCount: number;
};

export function roleLabelForTier(tier: PriorRoleTier): string {
  switch (tier) {
    case 'major_rotation':
      return 'Major rotation';
    case 'rotation':
      return 'Rotation';
    case 'limited_role':
      return 'Limited role';
    case 'new_nba':
      return 'Rookie / New NBA player';
    default:
      return 'Prior role unknown';
  }
}

export function classifyPriorRole(args: {
  playerId: string | null;
  stats: PriorSeasonRoleStats | null | undefined;
}): PriorRoleTier {
  if (args.playerId == null) return 'new_nba';
  const s = args.stats;
  if (!s) return 'new_nba';
  const hasSample =
    (s.gamesPlayed != null && s.gamesPlayed > 0) ||
    (s.mpg != null && s.mpg > 0) ||
    (s.ppg != null && s.ppg > 0);
  if (!hasSample) return 'new_nba';
  if (s.mpg == null) return 'unknown';
  if (s.mpg >= ROLE_MAJOR_MPG) return 'major_rotation';
  if (s.mpg >= ROLE_ROTATION_MPG) return 'rotation';
  return 'limited_role';
}

function tierSortKey(tier: PriorRoleTier): number {
  switch (tier) {
    case 'major_rotation':
      return 0;
    case 'rotation':
      return 1;
    case 'new_nba':
      return 2;
    case 'limited_role':
      return 3;
    default:
      return 4;
  }
}

/** Deterministic importance sort for storytelling. */
export function compareChangePlayers(
  a: RosterChangePlayerStory,
  b: RosterChangePlayerStory
): number {
  const t = tierSortKey(a.roleTier) - tierSortKey(b.roleTier);
  if (t !== 0) return t;
  const mpgA = a.mpg ?? -1;
  const mpgB = b.mpg ?? -1;
  if (mpgB !== mpgA) return mpgB - mpgA;
  const gpA = a.gamesPlayed ?? -1;
  const gpB = b.gamesPlayed ?? -1;
  if (gpB !== gpA) return gpB - gpA;
  const ppgA = a.ppg ?? -1;
  const ppgB = b.ppg ?? -1;
  if (ppgB !== ppgA) return ppgB - ppgA;
  return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' });
}

export function buildPlayerStory(
  player: ContinuityPlayer,
  statsByPlayerId: Map<string, PriorSeasonRoleStats>,
  otherTeamByEntity: Map<string, string>
): RosterChangePlayerStory {
  const stats =
    player.playerId != null ? statsByPlayerId.get(player.playerId) ?? null : null;
  const roleTier = classifyPriorRole({ playerId: player.playerId, stats });
  return {
    playerEntityId: player.playerEntityId,
    displayName: player.displayName,
    playerId: player.playerId,
    roleTier,
    roleLabel: roleLabelForTier(roleTier),
    mpg: stats?.mpg ?? null,
    ppg: stats?.ppg ?? null,
    gamesPlayed: stats?.gamesPlayed ?? null,
    otherTeamAbbr: otherTeamByEntity.get(player.playerEntityId) ?? null,
  };
}

export function splitKeyAndOther(
  stories: RosterChangePlayerStory[],
  highlight: number = KEY_CHANGE_HIGHLIGHT
): { key: RosterChangePlayerStory[]; other: ContinuityPlayer[] } {
  const sorted = [...stories].sort(compareChangePlayers);
  const key = sorted.slice(0, highlight);
  const other = sorted.slice(highlight).map((s) => ({
    playerEntityId: s.playerEntityId,
    displayName: s.displayName,
    playerId: s.playerId,
  }));
  return { key, other };
}

export function emptyRosterChangeStory(
  continuity: TeamRosterContinuity
): RosterChangeStory {
  return {
    available: false,
    priorSeason: continuity.previousSeason,
    statsScope: 'whole_season_prior',
    addedKey: [],
    addedOther: [],
    departedKey: [],
    departedOther: [],
    returningCount: continuity.returningCount,
    addedCount: continuity.addedCount,
    departedCount: continuity.departedCount,
  };
}

export function buildRosterChangeStory(args: {
  continuity: TeamRosterContinuity;
  statsByPlayerId: Map<string, PriorSeasonRoleStats>;
  /** Prior-season open-roster team for Added players. */
  priorTeamByEntity: Map<string, string>;
  /** Current-season open roster on another team for Departed players. */
  currentOtherTeamByEntity: Map<string, string>;
}): RosterChangeStory {
  const { continuity } = args;
  if (!continuity.available) {
    return emptyRosterChangeStory(continuity);
  }

  const addedStories = continuity.added.map((p) =>
    buildPlayerStory(p, args.statsByPlayerId, args.priorTeamByEntity)
  );
  const departedStories = continuity.departed.map((p) =>
    buildPlayerStory(p, args.statsByPlayerId, args.currentOtherTeamByEntity)
  );

  const addedSplit = splitKeyAndOther(addedStories);
  const departedSplit = splitKeyAndOther(departedStories);

  return {
    available: true,
    priorSeason: continuity.previousSeason,
    statsScope: 'whole_season_prior',
    addedKey: addedSplit.key,
    addedOther: addedSplit.other,
    departedKey: departedSplit.key,
    departedOther: departedSplit.other,
    returningCount: continuity.returningCount,
    addedCount: continuity.addedCount,
    departedCount: continuity.departedCount,
  };
}

export function formatMpg(mpg: number | null): string | null {
  if (mpg == null || Number.isNaN(mpg)) return null;
  return `${mpg.toFixed(1)} MPG`;
}

export function formatPpg(ppg: number | null): string | null {
  if (ppg == null || Number.isNaN(ppg)) return null;
  return `${ppg.toFixed(1)} PPG`;
}

/** Context line under a key player — never zeros for missing. */
export function formatChangeContextLine(story: RosterChangePlayerStory): string {
  if (story.roleTier === 'new_nba') {
    return story.roleLabel;
  }
  const parts: string[] = [story.roleLabel];
  const mpg = formatMpg(story.mpg);
  const ppg = formatPpg(story.ppg);
  if (mpg) parts.push(mpg);
  if (ppg) parts.push(ppg);
  return parts.join(' · ');
}

/** Banned subjective wording — used in tests. */
export const BANNED_STORY_WORDS = [
  'superstar',
  'star',
  'huge addition',
  'massive loss',
  'great signing',
  'bad loss',
  'traded',
  'waived',
  'free agency',
] as const;

/**
 * Whole-season prior MPG (PGL) + PPG/GP (PSA) for a set of BDL player ids.
 * Semantics: all teams that season — not previous-team-only splits.
 */
export const PRIOR_SEASON_ROLE_STATS_SQL = `
  WITH mpg AS (
    SELECT
      pgl.player_id,
      count(*)::int AS gp,
      avg(NULLIF(trim(pgl.minutes), '')::numeric) AS mpg
    FROM analytics.player_game_logs pgl
    WHERE pgl.season = $1
      AND pgl.player_id = ANY($2::text[])
    GROUP BY pgl.player_id
  ),
  psa AS (
    SELECT
      player_id,
      games_played,
      pts_avg
    FROM analytics.player_season_averages
    WHERE season = $1
      AND player_id = ANY($2::text[])
  )
  SELECT
    coalesce(psa.player_id, mpg.player_id) AS player_id,
    coalesce(psa.games_played, mpg.gp) AS games_played,
    mpg.mpg,
    psa.pts_avg
  FROM psa
  FULL OUTER JOIN mpg ON mpg.player_id = psa.player_id
`;

/** Open-roster team abbreviation for entities in a season (any team). */
export const ENTITY_OPEN_ROSTER_TEAM_SQL = `
  SELECT
    c.player_entity_id::text AS player_entity_id,
    t.abbreviation AS team_abbr,
    c.team_id
  FROM analytics.team_roster_current c
  JOIN analytics.teams t ON t.team_id = c.team_id
  WHERE c.season = $1
    AND c.player_entity_id = ANY($2::uuid[])
`;
