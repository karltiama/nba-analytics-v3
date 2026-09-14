import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { extractRows, pageIsExhausted } from '../../lib/providers/owls-insight/client';
import { verifyEnvelopeChecksum } from '../../lib/providers/owls-insight/archive';
import type { OwlsArchiveEnvelope } from '../../lib/providers/owls-insight/types';

function checksumCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortValue(value)), 'utf8').digest('hex');
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
    return out;
  }
  return value;
}

const dir = join('tmp/owls-probe/player-props');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json.gz'))
  .sort();

const envelopes: OwlsArchiveEnvelope[] = [];
const pageSummaries: unknown[] = [];
for (const file of files) {
  const buf = readFileSync(join(dir, file));
  const env = JSON.parse(gunzipSync(buf).toString('utf8')) as OwlsArchiveEnvelope;
  envelopes.push(env);
  const rows = extractRows(env.payload);
  const rec = env.payload as Record<string, unknown>;
  const nested = rec?.data && typeof rec.data === 'object' ? (rec.data as Record<string, unknown>) : null;
  pageSummaries.push({
    file,
    gzipBytes: buf.length,
    schema: env.schema,
    runId: env.backfill_run_id,
    checksum: env.checksum,
    checksumVerified: verifyEnvelopeChecksum(env) && checksumCanonical(env.payload) === env.checksum,
    envelopeRowCount: env.row_count,
    extractedRows: rows.length,
    exhausted: pageIsExhausted(env.payload, rows.length, env.limit),
    request: env.request,
    status: env.response_metadata.status,
    durationMs: env.response_metadata.durationMs,
    payloadKeys: rec && typeof rec === 'object' ? Object.keys(rec) : [],
    nestedKeys: nested ? Object.keys(nested) : [],
    pagination: nested?.pagination ?? rec?.pagination ?? null,
    headers: {
      remainingMinute: env.response_metadata.headers['x-ratelimit-remaining-minute'],
      remainingMonth: env.response_metadata.headers['x-ratelimit-remaining-month'],
      remainingDay: env.response_metadata.headers['x-ratelimit-remaining-day'],
      resetMinute: env.response_metadata.headers['x-ratelimit-reset-minute'],
      resetMonth: env.response_metadata.headers['x-ratelimit-reset-month'],
      retryAfter: env.response_metadata.headers['retry-after'],
      xOwlsCode: env.response_metadata.headers['x-owls-code'],
    },
    rawPayloadPreserved: env.payload != null,
    requestPreserved: env.request != null,
  });
}

const allRows = envelopes.flatMap((env) => extractRows(env.payload)) as Record<string, unknown>[];
const first = allRows[0] ?? {};
const fieldPresence: Record<string, { present: number; nonNull: number; sample: unknown }> = {};
for (const row of allRows) {
  for (const [k, v] of Object.entries(row)) {
    const slot = (fieldPresence[k] ??= { present: 0, nonNull: 0, sample: null });
    slot.present += 1;
    if (v !== null && v !== undefined && v !== '') {
      slot.nonNull += 1;
      if (slot.sample == null) slot.sample = v;
    }
  }
}

function countBy(key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of allRows) {
    const v = String(row[key] ?? '(missing)');
    out[v] = (out[v] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const books = countBy('book');
const propTypes = countBy('propType');
const sides = {
  overPrice: allRows.filter((r) => r.overPrice != null).length,
  underPrice: allRows.filter((r) => r.underPrice != null).length,
  overOdds: allRows.filter((r) => r.overOdds != null).length,
  underOdds: allRows.filter((r) => r.underOdds != null).length,
  american: allRows.filter((r) => r.american != null || r.americanOdds != null).length,
  decimal: allRows.filter((r) => r.decimal != null || r.decimalOdds != null || r.overDecimal != null).length,
  line: allRows.filter((r) => r.line != null).length,
  openingLine: allRows.filter((r) => r.openingLine != null).length,
  closingLine: allRows.filter((r) => r.closingLine != null).length,
  openingOverPrice: allRows.filter((r) => r.openingOverPrice != null).length,
  openingUnderPrice: allRows.filter((r) => r.openingUnderPrice != null).length,
  closingOverPrice: allRows.filter((r) => r.closingOverPrice != null).length,
  closingUnderPrice: allRows.filter((r) => r.closingUnderPrice != null).length,
};

const coreMap: Record<string, string[]> = {
  PTS: ['points'],
  REB: ['rebounds'],
  AST: ['assists'],
  '3PM': ['threes', 'threes_made', 'three_pointers', 'fg3m'],
  PRA: ['pts_rebs_asts', 'points_rebounds_assists', 'pra'],
  PA: ['pts_asts', 'points_assists', 'pa'],
  PR: ['pts_rebs', 'points_rebounds', 'pr'],
  RA: ['rebs_asts', 'assists_rebounds', 'ra'],
};

const coverage: Record<string, unknown> = {};
for (const [cc, aliases] of Object.entries(coreMap)) {
  const hits = aliases.filter((a) => (propTypes[a] ?? 0) > 0);
  coverage[cc] = {
    status: hits.length ? 'SUPPORTED AND PRESENT' : 'UNKNOWN until type scan',
    matchingTypes: hits,
    counts: Object.fromEntries(hits.map((h) => [h, propTypes[h]])),
  };
}

const uniquePlayers = new Map<string, { player: unknown; playerId: unknown; team: unknown; count: number }>();
for (const row of allRows) {
  const name = String(row.player ?? row.playerName ?? row.name ?? '');
  const id = row.playerId ?? row.player_id ?? null;
  const key = `${id ?? ''}|${name}`;
  const cur = uniquePlayers.get(key);
  if (cur) cur.count += 1;
  else uniquePlayers.set(key, { player: name, playerId: id, team: row.team ?? row.playerTeam ?? row.teamName ?? null, count: 1 });
}

const sampleRows = allRows.slice(0, 3);
const lastPageRows = extractRows(envelopes[envelopes.length - 1]!.payload).slice(0, 2);

const report = {
  pages: pageSummaries,
  totalRows: allRows.length,
  firstRowKeys: Object.keys(first),
  fieldPresence,
  books,
  propTypes,
  sides,
  coverage,
  uniquePlayerCount: uniquePlayers.size,
  uniquePlayers: [...uniquePlayers.values()].sort((a, b) => String(a.player).localeCompare(String(b.player))),
  sampleRows,
  lastPageSample: lastPageRows,
  gzipTotalBytes: envelopes.reduce((n, _e, i) => n + readFileSync(join(dir, files[i]!)).length, 0),
};

writeFileSync('tmp/owls-probe/analysis.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      pages: report.pages.length,
      totalRows: report.totalRows,
      firstRowKeys: report.firstRowKeys,
      books: report.books,
      propTypes: report.propTypes,
      sides: report.sides,
      coverage: report.coverage,
      uniquePlayerCount: report.uniquePlayerCount,
      gzipTotalBytes: report.gzipTotalBytes,
      checksums: (report.pages as { file: string; checksumVerified: boolean; extractedRows: number; gzipBytes: number; pagination: unknown; headers: unknown; durationMs: number }[]).map(
        (p) => ({
          file: p.file,
          checksumVerified: p.checksumVerified,
          extractedRows: p.extractedRows,
          gzipBytes: p.gzipBytes,
          pagination: p.pagination,
          headers: p.headers,
          durationMs: p.durationMs,
        })
      ),
      sampleRow: report.sampleRows[0],
    },
    null,
    2
  )
);
