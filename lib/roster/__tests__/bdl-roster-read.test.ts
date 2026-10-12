import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FRESH_MAX_DAYS, INFORMATIVE_MAX_DAYS } from '@/lib/pregame-matchup/roster';
import {
  bdlCurrentFranchiseTeamMapQuery,
  bdlEligibleBatchQuery,
  bdlTeamMembershipQuery,
  classifyBdlRosterIdentity,
  explainRosterEligibility,
  resolveRosterTeam,
  rosterObservationEtDate,
  toObservedRosterMember,
  type RosterTeamMapRow,
  type StoredRosterBatch,
} from '@/lib/roster/bdl-roster-read';

/** Read from raw.teams joined to analytics.teams on abbreviation, East/West only, on 2026-10-12. */
const CURRENT_FRANCHISE_MAP: RosterTeamMapRow[] = [
  ['1', 'ATL'], ['2', 'BOS'], ['3', 'BKN'], ['4', 'CHA'], ['5', 'CHI'], ['6', 'CLE'],
  ['7', 'DAL'], ['8', 'DEN'], ['9', 'DET'], ['10', 'GSW'], ['11', 'HOU'], ['12', 'IND'],
  ['13', 'LAC'], ['14', 'LAL'], ['15', 'MEM'], ['16', 'MIA'], ['17', 'MIL'], ['18', 'MIN'],
  ['19', 'NOP'], ['20', 'NYK'], ['21', 'OKC'], ['22', 'ORL'], ['23', 'PHI'], ['24', 'PHX'],
  ['25', 'POR'], ['26', 'SAC'], ['27', 'SAS'], ['28', 'TOR'], ['29', 'UTA'], ['30', 'WAS'],
].map(([providerTeamId, abbreviation]) => ({
  providerTeamId: providerTeamId!,
  abbreviation: abbreviation!,
  analyticsTeamId: providerTeamId!,
}));

function batch(partial: Partial<StoredRosterBatch> & Pick<StoredRosterBatch, 'batchId' | 'collectedAt'>): StoredRosterBatch {
  return {
    provider: 'balldontlie',
    seasonLabel: '2026-27',
    status: 'complete',
    teamCount: 30,
    playerCount: 450,
    ...partial,
  };
}

