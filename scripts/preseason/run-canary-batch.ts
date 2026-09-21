/**
 * Facts + signals canary for 5 teams (DET + 4). No editorial. No generate:all.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import pool from '@/lib/db';
import {
  buildPreseasonTeamPacket,
  derivePreseasonContextSignals,
  writePreseasonPacket,
} from '@/lib/teams/preseason-preview/automation';
import {
  HIGH_MINUTE_MPG,
  HIGH_USAGE_AVG,
  MEANINGFUL_MINUTE_MPG,
  MIN_USAGE_GAMES,
  MIN_USAGE_TOTAL_MINUTES,
  RECENT_COMPETITIVE_MINUTES_RATIO,
  RECENT_COMPETITIVE_MIN_BASELINE_MPG,
  RECENT_COMPETITIVE_MIN_SEASON_GP,
  RECENT_COMPETITIVE_MIN_WINDOW_GP,
} from '@/lib/teams/preseason-preview/automation/policy';
import type { PreseasonTeamPacket } from '@/lib/teams/preseason-preview/automation/types';

const SEASON = '2026';

/**
 * Canary set (materially different situations):
 * - DET: reference + mapping edge cases (NBA-only entities)
 * - BOS: relatively stable core (lower turnover)
 * - CHA: high roster turnover rebuild
 * - SAS: young / development-heavy roster
 * - WAS: high turnover + depth churn
 */
const TEAMS = [
  { slug: 'DET', situation: 'reference + mapping edge cases' },
  { slug: 'BOS', situation: 'stable roster / lower turnover' },
  { slug: 'CHA', situation: 'high roster turnover' },
  { slug: 'SAS', situation: 'young / rebuilding' },
  { slug: 'WAS', situation: 'high turnover + data churn' },
] as const;

function skippedSignals(packet: PreseasonTeamPacket): string[] {
  const skipped: string[] = [];
  const byEntity = new Map(
    packet.playerSeasonStats.map((s) => [s.playerEntityId, s])
  );

  for (const p of packet.departures) {
    const s = byEntity.get(p.playerEntityId);
    if (!s || s.mpg == null || s.mpg < MEANINGFUL_MINUTE_MPG) {
      skipped.push(
        `VACATED_MINUTES skipped for ${p.displayName}: mpg=${s?.mpg ?? 'null'} (need >= ${MEANINGFUL_MINUTE_MPG})`
      );
    }
  }
  for (const p of packet.returningPlayers) {
    const s = byEntity.get(p.playerEntityId);
    if (!s || s.mpg == null || s.mpg < HIGH_MINUTE_MPG) {
      skipped.push(
        `RETURNING_HIGH_MINUTE skipped for ${p.displayName}: mpg=${s?.mpg ?? 'null'} (need >= ${HIGH_MINUTE_MPG})`
      );
    }
    if (
      !s ||
      s.usageAvg == null ||
      s.usageGames == null ||
      s.usageTotalMinutes == null ||
      s.usageGames < MIN_USAGE_GAMES ||
      s.usageTotalMinutes < MIN_USAGE_TOTAL_MINUTES ||
      s.usageAvg < HIGH_USAGE_AVG
    ) {
      skipped.push(
        `HIGH_USAGE_RETURNER skipped for ${p.displayName}: usageAvg=${s?.usageAvg ?? 'null'} games=${s?.usageGames ?? 'null'} totalMin=${s?.usageTotalMinutes ?? 'null'}`
      );
    }
  }
  for (const p of packet.additions) {
    const s = byEntity.get(p.playerEntityId);
    if (!s || s.mpg == null || s.mpg < HIGH_MINUTE_MPG) {
      skipped.push(
        `NEW_HIGH_MINUTE_ADDITION skipped for ${p.displayName}: mpg=${s?.mpg ?? 'null'}`
      );
    }
  }
  for (const p of [...packet.returningPlayers, ...packet.additions]) {
    const s = byEntity.get(p.playerEntityId);
    const w = s?.recentCompetitive;
    if (
      !s?.mpg ||
      !w?.recentMpg ||
      (s.gamesPlayed ?? 0) < RECENT_COMPETITIVE_MIN_SEASON_GP ||
      w.gamesIncluded < RECENT_COMPETITIVE_MIN_WINDOW_GP ||
      s.mpg < RECENT_COMPETITIVE_MIN_BASELINE_MPG ||
      w.recentMpg / s.mpg < RECENT_COMPETITIVE_MINUTES_RATIO
    ) {
      skipped.push(
        `RECENT_COMPETITIVE_MINUTES_INCREASE skipped for ${p.displayName}: baseline=${s?.mpg ?? 'null'} recent=${w?.recentMpg ?? 'null'} window=${w?.gamesIncluded ?? 0} psGames=${w?.postseasonGameCount ?? 'n/a'}`
      );
    }
  }
  return skipped;
}

