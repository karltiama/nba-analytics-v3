import { describe, expect, it } from 'vitest';
import {
  ADVANCED_ONLY_ALEX_LEN_2023,
  DuplicateAdvancedKeyError,
  EXCLUDED_ADVANCED_FIELDS,
  SELECTED_ADVANCED_FIELDS,
  assertAdvancedGrainOrThrow,
  auditAdvancedIdentity,
  candidateKey,
  emptyGrainReport,
  extractSelectedMetrics,
  ingestArchiveRowIntoGrain,
  isExcludedAdvancedField,
  isSelectedAdvancedField,
  preserveAdvancedNumber,
  transformAdvancedArchiveRow,
} from '@/lib/archive/player-game-advanced';
import { PLAYER_GAME_ADVANCED_SEASONS } from '@/lib/betting/historical-advanced';

function archiveRow(opts: {
  gameId?: number | string | null;
  playerId?: number | string | null;
  playerName?: string;
  teamId?: number;
  playerTeamId?: number;
  season?: number;
  period?: number;
  extra?: Record<string, unknown>;
}) {
  return {
    period: opts.period ?? 0,
    player:
      opts.playerId == null
        ? { first_name: opts.playerName ?? 'Skip' }
        : {
            id: opts.playerId,
            first_name: opts.playerName ?? 'Jayson',
            last_name: 'Tatum',
            team_id: opts.playerTeamId ?? 2,
          },
    team: { id: opts.teamId ?? 2 },
    game:
      opts.gameId == null
        ? { season: opts.season ?? 2023 }
        : { id: opts.gameId, season: opts.season ?? 2023 },
    usage_percentage: 0.32,
    true_shooting_percentage: 0.587,
    effective_field_goal_percentage: 0.55,
    offensive_rating: 118.4,
    defensive_rating: 104.1,
    net_rating: 14.3,
    pace: 99.2,
    possessions: 82,
    assist_percentage: 0.21,
    rebound_percentage: 0.09,
    turnover_ratio: 8.4,
    pie: 0.142,
    switches_on: 0,
    matchup_minutes: '32:10',
    estimated_usage_percentage: 0.99,
    ...opts.extra,
  };
}

describe('selected Advanced field mapping', () => {
  it('maps approved fields and preserves 0–1 percentage scale', () => {
    const result = transformAdvancedArchiveRow(archiveRow({ gameId: 15905067, playerId: 434 }), '2023');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.gameId).toBe('15905067');
    expect(result.candidate.playerId).toBe('434');
    expect(result.candidate.metrics.usage_percentage).toBe(0.32);
    expect(result.candidate.metrics.true_shooting_percentage).toBe(0.587);
    expect(result.candidate.metrics.pie).toBe(0.142);
    expect(result.candidate.metrics.turnover_ratio).toBe(8.4);
    expect(result.candidate.metrics.possessions).toBe(82);
  });

  it('does not copy unselected fields including switches_on and matchup_*', () => {
    const result = transformAdvancedArchiveRow(archiveRow({ gameId: 1, playerId: 2 }), '2025');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate).not.toHaveProperty('switches_on');
    expect(JSON.stringify(result.candidate)).not.toContain('matchup_minutes');
    expect(JSON.stringify(result.candidate)).not.toContain('estimated_usage_percentage');
    expect(Object.keys(result.candidate.metrics).sort()).toEqual([...SELECTED_ADVANCED_FIELDS].sort());
  });

  it('preserves nulls and does not coerce missing metrics to 0', () => {
    const result = transformAdvancedArchiveRow(
      archiveRow({
        gameId: 1,
        playerId: 2,
        extra: { usage_percentage: null, pie: null, possessions: undefined },
      }),
      '2024'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.metrics.usage_percentage).toBeNull();
    expect(result.candidate.metrics.pie).toBeNull();
    expect(result.candidate.metrics.possessions).toBeNull();
    expect(preserveAdvancedNumber(null)).toBeNull();
    expect(preserveAdvancedNumber(0)).toBe(0);
  });

  it('uses nested IDs, not player names', () => {
    const result = transformAdvancedArchiveRow(
      archiveRow({ gameId: 1038324, playerId: 273, playerName: 'Wrong Name' }),
      '2023'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.playerId).toBe('273');
    expect(JSON.stringify(result.candidate)).not.toContain('Wrong Name');
  });

  it('keeps the known Advanced-only Alex Len row when identity is present', () => {
    const result = transformAdvancedArchiveRow(
      archiveRow({
        gameId: Number(ADVANCED_ONLY_ALEX_LEN_2023.gameId),
        playerId: Number(ADVANCED_ONLY_ALEX_LEN_2023.playerId),
      }),
      '2023'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { candidates, audit } = auditAdvancedIdentity({
      candidates: [result.candidate],
      gamesById: new Map([[ADVANCED_ONLY_ALEX_LEN_2023.gameId, { game_id: ADVANCED_ONLY_ALEX_LEN_2023.gameId, season: '2023' }]]),
      playerIds: new Set([ADVANCED_ONLY_ALEX_LEN_2023.playerId]),
      pglKeys: new Set(),
    });
    expect(candidates).toHaveLength(1);
    expect(audit.advancedOnlyValid).toBe(1);
    expect(audit.mapped).toBe(1);
  });
});

