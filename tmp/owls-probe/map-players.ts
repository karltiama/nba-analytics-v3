import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractRows } from '../../lib/providers/owls-insight/client';
import { matchOwlsPlayer, type PlayerIdentitySeed } from '../../lib/providers/owls-insight/mapping';
import { asRecord, normalizePayloadRows } from '../../lib/providers/owls-insight/normalize';
import type { OwlsArchiveEnvelope } from '../../lib/providers/owls-insight/types';

async function main() {
  const db = await import('../../lib/db');
  const players = await db.query<{ player_id: string; full_name: string }>(
    `SELECT player_id::text AS player_id, full_name FROM analytics.players`
  );
  await db.default.end().catch(() => undefined);

  const index: PlayerIdentitySeed[] = players.map((p) => ({
    playerId: p.player_id,
    fullName: p.full_name,
  }));

  const dir = join('tmp/owls-probe/player-props');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort();
  const envelopes = files.map(
    (f) => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8')) as OwlsArchiveEnvelope
  );
  const rawRows = envelopes.flatMap((env) => extractRows(env.payload).map(asRecord).filter((x): x is Record<string, unknown> => x != null));

  const unique = new Map<string, { playerName: string; playerId: string | null; rows: number }>();
  for (const row of rawRows) {
    const playerName = String(row.playerName ?? row.player ?? '');
    const playerId = typeof row.playerId === 'string' ? row.playerId : null;
    const key = `${playerId ?? ''}|${playerName}`;
    const cur = unique.get(key);
    if (cur) cur.rows += 1;
    else unique.set(key, { playerName, playerId, rows: 1 });
  }

  const mapped = [...unique.values()].map((p) => {
    const result = matchOwlsPlayer({
      providerPlayerName: p.playerName,
      providerPlayerId: p.playerId,
      index,
    });
    return { ...p, status: result.status, reason: result.reason, courtContextPlayerId: result.courtContextPlayerId };
  });

  const normalized = envelopes.flatMap((env) =>
    normalizePayloadRows({ envelope: env, courtContextGameId: '1037995', gameMatch: 'MATCHED' })
  );
  const opening = normalized.filter((r) => r.opening_line != null).length;
  const closing = normalized.filter((r) => r.closing_line != null).length;
  const prices = normalized.filter((r) => r.american_odds != null).length;
  const byBook: Record<string, { rows: number; withOpening: number; withClosing: number; withPrice: number }> = {};
  for (const row of normalized) {
    const book = row.book ?? '(missing)';
    const slot = (byBook[book] ??= { rows: 0, withOpening: 0, withClosing: 0, withPrice: 0 });
    slot.rows += 1;
    if (row.opening_line != null) slot.withOpening += 1;
    if (row.closing_line != null) slot.withClosing += 1;
    if (row.american_odds != null) slot.withPrice += 1;
  }

  const out = {
    uniquePlayers: mapped.length,
    matched: mapped.filter((m) => m.status === 'MATCHED').length,
    ambiguous: mapped.filter((m) => m.status === 'AMBIGUOUS').length,
    unmatched: mapped.filter((m) => m.status === 'UNMATCHED').length,
    unmatchedOrAmbiguous: mapped.filter((m) => m.status !== 'MATCHED'),
    all: mapped,
    normalizedRows: normalized.length,
    openingLines: opening,
    closingLines: closing,
    americanPrices: prices,
    byBook,
  };
  writeFileSync('tmp/owls-probe/player-mapping.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        uniquePlayers: out.uniquePlayers,
        matched: out.matched,
        ambiguous: out.ambiguous,
        unmatched: out.unmatched,
        unmatchedOrAmbiguous: out.unmatchedOrAmbiguous,
        normalizedRows: out.normalizedRows,
        openingLines: out.openingLines,
        closingLines: out.closingLines,
        americanPrices: out.americanPrices,
        byBook: out.byBook,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
