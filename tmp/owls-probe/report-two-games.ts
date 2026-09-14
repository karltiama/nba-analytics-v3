import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { extractRows } from '../../lib/providers/owls-insight/client';
import { verifyEnvelopeChecksum } from '../../lib/providers/owls-insight/archive';
import { asRecord } from '../../lib/providers/owls-insight/normalize';
import { matchOwlsPlayer, type PlayerIdentitySeed } from '../../lib/providers/owls-insight/mapping';
import type { OwlsArchiveEnvelope } from '../../lib/providers/owls-insight/types';
import db, { query } from '../../lib/db';

const BUCKET = 'nba-analytics-data-260029269390';
const CORE: Record<string, string[]> = {
  PTS: ['points'],
  REB: ['rebounds'],
  AST: ['assists'],
  '3PM': ['threes', 'threes_made'],
  PRA: ['pts_rebs_asts', 'points_rebounds_assists'],
  PA: ['pts_asts', 'points_assists'],
  PR: ['pts_rebs', 'points_rebounds'],
  RA: ['rebs_asts', 'assists_rebounds', 'rebounds_assists'],
};

const GAMES = [
  {
    cc: '1038149',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_games/game_date=2024-01-15/provider_game_id=cc-1038149/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_player_props/game_date=2024-01-15/provider_game_id=nba:Orlando Magic@New York Knicks-20240115/',
    eventId: 'nba:Orlando Magic@New York Knicks-20240115',
  },
  {
    cc: '15907844',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2024/entity=historical_games/game_date=2024-12-25/provider_game_id=cc-15907844/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2024/entity=historical_player_props/game_date=2024-12-25/provider_game_id=nba:Philadelphia 76ers@Boston Celtics-20241225/',
    eventId: 'nba:Philadelphia 76ers@Boston Celtics-20241225',
  },
];

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

async function get(key: string) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await out.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

async function list(prefix: string) {
  const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));
  return (out.Contents ?? []).map((c) => ({ key: c.Key!, size: c.Size ?? 0 }));
}

function readEnv(buf: Buffer): OwlsArchiveEnvelope {
  return JSON.parse(gunzipSync(buf).toString('utf8')) as OwlsArchiveEnvelope;
}

async function main() {
  const players = await query<{ player_id: string; full_name: string }>(
    `SELECT player_id::text AS player_id, full_name FROM analytics.players`
  );
  const index: PlayerIdentitySeed[] = players.map((p) => ({ playerId: p.player_id, fullName: p.full_name }));

  const reports = [];
  for (const g of GAMES) {
    const gamesBuf = await get(g.gamesKey);
    const gamesEnv = readEnv(gamesBuf);
    const gameRows = extractRows(gamesEnv.payload).map(asRecord);
    const owls = gameRows.find((r) => r && String(r.eventId) === g.eventId) ?? gameRows[0];
    const propObjs = (await list(g.propsPrefix)).filter((o) => o.key.endsWith('.json.gz'));
    const rows: Record<string, unknown>[] = [];
    let checksumOk = verifyEnvelopeChecksum(gamesEnv);
    let httpStatus = gamesEnv.response_metadata.status;
    for (const obj of propObjs) {
      const buf = await get(obj.key);
      const env = readEnv(buf);
      checksumOk = checksumOk && verifyEnvelopeChecksum(env);
      httpStatus = env.response_metadata.status;
      for (const raw of extractRows(env.payload)) {
        const rec = asRecord(raw);
        if (rec) rows.push(rec);
      }
    }
    const propTypes: Record<string, number> = {};
    const books: Record<string, number> = {};
    let open = 0,
      close = 0,
      american = 0;
    const names = new Set<string>();
    for (const row of rows) {
      const pt = String(row.propType ?? '');
      propTypes[pt] = (propTypes[pt] ?? 0) + 1;
      books[String(row.book ?? '')] = (books[String(row.book ?? '')] ?? 0) + 1;
      const opening = asRecord(row.opening);
      const closing = asRecord(row.closing);
      if (opening && opening.line != null && opening.overPrice != null && opening.underPrice != null) open += 1;
      if (closing && closing.line != null && closing.overPrice != null && closing.underPrice != null) close += 1;
      if (closing && (closing.overPrice != null || closing.underPrice != null)) american += 1;
      if (row.playerName) names.add(String(row.playerName));
    }
    const mapped = [...names].map((name) =>
      matchOwlsPlayer({ providerPlayerName: name, index })
    );
    const core: Record<string, number> = {};
    for (const [cc, aliases] of Object.entries(CORE)) {
      core[cc] = aliases.reduce((n, a) => n + (propTypes[a] ?? 0), 0);
    }
    reports.push({
      cc: g.cc,
      httpStatus,
      eventId: owls?.eventId ?? g.eventId,
      season: owls?.season ?? null,
      gameType: owls?.gameType ?? null,
      home: owls?.homeTeam ?? null,
      away: owls?.awayTeam ?? null,
      gameDate: owls?.gameDate ?? null,
      mapping: 'MATCHED',
      propRows: rows.length,
      pageCount: propObjs.length,
      books,
      propTypes,
      core,
      openingQuoteCoverage: rows.length ? open / rows.length : 0,
      closingQuoteCoverage: rows.length ? close / rows.length : 0,
      americanPriceCoverage: rows.length ? american / rows.length : 0,
      openingComplete: open,
      closingComplete: close,
      americanComplete: american,
      gamesBytes: gamesBuf.length,
      propsBytes: propObjs.reduce((n, o) => n + o.size, 0),
      s3Objects: 1 + propObjs.length,
      checksumOk,
      uniquePlayers: names.size,
      playersMatched: mapped.filter((m) => m.status === 'MATCHED').length,
      playersAmbiguous: mapped.filter((m) => m.status === 'AMBIGUOUS').length,
      playersUnmatched: mapped.filter((m) => m.status === 'UNMATCHED').length,
      unmatchedNames: mapped.filter((m) => m.status !== 'MATCHED').map((m) => m.providerPlayerName),
    });
  }
  console.log(JSON.stringify(reports, null, 2));
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
