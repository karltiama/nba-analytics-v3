/**
 * opponent-team-box-pgl-v1
 *
 * Reconstruct one canonical team-game box from PGL rows + game meta.
 * Does NOT read analytics.team_game_stats advanced columns.
 *
 * Possession inputs align with scripts/compute-team-stats.ts /
 * reconstructTeamMeasures (FTA weight 0.44).
 */

import {
  OPPONENT_POSSESSIONS_FORMULA_VERSION,
  OPPONENT_TEAM_BOX_VERSION,
} from '../types';

/** Same Oliver weight as compute-team-stats / reconstructTeamMeasures. Not tuned. */
export const POSSESSION_FTA_WEIGHT = 0.44;

export type OpponentPglStatRow = {
  playerId: string;
  teamId: string;
  gameId: string;
  points: number | null;
  fieldGoalsAttempted: number | null;
  freeThrowsAttempted: number | null;
  threePointersAttempted: number | null;
  turnovers: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
};

export type OpponentGameMeta = {
  gameId: string;
  season: string;
  startTime: string;
  status: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
};

/** Side stats before opponent mirror fields are attached. */
export type TeamSideAgg = {
  teamId: string;
  gameId: string;
  season: string;
  startTime: string;
  opponentTeamId: string;
  points: number;
  /** From analytics.games score (authoritative), not PGL sum. */
  pointsAllowed: number;
  fga: number;
  fta: number;
  tpa: number;
  tov: number;
  orb: number;
  drb: number;
  pglPointsSum: number;
};

export type OpponentTeamBox = TeamSideAgg & {
  opponentFga: number;
  opponentFta: number;
  opponentTpa: number;
  opponentTov: number;
  opponentOrb: number;
  opponentDrb: number;
  estimatedPossessions: number;
  usable: true;
};

export type UnusableTeamBox = {
  usable: false;
  teamId: string;
  gameId: string;
  reason: string;
};

export type TeamBoxResult = OpponentTeamBox | UnusableTeamBox;

export function isEligibleOpponentHistoryGame(game: OpponentGameMeta): boolean {
  return (
    game.status === 'Final' &&
    typeof game.startTime === 'string' &&
    game.startTime.length > 0 &&
    Number.isFinite(Date.parse(game.startTime)) &&
    game.homeScore != null &&
    game.awayScore != null &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    String(game.homeTeamId) !== String(game.awayTeamId)
  );
}

/**
 * Sum finite contributions. If no player contributed a finite value → missing (null).
 * Does not coerce null→0 at the player level.
 */
export function sumFiniteContributions(values: readonly (number | null | undefined)[]): number | null {
  let any = false;
  let sum = 0;
  for (const v of values) {
    if (v == null) continue;
    if (!Number.isFinite(v)) return null;
    any = true;
    sum += v;
  }
  return any ? sum : null;
}

function dedupePglRows(rows: readonly OpponentPglStatRow[]): {
  rows: OpponentPglStatRow[];
  duplicatePlayerRowsDropped: number;
} {
  const best = new Map<string, OpponentPglStatRow>();
  let dupes = 0;
  for (const r of rows) {
    const key = `${r.gameId}|${r.teamId}|${r.playerId}`;
    if (best.has(key)) {
      dupes += 1;
      continue; // keep first; fail-closed against double-counting
    }
    best.set(key, r);
  }
  return { rows: [...best.values()], duplicatePlayerRowsDropped: dupes };
}

