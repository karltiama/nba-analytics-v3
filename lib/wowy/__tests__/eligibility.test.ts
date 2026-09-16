import { describe, expect, it } from 'vitest';
import { classifyWowyGame } from '../eligibility';
import { isUsableWowyPrior } from '../cutoff';
import type { WowyLoadedGame, WowyPairQuery } from '../types';

const query: WowyPairQuery = {
  subjectPlayerId: 'A',
  teammatePlayerId: 'B',
  season: '2024',
  teamId: '8',
  seasonType: 'regular',
};

function game(partial: Partial<WowyLoadedGame> = {}): WowyLoadedGame {
  return {
    gameId: 'g1',
    startTime: '2025-01-10T00:00:00.000Z',
    gameDate: '2025-01-09',
    season: '2024',
    status: 'Final',
    homeScore: 110,
    awayScore: 100,
    subjectTeamId: '8',
    opponentTeamId: '14',
    opponentAbbr: 'LAL',
    subjectMinutes: '32',
    subjectPts: 20,
    subjectReb: 10,
    subjectAst: 8,
    subjectTpm: 2,
    subjectFga: 15,
    subjectTpa: 6,
    subjectFta: 4,
    teammateRowPresent: true,
    teammateTeamId: '8',
    teammateMinutes: '30',
    teammatePts: 18,
    teammateReb: 4,
    teammateAst: 6,
    teammateTpm: 3,
    teammateFga: 14,
    teammateFta: 2,
    homeTeamId: '8',
    teamPts: null,
    teamReb: null,
    teamAst: null,
    teamTpm: null,
    teamFga: null,
    teamTpa: null,
    teamFta: null,
    teamOppPts: null,
    ...partial,
  };
}

describe('classifyWowyGame', () => {
  it('puts both-played same-team games in the with bucket', () => {
    const classified = classifyWowyGame(game(), query);
    expect(classified.bucket).toBe('with');
    expect(classified.teammate.participation).toBe('played');
    expect(classified.teammate.membership.kind).toBe('same_team_game_log');
    expect(classified.excludeReason).toBeNull();
  });

  it('puts verified teammate DNP (minutes 00) in the without bucket and does not label injury', () => {
    const classified = classifyWowyGame(game({ teammateMinutes: '00', teammatePts: 0 }), query);
    expect(classified.bucket).toBe('without');
    expect(classified.teammate.participation).toBe('verified_dnp');
    expect(classified.teammate.appearance?.reason).toMatch(/minutes_00_dnp/);
    expect(classified.teammate.appearance?.reason).not.toMatch(/injur/i);
  });

  it('treats a missing teammate row as unknown membership, not absence', () => {
    const classified = classifyWowyGame(
      game({
        teammateRowPresent: false,
        teammateTeamId: null,
        teammateMinutes: null,
      }),
      query
    );
    expect(classified.bucket).toBe('excluded');
    expect(classified.excludeReason).toBe('teammate_unknown_membership');
    expect(classified.teammate.participation).toBe('unknown');
    expect(classified.teammate.membership.kind).toBe('teammate_row_missing');
    expect(classified.teammate.membership.note).toMatch(/not inferred/i);
  });

  it('keeps distinct team stints separate and does not treat different team_id as with/without', () => {
    const classified = classifyWowyGame(game({ teammateTeamId: '14' }), query);
    expect(classified.bucket).toBe('excluded');
    expect(classified.excludeReason).toBe('teammate_different_team');
    expect(classified.teammate.membership.note).toMatch(/not a verified trade date/i);
  });

  it('does not pool a subject game from a different team stint into the selected team', () => {
    const classified = classifyWowyGame(game({ subjectTeamId: '14', teammateTeamId: '14' }), query);
    expect(classified.excludeReason).toBe('ambiguous_team_membership');
    expect(classified.bucket).toBe('excluded');
  });

  it('excludes subject DNP rows from the comparison', () => {
    const classified = classifyWowyGame(game({ subjectMinutes: '00', subjectPts: 0 }), query);
    expect(classified.bucket).toBe('excluded');
    expect(classified.excludeReason).toBe('subject_did_not_play');
    expect(classified.subject.class).toBe('dnp');
  });

  it('keeps a zero-minute subject appearance as played', () => {
    const classified = classifyWowyGame(game({ subjectMinutes: '0', subjectPts: 0 }), query);
    expect(classified.subject.class).toBe('played');
    expect(classified.bucket).toBe('with');
    expect(classified.subject.minutes).toBe(0);
  });

  it('excludes incomplete game records', () => {
    expect(classifyWowyGame(game({ status: '2025-01-10T00:00:00Z' }), query).excludeReason).toBe(
      'incomplete_game'
    );
    expect(classifyWowyGame(game({ startTime: null }), query).excludeReason).toBe('incomplete_game');
    expect(classifyWowyGame(game({ homeScore: null }), query).excludeReason).toBe('incomplete_game');
  });

  it('excludes malformed subject minutes', () => {
    const classified = classifyWowyGame(game({ subjectMinutes: 'DNP-CD' }), query);
    expect(classified.excludeReason).toBe('subject_malformed_minutes');
  });

  it('drops games on or after the cutoff, including same ET basketball date', () => {
    const cutoff = '2025-01-10T17:00:00.000Z';
    const prior = classifyWowyGame(game({ startTime: '2025-01-08T00:00:00.000Z' }), {
      ...query,
      cutoffStartTime: cutoff,
    });
    expect(prior.bucket).toBe('with');

    const sameEtDate = classifyWowyGame(game({ startTime: '2025-01-10T16:00:00.000Z' }), {
      ...query,
      cutoffStartTime: cutoff,
    });
    expect(sameEtDate.excludeReason).toBe('on_or_after_cutoff');
    expect(isUsableWowyPrior('2025-01-10T16:00:00.000Z', cutoff)).toBe(false);

    const future = classifyWowyGame(game({ startTime: '2025-01-12T00:00:00.000Z' }), {
      ...query,
      cutoffStartTime: cutoff,
    });
    expect(future.excludeReason).toBe('on_or_after_cutoff');
  });

  it('does not classify playoff games into a regular-season query', () => {
    const classified = classifyWowyGame(
      game({ startTime: '2025-04-20T00:00:00.000Z', gameDate: '2025-04-19' }),
      query
    );
    expect(classified.excludeReason).toBe('season_type_mismatch');
    expect(classified.seasonType).toBe('playoffs');
  });

  it('uses team box with/without the subject when no teammate is selected', () => {
    const selfQuery = { ...query, teammatePlayerId: null };
    const withPlayer = classifyWowyGame(
      game({ teamPts: 120, teamOppPts: 108, teamReb: 45, teamAst: 28 }),
      selfQuery
    );
    expect(withPlayer.bucket).toBe('with');
    expect(withPlayer.subject.stats.pts).toBe(120);
    expect(withPlayer.subject.stats.oppPts).toBe(108);

    const withoutPlayer = classifyWowyGame(
      game({ subjectMinutes: '00', subjectPts: 0, teamPts: 99, teamOppPts: 110 }),
      selfQuery
    );
    expect(withoutPlayer.bucket).toBe('without');
    expect(withoutPlayer.teammate.participation).toBe('verified_dnp');
    expect(withoutPlayer.subject.stats.pts).toBe(99);
    expect(withoutPlayer.excludeReason).toBeNull();
  });
});
