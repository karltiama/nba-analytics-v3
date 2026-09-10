import { describe, expect, it } from 'vitest';
import {
  DuplicateRoleCategoryError,
  auditRoleIdentity,
  coverageFlags,
  createRoleIngestState,
  derivePrimaryRoleLabel,
  extractSeasonAverageRows,
  finalizeRoleCandidates,
  ingestSeasonAverageRow,
  isApprovedRoleCategory,
  isRoleProfileArchivePageKey,
  parseRoleArchivePageKey,
  selectedFieldsFromStats,
} from '@/lib/archive/player-role-profile';

function playtypeRow(playerId: string, season: number, possPct: number, ppp: number) {
  return {
    player: { id: playerId },
    season,
    season_type: 'regular',
    stats: { poss_pct: possPct, ppp, gp: 63, play_type: 'Isolation' },
  };
}

describe('Role Profile archive transform', () => {
  it('merges approved categories onto one player-season row', () => {
    const state = createRoleIngestState();
    ingestSeasonAverageRow({
      row: playtypeRow('175', 2025, 0.28, 1.163),
      archiveSeason: '2025',
      type: 'isolation',
      state,
    });
    ingestSeasonAverageRow({
      row: {
        player: { id: '175' },
        season: 2025,
        stats: { poss_pct: 0.36, ppp: 1.199 },
      },
      archiveSeason: '2025',
      type: 'prballhandler',
      state,
    });
    ingestSeasonAverageRow({
      row: {
        player: { id: '175' },
        season: 2025,
        stats: { drives: 25.8, drive_pts: 18.4, drive_fg_pct: 0.55 },
      },
      archiveSeason: '2025',
      type: 'drives',
      state,
    });
    ingestSeasonAverageRow({
      row: {
        player: { id: '175' },
        season: 2025,
        stats: { passes_made: 38.1, potential_ast: 9.2, ast: 6.4 },
      },
      archiveSeason: '2025',
      type: 'passing',
      state,
    });
    ingestSeasonAverageRow({
      row: {
        player: { id: '175' },
        season: 2025,
        stats: {
          restricted_area_fga: 4.1,
          restricted_area_fg_pct: 0.62,
          'in_the_paint_(non-ra)_fga': 2.2,
          'in_the_paint_(non-ra)_fg_pct': 0.45,
          'mid-range_fga': 1.1,
          'mid-range_fg_pct': 0.4,
          corner_3_fga: 0.8,
          corner_3_fg_pct: 0.39,
          above_the_break_3_fga: 3.0,
          above_the_break_3_fg_pct: 0.35,
          backcourt_fga: 0,
        },
      },
      archiveSeason: '2025',
      type: 'by_zone',
      state,
    });
    const rows = finalizeRoleCandidates(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerId).toBe('175');
    expect(rows[0]?.season).toBe('2025');
    expect(rows[0]?.metrics.isolationPossPct).toBe(0.28);
    expect(rows[0]?.metrics.pnrBallHandlerPossPct).toBe(0.36);
    expect(rows[0]?.metrics.drivesPerGame).toBe(25.8);
    expect(rows[0]?.metrics.passesPerGame).toBe(38.1);
    expect(rows[0]?.metrics.potentialAssistsPerGame).toBe(9.2);
    expect(rows[0]?.metrics.restrictedAreaFga).toBe(4.1);
    expect(rows[0]?.metrics.paintNonRaFga).toBe(2.2);
    expect(coverageFlags(rows[0]!.metrics).isolation).toBe(true);
    expect(coverageFlags(rows[0]!.metrics).zone).toBe(true);
  });

  it('preserves missing playtype as null and still emits a partial profile', () => {
    const state = createRoleIngestState();
    ingestSeasonAverageRow({
      row: { player: { id: '999' }, season: 2024, stats: { drives: 3.9, drive_pts: 1.2 } },
      archiveSeason: '2024',
      type: 'drives',
      state,
    });
    const rows = finalizeRoleCandidates(state);
    expect(rows[0]?.metrics.isolationPossPct).toBeNull();
    expect(rows[0]?.metrics.pnrBallHandlerPossPct).toBeNull();
    expect(rows[0]?.metrics.drivesPerGame).toBe(3.9);
    expect(coverageFlags(rows[0]!.metrics).isolation).toBe(false);
  });

  it('does not treat explicit source zero as missing', () => {
    const patch = selectedFieldsFromStats('isolation', { poss_pct: 0, ppp: 0 });
    expect(patch.isolationPossPct).toBe(0);
    expect(patch.isolationPpp).toBe(0);
  });

  it('excludes unsupported categories and seasons', () => {
    const state = createRoleIngestState();
    ingestSeasonAverageRow({
      row: playtypeRow('175', 2022, 0.2, 1),
      archiveSeason: '2022',
      type: 'isolation',
      state,
    });
    ingestSeasonAverageRow({
      row: playtypeRow('175', 2025, 0.2, 1),
      archiveSeason: '2025',
      type: 'spotup',
      state,
    });
    expect(finalizeRoleCandidates(state)).toHaveLength(0);
    expect(state.grain.skippedUnsupportedSeason).toBe(1);
    expect(state.grain.skippedUnsupportedCategory).toBe(1);
    expect(isApprovedRoleCategory('spotup')).toBe(false);
  });

  it('throws on conflicting duplicate category values and accepts identical reruns', () => {
    const state = createRoleIngestState();
    ingestSeasonAverageRow({
      row: playtypeRow('175', 2025, 0.28, 1.163),
      archiveSeason: '2025',
      type: 'isolation',
      state,
    });
    ingestSeasonAverageRow({
      row: playtypeRow('175', 2025, 0.28, 1.163),
      archiveSeason: '2025',
      type: 'isolation',
      state,
    });
    expect(state.grain.duplicateIdentical).toBe(1);
    expect(() =>
      ingestSeasonAverageRow({
        row: playtypeRow('175', 2025, 0.5, 1.163),
        archiveSeason: '2025',
        type: 'isolation',
        state,
      })
    ).toThrow(DuplicateRoleCategoryError);
  });

  it('drops unmapped players and unsupported seasons in identity audit', () => {
    const emptyMetrics = {
      isolationPossPct: null as number | null,
      isolationPpp: null as number | null,
      pnrBallHandlerPossPct: null as number | null,
      pnrBallHandlerPpp: null as number | null,
      pnrRollManPossPct: null as number | null,
      pnrRollManPpp: null as number | null,
      drivesPerGame: null as number | null,
      drivePointsPerGame: null as number | null,
      passesPerGame: null as number | null,
      potentialAssistsPerGame: null as number | null,
      restrictedAreaFga: null as number | null,
      restrictedAreaFgPct: null as number | null,
      paintNonRaFga: null as number | null,
      paintNonRaFgPct: null as number | null,
      midrangeFga: null as number | null,
      midrangeFgPct: null as number | null,
      cornerThreeFga: null as number | null,
      cornerThreeFgPct: null as number | null,
      aboveBreakThreeFga: null as number | null,
      aboveBreakThreeFgPct: null as number | null,
    };
    const audited = auditRoleIdentity({
      candidates: [
        {
          playerId: '175',
          season: '2025',
          source: 'x',
          metrics: { ...emptyMetrics, isolationPossPct: 0.28, isolationPpp: 1.16 },
        },
        {
          playerId: 'missing',
          season: '2025',
          source: 'x',
          metrics: { ...emptyMetrics, drivesPerGame: 1, drivePointsPerGame: 1 },
        },
        {
          playerId: '175',
          season: '2022',
          source: 'x',
          metrics: { ...emptyMetrics, isolationPossPct: 0.1, isolationPpp: 1 },
        },
      ],
      playerIds: new Set(['175']),
    });
    expect(audited.audit.mapped).toBe(1);
    expect(audited.audit.unmappedPlayers).toBe(1);
    expect(audited.audit.unsupportedSeason).toBe(1);
    expect(audited.candidates[0]?.playerId).toBe('175');
  });

  it('parses canonical page keys and envelope data arrays', () => {
    const key =
      'raw/source=balldontlie/league=nba/entity=season_averages/season=2023/season_type=regular/category=playtype/type=isolation/batch=01/page=1.json';
    expect(isRoleProfileArchivePageKey(key)).toBe(true);
    expect(parseRoleArchivePageKey(key)).toEqual({
      season: '2023',
      category: 'playtype',
      type: 'isolation',
    });
    expect(
      isRoleProfileArchivePageKey(
        'raw/source=balldontlie/league=nba/entity=season_averages/_characterization/season=2025/season_type=regular/category=playtype/type=isolation.json'
      )
    ).toBe(false);
    expect(extractSeasonAverageRows({ data: [playtypeRow('175', 2025, 0.28, 1)] })).toHaveLength(1);
    expect(
      extractSeasonAverageRows({
        request: { path: '/nba/v1/season_averages/playtype' },
        hasMore: false,
        body: { data: [playtypeRow('175', 2025, 0.28, 1)] },
      })
    ).toHaveLength(1);
  });

  it('does not derive a primary-role archetype', () => {
    expect(derivePrimaryRoleLabel({ ...emptyMetrics(), isolationPossPct: 0.4, pnrBallHandlerPossPct: 0.1 })).toBeNull();
  });
});

function emptyMetrics() {
  return {
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
