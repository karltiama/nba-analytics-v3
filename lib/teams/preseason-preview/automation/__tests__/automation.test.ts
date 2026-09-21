import { describe, expect, it } from 'vitest';
import { assemblePreseasonDraft } from '../assemble';
import { rankPlayerWatchCandidates } from '../candidates';
import { deriveRoleWatch } from '../role-watch';
import { derivePreseasonContextSignals } from '../signals';
import { validatePreseasonPreviewDraft } from '../validate';
import { computeRosterContinuity } from '@/lib/teams/team-roster-continuity';
import {
  USAGE_AGGREGATION_METHOD,
  MIN_USAGE_MINUTES_PER_GAME,
} from '../policy';
import type {
  FactProvenance,
  PacketPlayerRoleStats,
  PreseasonTeamPacket,
} from '../types';

const PROV: FactProvenance = {
  method: 'test',
  tables: ['test'],
  season: '2025',
};

function player(
  id: string,
  name: string,
  playerId: string | null = id.slice(0, 8)
) {
  return {
    playerEntityId: id,
    displayName: name,
    playerId,
    position: 'G' as string | null,
  };
}

function roleStats(
  partial: Partial<PacketPlayerRoleStats> & {
    playerEntityId: string;
    displayName: string;
  }
): PacketPlayerRoleStats {
  return {
    playerId: partial.playerId ?? '1',
    gamesPlayed: partial.gamesPlayed ?? 70,
    mpg: partial.mpg ?? null,
    ppg: partial.ppg ?? null,
    usageAvg: partial.usageAvg ?? null,
    usageGames: partial.usageGames ?? null,
    usageTotalMinutes: partial.usageTotalMinutes ?? null,
    recentCompetitive: partial.recentCompetitive ?? null,
    provenance: PROV,
    ...partial,
  };
}

function basePacket(
  overrides: Partial<PreseasonTeamPacket> = {}
): PreseasonTeamPacket {
  const returning = [
    player('11111111-1111-1111-1111-111111111111', 'Returner High'),
  ];
  const additions = [
    player('22222222-2222-2222-2222-222222222222', 'New Addition'),
  ];
  const departures = [
    player('33333333-3333-3333-3333-333333333333', 'Departed Big'),
  ];

  return {
    version: 'preseason-team-packet-v1.1',
    generatedAt: '2026-09-20T00:00:00.000Z',
    season: '2026',
    previousSeason: '2025',
    team: {
      teamId: '9',
      slug: 'DET',
      name: 'Detroit Pistons',
      abbreviation: 'DET',
      conference: 'East',
    },
    previousSeasonRegular: {
      season: '2025',
      available: true,
      unavailableReason: null,
      metricsScope: 'regular_season',
      postseasonStartEt: '2026-04-14',
      gamesPlayed: 82,
      wins: 44,
      losses: 38,
      record: '44–38',
      offensiveRating: 112.1,
      defensiveRating: 110.2,
      pace: 99.5,
      provenance: PROV,
    },
    previousSeasonAllGames: {
      season: '2025',
      available: true,
      unavailableReason: null,
      wins: 50,
      losses: 40,
      record: '50–40',
      offensiveRating: 113,
      defensiveRating: 109,
      pace: 100,
      gamesPlayed: 96,
      includesPostseason: true,
      metricsScope: 'all_games',
      scopeNote: 'Includes postseason',
      provenance: PROV,
    },
    currentRoster: [...returning, ...additions],
    previousRoster: [...returning, ...departures],
    additions,
    departures,
    returningPlayers: returning,
    playerSeasonStats: [
      roleStats({
        playerEntityId: returning[0].playerEntityId,
        displayName: 'Returner High',
        mpg: 32,
        usageAvg: 0.28,
        usageGames: 70,
        usageTotalMinutes: 2100,
        recentCompetitive: {
          gamesIncluded: 10,
          dateRangeStart: '2026-03-01',
          dateRangeEnd: '2026-04-20',
          regularSeasonGameCount: 6,
          postseasonGameCount: 4,
          baselineMpg: 32,
          recentMpg: 38,
          includesPostseasonByPolicy: true,
        },
      }),
      roleStats({
        playerEntityId: additions[0].playerEntityId,
        displayName: 'New Addition',
        mpg: 30,
        gamesPlayed: 65,
      }),
      roleStats({
        playerEntityId: departures[0].playerEntityId,
        displayName: 'Departed Big',
        mpg: 29,
        gamesPlayed: 72,
      }),
    ],
    schedule: {
      games: [],
      unavailableReason: 'none',
      provenance: PROV,
    },
    availableWowySummaries: [],
    warnings: [],
    provenanceSummary: [PROV],
    ...overrides,
  };
}

