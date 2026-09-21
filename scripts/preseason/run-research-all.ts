/**
 * V1.3 — Generate research packets for all 30 current NBA teams.
 * Research packets ONLY. Not final editorial. Not generate:all.
 *
 * Usage:
 *   npm run preseason:research:all -- --season=2026
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import pool from '@/lib/db';
import { listCurrentNbaTeams } from '@/lib/teams/team-directory-queries';
import { EXPECTED_CURRENT_NBA_TEAM_COUNT } from '@/lib/teams/team-directory';
import { runResearchPacket } from '@/lib/teams/preseason-preview/automation/run-research-packet';
import { InvalidRegularSeasonSnapshotError } from '@/lib/teams/preseason-preview/automation/regular-season-integrity';
import {
  auditResearchPacket,
  emptyFailedAudit,
  type TeamResearchAudit,
} from './lib/research-packet-audit';

function parseSeason(argv: string[]): string {
  const fromArg = argv.find((a) => a.startsWith('--season='));
  if (fromArg) return fromArg.slice('--season='.length);
  // npm on some shells strips unknown --flags; allow npm_config_season=2026
  const fromEnv = process.env.npm_config_season?.trim();
  if (fromEnv) return fromEnv;
  return '2026';
}

async function main() {
  const season = parseSeason(process.argv.slice(2));
  const generatedAt = new Date().toISOString();

  const listed = await listCurrentNbaTeams();
  if (!listed.integrity.ok || listed.teams.length !== EXPECTED_CURRENT_NBA_TEAM_COUNT) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: 'CURRENT_NBA_TEAM_SET_INVALID',
          integrity: listed.integrity,
        },
        null,
        2
      )
    );
    await pool.end();
    process.exit(1);
  }

  const teams = [...listed.teams].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation, 'en')
  );

  const audits: TeamResearchAudit[] = [];
  const paths: Record<string, string> = {};

  console.error(
    `V1.3 research:all — ${teams.length} teams, season=${season}`
  );

  for (const t of teams) {
    const slug = t.abbreviation.toUpperCase();
    console.error(`  → ${slug}`);
    try {
      const { research, rosterStatuses, researchPath } = await runResearchPacket({
        team: slug,
        season,
      });
      paths[slug] = researchPath;
      audits.push(auditResearchPacket(slug, research, rosterStatuses));
    } catch (e) {
      const msg =
        e instanceof InvalidRegularSeasonSnapshotError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      console.error(`  ✗ ${slug}: ${msg}`);
      audits.push(emptyFailedAudit(slug, msg));
    }
  }

  const majorTeams = audits.filter((a) => a.majorIssues.length > 0);
  const rsInvalid = audits.filter((a) => !a.rsValid);
  const reviewFlagRows = audits.flatMap((a) =>
    a.humanReviewFlags.map((f) => ({ team: a.team, flag: f }))
  );
  const unresolvedRows = audits.flatMap((a) =>
    a.unresolvedNames.map((n) => ({ team: a.team, name: n }))
  );
  const falseDeparted = audits.filter((a) =>
    a.majorIssues.some((m) => m.startsWith('FALSE_DEPARTED'))
  );
  const fabricatedWowy = audits.filter((a) => a.fabricatedWowy);
  const vacatedBad = audits.filter((a) => a.vacatedFromUnresolved);

  const structuralOk =
    audits.length === EXPECTED_CURRENT_NBA_TEAM_COUNT &&
    rsInvalid.length === 0 &&
    falseDeparted.length === 0 &&
    fabricatedWowy.length === 0 &&
    vacatedBad.length === 0 &&
    majorTeams.length === 0;

  // --- Exception-focused report (human review queue) ---
  const exceptionLines: string[] = [];
  exceptionLines.push('# Preseason Research Packets — All-30 Exception Report (V1.3)');
  exceptionLines.push('');
  exceptionLines.push(`**Season:** ${season}`);
  exceptionLines.push(`**Generated:** ${generatedAt}`);
  exceptionLines.push(`**Packets:** ${audits.length} / ${EXPECTED_CURRENT_NBA_TEAM_COUNT}`);
  exceptionLines.push(
    `**Structural integrity:** ${structuralOk ? 'PASS' : 'FAIL'}`
  );
  exceptionLines.push('');
  exceptionLines.push(
    'Research packets are **homework**, not publishable roster truth. Workflow: research packet → human thoughts → generated draft → manual edit → factual review → publish.'
  );
  exceptionLines.push('');
  exceptionLines.push('## Hard failures (must fix before trusting batch)');
  exceptionLines.push('');
  if (majorTeams.length === 0) {
    exceptionLines.push('- (none)');
  } else {
    for (const a of majorTeams) {
      exceptionLines.push(
        `- **${a.team}**: ${a.majorIssues.join(' | ')}`
      );
    }
  }
  exceptionLines.push('');
  exceptionLines.push('## Human-review queue (high-impact confirmed moves)');
  exceptionLines.push('');
  if (reviewFlagRows.length === 0) {
    exceptionLines.push('- (none)');
  } else {
    for (const r of reviewFlagRows) {
      exceptionLines.push(`- **${r.team}** — ${r.flag}`);
    }
  }
  exceptionLines.push('');
  exceptionLines.push('## UNRESOLVED roster statuses (absence without elsewhere evidence)');
  exceptionLines.push('');
  if (unresolvedRows.length === 0) {
    exceptionLines.push('- (none)');
  } else {
    for (const r of unresolvedRows) {
      exceptionLines.push(`- **${r.team}** — ${r.name}`);
    }
  }
  exceptionLines.push('');
  exceptionLines.push('## League summary table');
  exceptionLines.push('');
  exceptionLines.push(
    '| Team | RS Valid | Record | Add | Dep | Ret | Unres | Review Flags | Major |'
  );
  exceptionLines.push(
    '| ---- | -------: | ------ | --: | --: | --: | ----: | -----------: | ----- |'
  );
  for (const a of audits) {
    exceptionLines.push(
      `| ${a.team} | ${a.rsValid ? 'Y' : 'N'} | ${a.rsRecord ?? '—'} | ${a.add} | ${a.dep} | ${a.ret} | ${a.unres} | ${a.humanReviewFlags.length} | ${a.majorIssues.length ? a.majorIssues.join('; ') : '—'} |`
    );
  }
  exceptionLines.push('');
  exceptionLines.push('## Counts');
  exceptionLines.push('');
  exceptionLines.push(`- RS invalid: ${rsInvalid.length}`);
  exceptionLines.push(`- False DEPARTED: ${falseDeparted.length}`);
  exceptionLines.push(`- Fabricated WOWY: ${fabricatedWowy.length}`);
  exceptionLines.push(`- Vacated-from-UNRESOLVED: ${vacatedBad.length}`);
  exceptionLines.push(`- Human-review flags: ${reviewFlagRows.length}`);
  exceptionLines.push(`- UNRESOLVED players: ${unresolvedRows.length}`);
  exceptionLines.push(`- Teams with major issues: ${majorTeams.length}`);
  exceptionLines.push('');
  exceptionLines.push(
    structuralOk
      ? '**ALL_30_RESEARCH_PACKETS_OK = YES**'
      : '**ALL_30_RESEARCH_PACKETS_OK = NO**'
  );
  exceptionLines.push('');

  const exceptionPath = path.join(
    process.cwd(),
    'reports/product/preseason-preview-research-all-30-exceptions-v1.3.md'
  );
  await fs.writeFile(exceptionPath, `${exceptionLines.join('\n')}\n`, 'utf8');

  const summaryPath = path.join(
    process.cwd(),
    'reports/product/preseason-preview-research-all-30-audit-v1.3.json'
  );
  await fs.writeFile(
    summaryPath,
    JSON.stringify(
      {
        version: 'preseason-research-all-30-v1.3',
        generatedAt,
        season,
        teamCount: audits.length,
        structuralOk,
        paths,
        audits,
        reviewFlagRows,
        unresolvedRows,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        ok: structuralOk,
        season,
        teamCount: audits.length,
        exceptionPath,
        summaryPath,
        reviewFlagCount: reviewFlagRows.length,
        unresolvedCount: unresolvedRows.length,
        majorIssueTeams: majorTeams.map((a) => a.team),
      },
      null,
      2
    )
  );

  await pool.end();
  if (!structuralOk) process.exit(2);
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
