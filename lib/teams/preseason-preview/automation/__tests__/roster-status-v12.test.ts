import { describe, expect, it } from 'vitest';
import {
  classifyRosterStatuses,
  partitionRosterStatuses,
} from '../roster-status';
import { buildResearchPacketFromTeamPacket } from '../build-research-packet';
import { assemblePreseasonDraft } from '../assemble';
import { validatePreseasonPreviewDraft } from '../validate';
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

function p(
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

describe('classifyRosterStatuses V1.2', () => {
  const teamId = '2';
  const teamAbbr = 'BOS';
  const season = '2026';
  const previousSeason = '2025';

  it('1. returning player on both open rosters is RETURNING', () => {
    const rows = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [p('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Star')],
      current: [p('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Star')],
      elsewhereCurrentByEntity: new Map(),
      elsewherePreviousByEntity: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('RETURNING');
    expect(rows[0].confidence).toBe('high');
    expect(rows[0].evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('2. missing from current snapshot alone is UNRESOLVED not DEPARTED', () => {
    const rows = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [p('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Ghost')],
      current: [],
      elsewhereCurrentByEntity: new Map(),
      elsewherePreviousByEntity: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('UNRESOLVED');
    expect(rows[0].status).not.toBe('DEPARTED');
  });

  it('3. elsewhere current open roster confirms DEPARTED', () => {
    const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const elsewhere = new Map([
      [
        id,
        { playerEntityId: id, teamAbbr: 'PHI', teamId: '23' },
      ],
    ]);
    const rows = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [p(id, 'Jaylen Brown', '70')],
      current: [],
      elsewhereCurrentByEntity: elsewhere,
      elsewherePreviousByEntity: new Map(),
    });
    expect(rows[0].status).toBe('DEPARTED');
    expect(rows[0].otherTeamAbbr).toBe('PHI');
    expect(rows[0].evidence.some((e) => e.path.includes('PHI'))).toBe(true);
  });

  it('4. ambiguous absence becomes UNRESOLVED', () => {
    const rows = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [p('dddddddd-dddd-dddd-dddd-dddddddddddd', 'MaybeOut')],
      current: [p('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Stay')],
      elsewhereCurrentByEntity: new Map(),
      elsewherePreviousByEntity: new Map(),
    });
    const parts = partitionRosterStatuses(rows);
    expect(parts.unresolved.map((u) => u.displayName)).toContain('MaybeOut');
    expect(parts.departed).toHaveLength(0);
    expect(parts.added.map((r) => r.displayName)).toContain('Stay');
    expect(parts.returning).toHaveLength(0);
  });

  it('5. research packet never promotes unresolved into confirmed departure', () => {
    const unresolvedId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const returningId = '11111111-1111-1111-1111-111111111111';
    const statuses = classifyRosterStatuses({
      season,
      previousSeason,
      teamId,
      teamAbbr,
      previous: [
        p(unresolvedId, 'Unresolved Guy'),
        p(returningId, 'Returner'),
      ],
      current: [p(returningId, 'Returner')],
      elsewhereCurrentByEntity: new Map(),
      elsewherePreviousByEntity: new Map(),
    });

    const packet = minimalPacket({
      previousRoster: [
        p(unresolvedId, 'Unresolved Guy'),
        p(returningId, 'Returner'),
      ],
      currentRoster: [p(returningId, 'Returner')],
      returningPlayers: [p(returningId, 'Returner')],
      departures: [],
      additions: [],
      playerSeasonStats: [
        role(returningId, 'Returner', { mpg: 30, usageAvg: 0.28 }),
        role(unresolvedId, 'Unresolved Guy', { mpg: 25 }),
      ],
    });

    const research = buildResearchPacketFromTeamPacket({
      packet,
      rosterStatuses: statuses,
    });
    expect(
      research.roster.unresolved.some((u) => u.playerEntityId === unresolvedId)
    ).toBe(true);
    expect(
      research.roster.departures.some((d) => d.playerEntityId === unresolvedId)
    ).toBe(false);
    // Vacated signal must not fire for unresolved
    expect(
      research.contextSignals.some(
        (s) =>
          s.type === 'VACATED_MINUTES' && s.playerEntityId === unresolvedId
      )
    ).toBe(false);
  });
});

