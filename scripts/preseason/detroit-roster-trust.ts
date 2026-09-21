/**
 * Detroit roster-diff trust report (human-readable).
 * Does not retune classifications to match curated prose.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import pool, { query } from '@/lib/db';
import { buildPreseasonTeamPacket } from '@/lib/teams/preseason-preview/automation';
import type { PacketPlayer, PreseasonTeamPacket } from '@/lib/teams/preseason-preview/automation/types';

const SEASON = '2026';
const TEAM = 'DET';

async function providerIds(
  playerEntityId: string,
  playerId: string | null
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (playerId) out.analyticsPlayerId = playerId;
  const rows = await query<{ provider: string; provider_player_id: string }>(
    `SELECT provider, provider_player_id
     FROM analytics.player_provider_ids
     WHERE player_entity_id = $1::uuid`,
    [playerEntityId]
  );
  for (const r of rows) {
    out[r.provider] = r.provider_player_id;
  }
  return out;
}

async function otherTeamMembership(
  entityId: string,
  season: string,
  excludeTeamId: string
): Promise<string | null> {
  const row = await query<{ abbr: string }>(
    `SELECT t.abbreviation AS abbr
     FROM analytics.team_roster_current c
     JOIN analytics.teams t ON t.team_id = c.team_id
     WHERE c.player_entity_id = $1::uuid
       AND c.season = $2
       AND c.team_id <> $3
     LIMIT 1`,
    [entityId, season, excludeTeamId]
  );
  return row[0]?.abbr ?? null;
}

type RowReport = {
  classification: 'addition' | 'departure' | 'returning' | 'excluded_unmapped';
  displayName: string;
  playerEntityId: string;
  providerIds: Record<string, string>;
  priorSeasonTeamMembership: string | null;
  currentSeasonTeamMembership: string | null;
  statsEnrichmentStatus: string;
  warningReason: string | null;
};

async function describePlayer(
  p: PacketPlayer,
  packet: PreseasonTeamPacket,
  classification: RowReport['classification']
): Promise<RowReport> {
  const stats = packet.playerSeasonStats.find(
    (s) => s.playerEntityId === p.playerEntityId
  );
  const warning =
    packet.warnings.find((w) => w.includes(p.playerEntityId)) ?? null;
  let statsStatus = 'enriched';
  if (!p.playerId) statsStatus = 'skipped_missing_player_id';
  else if (!stats) statsStatus = 'no_stats_row';
  else if (stats.mpg == null && stats.usageAvg == null)
    statsStatus = 'enriched_but_empty_metrics';

  const priorOnDet = packet.previousRoster.some(
    (x) => x.playerEntityId === p.playerEntityId
  )
    ? 'DET'
    : await otherTeamMembership(
        p.playerEntityId,
        packet.previousSeason,
        packet.team.teamId
      );
  const currentOnDet = packet.currentRoster.some(
    (x) => x.playerEntityId === p.playerEntityId
  )
    ? 'DET'
    : await otherTeamMembership(
        p.playerEntityId,
        packet.season,
        packet.team.teamId
      );

  return {
    classification,
    displayName: p.displayName,
    playerEntityId: p.playerEntityId,
    providerIds: await providerIds(p.playerEntityId, p.playerId),
    priorSeasonTeamMembership: priorOnDet,
    currentSeasonTeamMembership: currentOnDet,
    statsEnrichmentStatus: statsStatus,
    warningReason: warning,
  };
}

async function main() {
  const packet = await buildPreseasonTeamPacket(TEAM, SEASON);
  const rows: RowReport[] = [];

  for (const p of packet.additions) {
    rows.push(await describePlayer(p, packet, 'addition'));
  }
  for (const p of packet.departures) {
    rows.push(await describePlayer(p, packet, 'departure'));
  }
  for (const p of packet.returningPlayers) {
    rows.push(await describePlayer(p, packet, 'returning'));
  }

  const lines: string[] = [];
  lines.push('# Detroit Roster-Diff Trust Report');
  lines.push('');
  lines.push(`**Season:** ${packet.season} vs prior ${packet.previousSeason}`);
  lines.push(`**Team:** ${packet.team.name} (${packet.team.teamId})`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    'Method: `player_entity_id` set-diff on `analytics.team_roster_current`. No transaction verbs. Not tuned to curated detroit.ts prose.'
  );
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push(`- Additions: ${packet.additions.length}`);
  lines.push(`- Departures: ${packet.departures.length}`);
  lines.push(`- Returning: ${packet.returningPlayers.length}`);
  lines.push(`- Packet warnings: ${packet.warnings.length}`);
  lines.push('');
  lines.push('## Snapshot scopes');
  lines.push('');
  lines.push(
    `- Regular season: available=${packet.previousSeasonRegular.available} record=${packet.previousSeasonRegular.record} GP=${packet.previousSeasonRegular.gamesPlayed}`
  );
  lines.push(
    `- All-games (internal): available=${packet.previousSeasonAllGames.available} record=${packet.previousSeasonAllGames.record} GP=${packet.previousSeasonAllGames.gamesPlayed} includesPostseason=${packet.previousSeasonAllGames.includesPostseason}`
  );
  lines.push('');

  for (const kind of [
    'addition',
    'departure',
    'returning',
  ] as const) {
    lines.push(`## ${kind}`);
    lines.push('');
    for (const r of rows.filter((x) => x.classification === kind)) {
      lines.push(`### ${r.displayName}`);
      lines.push('');
      lines.push(`- player_entity_id: \`${r.playerEntityId}\``);
      lines.push(
        `- provider IDs: ${
          Object.keys(r.providerIds).length
            ? Object.entries(r.providerIds)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : '(none)'
        }`
      );
      lines.push(`- prior-season membership: ${r.priorSeasonTeamMembership ?? '—'}`);
      lines.push(
        `- current-season membership: ${r.currentSeasonTeamMembership ?? '—'}`
      );
      lines.push(`- stats enrichment: ${r.statsEnrichmentStatus}`);
      lines.push(`- warning: ${r.warningReason ?? '—'}`);
      lines.push('');
    }
  }

  lines.push('## Excluded / unmapped (stats enrichment skipped)');
  lines.push('');
  const excluded = rows.filter(
    (r) => r.statsEnrichmentStatus === 'skipped_missing_player_id'
  );
  if (excluded.length === 0) {
    lines.push('None.');
  } else {
    for (const r of excluded) {
      lines.push(
        `- **${r.displayName}** (\`${r.playerEntityId}\`) — ${r.warningReason ?? 'missing player_id'}`
      );
    }
  }
  lines.push('');

  const outPath = path.join(
    process.cwd(),
    'reports/product/preseason-preview-detroit-roster-diff-trust.md'
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, path: outPath, rows: rows.length }, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
