import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { asRecord } from '../../lib/providers/owls-insight/normalize';
import { extractRows, pageIsExhausted } from '../../lib/providers/owls-insight/client';
import { verifyEnvelopeChecksum } from '../../lib/providers/owls-insight/archive';
import type { OwlsArchiveEnvelope } from '../../lib/providers/owls-insight/types';

type Quote = { line: unknown; overPrice: unknown; underPrice: unknown };

const games = [
  {
    cc: '1037995',
    label: '2023-12-25 LAL vs BOS regular',
    season: '2023',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_games/game_date=2023-12-25/provider_game_id=cc-1037995/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_player_props/game_date=2023-12-25/provider_game_id=nba:Boston Celtics@Los Angeles Lakers-20231225/',
  },
  {
    cc: '15905067',
    label: '2024-06-18 BOS vs DAL finals',
    season: '2023',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_games/game_date=2024-06-18/provider_game_id=cc-15905067/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2023/entity=historical_player_props/game_date=2024-06-18/provider_game_id=nba:Dallas Mavericks@Boston Celtics-20240618/',
  },
  {
    cc: '18444564',
    label: '2025-06-23 OKC vs IND finals',
    season: '2024',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2024/entity=historical_games/game_date=2025-06-23/provider_game_id=cc-18444564/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2024/entity=historical_player_props/game_date=2025-06-23/provider_game_id=nba:Indiana Pacers@Oklahoma City Thunder-20250623/',
  },
  {
    cc: '18447233',
    label: '2025-12-25 OKC vs SAS regular',
    season: '2025',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2025/entity=historical_games/game_date=2025-12-25/provider_game_id=cc-18447233/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2025/entity=historical_player_props/game_date=2025-12-25/provider_game_id=nba:San Antonio Spurs@Oklahoma City Thunder-20251225/',
  },
  {
    cc: '21716138',
    label: '2026-06-14 SAS vs NYK finals',
    season: '2025',
    gamesKey:
      'raw/source=owls_insight/league=nba/season=2025/entity=historical_games/game_date=2026-06-14/provider_game_id=cc-21716138/page=0001.json.gz',
    propsPrefix:
      'raw/source=owls_insight/league=nba/season=2025/entity=historical_player_props/game_date=2026-06-14/provider_game_id=nba:New York Knicks@San Antonio Spurs-20260614/',
  },
];

async function getObject(key: string): Promise<{ body: Buffer; size: number } | null> {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  try {
    const out = await client.send(
      new GetObjectCommand({ Bucket: 'nba-analytics-data-260029269390', Key: key })
    );
    const bytes = await out.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), size: bytes.byteLength };
  } catch {
    return null;
  }
}

async function listPrefix(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const out = await client.send(
    new ListObjectsV2Command({ Bucket: 'nba-analytics-data-260029269390', Prefix: prefix })
  );
  return (out.Contents ?? []).map((c) => ({ key: c.Key!, size: c.Size ?? 0 }));
}

function readEnv(buf: Buffer): OwlsArchiveEnvelope {
  return JSON.parse(gunzipSync(buf).toString('utf8')) as OwlsArchiveEnvelope;
}

function quote(v: unknown): Quote | null {
  const rec = asRecord(v);
  if (!rec) return null;
  return { line: rec.line, overPrice: rec.overPrice, underPrice: rec.underPrice };
}