export function aggregateTeamSide(args: {
  teamId: string;
  game: OpponentGameMeta;
  pglRows: readonly OpponentPglStatRow[];
}): { side: TeamSideAgg | null; reason?: string; duplicatePlayerRowsDropped: number } {
  const { teamId, game } = args;
  if (!isEligibleOpponentHistoryGame(game)) {
    return { side: null, reason: 'game_not_eligible_final_with_scores', duplicatePlayerRowsDropped: 0 };
  }
  if (String(teamId) !== String(game.homeTeamId) && String(teamId) !== String(game.awayTeamId)) {
    return { side: null, reason: 'team_not_in_game', duplicatePlayerRowsDropped: 0 };
  }

  const filtered = args.pglRows.filter(
    (r) => String(r.gameId) === String(game.gameId) && String(r.teamId) === String(teamId)
  );
  const { rows, duplicatePlayerRowsDropped } = dedupePglRows(filtered);
  if (rows.length === 0) {
    return { side: null, reason: 'no_pgl_rows', duplicatePlayerRowsDropped };
  }

  const points = sumFiniteContributions(rows.map((r) => r.points));
  const fga = sumFiniteContributions(rows.map((r) => r.fieldGoalsAttempted));
  const fta = sumFiniteContributions(rows.map((r) => r.freeThrowsAttempted));
  const tpa = sumFiniteContributions(rows.map((r) => r.threePointersAttempted));
  const tov = sumFiniteContributions(rows.map((r) => r.turnovers));
  const orb = sumFiniteContributions(rows.map((r) => r.offensiveRebounds));
  const drb = sumFiniteContributions(rows.map((r) => r.defensiveRebounds));

  const missing: string[] = [];
  if (points == null) missing.push('points');
  if (fga == null) missing.push('fga');
  if (fta == null) missing.push('fta');
  if (tpa == null) missing.push('tpa');
  if (tov == null) missing.push('tov');
  if (orb == null) missing.push('orb');
  if (drb == null) missing.push('drb');
  if (missing.length) {
    return {
      side: null,
      reason: `missing_required_fields:${missing.join(',')}`,
      duplicatePlayerRowsDropped,
    };
  }

  const isHome = String(teamId) === String(game.homeTeamId);
  const pointsAllowed = isHome ? game.awayScore! : game.homeScore!;
  const opponentTeamId = isHome ? String(game.awayTeamId) : String(game.homeTeamId);

  return {
    side: {
      teamId: String(teamId),
      gameId: String(game.gameId),
      season: String(game.season),
      startTime: game.startTime,
      opponentTeamId,
      points: points!,
      pointsAllowed,
      fga: fga!,
      fta: fta!,
      tpa: tpa!,
      tov: tov!,
      orb: orb!,
      drb: drb!,
      pglPointsSum: points!,
    },
    duplicatePlayerRowsDropped,
  };
}

export function teamPossessionEstimate(side: {
  fga: number;
  fta: number;
  orb: number;
  tov: number;
}): number {
  return side.fga + POSSESSION_FTA_WEIGHT * side.fta - side.orb + side.tov;
}

export function estimatedPossessionsBothSides(
  team: { fga: number; fta: number; orb: number; tov: number },
  opp: { fga: number; fta: number; orb: number; tov: number }
): number | null {
  const p = 0.5 * (teamPossessionEstimate(team) + teamPossessionEstimate(opp));
  if (!Number.isFinite(p) || !(p > 0)) return null;
  return p;
}

/**
 * Pair home/away sides into mirrored OpponentTeamBox rows.
 * Fail closed on mirror mismatches.
 */
