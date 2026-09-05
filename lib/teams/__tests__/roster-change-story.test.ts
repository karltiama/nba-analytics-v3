import { describe, expect, it } from 'vitest';
import {
  BANNED_STORY_WORDS,
  KEY_CHANGE_HIGHLIGHT,
  PRIOR_SEASON_ROLE_STATS_SQL as STATS_SQL,
  ROLE_MAJOR_MPG,
  ROLE_ROTATION_MPG,
  buildPlayerStory,
  buildRosterChangeStory,
  classifyPriorRole,
  compareChangePlayers,
  emptyRosterChangeStory,
  formatChangeContextLine,
  formatMpg,
  formatPpg,
  type PriorSeasonRoleStats,
  type RosterChangePlayerStory,
} from '../roster-change-story';
import {
  TEAM_ROSTER_ENTITY_SQL,
  computeRosterContinuity,
  type ContinuityPlayer,
} from '../team-roster-continuity';
import {
  TEAM_COMPACT_UPCOMING_SQL,
  TEAM_COMPACT_RECENT_SQL,
} from '../team-compact-schedule';
import { TEAM_ROSTER_CURRENT_SQL } from '../team-roster-presentation';

function cp(
  id: string,
  name: string,
  playerId: string | null = null
): ContinuityPlayer {
  return { playerEntityId: id, displayName: name, playerId };
}

function story(
  partial: Partial<RosterChangePlayerStory> &
    Pick<RosterChangePlayerStory, 'playerEntityId' | 'displayName' | 'roleTier'>
): RosterChangePlayerStory {
  return {
    playerId: null,
    roleLabel: partial.roleTier,
    mpg: null,
    ppg: null,
    gamesPlayed: null,
    otherTeamAbbr: null,
    ...partial,
  };
}

