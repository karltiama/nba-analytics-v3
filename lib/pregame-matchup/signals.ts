/**
 * Deterministic matchup contrasts. A signal is shown only when the two teams differ by at least
 * one league-wide team standard deviation on that measure. The score is a ranking key, not a
 * win probability, and it is not shown.
 *
 * Ratings describe the 2025–26 regular-season teams. They are not a prediction and not a roster fact.
 */

import type { TeamProfile } from './aggregate';

/** One team-standard-deviation gap. Below this, the teams are not treated as distinguishable. */
export const MIN_STANDARDIZED_GAP = 1;

export const ROSTER_LIMITATION =
  'These figures describe 2025–26 regular-season teams. Current rosters are not verified, so this is not a prediction for tonight.';

export type MatchupInsight = {
  id: 'efficiency' | 'three_point_rate' | 'offensive_rebounding' | 'turnover_rate' | 'estimated_possessions';
  headline: string;
  body: string;
  evidence: string;
  limitation: string;
};

type Side = { abbr: string; profile: TeamProfile };

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  return Number.isFinite(sd) && sd > 0 ? sd : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Number.isFinite(value) ? value : null;
}

function gap(diff: number, sd: number | null): number | null {
  if (sd == null || !Number.isFinite(diff)) return null;
  const z = Math.abs(diff) / sd;
  return Number.isFinite(z) ? z : null;
}

function num(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  const text = num(value);
  return value > 0 ? `+${text}` : text;
}