async function main() {
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
  const perGame = [];
  for (const g of games) {
    const gamesObj = await getObject(g.gamesKey);
    const gamesEnv = gamesObj ? readEnv(gamesObj.body) : null;
    const gameRows = gamesEnv ? extractRows(gamesEnv.payload).map(asRecord) : [];
    const matched = gameRows.find((r) => {
      if (!r) return false;
      // prefer exact home/away later; take the one used in props prefix
      return true;
    });
    const propsObjs = await listPrefix(g.propsPrefix);
    const propEnvs = [];
    for (const obj of propsObjs.filter((o) => o.key.endsWith('.json.gz'))) {
      const got = await getObject(obj.key);
      if (!got) continue;
      const env = readEnv(got.body);
      propEnvs.push({
        key: obj.key,
        size: got.size,
        checksumOk: verifyEnvelopeChecksum(env),
        checksum: env.checksum,
        runId: env.backfill_run_id,
        rowCount: env.row_count,
        extracted: extractRows(env.payload).length,
        exhausted: pageIsExhausted(env.payload, extractRows(env.payload).length, env.limit),
        pagination: (asRecord(asRecord(env.payload)?.data)?.pagination as unknown) ?? null,
        request: env.request,
        status: env.response_metadata.status,
        gzipOk: true,
        payloadPreserved: env.payload != null,
        requestPreserved: env.request != null,
      });
    }
    const rows = propEnvs.flatMap((p) => {
      const gotKey = p.key;
      void gotKey;
      return [];
    });
    const allPropRows: Record<string, unknown>[] = [];
    for (const obj of propsObjs.filter((o) => o.key.endsWith('.json.gz'))) {
      const got = await getObject(obj.key);
      if (!got) continue;
      const env = readEnv(got.body);
      for (const raw of extractRows(env.payload)) {
        const rec = asRecord(raw);
        if (rec) allPropRows.push(rec);
      }
    }
    const propTypes: Record<string, number> = {};
    const books: Record<string, number> = {};
    let openLine = 0,
      openOver = 0,
      openUnder = 0,
      closeLine = 0,
      closeOver = 0,
      closeUnder = 0,
      lineMoved = 0,
      overMoved = 0,
      underMoved = 0;
    for (const row of allPropRows) {
      const pt = String(row.propType ?? '');
      propTypes[pt] = (propTypes[pt] ?? 0) + 1;
      const book = String(row.book ?? '');
      books[book] = (books[book] ?? 0) + 1;
      const opening = quote(row.opening);
      const closing = quote(row.closing);
      if (opening?.line != null) openLine += 1;
      if (opening?.overPrice != null) openOver += 1;
      if (opening?.underPrice != null) openUnder += 1;
      if (closing?.line != null) closeLine += 1;
      if (closing?.overPrice != null) closeOver += 1;
      if (closing?.underPrice != null) closeUnder += 1;
      if (opening?.line != null && closing?.line != null && opening.line !== closing.line) lineMoved += 1;
      if (opening?.overPrice != null && closing?.overPrice != null && opening.overPrice !== closing.overPrice)
        overMoved += 1;
      if (opening?.underPrice != null && closing?.underPrice != null && opening.underPrice !== closing.underPrice)
        underMoved += 1;
    }
    const coverage: Record<string, { status: string; types: string[] }> = {};
    for (const [cc, aliases] of Object.entries(CORE)) {
      const hit = aliases.filter((a) => (propTypes[a] ?? 0) > 0);
      coverage[cc] = { status: hit.length ? 'PRESENT' : 'ABSENT', types: hit };
    }
    const targetEvent = g.propsPrefix.split('provider_game_id=')[1]?.replace(/\/$/, '');
    const owlsGame = gameRows.find((r) => r && String(r.eventId) === targetEvent) ?? gameRows[0] ?? null;
    perGame.push({
      cc: g.cc,
      label: g.label,
      season: g.season,
      gamesGzip: gamesObj?.size ?? 0,
      gamesChecksumOk: gamesEnv ? verifyEnvelopeChecksum(gamesEnv) : false,
      gamesRowCount: gamesEnv?.row_count ?? null,
      owls: owlsGame
        ? {
            eventId: owlsGame.eventId,
            gameDate: owlsGame.gameDate,
            homeTeam: owlsGame.homeTeam,
            awayTeam: owlsGame.awayTeam,
            season: owlsGame.season,
            gameType: owlsGame.gameType,
            propsSnapshots: owlsGame.propsSnapshots,
            oddsSnapshots: owlsGame.oddsSnapshots,
          }
        : null,
      propsObjects: propEnvs,
      propsGzipTotal: propsObjs.reduce((n, o) => n + o.size, 0),
      propRows: allPropRows.length,
      propTypes,
      books,
      coverage,
      openClose: {
        rows: allPropRows.length,
        openingLine: openLine,
        openingOver: openOver,
        openingUnder: openUnder,
        closingLine: closeLine,
        closingOver: closeOver,
        closingUnder: closeUnder,
        lineMoved,
        overMoved,
        underMoved,
      },
      players: [...new Set(allPropRows.map((r) => String(r.playerName ?? '')))].sort(),
    });
    void rows;
    void createHash;
  }
  console.log(JSON.stringify({ perGame }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
