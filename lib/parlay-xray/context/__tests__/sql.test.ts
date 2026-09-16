import { describe, expect, it } from 'vitest';
import {
  CONTEXT_PLAYER_LOGS_SQL,
  CONTEXT_PROJECTION_SQL,
  CONTEXT_TARGET_GAME_SQL,
  CONTEXT_TEAM_STATS_SQL,
  assertContextSqlIsAsOfSafe,
  assertContextSqlIsOutcomeFree,
} from '../sql';
import { assembleXrayLegContext } from '../assemble';
import { matchupTeamIds } from '../load';
import { CUTOFF, matchedPoints, priorLogs, resolution } from './fixtures';

describe('matchupTeamIds', () => {
  it('maps abbreviations onto the target game team ids', () => {
    const mapped = matchupTeamIds(resolution(), {
      gameId: '18447934',
      startTime: '2026-04-03T01:30:00.000Z',
      season: '2026',
      homeTeamId: '7',
      awayTeamId: '21',
      homeAbbr: 'DEN',
      awayAbbr: 'OKC',
    });
    expect(mapped.playerTeamId).toBe('21');
    expect(mapped.opponentTeamId).toBe('7');
  });
});

describe('X3C SQL and contract safety', () => {
  it('requires history SQL to use a strict cutoff and exclude the target game', () => {
    assertContextSqlIsAsOfSafe(CONTEXT_PLAYER_LOGS_SQL);
    assertContextSqlIsAsOfSafe(CONTEXT_TEAM_STATS_SQL);
    assertContextSqlIsAsOfSafe(CONTEXT_PROJECTION_SQL);
    expect(CONTEXT_PLAYER_LOGS_SQL).toMatch(/l\.game_id <> \$3/);
    expect(CONTEXT_TEAM_STATS_SQL).toMatch(/t\.game_id <> \$3/);
    expect(CONTEXT_PLAYER_LOGS_SQL).toMatch(/< \$2::timestamptz/);
    expect(CONTEXT_TEAM_STATS_SQL).toMatch(/g\.start_time < \$2::timestamptz/);
    expect(CONTEXT_PROJECTION_SQL).toMatch(/generated_at < \$3::timestamptz/);
  });

  it('does not read scores, settlements, or season-average tables', () => {
    assertContextSqlIsOutcomeFree(CONTEXT_TARGET_GAME_SQL);
    assertContextSqlIsOutcomeFree(CONTEXT_PLAYER_LOGS_SQL);
    assertContextSqlIsOutcomeFree(CONTEXT_TEAM_STATS_SQL);
    assertContextSqlIsOutcomeFree(CONTEXT_PROJECTION_SQL);
    expect(CONTEXT_TARGET_GAME_SQL).not.toMatch(/home_score|away_score/);
    expect(() => assertContextSqlIsOutcomeFree('select actual_pts from analytics.prediction_settlements')).toThrow(
      /actual_pts|prediction_settlements/
    );
  });

  it('does not mutate X3A resolution fields', () => {
    const resolved = resolution();
    const frozenName = resolved.originalLeg.playerDisplayName.value;
    const packet = assembleXrayLegContext({
      resolution: resolved,
      match: matchedPoints(),
      contextCutoffAt: CUTOFF,
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(4), priorTeamStats: [], projectionSnapshots: [] },
    });
    packet.identity.originalLeg.playerDisplayName.value = 'mutated';
    expect(resolved.originalLeg.playerDisplayName.value).toBe(frozenName);
    expect(packet.dataQuality.playerPriorSampleCount).toBe(4);
    expect(packet.role.startersPregame.reason).toBe('STARTERS_POSTGAME_CONFIRMED');
  });

  it('requires an explicit cutoff', () => {
    const packet = assembleXrayLegContext({
      resolution: resolution(),
      match: matchedPoints(),
      contextCutoffAt: '',
      season: '2026',
      sources: { priorPlayerLogs: priorLogs(10), priorTeamStats: [], projectionSnapshots: [] },
    });
    expect(packet.identity.status).toBe('NEEDS_CONFIRMATION');
    expect(packet.identity.reason).toBe('MISSING_CONTEXT_CUTOFF');
    expect(packet.playerForm.reason).toBe('MISSING_CONTEXT_CUTOFF');
  });
});
