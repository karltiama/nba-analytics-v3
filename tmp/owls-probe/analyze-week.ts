import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { extractRows } from '../../lib/providers/owls-insight/client';
import { asRecord } from '../../lib/providers/owls-insight/normalize';
import { verifyEnvelopeChecksum } from '../../lib/providers/owls-insight/archive';
import type { CheckpointState } from '../../lib/providers/owls-insight/checkpoint';
import type { OwlsArchiveEnvelope } from '../../lib/providers/owls-insight/types';

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

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const envCache = new Map<string, { env: OwlsArchiveEnvelope; bytes: number }>();
let lastRemainingMonth: string | null = null;

async function getEnv(key: string): Promise<{ env: OwlsArchiveEnvelope; bytes: number }> {
  const hit = envCache.get(key);
  if (hit) return hit;
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = Buffer.from(await out.Body!.transformToByteArray());
  const env = JSON.parse(gunzipSync(bytes).toString()) as OwlsArchiveEnvelope;
  const remaining = env.response_metadata?.headers?.remainingMonth;
  if (remaining) lastRemainingMonth = remaining;
  const packed = { env, bytes: bytes.length };
  envCache.set(key, packed);
  return packed;
}

function completeOu(quote: Record<string, unknown> | null): boolean {
  return Boolean(quote && quote.line != null && quote.overPrice != null && quote.underPrice != null);
}