describe('research packet WOWY + evidence', () => {
  it('6. WOWY without data is CANDIDATE_FOR_REVIEW not fabricated', () => {
    const returningId = '11111111-1111-1111-1111-111111111111';
    const departedId = '22222222-2222-2222-2222-222222222222';
    const statuses = classifyRosterStatuses({
      season: '2026',
      previousSeason: '2025',
      teamId: '9',
      teamAbbr: 'DET',
      previous: [
        p(returningId, 'Star'),
        p(departedId, 'Gone'),
      ],
      current: [p(returningId, 'Star')],
      elsewhereCurrentByEntity: new Map([
        [
          departedId,
          { playerEntityId: departedId, teamAbbr: 'SAS', teamId: '27' },
        ],
      ]),
      elsewherePreviousByEntity: new Map(),
    });
    const packet = minimalPacket({
      previousRoster: [p(returningId, 'Star'), p(departedId, 'Gone')],
      currentRoster: [p(returningId, 'Star')],
      returningPlayers: [p(returningId, 'Star')],
      departures: [p(departedId, 'Gone')],
      additions: [],
      playerSeasonStats: [
        role(returningId, 'Star', {
          mpg: 32,
          usageAvg: 0.3,
          usageGames: 70,
          usageTotalMinutes: 2000,
        }),
        role(departedId, 'Gone', { mpg: 28, gamesPlayed: 70 }),
      ],
      availableWowySummaries: [],
    });
    const research = buildResearchPacketFromTeamPacket({
      packet,
      rosterStatuses: statuses,
    });
    expect(research.wowyCandidates.length).toBeGreaterThan(0);
    expect(
      research.wowyCandidates.every(
        (w) =>
          w.status === 'CANDIDATE_FOR_REVIEW' ||
          (w.status === 'HAS_DATA' && w.sampleSize != null)
      )
    ).toBe(true);
    expect(
      research.wowyCandidates.every(
        (w) => w.status !== 'HAS_DATA' || w.metrics != null
      )
    ).toBe(true);
    for (const w of research.wowyCandidates.filter(
      (x) => x.status === 'CANDIDATE_FOR_REVIEW'
    )) {
      expect(w.metrics).toBeNull();
      expect(w.sampleSize).toBeNull();
    }
  });

  it('7. major role-shift claims retain evidence paths', () => {
    const returningId = '11111111-1111-1111-1111-111111111111';
    const departedId = '22222222-2222-2222-2222-222222222222';
    const statuses = classifyRosterStatuses({
      season: '2026',
      previousSeason: '2025',
      teamId: '9',
      teamAbbr: 'DET',
      previous: [p(returningId, 'Star'), p(departedId, 'Gone')],
      current: [p(returningId, 'Star')],
      elsewhereCurrentByEntity: new Map([
        [
          departedId,
          { playerEntityId: departedId, teamAbbr: 'SAS', teamId: '27' },
        ],
      ]),
      elsewherePreviousByEntity: new Map(),
    });
    const packet = minimalPacket({
      previousRoster: [p(returningId, 'Star'), p(departedId, 'Gone')],
      currentRoster: [p(returningId, 'Star')],
      returningPlayers: [p(returningId, 'Star')],
      departures: [p(departedId, 'Gone')],
      playerSeasonStats: [
        role(returningId, 'Star', {
          mpg: 32,
          usageAvg: 0.3,
          usageGames: 70,
          usageTotalMinutes: 2000,
        }),
        role(departedId, 'Gone', { mpg: 28, gamesPlayed: 70 }),
      ],
    });
    const research = buildResearchPacketFromTeamPacket({
      packet,
      rosterStatuses: statuses,
    });
    expect(research.roleUsageShiftCandidates.length).toBeGreaterThan(0);
    for (const c of research.roleUsageShiftCandidates) {
      expect(c.claim.evidence.length).toBeGreaterThan(0);
    }
    for (const q of research.researchQuestions) {
      expect(q.evidence.length).toBeGreaterThan(0);
    }
  });

  it('8. Detroit regular-season 60–22 scope preserved on assemble path', () => {
    const packet = minimalPacket({});
    packet.previousSeasonRegular = {
      season: '2025',
      available: true,
      unavailableReason: null,
      metricsScope: 'regular_season',
      postseasonStartEt: '2026-04-14',
      gamesPlayed: 82,
      wins: 60,
      losses: 22,
      record: '60–22',
      offensiveRating: 115,
      defensiveRating: 107,
      pace: 101,
      provenance: PROV,
    };
    packet.previousSeasonAllGames = {
      season: '2025',
      available: true,
      unavailableReason: null,
      wins: 67,
      losses: 29,
      record: '67–29',
      offensiveRating: 114,
      defensiveRating: 107,
      pace: 101,
      gamesPlayed: 96,
      includesPostseason: true,
      metricsScope: 'all_games',
      scopeNote: 'Includes postseason',
      provenance: PROV,
    };
    const draft = assemblePreseasonDraft({ packet });
    expect(draft.snapshot.regularSeasonRecord).toBe('60–22');
    expect(draft.snapshot.regularSeasonGamesPlayed).toBe(82);
    expect(draft.snapshot.allGamesMetricsExcludedFromPublicSnapshot).toBe(true);
    expect(validatePreseasonPreviewDraft(draft, packet).ok).toBe(true);
  });
});

