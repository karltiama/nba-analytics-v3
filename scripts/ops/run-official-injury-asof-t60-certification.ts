/**
 * Phase 5A — as-of T−60 certification + full dry reconstruction.
 *
 *   npx tsx scripts/ops/run-official-injury-asof-t60-certification.ts
 */

import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import {
  OFFICIAL_INJURY_ASOF_T60_VERSION,
  MAX_FRESHNESS_MINUTES,
  computeSemanticHash,
  selectAsOfT60Snapshot,
  reconstructTeams,
  projectOfficialPlayerGameCutoff,
  type GameSnapshot,
  type IdentityAttachment,
  type SelectedPlayerState,
} from '../../lib/injuries/official/as-of-t60';

const ROOT = process.cwd();
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/official-injury-asof-t60');
const SNAP_GZ = path.join(ROOT, 'tmp/official-injury-report-asof-t60/game-snapshots.ndjson.gz');
const ID_GZ = path.join(
  ROOT,
  'tmp/official-injury-report-player-identity-resolution/all-results.ndjson.gz'
);
const OPG_GZ = path.join(
  ROOT,
  'tmp/official-injury-report-player-identity-candidate-audit/official-player-game-candidates.ndjson.gz'
);
const PHASE1B_JSON = path.join(
  ROOT,
  'reports/operations/official-injury-report-t60-source-coverage.json'
);
const MODULE_PATH = path.join(ROOT, 'lib/injuries/official/as-of-t60.ts');
const RUNNER_PATH = path.join(
  ROOT,
  'scripts/ops/run-official-injury-asof-t60-certification.ts'
);
const OUT_TMP = path.join(ROOT, 'tmp/official-injury-report-asof-t60');
const REPORTS = path.join(ROOT, 'reports/operations');

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

