import { describe, expect, it } from 'vitest';
import {
  certifyStarterGame,
  extractStarterCandidatesFromArchive,
  failStarterCertificationIfIdentityUnsafe,
  GAME_STARTERS_SEASON,
  groupCertifiedStarters,
  historicalTeamIdFromLineupRow,
  isLineups2025StarterAnomaly,
  shouldShowStartingFive,
} from '@/lib/archive/game-starters-from-lineups';

function starterEntry(opts: {
  gameId: string;
  playerId: string;
  teamId: string;
  playerTeamId?: string;
  position?: string;
  starter?: boolean;
}) {
  return {
    game_id: Number(opts.gameId),
    starter: opts.starter ?? true,
    position: opts.position ?? 'G',
    player: { id: Number(opts.playerId), team_id: Number(opts.playerTeamId ?? opts.teamId) },
    team: { id: Number(opts.teamId) },
  };
}

function five(gameId: string, teamId: string, start: number) {
  return Array.from({ length: 5 }, (_, i) =>
    starterEntry({ gameId, teamId, playerId: String(start + i), position: i === 0 ? 'C' : 'G' })
  );
}

describe('extractStarterCandidatesFromArchive', () => {
  it('keeps starter=true rows and excludes non-starters', () => {
    const body = {
      game_id: '18447937',
      data: [
        ...five('18447937', '13', 1),
        ...five('18447937', '27', 11),
        starterEntry({ gameId: '18447937', teamId: '13', playerId: '99', starter: false }),
      ],
    };
    const extracted = extractStarterCandidatesFromArchive('18447937', body);
    expect(extracted.archiveRows).toBe(11);
    expect(extracted.starterCandidates).toHaveLength(10);
    expect(extracted.unknownIdentity).toBe(0);
    expect(extracted.starterCandidates.some((r) => r.playerId === '99')).toBe(false);
  });

  it('uses top-level team.id and ignores nested player.team_id', () => {
    const row = starterEntry({
      gameId: '18447937',
      playerId: '132',
      teamId: '27',
      playerTeamId: '7',
      position: 'G',
    });
    expect(historicalTeamIdFromLineupRow(row)).toBe('27');
    const extracted = extractStarterCandidatesFromArchive('18447937', { data: [row] });
    expect(extracted.starterCandidates[0]?.teamId).toBe('27');
    expect(extracted.starterCandidates[0]?.teamId).not.toBe('7');
  });

  it('flags unknown identity instead of name-matching', () => {
    const extracted = extractStarterCandidatesFromArchive('18447937', {
      data: [
        {
          starter: true,
          position: 'G',
          player: { team_id: 7 },
          team: { id: 27 },
        },
      ],
    });
    expect(extracted.unknownIdentity).toBe(1);
    expect(extracted.starterCandidates).toHaveLength(0);
  });

  it('accepts an explicit 2026 season without flipping the 2025 product constant', () => {
    expect(GAME_STARTERS_SEASON).toBe('2025');
    const extracted = extractStarterCandidatesFromArchive(
      '18450001',
      { data: five('18450001', '1', 101) },
      '2026'
    );
    expect(extracted.starterCandidates.every((row) => row.season === '2026')).toBe(true);
    expect(GAME_STARTERS_SEASON).toBe('2025');
  });
});

describe('certifyStarterGame', () => {
  it('certifies a valid 5+5 game', () => {
    const starters = [
      ...five('18447937', '13', 1).map((r) => ({
        gameId: '18447937',
        teamId: '13',
        playerId: String(r.player.id),
        position: 'G',
        season: '2025',
        source: 'bdl_lineups_archive_2025',
      })),
      ...five('18447937', '27', 11).map((r) => ({
        gameId: '18447937',
        teamId: '27',
        playerId: String(r.player.id),
        position: 'G',
        season: '2025',
        source: 'bdl_lineups_archive_2025',
      })),
    ];
    const cert = certifyStarterGame({
      gameId: '18447937',
      homeTeamId: '13',
      awayTeamId: '27',
      starterCandidates: starters,
    });
    expect(cert.productEligible).toBe(true);
    expect(cert.reason).toBe('valid_5_plus_5');
  });

  it('does not certify known anomaly games', () => {
    expect(isLineups2025StarterAnomaly('18447931')).toBe(true);
    expect(isLineups2025StarterAnomaly('18447988')).toBe(true);
    const cert = certifyStarterGame({
      gameId: '18447931',
      homeTeamId: '10',
      awayTeamId: '2',
      starterCandidates: [
        ...five('18447931', '10', 1).slice(0, 4).map((r) => ({
          gameId: '18447931',
          teamId: '10',
          playerId: String(r.player.id),
          position: 'G',
          season: '2025',
          source: 'bdl_lineups_archive_2025',
        })),
        ...five('18447931', '2', 11).map((r) => ({
          gameId: '18447931',
          teamId: '2',
          playerId: String(r.player.id),
          position: 'G',
          season: '2025',
          source: 'bdl_lineups_archive_2025',
        })),
      ],
    });
    expect(cert.productEligible).toBe(false);
    expect(cert.reason).toBe('anomaly');
  });

  it('fails unknown identity rather than fuzzy match', () => {
    const cert = certifyStarterGame({
      gameId: '18447937',
      homeTeamId: '13',
      awayTeamId: '27',
      starterCandidates: [],
      unknownIdentity: 1,
    });
    expect(cert.productEligible).toBe(false);
    expect(cert.reason).toBe('unknown_identity');
  });

  it('does not emit a partial five when canonical identity is unsafe', () => {
    const cert = failStarterCertificationIfIdentityUnsafe(
      {
        productEligible: true,
        reason: 'valid_5_plus_5',
        homeCount: 5,
        awayCount: 5,
      },
      'identity_not_serving'
    );
    expect(cert.productEligible).toBe(false);
    expect(cert.reason).toBe('canonical_identity_unresolved');
    expect(cert.homeCount).toBe(0);
    expect(cert.awayCount).toBe(0);
  });
});

describe('groupCertifiedStarters / Starting Five visibility', () => {
  it('is available only with exactly 5 home and 5 away', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((n) => ({
        player_id: String(n),
        player_name: `Home ${n}`,
        team_id: '13',
        position: 'G',
      })),
      ...[11, 12, 13, 14, 15].map((n) => ({
        player_id: String(n),
        player_name: `Away ${n}`,
        team_id: '27',
        position: 'F',
      })),
    ];
    const grouped = groupCertifiedStarters(rows, '13', '27');
    expect(shouldShowStartingFive(grouped)).toBe(true);
    expect(grouped.home).toHaveLength(5);
    expect(grouped.away).toHaveLength(5);
  });

  it('hides partial fives including anomaly 4-starter teams', () => {
    const rows = [
      ...[1, 2, 3, 4].map((n) => ({ player_id: String(n), team_id: '10', player_name: `P${n}` })),
      ...[11, 12, 13, 14, 15].map((n) => ({ player_id: String(n), team_id: '2', player_name: `P${n}` })),
    ];
    const grouped = groupCertifiedStarters(rows, '10', '2');
    expect(grouped.available).toBe(false);
    expect(shouldShowStartingFive(grouped)).toBe(false);
    expect(grouped.home).toHaveLength(0);
    expect(grouped.away).toHaveLength(0);
  });

  it('hides 2023/2024 empty serving', () => {
    expect(shouldShowStartingFive(groupCertifiedStarters([], '2', '7'))).toBe(false);
  });
});