describe('roster continuity reuse', () => {
  it('is deterministic on entity ids', () => {
    const a = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [
        { playerEntityId: 'a', displayName: 'A', playerId: '1' },
        { playerEntityId: 'b', displayName: 'B', playerId: '2' },
      ],
      previous: [
        { playerEntityId: 'a', displayName: 'A', playerId: '1' },
        { playerEntityId: 'c', displayName: 'C', playerId: '3' },
      ],
    });
    expect(a.returning.map((p) => p.playerEntityId)).toEqual(['a']);
    expect(a.added.map((p) => p.playerEntityId)).toEqual(['b']);
    expect(a.departed.map((p) => p.playerEntityId)).toEqual(['c']);
  });

  it('does not merge same display names with different entities', () => {
    const result = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [
        { playerEntityId: 'e1', displayName: 'Same Name', playerId: '1' },
      ],
      previous: [
        { playerEntityId: 'e2', displayName: 'Same Name', playerId: '2' },
      ],
    });
    expect(result.added).toHaveLength(1);
    expect(result.departed).toHaveLength(1);
    expect(result.returning).toHaveLength(0);
  });
});

describe('derivePreseasonContextSignals V1.1', () => {
  it('emits RECENT_COMPETITIVE_MINUTES_INCREASE with scope evidence', () => {
    const signals = derivePreseasonContextSignals(basePacket());
    const types = signals.map((s) => s.type);
    expect(types).toContain('VACATED_MINUTES');
    expect(types).toContain('RETURNING_HIGH_MINUTE_PLAYER');
    expect(types).toContain('HIGH_USAGE_RETURNER');
    expect(types).toContain('NEW_HIGH_MINUTE_ADDITION');
    expect(types).toContain('RECENT_COMPETITIVE_MINUTES_INCREASE');
    expect(types).not.toContain('LATE_SEASON_MINUTES_INCREASE');
    expect(types).not.toContain('VACATED_USAGE');

    const recent = signals.find(
      (s) => s.type === 'RECENT_COMPETITIVE_MINUTES_INCREASE'
    )!;
    expect(recent.evidence.postseasonGameCount).toBe(4);
    expect(recent.evidence.regularSeasonGameCount).toBe(6);
    expect(recent.evidence.includesPostseasonByPolicy).toBe(true);
    expect(recent.evidence.scopeLabel).toBe(
      'recent_competitive_not_regular_season_only'
    );
  });

  it('documents usage aggregation method on HIGH_USAGE_RETURNER', () => {
    const signals = derivePreseasonContextSignals(basePacket());
    const usage = signals.find((s) => s.type === 'HIGH_USAGE_RETURNER')!;
    expect(usage.evidence.aggregationMethod).toBe(USAGE_AGGREGATION_METHOD);
    expect(MIN_USAGE_MINUTES_PER_GAME).toBe(5);
  });

  it('skips HIGH_USAGE when total minutes gate fails', () => {
    const packet = basePacket({
      playerSeasonStats: [
        roleStats({
          playerEntityId: '11111111-1111-1111-1111-111111111111',
          displayName: 'Returner High',
          mpg: 32,
          usageAvg: 0.3,
          usageGames: 25,
          usageTotalMinutes: 50,
        }),
      ],
    });
    const types = derivePreseasonContextSignals(packet).map((s) => s.type);
    expect(types).not.toContain('HIGH_USAGE_RETURNER');
  });

  it('is deterministic for the same packet', () => {
    const packet = basePacket();
    expect(derivePreseasonContextSignals(packet)).toEqual(
      derivePreseasonContextSignals(packet)
    );
  });
});