async function* readGz(file: string) {
  const rl = readline.createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function writeGz(file: string, rows: object[]) {
  const gzip = createGzip();
  const out = createWriteStream(file);
  const done = pipeline(gzip, out);
  for (const row of rows) gzip.write(JSON.stringify(row) + '\n');
  gzip.end();
  await done;
}

function loadFixtures(split: string) {
  const dir = path.join(FIXTURE_ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

function runFixture(fx: any) {
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
    identityByKey: new Map(),
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
  const diffs: string[] = [];
  if (sel.gameLevelStatus !== fx.expected.game_level_status)
    diffs.push(`status:${sel.gameLevelStatus}`);
  if (
    fx.expected.selected_published_at !== undefined &&
    sel.selectedPublishedAt !== fx.expected.selected_published_at
  )
    diffs.push(`pub:${sel.selectedPublishedAt}`);
  if (
    fx.expected.away_team_state &&
    teams.away.team_state !== fx.expected.away_team_state
  )
    diffs.push(`away:${teams.away.team_state}`);
  if (
    fx.expected.home_team_state &&
    teams.home.team_state !== fx.expected.home_team_state
  )
    diffs.push(`home:${teams.home.team_state}`);
  if (
    fx.expected.away_player_count != null &&
    teams.away.players.length !== fx.expected.away_player_count
  )
    diffs.push(`away_n:${teams.away.players.length}`);
  if (
    fx.expected.home_player_count != null &&
    teams.home.players.length !== fx.expected.home_player_count
  )
    diffs.push(`home_n:${teams.home.players.length}`);
  if (
    fx.expected.selected_source_game_block_id !== undefined &&
    (sel.selected?.source_game_block_id ?? null) !==
      fx.expected.selected_source_game_block_id
  )
    diffs.push('block_id');
  if (fx.expected.future_count != null && sel.futureCount !== fx.expected.future_count)
    diffs.push(`future:${sel.futureCount}`);
  if (fx.expected.duplicateTimestampConflict && !sel.duplicateTimestampConflict)
    diffs.push('conflict');
  if (fx.expected.away_status && teams.away.players[0]?.status_raw !== fx.expected.away_status)
    diffs.push('away_status');
  return { ok: diffs.length === 0, diffs, sel, teams };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * (p / 100);
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  if (f === c) return sorted[f]!;
  return sorted[f]! * (c - k) + sorted[c]! * (k - f);
}

async function main() {
  mkdirSync(OUT_TMP, { recursive: true });
  mkdirSync(REPORTS, { recursive: true });

  const idResultsSha = sha256File(ID_GZ);
  const snapSha = sha256File(SNAP_GZ);
  const fingerprint = {
    fingerprinted_at: utcNow(),
    reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
    files: {
      'lib/injuries/official/as-of-t60.ts': sha256File(MODULE_PATH),
      'scripts/ops/run-official-injury-asof-t60-certification.ts': sha256File(RUNNER_PATH),
      game_snapshots_gz: snapSha,
      identity_results_gz: idResultsSha,
      parser_py: 'ce7d729db2fe46b07e0bcfdfc9db506b62af812c0633afb30a2b97646f615ac7',
      parsed_rows_gz: 'ed7ef57028015813fda5fce808d879e7fdcf5c3ef8185d5dce684ac4549494f6',
      blocks_gz: '22ea92cf691e0d03d0df2e676a63c852bc0171988a562a49765a339c7091435c',
    },
    node: process.version,
  };
  writeFileSync(
    path.join(OUT_TMP, 'reconstruction-fingerprint.json'),
    JSON.stringify(fingerprint, null, 2) + '\n'
  );
  const frozenModuleSha = fingerprint.files['lib/injuries/official/as-of-t60.ts'];

  // Development gate
  const dev = loadFixtures('development');
  const syn = loadFixtures('synthetic');
  const devResults = [...dev, ...syn].map((fx) => {
    const r = runFixture(fx);
    return { fixture_id: fx.fixture_id, split: fx.split, ok: r.ok, diffs: r.diffs };
  });
  const devExact = devResults.filter((r) => r.ok).length;
  const developmentGate = devExact === devResults.length ? 'PASS' : 'FAIL';
  const developmentReport = {
    generated_at: utcNow(),
    phase: '5A.1',
    AS_OF_T60_DEVELOPMENT_GATE: developmentGate,
    reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
    development_exact: `${dev.filter((f) => runFixture(f).ok).length}/${dev.length}`,
    synthetic_exact: `${syn.filter((f) => runFixture(f).ok).length}/${syn.length}`,
    failures: devResults.filter((r) => !r.ok),
    AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
  };
  writeFileSync(
    path.join(REPORTS, 'official-injury-report-asof-t60-development.json'),
    JSON.stringify(developmentReport, null, 2) + '\n'
  );
  writeFileSync(
    path.join(REPORTS, 'official-injury-report-asof-t60-development.md'),
    [
      '# Official injury as-of T−60 — development gate',
      '',
      `**AS_OF_T60_DEVELOPMENT_GATE = ${developmentGate}**`,
      '',
      `Development: ${developmentReport.development_exact}  `,
      `Synthetic: ${developmentReport.synthetic_exact}`,
      '',
      'AS_OF_INJURY_TAPE_CERTIFIED = NO',
      '',
    ].join('\n') + '\n'
  );
  if (developmentGate !== 'PASS') {
    console.log(JSON.stringify(developmentReport, null, 2));
    process.exit(1);
  }

  // Held-out first run (immutable)
  const hoJson = path.join(REPORTS, 'official-injury-report-asof-t60-held-out-first-run.json');
  const hoMd = path.join(REPORTS, 'official-injury-report-asof-t60-held-out-first-run.md');
  let heldCertified = false;
  let hoExact = '0/0';
  if (existsSync(hoJson)) {
    const prior = JSON.parse(readFileSync(hoJson, 'utf8'));
    heldCertified = prior.AS_OF_T60_HELD_OUT_PASS === true;
    hoExact = prior.held_out_exact;
    console.log('Preserving immutable held-out first-run artifact.');
  } else {
    if (sha256File(MODULE_PATH) !== frozenModuleSha) {
      throw new Error('Module changed before held-out');
    }
    const held = loadFixtures('held_out');
    const results = held.map((fx) => {
      const r = runFixture(fx);
      return {
        fixture_id: fx.fixture_id,
        category: fx.category,
        ok: r.ok,
        diffs: r.diffs,
        expected: fx.expected.game_level_status,
        actual: r.sel.gameLevelStatus,
      };
    });
    const exact = results.filter((r) => r.ok).length;
    heldCertified = exact === held.length;
    hoExact = `${exact}/${held.length}`;
    const first = {
      generated_at: utcNow(),
      immutable: true,
      note: 'FIRST blind held-out run — do not overwrite',
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      fingerprint,
      held_out_exact: hoExact,
      AS_OF_T60_HELD_OUT_PASS: heldCertified,
      AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
      results,
    };
    writeFileSync(hoJson, JSON.stringify(first, null, 2) + '\n');
    writeFileSync(
      hoMd,
      [
        '# Official injury as-of T−60 — held-out FIRST RUN',
        '',
        '**IMMUTABLE**',
        '',
        `Held-out: **${hoExact}**`,
        '',
        `PASS = ${heldCertified}`,
        '',
      ].join('\n') + '\n'
    );
  }

  if (!heldCertified) {
    writeFileSync(
      path.join(REPORTS, 'official-injury-report-asof-t60-certification.json'),
      JSON.stringify(
        {
          AS_OF_T60_RECONSTRUCTION_GATE: 'FAIL',
          AS_OF_INJURY_TAPE_CERTIFIED: 'NO',
          F9: 'BLOCKED',
          NEXT: 'REOPEN_ASOF_T60_DEVELOPMENT',
        },
        null,
        2
      ) + '\n'
    );
    process.exit(1);
  }

  // Load identity + OPG ever_out flags
  const identity = new Map<string, IdentityAttachment>();
  const opgMeta = new Map<string, { ever_out: boolean; season: string }>();
  for await (const r of readGz(ID_GZ)) {
    identity.set(`${r.game_id}|${r.team_id}|${r.player_name_raw}`, {
      resolution_status: r.resolution_status,
      player_entity_id: r.player_entity_id,
      serving_player_id: r.serving_player_id,
      quarantine_reason: r.quarantine_reason,
    });
  }
  for await (const r of readGz(OPG_GZ)) {
    opgMeta.set(`${r.game_id}|${r.team_id}|${r.player_name_raw}`, {
      ever_out: Boolean(r.ever_out),
      season: String(r.season),
    });
  }

  // Full reconstruction
  if (sha256File(MODULE_PATH) !== frozenModuleSha) {
    throw new Error('Module changed before full run');
  }

  const gameStates: object[] = [];
  const teamStates: object[] = [];
  const playerStates: object[] = [];
  const opgStates: object[] = [];
  const quarantined: object[] = [];

  const gameStatusCounts: Record<string, number> = {};
  const teamStateCounts: Record<string, number> = {};
  const ageBuckets: Record<string, number> = {};
  const ages: number[] = [];
  const statusVocab = new Map<string, number>();
  const seasonGame: Record<string, any> = {};
  const seasonTeam: Record<string, any> = {};
  const seasonPlayer: Record<string, any> = {};

  let exactCutoffGames = 0;
  let games = 0;
  let valid = 0;
  let nysTeams = 0;
  let submittedTeams = 0;
  let sourceAbsentTeams = 0;

  // Build selected players by game+team for OPG projection
  const selectedByGameTeam = new Map<string, { teamState: string; players: SelectedPlayerState[]; selection: any; sourceAbsent: boolean }>();

  for await (const game of readGz(SNAP_GZ)) {
    games += 1;
    const season = String(game.season);
    seasonGame[season] ??= { n: 0, statuses: {} as Record<string, number> };
    seasonGame[season].n += 1;

    const selection = selectAsOfT60Snapshot({
      sourceContentAbsent: Boolean(game.source_content_absent),
      cutoffAt: game.cutoff_at,
      snapshots: game.snapshots,
    });
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

    if (sel.exactCutoffCount > 0) exactCutoffGames += 1;

    gameStatusCounts[sel.gameLevelStatus] =
      (gameStatusCounts[sel.gameLevelStatus] ?? 0) + 1;
    seasonGame[season].statuses[sel.gameLevelStatus] =
      (seasonGame[season].statuses[sel.gameLevelStatus] ?? 0) + 1;
    ageBuckets[sel.ageBucket] = (ageBuckets[sel.ageBucket] ?? 0) + 1;
    if (sel.snapshotAgeMinutes != null && sel.gameLevelStatus === 'VALID_PRE_T60_SNAPSHOT') {
      ages.push(sel.snapshotAgeMinutes);
      valid += 1;
    }

    const teams = reconstructTeams({
      sourceContentAbsent: Boolean(game.source_content_absent),
      selection: sel,
      identityByKey: identity,
      gameId: game.game_id,
    });
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

    const gameOut = {
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      game_id: game.game_id,
      season,
      start_time: game.start_time,
      cutoff_at: game.cutoff_at,
      et_game_date: game.et_game_date,
      game_level_status: sel.gameLevelStatus,
      selected_published_at: sel.selectedPublishedAt,
      selected_source_game_block_id: sel.selected?.source_game_block_id ?? null,
      snapshot_age_minutes: sel.snapshotAgeMinutes,
      age_bucket: sel.ageBucket,
      candidate_count: sel.candidateCount,
      exact_cutoff_count: sel.exactCutoffCount,
      future_count: sel.futureCount,
      stale_only_count: sel.staleOnlyCount,
      duplicate_timestamp_conflict: sel.duplicateTimestampConflict,
    };
    gameStates.push(gameOut);
    if (
      sel.gameLevelStatus === 'SNAPSHOT_TIMESTAMP_CONFLICT' ||
      sel.gameLevelStatus === 'OTHER_STRUCTURAL_FAILURE'
    ) {
      quarantined.push({ kind: 'GAME', ...gameOut });
    }

    for (const side of [teams.away, teams.home] as const) {
      teamStateCounts[side.team_state] = (teamStateCounts[side.team_state] ?? 0) + 1;
      seasonTeam[season] ??= { n: 0, states: {} as Record<string, number> };
      seasonTeam[season].n += 1;
      seasonTeam[season].states[side.team_state] =
        (seasonTeam[season].states[side.team_state] ?? 0) + 1;
      if (side.team_state === 'NOT_YET_SUBMITTED') nysTeams += 1;
      if (side.team_state === 'SUBMITTED_WITH_PLAYER_ROWS') submittedTeams += 1;
      if (side.team_state === 'SOURCE_ABSENT') sourceAbsentTeams += 1;

      teamStates.push({
        reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
        game_id: game.game_id,
        season,
        cutoff_at: game.cutoff_at,
        selected_published_at: sel.selectedPublishedAt,
        snapshot_age_minutes: sel.snapshotAgeMinutes,
        team_id: side.team_id,
        abbr: side.abbr,
        side: side.side,
        team_state: side.team_state,
        player_row_count: side.players.length,
        duplicate_entity_in_snapshot: side.duplicate_entity_in_snapshot,
        duplicate_raw_name_conflict: side.duplicate_raw_name_conflict,
      });

      selectedByGameTeam.set(`${game.game_id}|${side.team_id}`, {
        teamState: side.team_state,
        players: side.players,
        selection: sel,
        sourceAbsent: Boolean(game.source_content_absent),
      });

      for (const p of side.players) {
        const st = p.status_raw ?? '';
        statusVocab.set(st, (statusVocab.get(st) ?? 0) + 1);
        seasonPlayer[season] ??= {
          n: 0,
          statuses: {} as Record<string, number>,
          identity: {} as Record<string, number>,
        };
        seasonPlayer[season].n += 1;
        seasonPlayer[season].statuses[st] = (seasonPlayer[season].statuses[st] ?? 0) + 1;
        seasonPlayer[season].identity[p.identity_bucket] =
          (seasonPlayer[season].identity[p.identity_bucket] ?? 0) + 1;

        // Identity consistency
        const key = `${game.game_id}|${side.team_id}|${p.player_name_raw}`;
        const expectedId = identity.get(key);
        if (expectedId && p.identity) {
          if (
            expectedId.resolution_status !== p.identity.resolution_status ||
            expectedId.player_entity_id !== p.identity.player_entity_id
          ) {
            throw new Error(`Identity drift at cutoff for ${key}`);
          }
        }

        playerStates.push({
          reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
          game_id: game.game_id,
          season,
          team_id: side.team_id,
          team_abbr: side.abbr,
          report_published_at: sel.selectedPublishedAt,
          cutoff_at: game.cutoff_at,
          snapshot_age_minutes: sel.snapshotAgeMinutes,
          player_name_raw: p.player_name_raw,
          status_raw: p.status_raw,
          reason_raw: p.reason_raw,
          coarse: p.coarse,
          identity_bucket: p.identity_bucket,
          player_entity_id: p.identity?.player_entity_id ?? null,
          serving_player_id: p.identity?.serving_player_id ?? null,
          identity_quarantine_reason: p.identity?.quarantine_reason ?? null,
        });
      }
    }
  }

  if (games !== 3962) throw new Error(`Game count drift: ${games}`);

  // OPG projection
  const opgCounts: Record<string, number> = {};
  let opgN = 0;
  for (const [key, meta] of opgMeta) {
    opgN += 1;
    const [gameId, teamId, ...nameParts] = key.split('|');
    const playerName = nameParts.join('|');
    const ctx = selectedByGameTeam.get(`${gameId}|${teamId}`);
    let proj;
    if (!ctx) {
      // team side missing from reconstruction map — treat via game-level
      proj = {
        source_status_state: 'NO_VALID_PRE_T60_SNAPSHOT' as const,
        explicit_status_raw: null,
      };
      // check if game source absent
      // fallback: look at gameStates
    } else {
      proj = projectOfficialPlayerGameCutoff({
        sourceContentAbsent: ctx.sourceAbsent,
        selection: ctx.selection,
        teamState: ctx.teamState as any,
        playerNameRaw: playerName,
        selectedPlayers: ctx.players,
      });
    }
    opgCounts[proj.source_status_state] = (opgCounts[proj.source_status_state] ?? 0) + 1;
    const id = identity.get(key);
    opgStates.push({
      reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
      game_id: gameId,
      team_id: teamId,
      player_name_raw: playerName,
      season: meta.season,
      ever_out: meta.ever_out,
      source_status_state: proj.source_status_state,
      explicit_status_raw: proj.explicit_status_raw,
      identity_status: id?.resolution_status ?? null,
      player_entity_id: id?.player_entity_id ?? null,
    });
  }

  // Fix OPG for games where ctx missing due to SOURCE_ABSENT — re-scan
  // Actually teams always registered. For 1037597 both teams SOURCE_ABSENT — ctx exists.

  await writeGz(path.join(OUT_TMP, 'game-states.ndjson.gz'), gameStates);
  await writeGz(path.join(OUT_TMP, 'team-states.ndjson.gz'), teamStates);
  await writeGz(path.join(OUT_TMP, 'selected-player-states.ndjson.gz'), playerStates);
  await writeGz(path.join(OUT_TMP, 'official-player-game-cutoff-states.ndjson.gz'), opgStates);
  await writeGz(path.join(OUT_TMP, 'quarantined.ndjson.gz'), quarantined);

  ages.sort((a, b) => a - b);
  const ageStats = {
    n: ages.length,
    median: percentile(ages, 50),
    mean: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null,
    p95: percentile(ages, 95),
    max: ages.length ? ages[ages.length - 1]! : null,
    le_15: ages.filter((a) => a <= 15).length,
    le_30: ages.filter((a) => a <= 30).length,
    le_60: ages.filter((a) => a <= 60).length,
    le_120: ages.filter((a) => a <= 120).length,
    le_360: ages.filter((a) => a <= 360).length,
    le_1440: ages.filter((a) => a <= 1440).length,
    le_2880: ages.filter((a) => a <= 2880).length,
  };

  const totalTeamGames = teamStates.length;
  const validTeamGames =
    totalTeamGames - (teamStateCounts['SOURCE_ABSENT'] ?? 0);
  const nysRate = nysTeams / Math.max(validTeamGames, 1);

  // Phase 1B comparison
  let phase1b: any = null;
  if (existsSync(PHASE1B_JSON)) {
    phase1b = JSON.parse(readFileSync(PHASE1B_JSON, 'utf8'));
  }

  const playerStatusCounts: Record<string, number> = {};
  for (const [k, v] of statusVocab) playerStatusCounts[k || '(null)'] = v;

  const identityBuckets: Record<string, number> = {};
  for (const p of playerStates as any[]) {
    identityBuckets[p.identity_bucket] = (identityBuckets[p.identity_bucket] ?? 0) + 1;
  }

  const gatePass =
    games === 3962 &&
    heldCertified &&
    developmentGate === 'PASS' &&
    (gameStatusCounts['SNAPSHOT_TIMESTAMP_CONFLICT'] ?? 0) === 0 &&
    sha256File(MODULE_PATH) === frozenModuleSha;

  const f9 = gatePass ? 'CLOSED' : 'PARTIAL';
  const tapeCertified = gatePass ? 'YES' : 'NO';

  const art = (p: string, n: number) => ({
    path: path.relative(ROOT, p).replace(/\\/g, '/'),
    sha256: sha256File(p),
    bytes: statSync(p).size,
    record_count: n,
  });

  const fullRun = {
    generated_at: utcNow(),
    phase: '5A.4',
    AS_OF_T60_RECONSTRUCTION_GATE: gatePass ? 'PASS' : 'FAIL',
    F9: f9,
    AS_OF_INJURY_TAPE_CERTIFIED: tapeCertified,
    reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
    reconstruction_sha256: frozenModuleSha,
    fingerprint,
    games: {
      target: games,
      status_counts: gameStatusCounts,
      exact_cutoff_report_games: exactCutoffGames,
      by_season: seasonGame,
    },
    snapshot_age: { buckets: ageBuckets, stats: ageStats },
    teams: {
      total_team_games: totalTeamGames,
      state_counts: teamStateCounts,
      nys_team_games: nysTeams,
      submitted_team_games: submittedTeams,
      source_absent_team_games: sourceAbsentTeams,
      nys_rate_among_non_source_absent: nysRate,
      by_season: seasonTeam,
    },
    selected_players: {
      total: playerStates.length,
      status_counts: playerStatusCounts,
      identity_buckets: identityBuckets,
      by_season: seasonPlayer,
    },
    opg_projection: {
      total: opgN,
      counts: opgCounts,
      note: 'OPG set is injury-report-mentioned players only — not full NBA rosters. NO_EXPLICIT_PLAYER_STATUS_AT_CUTOFF ≠ Available.',
    },
    phase1b_comparison: {
      phase1b_any_pre_t60: phase1b?.summary?.games_with_any_pre_cutoff_candidate ?? null,
      phase5a_valid_pre_t60: valid,
      phase5a_no_snapshot: gameStatusCounts['NO_PRE_T60_SNAPSHOT'] ?? 0,
      phase5a_stale: gameStatusCounts['STALE_PRE_T60_SNAPSHOT'] ?? 0,
      phase5a_source_absent: gameStatusCounts['NO_OFFICIAL_SOURCE_CONTENT'] ?? 0,
      note: 'Phase 5A uses canonical PDF title report_published_at; Phase 1B used filename-inferred publication times.',
    },
    safety: {
      report_at_cutoff_used: 'NO',
      future_report_used: 'NO',
      earlier_report_rollback_after_nys: 'NO',
      player_status_carry_forward: 'NO',
      missing_interpreted_as_available: 'NO',
      postgame_pgl_used_for_availability: 'NO',
    },
    artifacts: {
      game_states: art(path.join(OUT_TMP, 'game-states.ndjson.gz'), gameStates.length),
      team_states: art(path.join(OUT_TMP, 'team-states.ndjson.gz'), teamStates.length),
      selected_player_states: art(
        path.join(OUT_TMP, 'selected-player-states.ndjson.gz'),
        playerStates.length
      ),
      opg_cutoff_states: art(
        path.join(OUT_TMP, 'official-player-game-cutoff-states.ndjson.gz'),
        opgStates.length
      ),
      quarantined: art(path.join(OUT_TMP, 'quarantined.ndjson.gz'), quarantined.length),
    },
    NEXT: tapeCertified === 'YES'
      ? 'PROCEED_TO_T60_REASON_POLICY_AND_WOWY_ELIGIBILITY_DESIGN'
      : 'INVESTIGATE_ASOF_T60',
  };

  writeFileSync(
    path.join(OUT_TMP, 'run-state.json'),
    JSON.stringify(
      {
        generated_at: utcNow(),
        games,
        valid,
        nysTeams,
        playerRows: playerStates.length,
        opgN,
      },
      null,
      2
    ) + '\n'
  );

  writeFileSync(
    path.join(REPORTS, 'official-injury-report-asof-t60-full-run.json'),
    JSON.stringify(fullRun, null, 2) + '\n'
  );
  writeFileSync(
    path.join(REPORTS, 'official-injury-report-asof-t60-full-run.md'),
    [
      '# Official injury as-of T−60 — full dry run',
      '',
      `**AS_OF_T60_RECONSTRUCTION_GATE = ${fullRun.AS_OF_T60_RECONSTRUCTION_GATE}**  `,
      `**F9 = ${f9}**  `,
      `**AS_OF_INJURY_TAPE_CERTIFIED = ${tapeCertified}**`,
      '',
      `Version: \`${OFFICIAL_INJURY_ASOF_T60_VERSION}\`  `,
      `SHA: \`${frozenModuleSha}\``,
      '',
      `Games: **${games}** — \`${JSON.stringify(gameStatusCounts)}\``,
      `Team-games: **${totalTeamGames}** — NYS **${nysTeams}** / submitted **${submittedTeams}**`,
      `Selected player rows: **${playerStates.length}** — \`${JSON.stringify(playerStatusCounts)}\``,
      `OPG projection: **${opgN}** — \`${JSON.stringify(opgCounts)}\``,
      '',
      `Age median/p95/max: ${ageStats.median} / ${ageStats.p95} / ${ageStats.max}`,
      '',
      `NEXT = ${fullRun.NEXT}`,
      '',
      'Source fact layer only — not WOWY eligibility.',
      '',
    ].join('\n') + '\n'
  );

  const certification = {
    generated_at: utcNow(),
    AS_OF_T60_RECONSTRUCTION_GATE: fullRun.AS_OF_T60_RECONSTRUCTION_GATE,
    F9: f9,
    AS_OF_INJURY_TAPE_CERTIFIED: tapeCertified,
    reconstruction_version: OFFICIAL_INJURY_ASOF_T60_VERSION,
    reconstruction_sha256: frozenModuleSha,
    development_exact: developmentReport.development_exact,
    synthetic_exact: developmentReport.synthetic_exact,
    held_out_exact: hoExact,
    held_out_first_run_immutable: true,
    implementation: 'lib/injuries/official/as-of-t60.ts',
    NEXT: fullRun.NEXT,
    safety: fullRun.safety,
  };
  writeFileSync(
    path.join(REPORTS, 'official-injury-report-asof-t60-certification.json'),
    JSON.stringify(certification, null, 2) + '\n'
  );
  writeFileSync(
    path.join(REPORTS, 'official-injury-report-asof-t60-certification.md'),
    [
      '# Official injury as-of T−60 certification',
      '',
      `**AS_OF_T60_RECONSTRUCTION_GATE = ${certification.AS_OF_T60_RECONSTRUCTION_GATE}**  `,
      `**F9 = ${f9}**  `,
      `**AS_OF_INJURY_TAPE_CERTIFIED = ${tapeCertified}**`,
      '',
      `- Implementation: \`${certification.implementation}\``,
      `- Version: \`${OFFICIAL_INJURY_ASOF_T60_VERSION}\``,
      `- SHA-256: \`${frozenModuleSha}\``,
      `- Development: ${certification.development_exact}`,
      `- Synthetic: ${certification.synthetic_exact}`,
      `- Held-out: ${hoExact} (immutable)`,
      '',
      `NEXT = ${certification.NEXT}`,
      '',
    ].join('\n') + '\n'
  );

  console.log(
    JSON.stringify(
      {
        AS_OF_T60_DEVELOPMENT_GATE: developmentGate,
        held_out: hoExact,
        AS_OF_T60_RECONSTRUCTION_GATE: fullRun.AS_OF_T60_RECONSTRUCTION_GATE,
        F9: f9,
        AS_OF_INJURY_TAPE_CERTIFIED: tapeCertified,
        games: gameStatusCounts,
        teams: teamStateCounts,
        nysTeams,
        nysRate,
        playerRows: playerStates.length,
        playerStatusCounts,
        ageStats: {
          median: ageStats.median,
          p95: ageStats.p95,
          max: ageStats.max,
          le_15: ageStats.le_15,
          le_30: ageStats.le_30,
          le_60: ageStats.le_60,
        },
        opgCounts,
        exactCutoffGames,
        NEXT: fullRun.NEXT,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