describe('Advanced grain + identity', () => {
  it('flags duplicate game_id+player_id instead of picking first/last', () => {
    const grain = emptyGrainReport();
    const byKey = new Map();
    const row = archiveRow({ gameId: 10, playerId: 20 });
    ingestArchiveRowIntoGrain({ row, archiveSeason: '2025', byKey, grain });
    ingestArchiveRowIntoGrain({
      row: archiveRow({ gameId: 10, playerId: 20, extra: { pie: 0.9 } }),
      archiveSeason: '2025',
      byKey,
      grain,
    });
    expect(grain.duplicateKeys).toBe(1);
    expect(grain.validLogicalRows).toBe(1);
    expect(byKey.get(candidateKey('10', '20'))?.metrics.pie).toBe(0.142);
    expect(() => assertAdvancedGrainOrThrow(grain)).toThrow(DuplicateAdvancedKeyError);
  });

  it('does not target unsupported seasons', () => {
    const result = transformAdvancedArchiveRow(archiveRow({ gameId: 1, playerId: 2, season: 2026 }), '2026');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported_season');
    expect(PLAYER_GAME_ADVANCED_SEASONS).not.toContain('2026');
  });

  it('flags unmapped game/player and season mismatch without repairing IDs', () => {
    const row = transformAdvancedArchiveRow(archiveRow({ gameId: 99, playerId: 88, season: 2025 }), '2025');
    expect(row.ok).toBe(true);
    if (!row.ok) return;
    const unmapped = auditAdvancedIdentity({
      candidates: [row.candidate],
      gamesById: new Map(),
      playerIds: new Set(['88']),
    });
    expect(unmapped.audit.unmappedGames).toBe(1);
    expect(unmapped.candidates).toHaveLength(0);

    const mismatch = auditAdvancedIdentity({
      candidates: [row.candidate],
      gamesById: new Map([['99', { game_id: '99', season: '2024' }]]),
      playerIds: new Set(['88']),
    });
    expect(mismatch.audit.seasonMismatch).toBe(1);
    expect(mismatch.candidates).toHaveLength(0);
  });

  it('classifies excluded fields', () => {
    expect(isSelectedAdvancedField('usage_percentage')).toBe(true);
    expect(isExcludedAdvancedField('switches_on')).toBe(true);
    expect(isExcludedAdvancedField('matchup_fg_pct')).toBe(true);
    expect(EXCLUDED_ADVANCED_FIELDS).toContain('estimated_usage_percentage');
  });
});