async function main() {
  const state = JSON.parse(
    readFileSync('data/owls-insight/runs/owls-2026-09-14-week-2023rs/checkpoint.json', 'utf8')
  ) as CheckpointState;

  const byGame = new Map<
    string,
    {
      cc: string;
      date: string | null;
      eventId: string | null;
      matched: boolean;
      rows: Record<string, unknown>[];
      objects: string[];
      checksumOk: boolean;
      bytes: number;
      requests: number;
    }
  >();

  for (const unit of Object.values(state.units)) {
    const cc = unit.court_context_game_id ?? 'unknown';
    const slot = byGame.get(cc) ?? {
      cc,
      date: unit.game_date,
      eventId: unit.endpoint === 'history_player_props' ? unit.provider_game_id : null,
      matched: false,
      rows: [],
      objects: [],
      checksumOk: true,
      bytes: 0,
      requests: 0,
    };
    slot.requests += 1;
    if (unit.endpoint === 'history_player_props' && unit.provider_game_id) slot.eventId = unit.provider_game_id;
    if (!unit.archive_key) {
      slot.checksumOk = false;
      byGame.set(cc, slot);
      continue;
    }
    const { env, bytes } = await getEnv(unit.archive_key);
    slot.objects.push(unit.archive_key);
    slot.bytes += bytes;
    slot.checksumOk = slot.checksumOk && verifyEnvelopeChecksum(env) && (!unit.checksum || unit.checksum === env.checksum);
    if (unit.endpoint === 'history_games') {
      const games = extractRows(env.payload).map(asRecord);
      slot.matched = games.some((g) => g && slot.eventId && String(g.eventId) === slot.eventId) || games.length > 0;
    }
    if (unit.endpoint === 'history_player_props') {
      for (const raw of extractRows(env.payload)) {
        const rec = asRecord(raw);
        if (rec) slot.rows.push(rec);
      }
      if (env.provider_game_id) slot.eventId = env.provider_game_id;
    }
    byGame.set(cc, slot);
  }

  const games = [...byGame.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.cc.localeCompare(b.cc));
  const perGame = games.map((g) => {
    const books: Record<string, number> = {};
    const types: Record<string, number> = {};
    let open = 0,
      close = 0,
      lineMoved = 0,
      overMoved = 0,
      underMoved = 0;
    let openLine = 0,
      openOver = 0,
      openUnder = 0,
      closeLine = 0,
      closeOver = 0,
      closeUnder = 0;
    for (const row of g.rows) {
      books[String(row.book ?? '')] = (books[String(row.book ?? '')] ?? 0) + 1;
      types[String(row.propType ?? '')] = (types[String(row.propType ?? '')] ?? 0) + 1;
      const opening = asRecord(row.opening);
      const closing = asRecord(row.closing);
      if (opening?.line != null) openLine += 1;
      if (opening?.overPrice != null) openOver += 1;
      if (opening?.underPrice != null) openUnder += 1;
      if (closing?.line != null) closeLine += 1;
      if (closing?.overPrice != null) closeOver += 1;
      if (closing?.underPrice != null) closeUnder += 1;
      if (completeOu(opening)) open += 1;
      if (completeOu(closing)) close += 1;
      if (opening?.line != null && closing?.line != null && opening.line !== closing.line) lineMoved += 1;
      if (opening?.overPrice != null && closing?.overPrice != null && opening.overPrice !== closing.overPrice)
        overMoved += 1;
      if (opening?.underPrice != null && closing?.underPrice != null && opening.underPrice !== closing.underPrice)
        underMoved += 1;
    }
    const core: Record<string, number> = {};
    for (const [cc, aliases] of Object.entries(CORE)) {
      core[cc] = aliases.reduce((n, a) => n + (types[a] ?? 0), 0);
    }
    return {
      cc: g.cc,
      date: g.date,
      eventId: g.eventId,
      matched: Boolean(g.eventId),
      rows: g.rows.length,
      books,
      ...core,
      openOu: open,
      closeOu: close,
      openLine,
      openOver,
      openUnder,
      closeLine,
      closeOver,
      closeUnder,
      lineMoved,
      overMoved,
      underMoved,
      s3Objects: g.objects.length,
      checksumOk: g.checksumOk,
      requests: g.requests,
      types,
    };
  });

  const n = perGame.length;
  const populated = perGame.filter((g) => g.rows > 0);
  const found = perGame.filter((g) => g.matched);
  const rowCounts = populated.map((g) => g.rows).sort((a, b) => a - b);
  const median = rowCounts.length
    ? rowCounts.length % 2
      ? rowCounts[(rowCounts.length - 1) / 2]
      : (rowCounts[rowCounts.length / 2 - 1]! + rowCounts[rowCounts.length / 2]!) / 2
    : 0;
  const allTypes: Record<string, number> = {};
  const bookGames: Record<string, { games: Set<string>; rows: number; PTS: number; REB: number; AST: number; '3PM': number }> = {};
  let openLine = 0,
    openOver = 0,
    openUnder = 0,
    closeLine = 0,
    closeOver = 0,
    closeUnder = 0,
    openOu = 0,
    closeOu = 0,
    lineMoved = 0,
    overMoved = 0,
    underMoved = 0,
    totalRows = 0;
  for (const g of perGame) {
    totalRows += g.rows;
    openLine += g.openLine;
    openOver += g.openOver;
    openUnder += g.openUnder;
    closeLine += g.closeLine;
    closeOver += g.closeOver;
    closeUnder += g.closeUnder;
    openOu += g.openOu;
    closeOu += g.closeOu;
    lineMoved += g.lineMoved;
    overMoved += g.overMoved;
    underMoved += g.underMoved;
    for (const [t, c] of Object.entries(g.types)) allTypes[t] = (allTypes[t] ?? 0) + c;
    for (const [book, count] of Object.entries(g.books)) {
      const slot = (bookGames[book] ??= { games: new Set(), rows: 0, PTS: 0, REB: 0, AST: 0, '3PM': 0 });
      slot.games.add(g.cc);
      slot.rows += count;
    }
  }
  // per-book core counts need row walk — approximate from game-level if book is exclusive, else recount from populated games later
  for (const g of games) {
    for (const row of g.rows) {
      const book = String(row.book ?? '');
      const slot = bookGames[book];
      if (!slot) continue;
      const pt = String(row.propType ?? '');
      if (pt === 'points') slot.PTS += 1;
      if (pt === 'rebounds') slot.REB += 1;
      if (pt === 'assists') slot.AST += 1;
      if (pt === 'threes' || pt === 'threes_made') slot['3PM'] += 1;
    }
  }

  const report = {
        summary: {
          finalGames: n,
          gamesFound: found.length,
          populated: populated.length,
          withPTS: perGame.filter((g) => g.PTS > 0).length,
          withREB: perGame.filter((g) => g.REB > 0).length,
          withAST: perGame.filter((g) => g.AST > 0).length,
          with3PM: perGame.filter((g) => g['3PM'] > 0).length,
          pctProps: populated.length / n,
          pctPTS: perGame.filter((g) => g.PTS > 0).length / n,
          pctREB: perGame.filter((g) => g.REB > 0).length / n,
          pctAST: perGame.filter((g) => g.AST > 0).length / n,
          pct3PM: perGame.filter((g) => g['3PM'] > 0).length / n,
          medianRows: median,
          minRows: rowCounts[0] ?? 0,
          maxRows: rowCounts[rowCounts.length - 1] ?? 0,
          totalRows,
          types: allTypes,
          quotes: {
            totalRows,
            openLine,
            openOver,
            openUnder,
            closeLine,
            closeOver,
            closeUnder,
            completeOpenOu: openOu,
            completeCloseOu: closeOu,
            completeTwoWayPct: totalRows ? Math.min(openOu, closeOu) / totalRows : 0,
            lineMoved,
            overMoved,
            underMoved,
          },
          books: Object.fromEntries(
            Object.entries(bookGames).map(([k, v]) => [
              k,
              { games: v.games.size, rows: v.rows, PTS: v.PTS, REB: v.REB, AST: v.AST, '3PM': v['3PM'] },
            ])
          ),
          uniqueS3Objects: envCache.size,
          lastRemainingMonth,
          requestsPopulated: populated.map((g) => g.requests),
          requestsEmpty: perGame.filter((g) => g.rows === 0).map((g) => g.requests),
        },
        perGame,
      };
  writeFileSync('tmp/owls-probe/week-2023rs.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`wrote ${report.perGame.length} games to tmp/owls-probe/week-2023rs.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