export function pairMirroredTeamBoxes(args: {
  game: OpponentGameMeta;
  homeSide: TeamSideAgg;
  awaySide: TeamSideAgg;
}): { boxes: [OpponentTeamBox, OpponentTeamBox] } | { error: string } {
  const { homeSide, awaySide, game } = args;
  if (homeSide.teamId !== String(game.homeTeamId) || awaySide.teamId !== String(game.awayTeamId)) {
    return { error: 'side_team_ids_mismatch_game_meta' };
  }
  if (homeSide.opponentTeamId !== awaySide.teamId || awaySide.opponentTeamId !== homeSide.teamId) {
    return { error: 'opponent_id_mirror_failure' };
  }
  // pointsAllowed is from analytics.games scores (not PGL). Mirror against game meta only.
  if (
    homeSide.pointsAllowed !== game.awayScore ||
    awaySide.pointsAllowed !== game.homeScore
  ) {
    return { error: 'points_allowed_mirror_failure' };
  }

  const homePoss = estimatedPossessionsBothSides(homeSide, awaySide);
  const awayPoss = estimatedPossessionsBothSides(awaySide, homeSide);
  if (homePoss == null || awayPoss == null) {
    return { error: 'invalid_possession_estimate' };
  }
  if (Math.abs(homePoss - awayPoss) > 1e-9) {
    return { error: 'possession_estimate_asymmetric' };
  }

  const homeBox: OpponentTeamBox = {
    ...homeSide,
    opponentFga: awaySide.fga,
    opponentFta: awaySide.fta,
    opponentTpa: awaySide.tpa,
    opponentTov: awaySide.tov,
    opponentOrb: awaySide.orb,
    opponentDrb: awaySide.drb,
    estimatedPossessions: homePoss,
    usable: true,
  };
  const awayBox: OpponentTeamBox = {
    ...awaySide,
    opponentFga: homeSide.fga,
    opponentFta: homeSide.fta,
    opponentTpa: homeSide.tpa,
    opponentTov: homeSide.tov,
    opponentOrb: homeSide.orb,
    opponentDrb: homeSide.drb,
    estimatedPossessions: awayPoss,
    usable: true,
  };

  // Explicit mirror invariants
  if (
    homeBox.opponentFga !== awayBox.fga ||
    awayBox.opponentFga !== homeBox.fga ||
    homeBox.opponentOrb !== awayBox.orb ||
    homeBox.opponentDrb !== awayBox.drb ||
    homeBox.opponentTpa !== awayBox.tpa ||
    homeBox.opponentTov !== awayBox.tov ||
    homeBox.opponentFta !== awayBox.fta
  ) {
    return { error: 'opponent_stat_mirror_failure' };
  }

  return { boxes: [homeBox, awayBox] };
}

export function reconstructPairedBoxesForGame(args: {
  game: OpponentGameMeta;
  pglRows: readonly OpponentPglStatRow[];
}):
  | {
      ok: true;
      boxes: [OpponentTeamBox, OpponentTeamBox];
      duplicatePlayerRowsDropped: number;
      versions: {
        teamBox: typeof OPPONENT_TEAM_BOX_VERSION;
        possessions: typeof OPPONENT_POSSESSIONS_FORMULA_VERSION;
      };
    }
  | { ok: false; reason: string; duplicatePlayerRowsDropped: number } {
  const home = aggregateTeamSide({
    teamId: args.game.homeTeamId,
    game: args.game,
    pglRows: args.pglRows,
  });
  const away = aggregateTeamSide({
    teamId: args.game.awayTeamId,
    game: args.game,
    pglRows: args.pglRows,
  });
  const dupes = home.duplicatePlayerRowsDropped + away.duplicatePlayerRowsDropped;
  if (!home.side) {
    return { ok: false, reason: `home:${home.reason}`, duplicatePlayerRowsDropped: dupes };
  }
  if (!away.side) {
    return { ok: false, reason: `away:${away.reason}`, duplicatePlayerRowsDropped: dupes };
  }
  const paired = pairMirroredTeamBoxes({
    game: args.game,
    homeSide: home.side,
    awaySide: away.side,
  });
  if ('error' in paired) {
    return { ok: false, reason: paired.error, duplicatePlayerRowsDropped: dupes };
  }
  return {
    ok: true,
    boxes: paired.boxes,
    duplicatePlayerRowsDropped: dupes,
    versions: {
      teamBox: OPPONENT_TEAM_BOX_VERSION,
      possessions: OPPONENT_POSSESSIONS_FORMULA_VERSION,
    },
  };
}

/** Map box → Feature D TeamGameContextRow shape for reconstructTeamMeasures parity. */
export function toTeamGameContextRow(box: OpponentTeamBox) {
  return {
    game_id: box.gameId,
    team_id: box.teamId,
    opponent_team_id: box.opponentTeamId,
    season: box.season,
    start_time: box.startTime,
    team_points: box.points,
    team_fga: box.fga,
    team_3pa: box.tpa,
    team_fta: box.fta,
    team_turnovers: box.tov,
    offensive_rebounds: box.orb,
    points_allowed: box.pointsAllowed,
    opponent_fga: box.opponentFga,
    opponent_fta: box.opponentFta,
    opponent_turnovers: box.opponentTov,
    opponent_offensive_rebounds: box.opponentOrb,
  };
}