function role(
  id: string,
  name: string,
  partial: Partial<PacketPlayerRoleStats>
): PacketPlayerRoleStats {
  return {
    playerEntityId: id,
    playerId: partial.playerId ?? '1',
    displayName: name,
    gamesPlayed: partial.gamesPlayed ?? 70,
    mpg: partial.mpg ?? null,
    ppg: partial.ppg ?? null,
    usageAvg: partial.usageAvg ?? null,
    usageGames: partial.usageGames ?? null,
    usageTotalMinutes: partial.usageTotalMinutes ?? null,
    recentCompetitive: partial.recentCompetitive ?? null,
    provenance: PROV,
  };
}

function minimalPacket(
  overrides: Partial<PreseasonTeamPacket>
): PreseasonTeamPacket {
  const returning = overrides.returningPlayers ?? [
    p('11111111-1111-1111-1111-111111111111', 'Returner'),
  ];
  return {
    version: 'preseason-team-packet-v1.1',
    generatedAt: '2026-09-21T00:00:00.000Z',
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
      wins: 60,
      losses: 22,
      record: '60–22',
      offensiveRating: 115,
      defensiveRating: 107,
      pace: 101,
      provenance: PROV,
    },
    previousSeasonAllGames: {
      season: '2025',
      available: true,
      unavailableReason: null,
      wins: 67,
      losses: 29,
      record: '67–29',
      offensiveRating: 114,
      defensiveRating: 107,
      pace: 101,
      gamesPlayed: 96,
      includesPostseason: true,
      metricsScope: 'all_games',
      scopeNote: 'Includes postseason',
      provenance: PROV,
    },
    currentRoster: overrides.currentRoster ?? returning,
    previousRoster: overrides.previousRoster ?? returning,
    additions: overrides.additions ?? [],
    departures: overrides.departures ?? [],
    returningPlayers: returning,
    playerSeasonStats: overrides.playerSeasonStats ?? [],
    schedule: {
      games: [],
      unavailableReason: 'none',
      provenance: PROV,
    },
    availableWowySummaries: overrides.availableWowySummaries ?? [],
    warnings: [],
    provenanceSummary: [PROV],
    ...overrides,
  };
}