export function selectMatchupInsights(input: {
  away: Side;
  home: Side;
  league: TeamProfile[];
}): MatchupInsight[] {
  const { away, home, league } = input;
  if (league.length < 2) return [];
  const ortgSd = sampleSd(league.map((team) => team.offensiveRating));
  const drtgSd = sampleSd(league.map((team) => team.defensiveRating));
  const fg3Sd = sampleSd(league.map((team) => team.threePointAttemptRate));
  const orbSd = sampleSd(league.map((team) => team.offensiveReboundRate));
  const tovSd = sampleSd(league.map((team) => team.turnoverRate));
  const possSd = sampleSd(league.map((team) => team.estimatedPossessionsPerGame));
  const meanO = mean(league.map((team) => team.offensiveRating));
  const meanD = mean(league.map((team) => team.defensiveRating));
  if (meanO == null || meanD == null) return [];

  const candidates: Array<{ absZ: number; rank: number; insight: MatchupInsight }> = [];

  const directions = [
    { offense: away, defense: home },
    { offense: home, defense: away },
  ];
  let bestEfficiency: { absZ: number; insight: MatchupInsight } | null = null;
  for (const pair of directions) {
    const surprise = pair.offense.profile.offensiveRating - pair.defense.profile.defensiveRating - (meanO - meanD);
    const scale = ortgSd != null && drtgSd != null ? Math.sqrt(ortgSd ** 2 + drtgSd ** 2) : null;
    const absZ = gap(surprise, scale);
    if (absZ == null || absZ < MIN_STANDARDIZED_GAP) continue;
    const insight: MatchupInsight = {
      id: 'efficiency',
      headline: `${pair.offense.abbr} offense, ${pair.defense.abbr} defense`,
      body: `${pair.offense.abbr} scored ${num(pair.offense.profile.offensiveRating)} points per 100 estimated possessions. ${pair.defense.abbr} allowed ${num(pair.defense.profile.defensiveRating)}. Relative to a typical 2025–26 team, that offense-versus-defense gap stands out. It describes last season's teams, not a winner tonight.`,
      evidence: `${pair.offense.abbr} offensive rating ${num(pair.offense.profile.offensiveRating)} · ${pair.defense.abbr} defensive rating ${num(pair.defense.profile.defensiveRating)}`,
      limitation: ROSTER_LIMITATION,
    };
    if (!bestEfficiency || absZ > bestEfficiency.absZ) bestEfficiency = { absZ, insight };
  }
  if (bestEfficiency) candidates.push({ absZ: bestEfficiency.absZ, rank: 1, insight: bestEfficiency.insight });

  const fg3Z = gap(away.profile.threePointAttemptRate - home.profile.threePointAttemptRate, fg3Sd);
  if (fg3Z != null && fg3Z >= MIN_STANDARDIZED_GAP) {
    const higher = away.profile.threePointAttemptRate >= home.profile.threePointAttemptRate ? away : home;
    const lower = higher === away ? home : away;
    candidates.push({
      absZ: fg3Z,
      rank: 2,
      insight: {
        id: 'three_point_rate',
        headline: `${higher.abbr} lived on more threes`,
        body: `${higher.abbr} took threes on ${pct(higher.profile.threePointAttemptRate)} of its field-goal attempts. ${lower.abbr} took them on ${pct(lower.profile.threePointAttemptRate)}. The volume difference is large enough, against the league's team spread, to be a stylistic contrast. It is not a made-three prediction.`,
        evidence: `${higher.abbr} 3PA rate ${pct(higher.profile.threePointAttemptRate)} · ${lower.abbr} 3PA rate ${pct(lower.profile.threePointAttemptRate)}`,
        limitation: ROSTER_LIMITATION,
      },
    });
  }

  const reboundDirections = [
    { offense: away, defense: home },
    { offense: home, defense: away },
  ];
  let bestRebound: { absZ: number; insight: MatchupInsight } | null = null;
  for (const pair of reboundDirections) {
    const absZ = gap(pair.offense.profile.offensiveReboundRate - pair.defense.profile.opponentOffensiveReboundRate, orbSd);
    if (absZ == null || absZ < MIN_STANDARDIZED_GAP) continue;
    const insight: MatchupInsight = {
      id: 'offensive_rebounding',
      headline: 'Second-chance profile',
      body: `${pair.offense.abbr} grabbed ${pct(pair.offense.profile.offensiveReboundRate)} of its missed shots. Opponents grabbed ${pct(pair.defense.profile.opponentOffensiveReboundRate)} of their misses against ${pair.defense.abbr}. Rebounding is a place these historical profiles differ. It does not say who will control the glass tonight.`,
      evidence: `${pair.offense.abbr} offensive-rebounding rate ${pct(pair.offense.profile.offensiveReboundRate)} · opponents' offensive-rebounding rate against ${pair.defense.abbr} ${pct(pair.defense.profile.opponentOffensiveReboundRate)}`,
      limitation: ROSTER_LIMITATION,
    };
    if (!bestRebound || absZ > bestRebound.absZ) bestRebound = { absZ, insight };
  }
  if (bestRebound) candidates.push({ absZ: bestRebound.absZ, rank: 3, insight: bestRebound.insight });

  const tovZ = gap(away.profile.turnoverRate - home.profile.turnoverRate, tovSd);
  if (tovZ != null && tovZ >= MIN_STANDARDIZED_GAP) {
    const higher = away.profile.turnoverRate >= home.profile.turnoverRate ? away : home;
    const lower = higher === away ? home : away;
    candidates.push({
      absZ: tovZ,
      rank: 4,
      insight: {
        id: 'turnover_rate',
        headline: `${higher.abbr} gave the ball up more often`,
        body: `${higher.abbr}'s turnover rate was ${pct(higher.profile.turnoverRate)}. ${lower.abbr}'s was ${pct(lower.profile.turnoverRate)}. The gap is wide relative to other 2025–26 teams. Turnover rate here is turnovers divided by shot attempts, a free-throw estimate, and turnovers. It is not a steal projection.`,
        evidence: `${higher.abbr} turnover rate ${pct(higher.profile.turnoverRate)} · ${lower.abbr} turnover rate ${pct(lower.profile.turnoverRate)}`,
        limitation: ROSTER_LIMITATION,
      },
    });
  }

  const possZ = gap(away.profile.estimatedPossessionsPerGame - home.profile.estimatedPossessionsPerGame, possSd);
  if (possZ != null && possZ >= MIN_STANDARDIZED_GAP) {
    const higher = away.profile.estimatedPossessionsPerGame >= home.profile.estimatedPossessionsPerGame ? away : home;
    const lower = higher === away ? home : away;
    candidates.push({
      absZ: possZ,
      rank: 5,
      insight: {
        id: 'estimated_possessions',
        headline: 'Different estimated possession counts',
        body: `${higher.abbr} averaged ${num(higher.profile.estimatedPossessionsPerGame)} estimated possessions per game. ${lower.abbr} averaged ${num(lower.profile.estimatedPossessionsPerGame)}. This is a box-score possession estimate, not official NBA pace, and it is not adjusted for overtime.`,
        evidence: `${higher.abbr} ${num(higher.profile.estimatedPossessionsPerGame)} estimated possessions/game · ${lower.abbr} ${num(lower.profile.estimatedPossessionsPerGame)}`,
        limitation: ROSTER_LIMITATION,
      },
    });
  }

  candidates.sort((a, b) => b.absZ - a.absZ || a.rank - b.rank);
  return candidates.slice(0, 3).map((candidate) => candidate.insight);
}

export function formatNet(value: number): string {
  return signed(value);
}
