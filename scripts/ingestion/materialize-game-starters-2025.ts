/**
 * Step 12C: certified 2025 lineup archive → analytics.game_starters.
 * Read-only S3. No BDL HTTP. starter=true only. Top-level team.id only.
 *
 *   npx tsx scripts/ingestion/materialize-game-starters-2025.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-game-starters-2025.ts --execute --i-understand-production-write
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  certifyStarterGame,
  extractStarterCandidatesFromArchive,
  GAME_STARTERS_SEASON,
  GAME_STARTERS_SOURCE,
  type GameStarterCandidate,
} from '@/lib/archive/game-starters-from-lineups';
import {
  lineups2025CanonicalPrefix,
  lineups2025GameObjectKey,
  loadAuthoritativeBdl2025GameInventory,
} from '@/lib/archive/lineups-2025';
import { LINEUPS_2025_STARTER_ANOMALY_IDS } from '@/lib/betting/historical-starters';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';

const EXPECTED_ELIGIBLE_GAMES = 1320;
const EXPECTED_SERVING_ROWS = 13200;
const EXPECTED_ARCHIVE_ROWS = 28833;
const OUT_JSON = 'reports/trial/game-starters-2025-materialize.json';
const BATCH = 500;

type GameRow = { game_id: string; season: string; home_team_id: string; away_team_id: string };

function parseFlags(argv: string[]) {
  return {
    execute: argv.includes('--execute'),
    confirm: argv.includes('--i-understand-production-write'),
  };
}

async function dbBytes(): Promise<number> {
  const r = await pool.query<{ n: string }>(`select pg_database_size(current_database())::text as n`);
  return Number(r.rows[0]?.n ?? 0);
}

async function tableBytes(): Promise<{ table: number; indexes: number }> {
  const r = await pool.query<{ table_bytes: string; index_bytes: string }>(
    `select
       coalesce(pg_table_size('analytics.game_starters'), 0)::text as table_bytes,
       coalesce(pg_indexes_size('analytics.game_starters'), 0)::text as index_bytes`
  );
  return { table: Number(r.rows[0]?.table_bytes ?? 0), indexes: Number(r.rows[0]?.index_bytes ?? 0) };
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function upsertBatch(rows: GameStarterCandidate[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await pool.query(
    `insert into analytics.game_starters (
       game_id, team_id, player_id, position, season, source
     )
     select * from unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]
     ) as t(game_id, team_id, player_id, position, season, source)
     on conflict on constraint game_starters_pk do update set
       position = excluded.position,
       season = excluded.season,
       source = excluded.source,
       updated_at = now()
     where analytics.game_starters.position is distinct from excluded.position
        or analytics.game_starters.season is distinct from excluded.season
        or analytics.game_starters.source is distinct from excluded.source`,
    [
      rows.map((r) => r.gameId),
      rows.map((r) => r.teamId),
      rows.map((r) => r.playerId),
      rows.map((r) => r.position),
      rows.map((r) => r.season),
      rows.map((r) => r.source),
    ]
  );
  return result.rowCount ?? 0;
}

async function main() {
  const { execute, confirm } = parseFlags(process.argv.slice(2));
  const mode = readIngestionMode();
  const generatedAt = new Date().toISOString();
  const bytesBefore = await dbBytes();

  if (mode.dataMode !== 'replay') {
    throw new Error(`Safety stop: DATA_MODE=${mode.dataMode || '(empty)'} (require replay)`);
  }
  if (execute && !confirm) {
    throw new Error('Safety stop: --execute requires --i-understand-production-write');
  }

  const inventory = loadAuthoritativeBdl2025GameInventory();
  const prefix = lineups2025CanonicalPrefix();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });

  const gameRes = await pool.query<GameRow>(
    `select game_id, season, home_team_id, away_team_id
     from analytics.games
     where game_id = any($1::text[])`,
    [inventory.gameIds]
  );
  const gamesById = new Map(gameRes.rows.map((g) => [g.game_id, g]));

  let archiveRows = 0;
  let starterTrueRows = 0;
  let unknownIdentity = 0;
  let missingObjects = 0;
  let invalidArchive = 0;
  const teamGames = new Map<string, number>();
  const eligible: GameStarterCandidate[] = [];
  const anomalyIds: string[] = [];
  const incompleteIds: string[] = [];
  const wrongSeason: string[] = [];
  const missingGames: string[] = [];

  for (const gameId of inventory.gameIds) {
    const key = lineups2025GameObjectKey(prefix, gameId);
    const body = await s3.getJson<unknown>(key);
    if (!body) {
      missingObjects += 1;
      continue;
    }
    const extracted = extractStarterCandidatesFromArchive(gameId, body);
    archiveRows += extracted.archiveRows;
    starterTrueRows += extracted.starterCandidates.length;
    unknownIdentity += extracted.unknownIdentity;
    const game = gamesById.get(gameId);
    if (!game) {
      missingGames.push(gameId);
      continue;
    }
    if (game.season !== GAME_STARTERS_SEASON) wrongSeason.push(gameId);
    for (const row of extracted.starterCandidates) {
      const k = `${row.gameId}|${row.teamId}`;
      teamGames.set(k, (teamGames.get(k) ?? 0) + 1);
    }
    const cert = certifyStarterGame({
      gameId,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      starterCandidates: extracted.starterCandidates,
      unknownIdentity: extracted.unknownIdentity,
    });
    if (cert.reason === 'anomaly') anomalyIds.push(gameId);
    else if (!cert.productEligible) incompleteIds.push(gameId);
    else eligible.push(...extracted.starterCandidates.map((r) => ({ ...r, season: game.season })));
  }

  const exactly5 = [...teamGames.values()].filter((n) => n === 5).length;
  const fewer5 = [...teamGames.values()].filter((n) => n < 5).length;
  const more5 = [...teamGames.values()].filter((n) => n > 5).length;
  const eligibleGameCount = new Set(eligible.map((r) => r.gameId)).size;

  const playerIds = [...new Set(eligible.map((r) => r.playerId))];
  const teamIds = [...new Set(eligible.map((r) => r.teamId))];
  const mappedPlayers = await pool.query<{ player_id: string }>(
    `select player_id from analytics.players where player_id = any($1::text[])`,
    [playerIds]
  );
  const mappedTeams = await pool.query<{ team_id: string }>(
    `select team_id from analytics.teams where team_id = any($1::text[])`,
    [teamIds]
  );
  const mappedPlayerSet = new Set(mappedPlayers.rows.map((r) => r.player_id));
  const mappedTeamSet = new Set(mappedTeams.rows.map((r) => r.team_id));
  const unmappedPlayers = playerIds.filter((id) => !mappedPlayerSet.has(id));
  const unmappedTeams = teamIds.filter((id) => !mappedTeamSet.has(id));

  const candidate = {
    archiveGames: inventory.gameIds.length,
    archiveRows,
    starterTrueRows,
    distinctGamesWithStarters: new Set(
      [...teamGames.keys()].map((k) => k.split('|')[0])
    ).size,
    teamGames: teamGames.size,
    exactly5StarterTeamGames: exactly5,
    fewerThan5TeamGames: fewer5,
    moreThan5TeamGames: more5,
    valid5plus5Games: eligibleGameCount,
    anomalousGames: [...new Set(anomalyIds)],
    incompleteGames: incompleteIds,
    candidateServingRows: eligible.length,
    unknownIdentity,
    missingObjects,
    invalidArchive,
    missingGames: missingGames.slice(0, 20),
    wrongSeason,
    unmappedPlayers: unmappedPlayers.slice(0, 20),
    unmappedPlayerCount: unmappedPlayers.length,
    unmappedTeams,
    expectedEligibleGames: EXPECTED_ELIGIBLE_GAMES,
    expectedServingRows: EXPECTED_SERVING_ROWS,
    expectedArchiveRows: EXPECTED_ARCHIVE_ROWS,
    nestedTeamNote: 'team_id taken from top-level team.id; player.team_id never used',
    source: GAME_STARTERS_SOURCE,
  };

  const materialMismatch =
    eligibleGameCount !== EXPECTED_ELIGIBLE_GAMES ||
    eligible.length !== EXPECTED_SERVING_ROWS ||
    unmappedPlayers.length > 0 ||
    unmappedTeams.length > 0 ||
    unknownIdentity > 0 ||
    missingObjects > 0 ||
    missingGames.length > 0 ||
    wrongSeason.length > 0 ||
    Math.abs(archiveRows - EXPECTED_ARCHIVE_ROWS) > 50;

  const report: Record<string, unknown> = {
    generatedAt,
    step: '12C',
    dryRun: !execute,
    safety: {
      dataMode: mode.dataMode,
      offseason: mode.offseason,
      cronDryRun: mode.cronDryRun,
      bdlHttp: 0,
      s3Writes: false,
    },
    bytesBefore,
    candidate,
    materialMismatch,
  };

  if (materialMismatch) {
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ stopped: true, reason: 'material_mismatch', candidate }, null, 2));
    throw new Error('Safety stop: candidate counts differ materially from certified 1320/13200. No INSERT.');
  }

  if (!execute) {
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify({ ...report, note: 'dry-run; no INSERT' }, null, 2) + '\n');
    console.log(JSON.stringify({ dryRun: true, candidate }, null, 2));
    return;
  }

  await pool.query(
    `delete from analytics.game_starters
     where season = $1
       and game_id = any($2::text[])`,
    [GAME_STARTERS_SEASON, [...LINEUPS_2025_STARTER_ANOMALY_IDS]]
  );

  let upserted = 0;
  for (const part of chunk(eligible, BATCH)) {
    upserted += await upsertBatch(part);
  }

  const countRes = await pool.query<{ n: string; games: string }>(
    `select count(*)::text as n, count(distinct game_id)::text as games from analytics.game_starters`
  );
  const dupRes = await pool.query<{ n: string }>(
    `select count(*)::text as n from (
       select game_id, team_id, player_id from analytics.game_starters
       group by 1,2,3 having count(*) > 1
     ) d`
  );
  const anomalyServing = await pool.query<{ n: string }>(
    `select count(*)::text as n from analytics.game_starters where game_id = any($1::text[])`,
    [[...LINEUPS_2025_STARTER_ANOMALY_IDS]]
  );
  const otherSeason = await pool.query<{ n: string }>(
    `select count(*)::text as n from analytics.game_starters where season <> $1`,
    [GAME_STARTERS_SEASON]
  );
  const bytesAfter = await dbBytes();
  const sizes = await tableBytes();

  report.backfill = {
    upsertTouched: upserted,
    servingRows: Number(countRes.rows[0]?.n ?? 0),
    servingGames: Number(countRes.rows[0]?.games ?? 0),
    duplicateKeys: Number(dupRes.rows[0]?.n ?? 0),
    anomalyRows: Number(anomalyServing.rows[0]?.n ?? 0),
    otherSeasonRows: Number(otherSeason.rows[0]?.n ?? 0),
  };
  report.bytesAfter = bytesAfter;
  report.tableBytes = sizes.table;
  report.indexBytes = sizes.indexes;
  report.deltaBytes = bytesAfter - bytesBefore;

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        execute: true,
        servingRows: report.backfill,
        tableBytes: sizes.table,
        indexBytes: sizes.indexes,
        deltaBytes: bytesAfter - bytesBefore,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
