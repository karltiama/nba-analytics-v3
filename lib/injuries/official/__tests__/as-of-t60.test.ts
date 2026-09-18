import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_INJURY_ASOF_T60_VERSION,
  computeSemanticHash,
  selectAsOfT60Snapshot,
  reconstructTeams,
  type GameSnapshot,
  type IdentityAttachment,
} from '../as-of-t60';

const ROOT = path.join(process.cwd(), 'tests/fixtures/official-injury-asof-t60');

function loadSplit(split: string) {
  const dir = path.join(ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

function runRealOrSyn(fx: any) {
  const snapshots = (fx.input.snapshots as GameSnapshot[]).map((s) => ({
    ...s,
    semantic_hash: s.semantic_hash ?? computeSemanticHash(s),
  }));
  const selection = selectAsOfT60Snapshot({
    sourceContentAbsent: Boolean(fx.input.source_content_absent),
    cutoffAt: fx.input.cutoff_at,
    snapshots,
  });
  const sel = selection.selected
    ? {
        ...selection,
        selected: {
          ...selection.selected,
          away_team_id: fx.input.away_team_id,
          home_team_id: fx.input.home_team_id,
          away_abbr: fx.input.away_abbr,
          home_abbr: fx.input.home_abbr,
        },
      }
    : selection;
  const teams = reconstructTeams({
    sourceContentAbsent: Boolean(fx.input.source_content_absent),
    selection: sel,
    identityByKey: new Map<string, IdentityAttachment>(),
    gameId: fx.input.game_id,
  });
  if (!sel.selected) {
    teams.away.team_id = fx.input.away_team_id;
    teams.away.abbr = fx.input.away_abbr;
    teams.home.team_id = fx.input.home_team_id;
    teams.home.abbr = fx.input.home_abbr;
    if (fx.input.source_content_absent) {
      teams.away.team_state = 'SOURCE_ABSENT';
      teams.home.team_state = 'SOURCE_ABSENT';
    }
  }
  return { selection: sel, teams };
}

describe('as-of T−60 development fixtures', () => {
  const fixtures = loadSplit('development');
  it(`loads ${fixtures.length} development fixtures`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id} (${fx.category})`, () => {
      const { selection, teams } = runRealOrSyn(fx);
      expect(selection.reconstructionVersion).toBe(OFFICIAL_INJURY_ASOF_T60_VERSION);
      expect(selection.gameLevelStatus).toBe(fx.expected.game_level_status);
      expect(selection.selectedPublishedAt).toBe(fx.expected.selected_published_at);
      if (fx.expected.snapshot_age_minutes != null) {
        expect(selection.snapshotAgeMinutes).toBe(fx.expected.snapshot_age_minutes);
      }
      if (fx.expected.age_bucket) {
        expect(selection.ageBucket).toBe(fx.expected.age_bucket);
      }
      if (fx.expected.exact_cutoff_count != null) {
        expect(selection.exactCutoffCount).toBe(fx.expected.exact_cutoff_count);
      }
      if (fx.expected.away_team_state) {
        expect(teams.away.team_state).toBe(fx.expected.away_team_state);
      }
      if (fx.expected.home_team_state) {
        expect(teams.home.team_state).toBe(fx.expected.home_team_state);
      }
      if (fx.expected.away_player_count != null) {
        expect(teams.away.players.length).toBe(fx.expected.away_player_count);
      }
      if (fx.expected.home_player_count != null) {
        expect(teams.home.players.length).toBe(fx.expected.home_player_count);
      }
      if (fx.expected.selected_source_game_block_id !== undefined) {
        expect(selection.selected?.source_game_block_id ?? null).toBe(
          fx.expected.selected_source_game_block_id
        );
      }
    });
  }
});

describe('as-of T−60 synthetic policy fixtures', () => {
  const fixtures = loadSplit('synthetic');
  for (const fx of fixtures) {
    it(`policy: ${fx.fixture_id}`, () => {
      const { selection, teams } = runRealOrSyn(fx);
      expect(selection.gameLevelStatus).toBe(fx.expected.game_level_status);
      if (fx.expected.selected_published_at !== undefined) {
        expect(selection.selectedPublishedAt).toBe(fx.expected.selected_published_at);
      }
      if (fx.expected.away_team_state) {
        expect(teams.away.team_state).toBe(fx.expected.away_team_state);
      }
      if (fx.expected.home_team_state) {
        expect(teams.home.team_state).toBe(fx.expected.home_team_state);
      }
      if (fx.expected.future_count != null) {
        expect(selection.futureCount).toBe(fx.expected.future_count);
      }
      if (fx.expected.duplicateTimestampConflict) {
        expect(selection.duplicateTimestampConflict).toBe(true);
      }
      if (fx.expected.away_player_names) {
        expect(teams.away.players.map((p) => p.player_name_raw)).toEqual(
          fx.expected.away_player_names
        );
      }
      if (fx.expected.missing_player_not_carried) {
        expect(
          teams.away.players.some(
            (p) => p.player_name_raw === fx.expected.missing_player_not_carried
          )
        ).toBe(false);
      }
      if (fx.expected.away_status) {
        expect(teams.away.players[0]?.status_raw).toBe(fx.expected.away_status);
      }
    });
  }
});

describe('held-out not loaded by development suite', () => {
  it('development fixtures all have split=development', () => {
    expect(loadSplit('development').every((f) => f.split === 'development')).toBe(true);
  });
});