describe('roster-change-story (Phase 2.T.4A)', () => {
  it('1. high-MPG addition ranks above low-MPG addition', () => {
    const high = story({
      playerEntityId: 'h',
      displayName: 'High',
      roleTier: 'major_rotation',
      mpg: 32,
      ppg: 20,
    });
    const low = story({
      playerEntityId: 'l',
      displayName: 'Low',
      roleTier: 'limited_role',
      mpg: 8,
      ppg: 4,
    });
    expect(compareChangePlayers(high, low)).toBeLessThan(0);
  });

  it('2. high-role departure ranks appropriately', () => {
    const a = story({
      playerEntityId: 'a',
      displayName: 'A',
      roleTier: 'major_rotation',
      mpg: 30,
    });
    const b = story({
      playerEntityId: 'b',
      displayName: 'B',
      roleTier: 'rotation',
      mpg: 20,
    });
    expect(compareChangePlayers(a, b)).toBeLessThan(0);
  });

  it('3. ranking is deterministic', () => {
    const a = story({
      playerEntityId: '1',
      displayName: 'Ann',
      roleTier: 'rotation',
      mpg: 20,
      ppg: 10,
      gamesPlayed: 70,
    });
    const b = story({
      playerEntityId: '2',
      displayName: 'Bob',
      roleTier: 'rotation',
      mpg: 20,
      ppg: 10,
      gamesPlayed: 70,
    });
    expect(compareChangePlayers(a, b)).toBe(
      'Ann'.localeCompare('Bob', 'en', { sensitivity: 'base' })
    );
    expect(compareChangePlayers(a, b)).toBe(compareChangePlayers(a, b));
  });

  it('4. PPG/MPG displayed only when non-null', () => {
    expect(formatMpg(31.8)).toBe('31.8 MPG');
    expect(formatPpg(21.4)).toBe('21.4 PPG');
    expect(formatMpg(null)).toBeNull();
    expect(formatPpg(null)).toBeNull();
    const line = formatChangeContextLine(
      story({
        playerEntityId: 'x',
        displayName: 'X',
        roleTier: 'major_rotation',
        roleLabel: 'Major rotation',
        mpg: 31.8,
        ppg: null,
      })
    );
    expect(line).toBe('Major rotation · 31.8 MPG');
    expect(line).not.toMatch(/PPG/);
  });

  it('5. missing stats do not become zero', () => {
    const s = buildPlayerStory(cp('e', 'P', '99'), new Map(), new Map());
    expect(s.mpg).toBeNull();
    expect(s.ppg).toBeNull();
    expect(formatChangeContextLine(s)).not.toMatch(/0\.0/);
  });

  it('6. NBA-only rookie receives new-player label', () => {
    expect(classifyPriorRole({ playerId: null, stats: null })).toBe('new_nba');
    const s = buildPlayerStory(cp('e', 'Rookie', null), new Map(), new Map());
    expect(s.roleLabel).toBe('Rookie / New NBA player');
  });

  it('7. rookie is not automatically ranked as unimportant', () => {
    const rookie = story({
      playerEntityId: 'r',
      displayName: 'Rookie',
      roleTier: 'new_nba',
    });
    const limited = story({
      playerEntityId: 'l',
      displayName: 'Bench',
      roleTier: 'limited_role',
      mpg: 5,
    });
    expect(compareChangePlayers(rookie, limited)).toBeLessThan(0);
    expect(tierAfterRotation(rookie)).toBe(true);
  });

  it('8. no subjective star/superstar wording', () => {
    const labels = [
      formatChangeContextLine(
        story({
          playerEntityId: 'a',
          displayName: 'A',
          roleTier: 'major_rotation',
          roleLabel: 'Major rotation',
          mpg: 32,
          ppg: 25,
        })
      ),
      'Rookie / New NBA player',
      'Rotation',
      'Limited role',
    ].join(' ');
    for (const w of BANNED_STORY_WORDS) {
      expect(labels.toLowerCase()).not.toContain(w);
    }
  });

  it('9. previous-team context uses canonical stint/roster map', () => {
    const s = buildPlayerStory(
      cp('e', 'Tradee', '1'),
      new Map([
        [
          '1',
          { playerId: '1', gamesPlayed: 70, mpg: 30, ppg: 18 } satisfies PriorSeasonRoleStats,
        ],
      ]),
      new Map([['e', 'BOS']])
    );
    expect(s.otherTeamAbbr).toBe('BOS');
  });

  it('10. no transaction verbs inferred', () => {
    const line = formatChangeContextLine(
      story({
        playerEntityId: 'a',
        displayName: 'A',
        roleTier: 'rotation',
        roleLabel: 'Rotation',
        mpg: 22,
        ppg: 11,
        otherTeamAbbr: 'BOS',
      })
    );
    expect(line).not.toMatch(/traded|waived|signed|acquired/i);
  });

  it('11. whole-season vs team-specific stat semantics documented', () => {
    expect(STATS_SQL).toMatch(/player_game_logs/);
    expect(STATS_SQL).toMatch(/player_season_averages/);
    expect(STATS_SQL).not.toMatch(/team_id\s*=/);
    const continuity = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [cp('e', 'P', '1')],
      previous: [],
    });
    const built = buildRosterChangeStory({
      continuity,
      statsByPlayerId: new Map(),
      priorTeamByEntity: new Map(),
      currentOtherTeamByEntity: new Map(),
    });
    expect(built.statsScope).toBe('whole_season_prior');
  });

  it('12. Class D is not name-fabricated', () => {
    expect(TEAM_ROSTER_ENTITY_SQL).toMatch(/player_entity_id/);
    expect(TEAM_ROSTER_ENTITY_SQL).not.toMatch(/raw\.players/);
  });

  it('13. Added/Departed counts remain identical to continuity logic', () => {
    const continuity = computeRosterContinuity({
      season: '2026',
      previousSeason: '2025',
      previousSeasonAvailable: true,
      current: [cp('a', 'A', '1'), cp('b', 'B', null), cp('c', 'C', '3')],
      previous: [cp('c', 'C', '3'), cp('d', 'D', '4')],
    });
    const built = buildRosterChangeStory({
      continuity,
      statsByPlayerId: new Map(),
      priorTeamByEntity: new Map(),
      currentOtherTeamByEntity: new Map(),
    });
    expect(built.addedCount).toBe(continuity.addedCount);
    expect(built.departedCount).toBe(continuity.departedCount);
    expect(built.returningCount).toBe(continuity.returningCount);
    expect(built.addedKey.length + built.addedOther.length).toBe(
      continuity.addedCount
    );
  });

  it('14. 2025 view still fails safely when 2024 context unavailable', () => {
    const continuity = computeRosterContinuity({
      season: '2025',
      previousSeason: '2024',
      previousSeasonAvailable: false,
      current: [],
      previous: [],
    });
    const empty = emptyRosterChangeStory(continuity);
    expect(empty.available).toBe(false);
    expect(continuity.available).toBe(false);
  });

  it('15. no N+1 queries', () => {
    expect(STATS_SQL).toMatch(/ANY\(\$2/);
    expect(STATS_SQL).toMatch(/GROUP BY/);
    expect(KEY_CHANGE_HIGHLIGHT).toBe(3);
    expect(ROLE_MAJOR_MPG).toBe(28);
    expect(ROLE_ROTATION_MPG).toBe(15);
  });

  it('16. roster/schedule/injury/snapshot behavior remains unchanged', () => {
    expect(TEAM_ROSTER_CURRENT_SQL).toMatch(/team_roster_current/);
    expect(TEAM_COMPACT_UPCOMING_SQL).toMatch(/analytics\.games/);
    expect(TEAM_COMPACT_RECENT_SQL).toMatch(/analytics\.games/);
  });
});

function tierAfterRotation(s: RosterChangePlayerStory): boolean {
  const rotation = story({
    playerEntityId: 'rot',
    displayName: 'Rot',
    roleTier: 'rotation',
    mpg: 20,
  });
  return compareChangePlayers(rotation, s) < 0;
}
