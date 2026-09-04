import { describe, expect, it } from 'vitest';
import {
  resolveRosterIdentity,
  buildResolverIndex,
  type RosterObservation,
} from '../identity-resolver';

/**
 * Populate path must skip unresolved/ambiguous — no stint without analytics id.
 */
describe('stint populate eligibility', () => {
  const index = buildResolverIndex({
    providerMaps: [],
    analyticsPlayers: [
      {
        playerId: '132',
        fullName: 'Luka Doncic',
        position: 'G',
        pglTeamAbbrevs: ['LAL'],
      },
      {
        playerId: 'a',
        fullName: 'Brandon Williams',
        position: 'G',
        pglTeamAbbrevs: ['DAL'],
      },
      {
        playerId: 'b',
        fullName: 'Brandon Williams',
        position: 'F',
        pglTeamAbbrevs: ['LAC'],
      },
    ],
  });

  function eligible(obs: RosterObservation): boolean {
    const r = resolveRosterIdentity(obs, index);
    return r.status === 'provider_match' || r.status === 'safe_fallback_match';
  }

  it('resolved roster player is eligible to open stint', () => {
    expect(
      eligible({
        nbaPlayerId: '1',
        fullName: 'Luka Doncic',
        teamAbbr: 'LAL',
        teamInternalId: '14',
        jersey: '77',
        position: 'G',
        season: '2025-26',
      })
    ).toBe(true);
  });

  it('unresolved player skipped', () => {
    expect(
      eligible({
        nbaPlayerId: '1642846',
        fullName: 'Ace Bailey',
        teamAbbr: 'UTA',
        teamInternalId: '29',
        jersey: '19',
        position: 'F',
        season: '2025-26',
      })
    ).toBe(false);
  });

  it('ambiguous player skipped', () => {
    expect(
      eligible({
        nbaPlayerId: 'x',
        fullName: 'Brandon Williams',
        teamAbbr: 'BOS',
        teamInternalId: '2',
        jersey: '10',
        position: 'G',
        season: '2025-26',
      })
    ).toBe(false);
  });

  it('raw observation unique key is day+season+team+player (documented)', () => {
    // Mirrors raw.nba_roster_snapshots PK — same calendar day does not duplicate.
    const key = (o: {
      snapshot_date: string;
      season_label: string;
      nba_team_id: string;
      nba_player_id: string;
    }) =>
      `${o.snapshot_date}|${o.season_label}|${o.nba_team_id}|${o.nba_player_id}`;
    const a = key({
      snapshot_date: '2026-09-04',
      season_label: '2025-26',
      nba_team_id: '1610612752',
      nba_player_id: '1629029',
    });
    const b = key({
      snapshot_date: '2026-09-04',
      season_label: '2025-26',
      nba_team_id: '1610612752',
      nba_player_id: '1629029',
    });
    expect(a).toBe(b);
  });
});