describe('public snapshot vs all-games', () => {
  it('assembles regular-season fields and excludes all-games from public snapshot', () => {
    const packet = basePacket();
    const draft = assemblePreseasonDraft({ packet });
    expect(draft.snapshot.regularSeasonRecord).toBe('44–38');
    expect(draft.snapshot.allGamesMetricsExcludedFromPublicSnapshot).toBe(true);
    expect(draft.snapshot.regularSeasonRecord).not.toBe(
      packet.previousSeasonAllGames.record
    );
    expect(validatePreseasonPreviewDraft(draft, packet).ok).toBe(true);
  });

  it('keeps draft valid when regular-season snapshot unavailable', () => {
    const packet = basePacket({
      previousSeasonRegular: {
        season: '2025',
        available: false,
        unavailableReason: 'missing calendar',
        metricsScope: 'regular_season',
        postseasonStartEt: null,
        gamesPlayed: 0,
        wins: null,
        losses: null,
        record: null,
        offensiveRating: null,
        defensiveRating: null,
        pace: null,
        provenance: PROV,
      },
    });
    const draft = assemblePreseasonDraft({ packet });
    expect(draft.snapshot.regularSeasonRecord).toBeNull();
    expect(draft.snapshot.regularSeasonOffensiveRating).toBeNull();
    expect(validatePreseasonPreviewDraft(draft, packet).ok).toBe(true);
    expect(draft.sourceSummary.unavailableFields).toContain(
      'snapshot.regularSeasonRecord'
    );
  });

  it('rejects public snapshot that copies postseason-contaminated all-games record', () => {
    const packet = basePacket();
    const draft = assemblePreseasonDraft({ packet });
    draft.snapshot.regularSeasonRecord = packet.previousSeasonAllGames.record;
    const result = validatePreseasonPreviewDraft(draft, packet);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('all-games'))
    ).toBe(true);
  });
});

describe('candidates and role watch', () => {
  it('attaches RECENT_COMPETITIVE reasons', () => {
    const packet = basePacket();
    const signals = derivePreseasonContextSignals(packet);
    const candidates = rankPlayerWatchCandidates(packet, signals);
    expect(
      candidates.some((c) =>
        c.reasons.includes('RECENT_COMPETITIVE_MINUTES_INCREASE')
      )
    ).toBe(true);
  });

  it('labels role watch MINUTES_UP from recent competitive evidence', () => {
    const signals = derivePreseasonContextSignals(basePacket());
    const roles = deriveRoleWatch(signals);
    expect(roles.some((r) => r.label === 'MINUTES_UP')).toBe(true);
  });
});

describe('validatePreseasonPreviewDraft', () => {
  it('accepts a dry assembled draft', () => {
    const packet = basePacket();
    const draft = assemblePreseasonDraft({ packet });
    const result = validatePreseasonPreviewDraft(draft, packet);
    expect(result.ok).toBe(true);
    expect(result.draft.review.status).toBe('NEEDS_REVIEW');
  });

  it('rejects unknown player ids', () => {
    const packet = basePacket();
    const draft = assemblePreseasonDraft({ packet });
    draft.rosterChanges.additions.push({
      playerEntityId: '99999999-9999-9999-9999-999999999999',
      playerId: null,
      name: 'Fake',
      context: null,
    });
    expect(validatePreseasonPreviewDraft(draft, packet).ok).toBe(false);
  });

  it('rejects invented wowy when packet has none', () => {
    const packet = basePacket();
    const draft = assemblePreseasonDraft({ packet });
    draft.wowyContext.push({
      title: 'x',
      detail: 'y',
      disclaimer: 'z',
    });
    expect(validatePreseasonPreviewDraft(draft, packet).ok).toBe(false);
  });
});