function suspicious(packet: PreseasonTeamPacket): string[] {
  const notes: string[] = [];
  if (
    packet.previousSeasonAllGames.includesPostseason &&
    packet.previousSeasonRegular.available &&
    packet.previousSeasonRegular.record ===
      packet.previousSeasonAllGames.record
  ) {
    notes.push(
      'SUSPICIOUS: regular-season record equals all-games record despite includesPostseason'
    );
  }
  if (!packet.previousSeasonRegular.available) {
    notes.push(
      `Regular-season snapshot unavailable: ${packet.previousSeasonRegular.unavailableReason}`
    );
  }
  const nullId = [
    ...packet.additions,
    ...packet.departures,
    ...packet.returningPlayers,
  ].filter((p) => !p.playerId);
  if (nullId.length > 0) {
    notes.push(
      `${nullId.length} entities missing player_id: ${nullId.map((p) => p.displayName).join(', ')}`
    );
  }
  if (packet.additions.length + packet.departures.length === 0) {
    notes.push('Zero roster turnover — verify continuity seasons populated');
  }
  return notes;
}

async function main() {
  const sections: string[] = [];
  sections.push('# Preseason Preview Canary Batch (Facts + Signals)');
  sections.push('');
  sections.push(`**Season:** ${SEASON}`);
  sections.push(`**Generated:** ${new Date().toISOString()}`);
  sections.push('');
  sections.push(
    'Facts + signals only. No editorial generation. No generate:all.'
  );
  sections.push('');

  let stop = false;

  for (const t of TEAMS) {
    const packet = await buildPreseasonTeamPacket(t.slug, SEASON);
    await writePreseasonPacket(packet);
    const signals = derivePreseasonContextSignals(packet);
    const skipped = skippedSignals(packet);
    const sus = suspicious(packet);

    sections.push(`## ${t.slug} — ${packet.team.name}`);
    sections.push('');
    sections.push(`- Situation: ${t.situation}`);
    sections.push(
      `- Roster counts: additions=${packet.additions.length}, departures=${packet.departures.length}, returning=${packet.returningPlayers.length}`
    );
    sections.push(
      `- Regular-season snapshot: available=${packet.previousSeasonRegular.available} record=${packet.previousSeasonRegular.record ?? 'null'} GP=${packet.previousSeasonRegular.gamesPlayed}`
    );
    sections.push(
      `- All-games (internal): record=${packet.previousSeasonAllGames.record ?? 'null'} GP=${packet.previousSeasonAllGames.gamesPlayed} includesPostseason=${packet.previousSeasonAllGames.includesPostseason}`
    );
    sections.push(`- Warnings (${packet.warnings.length}):`);
    if (packet.warnings.length === 0) sections.push('  - (none)');
    else for (const w of packet.warnings) sections.push(`  - ${w}`);
    sections.push(`- Signals produced (${signals.length}):`);
    if (signals.length === 0) sections.push('  - (none)');
    else {
      for (const s of signals) {
        sections.push(
          `  - ${s.type} · ${s.displayName} · magnitude=${typeof s.magnitude === 'number' ? s.magnitude.toFixed(3) : s.magnitude}`
        );
      }
    }
    sections.push(`- Skipped signal notes (sample, not exhaustive gate log): ${skipped.length} rows`);
    for (const s of skipped.slice(0, 12)) sections.push(`  - ${s}`);
    if (skipped.length > 12) sections.push(`  - … +${skipped.length - 12} more`);
    sections.push('- Suspicious / ambiguous:');
    if (sus.length === 0) sections.push('  - (none flagged)');
    else {
      for (const s of sus) sections.push(`  - ${s}`);
      if (
        sus.some((x) => x.startsWith('SUSPICIOUS:')) ||
        !packet.previousSeasonRegular.available
      ) {
        stop = true;
      }
    }
    sections.push('');
  }

  sections.push('## Verdict');
  sections.push('');
  if (stop) {
    sections.push(
      '**STOP** — deterministic facts/signals not fully trustworthy for all-30 (see flags above).'
    );
  } else {
    sections.push(
      'Canary facts/signals look coherent enough to proceed to a single Detroit editorial generation. Not a green light for all-30 yet.'
    );
  }
  sections.push('');

  const outPath = path.join(
    process.cwd(),
    'reports/product/preseason-preview-canary-batch.md'
  );
  await fs.writeFile(outPath, `${sections.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ ok: !stop, path: outPath, stop }, null, 2));
  await pool.end();
  if (stop) process.exit(2);
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
