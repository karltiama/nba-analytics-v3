import { describe, expect, it } from 'vitest';
import type { ServingGame, ServingLog } from '../bdl-to-serving';
import {
  BDL_PLAYER_POINTS_SCORE_MISMATCH,
  evaluateMappedGame,
  evaluateSeason,
  isUnresolvedHighSeverityProviderScoreMismatch,
  projectedValidationRow,
  specForGame,
  type GameEvidence,
  type RawStatRef,
} from '../provider-quality-policy';

function game(over: Partial<ServingGame> & { game_id: string; home_score: number; away_score: number }): ServingGame {
  return {
    season: '2023',
    start_time: '2024-02-07T00:00:00Z',
    status: 'Final',
    home_team_id: '23',
    away_team_id: '10',
    game_date: '2024-02-07',
    postseason: false,
    ...over,
  };
}

function logsFor(gameId: string, homePts: number[], awayPts: number[]): ServingLog[] {
  const out: ServingLog[] = [];
  homePts.forEach((pts, i) => {
    out.push({
      game_id: gameId,
      player_id: `h${i}`,
      team_id: '23',
      minutes: '20',
      points: pts,
      rebounds: 0,
      offensive_rebounds: 0,
      defensive_rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      personal_fouls: 0,
      field_goals_made: 0,
      field_goals_attempted: 0,
      three_pointers_made: 0,
      three_pointers_attempted: 0,
      free_throws_made: 0,
      free_throws_attempted: 0,
      plus_minus: 0,
      opponent_team_id: '10',
      is_home: true,
      game_date: '2024-02-07',
      season: '2023',
      pra: pts,
    });
  });
  awayPts.forEach((pts, i) => {
    out.push({
      game_id: gameId,
      player_id: `a${i}`,
      team_id: '10',
      minutes: '20',
      points: pts,
      rebounds: 0,
      offensive_rebounds: 0,
      defensive_rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      personal_fouls: 0,
      field_goals_made: 0,
      field_goals_attempted: 0,
      three_pointers_made: 0,
      three_pointers_attempted: 0,
      free_throws_made: 0,
      free_throws_attempted: 0,
      plus_minus: 0,
      opponent_team_id: '23',
      is_home: false,
      game_date: '2024-02-07',
      season: '2023',
      pra: pts,
    });
  });
  return out;
}

function rawFromLogs(rows: ServingLog[]): RawStatRef[] {
  return rows.map((l, i) => ({
    id: `stat-${l.game_id}-${i}`,
    playerId: l.player_id,
    teamId: l.team_id,
    gameId: l.game_id,
  }));
}

const sampledEvidence: GameEvidence = {
  refetchIdentical: true,
  boxScores: 'sampled_reproduced',
};

describe('2023 provider-quality policy', () => {
  it('allows a known anomaly only under the explicit persistent-provider-anomaly policy', () => {
    const spec = specForGame('1038319')!;
    const g = game({
      game_id: '1038319',
      home_score: spec.official.home,
      away_score: spec.official.away,
    });
    const rows = logsFor('1038319', [104], [125]);
    const result = evaluateMappedGame({
      season: '2023',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: sampledEvidence,
    });
    expect(result.decision).toBe('ALLOW_PERSISTENT_ANOMALY');
    expect(result.qualityFlag).toBe(true);
    const row = projectedValidationRow({ result, season: '2023', detectedAt: '2026-09-08T00:00:00Z' });
    expect(row.check_name).toBe(BDL_PLAYER_POINTS_SCORE_MISMATCH);
    expect(row.status).toBe('fail');
    expect(row.severity).toBe('error');
    expect(isUnresolvedHighSeverityProviderScoreMismatch(row)).toBe(true);
    expect(row.details).toMatchObject({ source: 'balldontlie' });
  });

  it('fails closed on an unknown score mismatch', () => {
    const g = game({ game_id: '9999999', home_score: 100, away_score: 100 });
    const rows = logsFor('9999999', [100], [98]);
    const result = evaluateMappedGame({
      season: '2023',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: sampledEvidence,
    });
    expect(result.decision).toBe('REJECT');
    expect(result.reason).toMatch(/unknown score mismatch/);
    expect(result.qualityFlag).toBe(false);
  });

  it('fails closed when a known id gains a new structural defect', () => {
    const spec = specForGame('1038319')!;
    const g = game({
      game_id: '1038319',
      home_score: spec.official.home,
      away_score: spec.official.away,
    });
    const rows = logsFor('1038319', [104], [125]);
    rows.push({ ...rows[0]!, player_id: rows[0]!.player_id });
    const result = evaluateMappedGame({
      season: '2023',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: sampledEvidence,
    });
    expect(result.decision).toBe('REJECT');
    expect(result.reason).toMatch(/structural defect/);
  });

  it('fails closed when a known id mismatch changes unexpectedly', () => {
    const spec = specForGame('1038319')!;
    const g = game({
      game_id: '1038319',
      home_score: spec.official.home,
      away_score: spec.official.away,
    });
    const rows = logsFor('1038319', [104], [120]);
    const result = evaluateMappedGame({
      season: '2023',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: sampledEvidence,
    });
    expect(result.decision).toBe('REJECT');
    expect(result.reason).toMatch(/drifted from reviewed allowlist/);
  });

  it('requires review if a known id suddenly reconciles', () => {
    const spec = specForGame('1038319')!;
    const g = game({
      game_id: '1038319',
      home_score: spec.official.home,
      away_score: spec.official.away,
    });
    const rows = logsFor('1038319', [104], [127]);
    const result = evaluateMappedGame({
      season: '2023',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: sampledEvidence,
    });
    expect(result.decision).toBe('REJECT');
    expect(result.reason).toMatch(/requires review/);
  });

  it('keeps the normal validation path for clean games', () => {
    const g = game({ game_id: '1000001', home_score: 110, away_score: 108 });
    const rows = logsFor('1000001', [50, 60], [108]);
    const result = evaluateMappedGame({
      season: '2023',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: { refetchIdentical: false, boxScores: 'not_applicable' },
    });
    expect(result.decision).toBe('ALLOW_STRICT');
    expect(result.qualityFlag).toBe(false);
  });

  it('does not apply the 2023 allowlist to another season', () => {
    const spec = specForGame('1038319')!;
    const g = game({
      game_id: '1038319',
      season: '2024',
      home_score: spec.official.home,
      away_score: spec.official.away,
    });
    const rows = logsFor('1038319', [104], [125]).map((l) => ({ ...l, season: '2024' }));
    const result = evaluateMappedGame({
      season: '2024',
      game: g,
      logs: rows,
      rawStats: rawFromLogs(rows),
      evidence: sampledEvidence,
    });
    expect(result.decision).toBe('REJECT');
    expect(result.reason).toMatch(/unknown score mismatch/);
  });

  it('does not expose a generic ignoreScoreMismatch switch', () => {
    expect(String(evaluateMappedGame)).not.toMatch(/ignoreScoreMismatch/);
    const season = evaluateSeason({
      season: '2023',
      games: [game({ game_id: '1000001', home_score: 10, away_score: 10 })],
      logsByGame: new Map([['1000001', logsFor('1000001', [10], [10])]]),
      rawStatsByGame: new Map([['1000001', rawFromLogs(logsFor('1000001', [10], [10]))]]),
      evidenceByGame: new Map(),
    });
    expect(season.canMaterialize).toBe(true);
    expect(season.allowStrict).toBe(1);
  });
});