describe('BallDontLie roster reader', () => {
  it('uses the latest complete batch collected before tipoff', () => {
    const tipoffAt = '2026-10-11T23:00:00.000Z';
    const result = explainRosterEligibility({
      batches: [
        batch({ batchId: 'older', collectedAt: '2026-10-10T18:00:00.000Z' }),
        batch({ batchId: 'latest', collectedAt: '2026-10-11T18:00:00.000Z' }),
        batch({ batchId: 'after', collectedAt: '2026-10-11T23:30:00.000Z' }),
      ],
      tipoffAt,
      gameEtDate: '2026-10-11',
    });
    expect(result.batch?.batchId).toBe('latest');
    expect(result.reason).toBe('eligible');
    expect(result.freshness).toBe('fresh');
    expect(result.sharesAllowed).toBe(true);
  });

  it('rejects an incomplete batch and a missing batch', () => {
    expect(explainRosterEligibility({
      batches: [batch({ batchId: 'partial', collectedAt: '2026-10-11T18:00:00.000Z', status: 'incomplete' })],
      tipoffAt: '2026-10-11T23:00:00.000Z',
      gameEtDate: '2026-10-11',
    }).reason).toBe('incomplete');
    expect(explainRosterEligibility({
      batches: [],
      tipoffAt: '2026-10-11T23:00:00.000Z',
      gameEtDate: '2026-10-11',
    }).reason).toBe('missing');
  });

  it('rejects an observation collected after tipoff even when the UTC date matches the game date', () => {
    const result = explainRosterEligibility({
      batches: [batch({ batchId: 'post', collectedAt: '2026-10-11T19:00:00.000Z' })],
      tipoffAt: '2026-10-11T17:00:00.000Z',
      gameEtDate: '2026-10-11',
    });
    expect(result.reason).toBe('after_tipoff');
    expect(result.batch).toBeNull();
    expect(result.sharesAllowed).toBe(false);
    expect(rosterObservationEtDate('2026-10-11T19:00:00.000Z')).toBe('2026-10-11');
  });

  it('accepts a pre-tipoff observation whose UTC date is the next day', () => {
    const collectedAt = '2026-10-12T00:46:08.747Z';
    expect(rosterObservationEtDate(collectedAt)).toBe('2026-10-11');
    const result = explainRosterEligibility({
      batches: [batch({ batchId: 'evening', collectedAt })],
      tipoffAt: '2026-10-12T03:00:00.000Z',
      gameEtDate: '2026-10-11',
    });
    expect(result.reason).toBe('eligible');
    expect(result.freshness).toBe('fresh');
  });

  it('marks a stale observation ineligible for continuity shares', () => {
    const result = explainRosterEligibility({
      batches: [batch({ batchId: 'old', collectedAt: '2026-09-01T16:00:00.000Z' })],
      tipoffAt: '2026-10-11T23:00:00.000Z',
      gameEtDate: '2026-10-11',
    });
    expect(result.reason).toBe('eligible');
    expect(result.freshness).toBe('stale');
    expect(result.sharesAllowed).toBe(false);
    expect(FRESH_MAX_DAYS).toBe(7);
    expect(INFORMATIVE_MAX_DAYS).toBe(21);
  });

  it('resolves all 30 current franchises and does not use numeric equality as a fallback', () => {
    expect(CURRENT_FRANCHISE_MAP).toHaveLength(30);
    const providerIds = new Set(CURRENT_FRANCHISE_MAP.map((row) => row.providerTeamId));
    const analyticsIds = new Set(CURRENT_FRANCHISE_MAP.map((row) => row.analyticsTeamId));
    const abbreviations = new Set(CURRENT_FRANCHISE_MAP.map((row) => row.abbreviation));
    expect(providerIds.size).toBe(30);
    expect(analyticsIds.size).toBe(30);
    expect(abbreviations.size).toBe(30);
    for (const row of CURRENT_FRANCHISE_MAP) {
      expect(resolveRosterTeam({
        providerTeamId: row.providerTeamId,
        teamAbbreviation: row.abbreviation,
      }, CURRENT_FRANCHISE_MAP)).toEqual({ ok: true, analyticsTeamId: row.analyticsTeamId });
    }
    expect(resolveRosterTeam({ providerTeamId: '17', teamAbbreviation: 'MIL' }, CURRENT_FRANCHISE_MAP)).toEqual({
      ok: true,
      analyticsTeamId: '17',
    });
    expect(resolveRosterTeam({ providerTeamId: '42', teamAbbreviation: 'WAS' }, CURRENT_FRANCHISE_MAP)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(resolveRosterTeam({ providerTeamId: '17', teamAbbreviation: 'MIL' }, [])).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(resolveRosterTeam({ providerTeamId: '17', teamAbbreviation: 'MIL' }, [
      { providerTeamId: '17', abbreviation: 'MIL', analyticsTeamId: '17' },
      { providerTeamId: '17', abbreviation: 'MIL', analyticsTeamId: '10' },
    ])).toEqual({ ok: false, reason: 'ambiguous' });
    expect(resolveRosterTeam({ providerTeamId: '17', teamAbbreviation: 'MIL' }, [
      { providerTeamId: '17', abbreviation: 'MIL', analyticsTeamId: '10' },
    ])).toEqual({ ok: true, analyticsTeamId: '10' });
    const mapQuery = bdlCurrentFranchiseTeamMapQuery();
    expect(mapQuery.text).toContain('upper(trim(r.abbreviation)) = upper(trim(t.abbreviation))');
    expect(mapQuery.text).not.toContain('t.team_id = r.id');
  });

  it('keeps the BallDontLie id namespace separate from a caller-supplied team number', () => {
    const member = toObservedRosterMember({
      providerPlayerId: '1057382509',
      providerTeamId: '17',
      teamAbbreviation: 'MIL',
      teamMap: CURRENT_FRANCHISE_MAP,
      observedAt: '2026-10-12T00:27:56.640Z',
      lookup: 'matched',
      playerId: '1057382509',
      hasPriorSeasonProduction: true,
    });
    expect(member?.providerTeamId).toBe('17');
    expect(member?.teamId).toBe('17');
    expect(member?.historicalPlayerId).toBe('1057382509');
    expect(toObservedRosterMember({
      providerPlayerId: '1057382509',
      providerTeamId: '42',
      teamAbbreviation: 'WAS',
      teamMap: CURRENT_FRANCHISE_MAP,
      observedAt: '2026-10-12T00:27:56.640Z',
      lookup: 'matched',
      playerId: '1057382509',
      hasPriorSeasonProduction: true,
    })).toBeNull();
  });

  it('keeps Eastern dates stable across the daylight-saving transitions', () => {
    expect(rosterObservationEtDate('2026-03-08T06:30:00.000Z')).toBe('2026-03-08');
    expect(rosterObservationEtDate('2026-03-08T07:30:00.000Z')).toBe('2026-03-08');
    expect(rosterObservationEtDate('2026-11-01T05:30:00.000Z')).toBe('2026-11-01');
    expect(rosterObservationEtDate('2026-11-01T06:30:00.000Z')).toBe('2026-11-01');
    const beforeFallback = explainRosterEligibility({
      batches: [batch({ batchId: 'before-fallback', collectedAt: '2026-11-01T05:30:00.000Z' })],
      tipoffAt: '2026-11-01T06:00:00.000Z',
      gameEtDate: '2026-11-01',
    });
    const afterFallback = explainRosterEligibility({
      batches: [batch({ batchId: 'after-fallback', collectedAt: '2026-11-01T06:30:00.000Z' })],
      tipoffAt: '2026-11-01T06:00:00.000Z',
      gameEtDate: '2026-11-01',
    });
    expect(beforeFallback.reason).toBe('eligible');
    expect(afterFallback.reason).toBe('after_tipoff');
  });

  it('classifies a provider id with no analytics row as resolved without history', () => {
    expect(classifyBdlRosterIdentity({
      providerPlayerId: '208',
      lookup: 'missing_player_row',
    })).toEqual({
      resolution: 'RESOLVED_NO_OBSERVED_PRIOR_SEASON_PRODUCTION',
      historicalPlayerId: null,
    });
  });

  it('classifies an unavailable lookup as unresolved and a mismatched id as ambiguous', () => {
    expect(classifyBdlRosterIdentity({ providerPlayerId: '9', lookup: 'unavailable' }).resolution).toBe('UNRESOLVED');
    expect(classifyBdlRosterIdentity({
      providerPlayerId: '9',
      lookup: 'matched',
      playerId: '999',
      hasPriorSeasonProduction: true,
    }).resolution).toBe('AMBIGUOUS');
    expect(classifyBdlRosterIdentity({ providerPlayerId: '9', lookup: 'conflict' }).resolution).toBe('AMBIGUOUS');
  });

  it('selects a complete batch before tipoff and joins history on the provider player id', () => {
    const batchQuery = bdlEligibleBatchQuery('2026-27', '2026-10-11T23:00:00.000Z');
    expect(batchQuery.text).toContain('collected_at < $3::timestamptz');
    expect(batchQuery.text).toContain("status = 'complete'");
    expect(batchQuery.text).not.toContain('nba_player_id');
    const membership = bdlTeamMembershipQuery('batch-1', 'ORL');
    expect(membership.text).toContain('p.player_id = m.provider_player_id');
    expect(membership.text).toContain('l.minutes::numeric > 0');
    expect(membership.text).not.toContain('nba_player_id');
    expect(membership.params[2]).toBe('2025');
    expect(membership.params[3]).toBe('2025-10-21');
    expect(membership.params[4]).toBe('2026-04-14');
    expect(membership.params[5]).toBe('2025-12-16');
  });

  it('is imported by the Matchup roster loader and does not mix NBA.com membership', () => {
    const loader = fs.readFileSync(path.join(process.cwd(), 'lib/pregame-matchup/roster-load.ts'), 'utf8');
    const page = fs.readFileSync(path.join(process.cwd(), 'app/scoreboard/games/[gameId]/page.tsx'), 'utf8');
    expect(loader).toContain('bdl-roster-read');
    expect(loader).not.toContain('nba_roster_snapshots');
    expect(loader).not.toContain('rosterMembershipQuery');
    expect(page).not.toContain('balldontlie.io');
    expect(page).not.toContain('nba.com');
  });
});
