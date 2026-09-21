/**
 * V1.2.1 research packet canary — DET/BOS/CHA/SAS/WAS.
 * Snapshot integrity + continuity + human-review flags.
 * Facts only. No editorial. No generate:all.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import pool from '@/lib/db';
import { runResearchPacket } from '@/lib/teams/preseason-preview/automation/run-research-packet';
import { partitionRosterStatuses } from '@/lib/teams/preseason-preview/automation/roster-status';
import { MAX_REGULAR_SEASON_GAMES } from '@/lib/teams/preseason-preview/automation/regular-season-integrity';

const SEASON = '2026';
const TEAMS = ['DET', 'BOS', 'CHA', 'SAS', 'WAS'] as const;

async function main() {
  const lines: string[] = [];
  lines.push('# Preseason Research Packet Canary (V1.2.1)');
  lines.push('');
  lines.push(`**Season:** ${SEASON}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    'Research packets only. RS integrity gate + DEPARTED-with-elsewhere + human-review flags.'
  );
  lines.push('');

  let falseDepartures = 0;
  let snapshotFailures = 0;
  let bosBrownDeparted = false;
  let detRecordOk = false;
  let sasRecordOk = false;
  const reviewFlags: string[] = [];

  for (const slug of TEAMS) {
    const { research, rosterStatuses, researchPath } = await runResearchPacket({
      team: slug,
      season: SEASON,
    });
    const parts = partitionRosterStatuses(rosterStatuses);
    const rs = research.snapshot.regularSeason;
    const gpOk =
      rs.available &&
      rs.gamesPlayed <= MAX_REGULAR_SEASON_GAMES &&
      rs.wins != null &&
      rs.losses != null &&
      rs.wins + rs.losses === rs.gamesPlayed;

    if (!gpOk) snapshotFailures += 1;

    lines.push(`## ${slug} — ${research.team.name}`);
    lines.push('');
    lines.push(`- Path: \`${researchPath}\``);
    lines.push(
      `- RS snapshot: available=${rs.available} record=${rs.record} GP=${rs.gamesPlayed} W=${rs.wins} L=${rs.losses} scope=${rs.metricsScope}`
    );
    lines.push(
      `- RS integrity (GP<=82, W+L=GP): ${gpOk ? 'PASS' : 'FAIL'}`
    );
    lines.push(
      `- All-games internal: record=${research.snapshot.allGamesInternal.record} GP=${research.snapshot.allGamesInternal.gamesPlayed} includesPostseason=${research.snapshot.allGamesInternal.includesPostseason}`
    );
    lines.push(
      `- Roster: added=${parts.added.length} departed=${parts.departed.length} returning=${parts.returning.length} unresolved=${parts.unresolved.length}`
    );
    lines.push(
      `- Departures: ${parts.departed.map((d) => `${d.displayName}→${d.otherTeamAbbr}`).join(', ') || '(none)'}`
    );
    lines.push(
      `- Unresolved: ${parts.unresolved.map((u) => u.displayName).join(', ') || '(none)'}`
    );

    const flagged = rosterStatuses.filter((r) => r.requiresHumanRosterReview);
    lines.push(
      `- Human roster review flags: ${
        flagged
          .map(
            (f) =>
              `${f.displayName}[${f.status}]:${f.reviewReasons.join('+')}`
          )
          .join('; ') || '(none)'
      }`
    );
    for (const f of flagged) {
      reviewFlags.push(`${slug}:${f.displayName}:${f.status}`);
    }

    lines.push(
      `- Watch candidates: ${research.playersToWatchCandidates.length}; role shifts: ${research.roleUsageShiftCandidates.length}; WOWY candidates: ${research.wowyCandidates.length}`
    );
    lines.push(
      `- WOWY fabricated? ${research.wowyCandidates.some((w) => w.status === 'HAS_DATA' && !w.sampleSize) ? 'YES' : 'no'}; review-only count=${research.wowyCandidates.filter((w) => w.status === 'CANDIDATE_FOR_REVIEW').length}`
    );

    const claimsMissingEvidence = [
      ...research.roleUsageShiftCandidates.filter(
        (c) => c.claim.evidence.length === 0
      ),
      ...research.researchQuestions.filter((q) => q.evidence.length === 0),
    ];
    lines.push(
      `- Claims missing evidence paths: ${claimsMissingEvidence.length}`
    );

    if (slug === 'DET') {
      detRecordOk =
        rs.record === '60–22' && rs.gamesPlayed === 82 && gpOk;
      lines.push(`- DET 60–22/82 check: ${detRecordOk ? 'PASS' : 'FAIL'}`);
    }

    if (slug === 'SAS') {
      sasRecordOk =
        rs.record === '62–20' && rs.gamesPlayed === 82 && gpOk;
      lines.push(
        `- SAS 62–20/82 (not 62–21/83) check: ${sasRecordOk ? 'PASS' : 'FAIL'}`
      );
    }

    if (slug === 'BOS') {
      const brownDep = parts.departed.find((d) =>
        d.displayName.includes('Jaylen Brown')
      );
      bosBrownDeparted = Boolean(brownDep);
      lines.push(
        `- Jaylen Brown status: ${
          brownDep
            ? `DEPARTED→${brownDep.otherTeamAbbr} review=${brownDep.requiresHumanRosterReview} (${brownDep.reviewReasons.join(',') || 'none'})`
            : 'not DEPARTED'
        }`
      );
    }

    for (const d of parts.departed) {
      if (!d.otherTeamAbbr) {
        falseDepartures += 1;
        lines.push(
          `- **BUG:** DEPARTED without elsewhere team: ${d.displayName}`
        );
      }
    }

    lines.push('');
  }

  lines.push('## Audit summary');
  lines.push('');
  lines.push(`- Snapshot integrity failures: ${snapshotFailures}`);
  lines.push(
    `- Departures without elsewhere evidence: ${falseDepartures}`
  );
  lines.push(`- DET RS 60–22/82: ${detRecordOk ? 'PASS' : 'FAIL'}`);
  lines.push(`- SAS RS 62–20/82: ${sasRecordOk ? 'PASS' : 'FAIL'}`);
  lines.push(
    `- BOS Jaylen Brown: ${
      bosBrownDeparted
        ? 'DEPARTED with elsewhere evidence'
        : 'not DEPARTED'
    }`
  );
  lines.push(`- Human review flag count: ${reviewFlags.length}`);
  lines.push('');

  const safe =
    snapshotFailures === 0 &&
    falseDepartures === 0 &&
    detRecordOk &&
    sasRecordOk;

  lines.push(
    safe
      ? 'Canary packet generation succeeded under V1.2.1 integrity + continuity rules.'
      : 'Canary found integrity/continuity issues — not ready for larger batch.'
  );
  lines.push('');

  const out = path.join(
    process.cwd(),
    'reports/product/preseason-preview-research-canary-v1.2.1.md'
  );
  await fs.writeFile(out, `${lines.join('\n')}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        ok: safe,
        path: out,
        snapshotFailures,
        falseDepartures,
        detRecordOk,
        sasRecordOk,
        reviewFlagCount: reviewFlags.length,
      },
      null,
      2
    )
  );
  await pool.end();
  if (!safe) process.exit(2);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
