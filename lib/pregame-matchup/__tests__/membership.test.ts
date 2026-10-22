import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayerContributors } from '@/components/matchup/PlayerContributors';
import type { PlayerSumRow } from '@/lib/pregame-matchup/aggregate';
import { attributeMatchupPlayers, observationStamp } from '@/lib/pregame-matchup/membership';
import { presentBdlRoster, type ListedRosterPlayer, type RosterMember, type RosterPresentation } from '@/lib/pregame-matchup/roster';

const OBSERVED = '2026-10-12T12:15:55.474Z';

function member(teamId: string, playerId: string, name: string): RosterMember {
  return {
    teamId,
    nbaPlayerId: playerId,
    analyticsPlayerId: playerId,
    identityStatus: 'resolved',
    name,
  };
}

function row(teamId: string, playerId: string, name: string, minutes: number): PlayerSumRow {
  return {
    teamId,
    playerId,
    name,
    games: 70,
    minutes,
    points: minutes / 2,
    fga: minutes / 4,
    usageMass: 20,
    usagePossessions: 80,
  };
}

function shown(players: RosterMember[]): RosterPresentation {
  const listed: ListedRosterPlayer[] = players.map((player) => ({
    teamId: player.teamId,
    nbaPlayerId: player.nbaPlayerId,
    playerId: player.analyticsPlayerId,
    name: player.name,
    identityStatus: 'resolved',
  }));
  return {
    status: 'shown',
    observationDate: '2026-10-12',
    freshness: 'informative',
    note: 'Roster observation: Oct 12, 2026.',
    teams: [],
    source: 'balldontlie',
    collectedAt: OBSERVED,
    listedPlayers: listed,
  };
}

function names(players: { name: string }[]): string[] {
  return players.map((player) => player.name);
}

describe('matchup roster attribution', () => {
  it('formats the October 12 observation in Eastern time', () => {
    expect(observationStamp('2026-10-12', OBSERVED)).toBe('Oct 12, 2026, 8:15 AM EDT');
  });

  it('keeps Grimes and Oubre out of the current Philadelphia list', () => {
    const roster = shown([
      member('6', '322', 'Donovan Mitchell'),
      member('6', '17896076', 'Evan Mobley'),
      member('23', '3547254', 'Tyrese Maxey'),
      member('23', '1057261935', 'VJ Edgecombe'),
      member('23', '38017730', 'Dominick Barlow'),
      member('23', '999', 'Roster Rookie'),
    ]);
    const result = attributeMatchupPlayers({
      awayTeamId: '6',
      homeTeamId: '23',
      roster,
      playerRows: [
        row('6', '322', 'Donovan Mitchell', 2800),
        row('6', '17896076', 'Evan Mobley', 2600),
        row('23', '3547254', 'Tyrese Maxey', 2900),
        row('23', '1057261935', 'VJ Edgecombe', 2400),
        row('23', '38017730', 'Dominick Barlow', 1800),
        row('23', '17895858', 'Quentin Grimes', 2300),
        row('23', '360', 'Kelly Oubre Jr.', 2100),
        row('12', '360', 'Kelly Oubre Jr.', 100),
      ],
    });

    expect(result.membership).toBe('shown');
    expect(result.currentLabel).toContain('Oct 12, 2026, 8:15 AM EDT');
    expect(result.currentLabel).not.toMatch(/starter|starting lineup|projected/i);
    expect(names(result.awayCurrent)).toEqual(['Donovan Mitchell', 'Evan Mobley']);
    expect(names(result.homeCurrent)).toEqual(['Dominick Barlow', 'Roster Rookie', 'Tyrese Maxey', 'VJ Edgecombe']);
    expect(names(result.homeCurrent)).not.toContain('Quentin Grimes');
    expect(names(result.homeCurrent)).not.toContain('Kelly Oubre Jr.');
    expect(names(result.homeHistorical)).toEqual(['Quentin Grimes', 'Kelly Oubre Jr.']);
    expect(result.homeCurrent.find((player) => player.name === 'Tyrese Maxey')?.prior?.minutesPerGame).toBeCloseTo(2900 / 70, 5);
    expect(result.homeCurrent.find((player) => player.name === 'Roster Rookie')?.prior).toBeNull();

    const html = renderToStaticMarkup(createElement(PlayerContributors, {
      awayAbbr: 'CLE',
      homeAbbr: 'PHI',
      contributors: result,
    }));
    const current = html.slice(html.indexOf('data-player-role="current"'), html.indexOf('data-player-role="historical"'));
    const historical = html.slice(html.indexOf('data-player-role="historical"'));
    expect(current).toContain('Tyrese Maxey');
    expect(current).toContain('2025–26 with PHI');
    expect(current).toContain('Roster Rookie</div><p class="type-secondary">2025–26 sample with PHI unavailable</p>');
    expect(current).not.toContain('Quentin Grimes');
    expect(current).not.toContain('Kelly Oubre Jr.');
    expect(historical).toContain('Quentin Grimes');
    expect(historical).toContain('Kelly Oubre Jr.');
    expect(historical).toContain('2025–26 historical production — not a confirmed current roster');
    expect(html).not.toMatch(/starter|starting lineup|projected rotation/i);
  });

  it('keeps Risacher out of the current Atlanta list', () => {
    const result = attributeMatchupPlayers({
      awayTeamId: '1',
      homeTeamId: '22',
      roster: shown([
        member('1', '1', 'Nickeil Alexander-Walker'),
        member('22', '2', 'Paolo Banchero'),
      ]),
      playerRows: [
        row('1', '1', 'Nickeil Alexander-Walker', 2500),
        row('1', '1028028244', 'Zaccharie Risacher', 2200),
        row('22', '2', 'Paolo Banchero', 2700),
      ],
    });
    expect(names(result.awayCurrent)).toEqual(['Nickeil Alexander-Walker']);
    expect(names(result.awayHistorical)).toEqual(['Zaccharie Risacher']);
    expect(names(result.homeCurrent)).toEqual(['Paolo Banchero']);
    expect(result.homeHistorical).toEqual([]);
    expect(result.homeHistoricalEmpty).toMatch(/outside the observed roster/);
  });

  it('withholds names when the observation is incomplete or after tipoff', () => {
    const members = [member('23', '17895858', 'Quentin Grimes')];
    const rows = [row('23', '17895858', 'Quentin Grimes', 2300)];
    for (const reason of ['incomplete', 'after_tipoff'] as const) {
      const roster = presentBdlRoster({
        observationEtDate: '2026-10-12',
        collectedAt: OBSERVED,
        reason,
        freshness: 'informative',
        teams: [],
        members,
      });
      expect(roster.listedPlayers).toBeNull();
      const result = attributeMatchupPlayers({
        awayTeamId: '6',
        homeTeamId: '23',
        roster,
        playerRows: rows,
      });
      expect(result.membership).toBe('unavailable');
      expect(result.homeCurrent).toEqual([]);
      expect(result.unavailableNote).toMatch(/unavailable/i);
      expect(names(result.homeHistorical)).toEqual(['Quentin Grimes']);
    }
  });
});
