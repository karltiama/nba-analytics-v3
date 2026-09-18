/**
 * Phase 5A — lock as-of T−60 fixtures (policy oracle; not the production module).
 *
 *   npx tsx scripts/ops/lock-official-injury-asof-t60-fixtures.ts
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';
import {
  OFFICIAL_INJURY_ASOF_T60_VERSION,
  computeSemanticHash,
  selectAsOfT60Snapshot,
  reconstructTeams,
  classifyTeamState,
  type GameSnapshot,
  type IdentityAttachment,
} from '../../lib/injuries/official/as-of-t60';

const ROOT = process.cwd();
const SNAP_GZ = path.join(ROOT, 'tmp/official-injury-report-asof-t60/game-snapshots.ndjson.gz');
const ID_GZ = path.join(
  ROOT,
  'tmp/official-injury-report-player-identity-resolution/all-results.ndjson.gz'
);
const OUT = path.join(ROOT, 'tests/fixtures/official-injury-asof-t60');

async function* readGz(file: string) {
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

function oracleSelect(game: any) {
  // Use the production selector — fixtures are locked AFTER materialization
  // but BEFORE any post-hoc tuning. Expectations come from stated Phase 5A rules
  // implemented once in as-of-t60.ts; this lock script freezes concrete cases.
  return selectAsOfT60Snapshot({
    sourceContentAbsent: Boolean(game.source_content_absent),
    cutoffAt: game.cutoff_at,
    snapshots: game.snapshots as GameSnapshot[],
  });
}

async function main() {
  const games: any[] = [];
  for await (const g of readGz(SNAP_GZ)) games.push(g);

  const identity = new Map<string, IdentityAttachment>();
  for await (const r of readGz(ID_GZ)) {
    identity.set(`${r.game_id}|${r.team_id}|${r.player_name_raw}`, {
      resolution_status: r.resolution_status,
      player_entity_id: r.player_entity_id,
      serving_player_id: r.serving_player_id,
      quarantine_reason: r.quarantine_reason,
    });
  }

  const byId = new Map(games.map((g) => [g.game_id, g]));

  function makeReal(fid: string, split: string, category: string, gameId: string) {
    const game = byId.get(gameId);
    if (!game) throw new Error(`missing game ${gameId}`);
    const selection = oracleSelect(game);
    // Fix team ids on reconstruct from game record
    const sel = selection.selected
      ? {
          ...selection,
          selected: {
            ...selection.selected,
            away_team_id: game.away_team_id,
            home_team_id: game.home_team_id,
            away_abbr: game.away_abbr,
            home_abbr: game.home_abbr,
          },
        }
      : selection;
    const teams = reconstructTeams({
      sourceContentAbsent: Boolean(game.source_content_absent),
      selection: sel,
      identityByKey: identity,
      gameId: game.game_id,
    });
    // Ensure team ids from game when selected null
    if (!sel.selected) {
      teams.away.team_id = game.away_team_id;
      teams.away.abbr = game.away_abbr;
      teams.home.team_id = game.home_team_id;
      teams.home.abbr = game.home_abbr;
      if (game.source_content_absent) {
        teams.away.team_state = 'SOURCE_ABSENT';
        teams.home.team_state = 'SOURCE_ABSENT';
      }
    }
    return {
      fixture_id: fid,
      kind: 'real',
      split,
      category,
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      input: {
        game_id: game.game_id,
        season: game.season,
        start_time: game.start_time,
        cutoff_at: game.cutoff_at,
        away_team_id: game.away_team_id,
        home_team_id: game.home_team_id,
        away_abbr: game.away_abbr,
        home_abbr: game.home_abbr,
        source_content_absent: game.source_content_absent,
        snapshots: game.snapshots,
      },
      expected: {
        game_level_status: sel.gameLevelStatus,
        selected_published_at: sel.selectedPublishedAt,
        snapshot_age_minutes: sel.snapshotAgeMinutes,
        age_bucket: sel.ageBucket,
        exact_cutoff_count: sel.exactCutoffCount,
        away_team_state: teams.away.team_state,
        home_team_state: teams.home.team_state,
        away_player_count: teams.away.players.length,
        home_player_count: teams.home.players.length,
        selected_source_game_block_id: sel.selected?.source_game_block_id ?? null,
      },
    };
  }

  // Pick categories from materialized data
  const picks: Array<[string, string, string, string]> = [];
  const used = new Set<string>();

  const tryPick = (
    fid: string,
    split: string,
    category: string,
    pred: (g: any, sel: any, teams: any) => boolean
  ) => {
    for (const g of games) {
      if (used.has(g.game_id)) continue;
      const sel = oracleSelect(g);
      const teams = reconstructTeams({
        sourceContentAbsent: Boolean(g.source_content_absent),
        selection: sel.selected
          ? {
              ...sel,
              selected: {
                ...sel.selected,
                away_team_id: g.away_team_id,
                home_team_id: g.home_team_id,
                away_abbr: g.away_abbr,
                home_abbr: g.home_abbr,
              },
            }
          : sel,
        identityByKey: identity,
        gameId: g.game_id,
      });
      if (pred(g, sel, teams)) {
        used.add(g.game_id);
        picks.push([fid, split, category, g.game_id]);
        return;
      }
    }
  };

  tryPick('dev-submitted-01', 'development', 'ordinary_submitted', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    t.away.team_state === 'SUBMITTED_WITH_PLAYER_ROWS' &&
    t.home.team_state === 'SUBMITTED_WITH_PLAYER_ROWS'
  );
  tryPick('dev-nys-01', 'development', 'nys_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    (t.away.team_state === 'NOT_YET_SUBMITTED' || t.home.team_state === 'NOT_YET_SUBMITTED')
  );
  tryPick('dev-available-01', 'development', 'available_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.status_raw === 'Available')
  );
  tryPick('dev-out-01', 'development', 'out_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.status_raw === 'Out')
  );
  tryPick('dev-questionable-01', 'development', 'questionable_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.status_raw === 'Questionable')
  );
  tryPick('dev-doubtful-01', 'development', 'doubtful_or_probable', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some(
      (p) => p.status_raw === 'Doubtful' || p.status_raw === 'Probable'
    )
  );
  tryPick('dev-source-absent-01', 'development', 'source_absent_1037597', (g) =>
    g.game_id === '1037597'
  );
  tryPick('dev-fresh-01', 'development', 'near_cutoff', (g, s) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    s.snapshotAgeMinutes != null &&
    s.snapshotAgeMinutes <= 15
  );
  tryPick('dev-entity-only-01', 'development', 'entity_only_player', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some(
      (p) => p.identity_bucket === 'RESOLVED_ENTITY_NO_SERVING_PLAYER'
    )
  );
  tryPick('dev-id-q-01', 'development', 'identity_quarantined_player', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.identity_bucket === 'IDENTITY_QUARANTINED')
  );
  tryPick('dev-exact-cutoff-01', 'development', 'exact_cutoff_exists', (g, s) =>
    s.exactCutoffCount > 0 && s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT'
  );
  // fill more development
  for (let i = 0; i < 12; i++) {
    tryPick(`dev-submitted-${String(i + 2).padStart(2, '0')}`, 'development', 'ordinary_submitted', (g, s, t) =>
      s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
      t.away.team_state === 'SUBMITTED_WITH_PLAYER_ROWS'
    );
  }
  tryPick('dev-nys-02', 'development', 'nys_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    (t.away.team_state === 'NOT_YET_SUBMITTED' || t.home.team_state === 'NOT_YET_SUBMITTED')
  );

  // held_out
  tryPick('ho-submitted-01', 'held_out', 'ordinary_submitted', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    t.away.team_state === 'SUBMITTED_WITH_PLAYER_ROWS' &&
    t.home.team_state === 'SUBMITTED_WITH_PLAYER_ROWS'
  );
  tryPick('ho-nys-01', 'held_out', 'nys_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    (t.away.team_state === 'NOT_YET_SUBMITTED' || t.home.team_state === 'NOT_YET_SUBMITTED')
  );
  tryPick('ho-available-01', 'held_out', 'available_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.status_raw === 'Available')
  );
  tryPick('ho-out-01', 'held_out', 'out_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.status_raw === 'Out')
  );
  tryPick('ho-questionable-01', 'held_out', 'questionable_at_cutoff', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.status_raw === 'Questionable')
  );
  tryPick('ho-fresh-01', 'held_out', 'near_cutoff', (g, s) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    s.snapshotAgeMinutes != null &&
    s.snapshotAgeMinutes <= 30
  );
  tryPick('ho-id-q-01', 'held_out', 'identity_quarantined_player', (g, s, t) =>
    s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT' &&
    [...t.away.players, ...t.home.players].some((p) => p.identity_bucket === 'IDENTITY_QUARANTINED')
  );
  tryPick('ho-exact-cutoff-01', 'held_out', 'exact_cutoff_exists', (g, s) =>
    s.exactCutoffCount > 0
  );
  for (let i = 0; i < 5; i++) {
    tryPick(`ho-submitted-${String(i + 2).padStart(2, '0')}`, 'held_out', 'ordinary_submitted', (g, s) =>
      s.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT'
    );
  }

  // Force 1037597 if missing
  if (![...picks].some((p) => p[3] === '1037597')) {
    picks.push(['dev-source-absent-01', 'development', 'source_absent_1037597', '1037597']);
  }

  const fixtures = picks.map(([fid, split, cat, gid]) => makeReal(fid, split, cat, gid));

  // Synthetic policy fixtures
  const tip = '2025-01-15T01:00:00.000Z';
  const cutoff = '2025-01-15T00:00:00.000Z';
  const baseTeam = (id: string, abbr: string, side: 'away' | 'home', nys: boolean, players: any[]) => ({
    team_id: id,
    abbr,
    side,
    nys,
    structural_conflict: false,
    players,
  });

  const synthetics = [
    {
      fixture_id: 'syn-strict-cutoff-exclude',
      kind: 'synthetic',
      split: 'synthetic',
      category: 'strict_cutoff',
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      input: {
        game_id: 'SYN1',
        season: '2024',
        start_time: tip,
        cutoff_at: cutoff,
        away_team_id: '1',
        home_team_id: '2',
        away_abbr: 'AAA',
        home_abbr: 'BBB',
        source_content_absent: false,
        snapshots: [
          {
            source_game_block_id: 'b1',
            s3_key: 'k1',
            report_published_at: cutoff, // exact — must exclude
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'A, A', status_raw: 'Out', reason_raw: 'x' },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
          {
            source_game_block_id: 'b0',
            s3_key: 'k0',
            report_published_at: '2024-12-14T23:00:00.000Z', // >48h stale
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'A, A', status_raw: 'Available', reason_raw: 'y' },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
        ],
      },
      expected: {
        game_level_status: 'STALE_PRE_T60_SNAPSHOT',
        selected_published_at: null,
        note: 'exact cutoff excluded; only stale remains',
      },
    },
    {
      fixture_id: 'syn-no-nys-rollback',
      kind: 'synthetic',
      split: 'synthetic',
      category: 'no_nys_rollback',
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      input: {
        game_id: 'SYN2',
        season: '2024',
        start_time: tip,
        cutoff_at: cutoff,
        away_team_id: '1',
        home_team_id: '2',
        away_abbr: 'AAA',
        home_abbr: 'BBB',
        source_content_absent: false,
        snapshots: [
          {
            source_game_block_id: 'early',
            s3_key: 'ke',
            report_published_at: '2025-01-14T20:00:00.000Z',
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'X, X', status_raw: 'Out', reason_raw: 'injury' },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
          {
            source_game_block_id: 'late',
            s3_key: 'kl',
            report_published_at: '2025-01-14T23:30:00.000Z',
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', true, []),
              '2': baseTeam('2', 'BBB', 'home', false, [
                { player_name_raw: 'Y, Y', status_raw: 'Available', reason_raw: null },
              ]),
            },
          },
        ],
      },
      expected: {
        game_level_status: 'VALID_PRE_T60_SNAPSHOT',
        selected_published_at: '2025-01-14T23:30:00.000Z',
        away_team_state: 'NOT_YET_SUBMITTED',
        home_team_state: 'SUBMITTED_WITH_PLAYER_ROWS',
        note: 'must NOT roll back to earlier submitted Out for AAA',
      },
    },
    {
      fixture_id: 'syn-no-player-carryforward',
      kind: 'synthetic',
      split: 'synthetic',
      category: 'no_player_carryforward',
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      input: {
        game_id: 'SYN3',
        season: '2024',
        start_time: tip,
        cutoff_at: cutoff,
        away_team_id: '1',
        home_team_id: '2',
        away_abbr: 'AAA',
        home_abbr: 'BBB',
        source_content_absent: false,
        snapshots: [
          {
            source_game_block_id: 'e1',
            s3_key: 'k1',
            report_published_at: '2025-01-14T18:00:00.000Z',
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'Missing, Later', status_raw: 'Out', reason_raw: 'x' },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
          {
            source_game_block_id: 'e2',
            s3_key: 'k2',
            report_published_at: '2025-01-14T23:00:00.000Z',
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'Other, Player', status_raw: 'Available', reason_raw: null },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
        ],
      },
      expected: {
        game_level_status: 'VALID_PRE_T60_SNAPSHOT',
        selected_published_at: '2025-01-14T23:00:00.000Z',
        away_player_names: ['Other, Player'],
        missing_player_not_carried: 'Missing, Later',
      },
    },
    {
      fixture_id: 'syn-future-leakage',
      kind: 'synthetic',
      split: 'synthetic',
      category: 'future_leakage',
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      input: {
        game_id: 'SYN4',
        season: '2024',
        start_time: tip,
        cutoff_at: cutoff,
        away_team_id: '1',
        home_team_id: '2',
        away_abbr: 'AAA',
        home_abbr: 'BBB',
        source_content_absent: false,
        snapshots: [
          {
            source_game_block_id: 'pre',
            s3_key: 'kp',
            report_published_at: '2025-01-14T22:00:00.000Z',
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'Z, Z', status_raw: 'Questionable', reason_raw: null },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
          {
            source_game_block_id: 'post',
            s3_key: 'ko',
            report_published_at: '2025-01-15T00:01:00.000Z', // after cutoff
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'Z, Z', status_raw: 'Out', reason_raw: null },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          },
        ],
      },
      expected: {
        game_level_status: 'VALID_PRE_T60_SNAPSHOT',
        selected_published_at: '2025-01-14T22:00:00.000Z',
        away_status: 'Questionable',
        future_count: 1,
      },
    },
    {
      fixture_id: 'syn-timestamp-conflict',
      kind: 'synthetic',
      split: 'synthetic',
      category: 'timestamp_conflict',
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      input: {
        game_id: 'SYN5',
        season: '2024',
        start_time: tip,
        cutoff_at: cutoff,
        away_team_id: '1',
        home_team_id: '2',
        away_abbr: 'AAA',
        home_abbr: 'BBB',
        source_content_absent: false,
        snapshots: (() => {
          const ts = '2025-01-14T22:00:00.000Z';
          const a = {
            source_game_block_id: 'c1',
            s3_key: 'ka',
            report_published_at: ts,
            game_date: '2025-01-14',
            matchup: 'AAA@BBB',
            away_abbr: 'AAA',
            home_abbr: 'BBB',
            away_team_id: '1',
            home_team_id: '2',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'A, A', status_raw: 'Out', reason_raw: null },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          };
          const b = {
            ...a,
            source_game_block_id: 'c2',
            s3_key: 'kb',
            teams: {
              '1': baseTeam('1', 'AAA', 'away', false, [
                { player_name_raw: 'A, A', status_raw: 'Available', reason_raw: null },
              ]),
              '2': baseTeam('2', 'BBB', 'home', false, []),
            },
          };
          return [
            { ...a, semantic_hash: computeSemanticHash(a) },
            { ...b, semantic_hash: computeSemanticHash(b) },
          ];
        })(),
      },
      expected: {
        game_level_status: 'SNAPSHOT_TIMESTAMP_CONFLICT',
        duplicateTimestampConflict: true,
      },
    },
  ];

  // Ensure semantic hashes on synthetic snapshots that need them
  for (const syn of synthetics) {
    for (const s of syn.input.snapshots as any[]) {
      if (!s.semantic_hash) s.semantic_hash = computeSemanticHash(s);
    }
  }

  for (const sub of ['development', 'held_out', 'synthetic']) {
    const dir = path.join(OUT, sub);
    mkdirSync(dir, { recursive: true });
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.json')) rmSync(path.join(dir, f));
      }
    }
  }

  const all = [...fixtures, ...synthetics];
  for (const fx of all) {
    writeFileSync(
      path.join(OUT, fx.split, `${fx.fixture_id}.json`),
      JSON.stringify(fx, null, 2) + '\n'
    );
  }

  const manifest = {
    locked_at: new Date().toISOString(),
    reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
    counts: {
      development: fixtures.filter((f) => f.split === 'development').length,
      held_out: fixtures.filter((f) => f.split === 'held_out').length,
      synthetic: synthetics.length,
      total: all.length,
    },
    fixtures: all.map((f) => ({
      fixture_id: f.fixture_id,
      kind: f.kind,
      split: f.split,
      category: f.category,
      expected_game_level_status: (f as any).expected.game_level_status,
    })),
    note: 'Real fixture expectations frozen from Phase 5A policy via as-of-t60 selector; do not retune to pass held-out.',
  };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest.counts, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
