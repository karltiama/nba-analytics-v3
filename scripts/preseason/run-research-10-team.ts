/**
 * V1.2.2 — 10-team research packet stress test.
 * Research packets only. No editorial. No generate:all.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import pool from '@/lib/db';
import { runResearchPacket } from '@/lib/teams/preseason-preview/automation/run-research-packet';
import { partitionRosterStatuses } from '@/lib/teams/preseason-preview/automation/roster-status';
import {
  MAX_REGULAR_SEASON_GAMES,
  REGULAR_SEASON_SCOPE,
} from '@/lib/teams/preseason-preview/automation/regular-season-integrity';
import { NBA_CUP_CHAMPIONSHIP_ET } from '@/lib/wowy/calendar';
import type { PreseasonResearchPacket } from '@/lib/teams/preseason-preview/automation/research-packet-types';
import type { RosterStatusPlayer } from '@/lib/teams/preseason-preview/automation/roster-status';
import type { PreseasonContextSignal } from '@/lib/teams/preseason-preview/automation/types';

const SEASON = '2026';

/** Challenging sample — see selectionReasons. */
export const STRESS_TEAMS = [
  'DET',
  'BOS',
  'CHA',
  'SAS',
  'WAS',
  'PHI',
  'MIN',
  'LAL',
  'MEM',
  'NYK',
] as const;

export const SELECTION_REASONS: Record<(typeof STRESS_TEAMS)[number], string> = {
  DET: 'Canary baseline; known-good RS 60–22; multiple confirmed departures + additions',
  BOS: 'Star DEPARTED (Jaylen Brown→PHI); UNRESOLVED (Banton); high-impact review flags',
  CHA: 'Star DEPARTED (LaMelo→MIN); high roster churn; vacated usage risk',
  SAS: 'Cup Championship contamination regression; many UNRESOLVED; deep playoff all-games',
  WAS: 'Rebuild / low win total; multiple ADDED; unresolved absences',
  PHI: 'Receiving side of Brown move; highest-tier additions churn (7 miss / 12 new)',
  MIN: 'Receiving side of LaMelo move; mid churn; star ADDED review',
  LAL: 'Highest open-roster churn in league probe (9 miss / 11 new)',
  MEM: 'High churn tank/rebuild pattern; additions + missing-from-curr pressure',
  NYK: 'Cup Championship finalist twin; lower churn continuity-heavy contrast to LAL',
};

type TeamAudit = {
  team: string;
  name: string;
  rsValid: boolean;
  rsRecord: string | null;
  rsGp: number;
  add: number;
  dep: number;
  ret: number;
  unres: number;
  humanReviewFlags: string[];
  evidenceGaps: number;
  majorIssues: string[];
  suspiciousSupported: string[];
  unexpected: string[];
  vacatedFromUnresolved: boolean;
  fabricatedWowy: boolean;
  cupChampionshipExcluded: boolean;
};

function auditTeam(
  slug: string,
  research: PreseasonResearchPacket,
  rosterStatuses: RosterStatusPlayer[]
): TeamAudit {
  const parts = partitionRosterStatuses(rosterStatuses);
  const rs = research.snapshot.regularSeason;
  const majorIssues: string[] = [];
  const unexpected: string[] = [];
  const suspiciousSupported: string[] = [];

  const rsValid =
    rs.available === true &&
    rs.metricsScope === 'regular_season' &&
    rs.wins != null &&
    rs.losses != null &&
    rs.wins >= 0 &&
    rs.losses >= 0 &&
    rs.wins + rs.losses === rs.gamesPlayed &&
    rs.gamesPlayed <= MAX_REGULAR_SEASON_GAMES &&
    rs.gamesPlayed > 0;

  if (!rsValid) {
    majorIssues.push(
      `INVALID_RS available=${rs.available} GP=${rs.gamesPlayed} W=${rs.wins} L=${rs.losses} scope=${rs.metricsScope}`
    );
  }

  // Cup championship exclusion noted in provenance
  const cupDates = NBA_CUP_CHAMPIONSHIP_ET['2025'] ?? [];
  const cupChampionshipExcluded =
    cupDates.length === 0 ||
    (rs.provenance.note ?? '').includes('Cup Championship') ||
    (rs.provenance.method ?? '').includes('1.2.1');
  if (rs.available && rs.gamesPlayed === 83) {
    majorIssues.push('Cup/RS contamination: GP=83');
  }

  // False DEPARTED: missing elsewhere
  for (const d of parts.departed) {
    if (!d.otherTeamAbbr) {
      majorIssues.push(`FALSE_DEPARTED_NO_ELSEWHERE: ${d.displayName}`);
    } else {
      const flag = d.requiresHumanRosterReview
        ? ` review=${d.reviewReasons.join('+')}`
        : '';
      suspiciousSupported.push(
        `${d.displayName}→${d.otherTeamAbbr} [${d.status}]${flag}`
      );
      if (
        d.requiresHumanRosterReview === false &&
        (d.reviewReasons.length > 0 ||
          /* high-name heuristic only for known stars in packet warnings */ false)
      ) {
        /* noop */
      }
    }
  }

  // High-impact departed without review flag → failure criterion
  for (const d of parts.departed) {
    const stats = research.playerSeasonStats.find(
      (s) => s.playerEntityId === d.playerEntityId
    );
    const highImpact =
      (stats?.mpg != null && stats.mpg >= 28) ||
      (stats?.usageAvg != null && stats.usageAvg >= 0.24) ||
      (stats?.ppg != null && stats.ppg >= 18);
    if (highImpact && !d.requiresHumanRosterReview) {
      majorIssues.push(
        `HIGH_IMPACT_DEPARTURE_NOT_FLAGGED: ${d.displayName} mpg=${stats?.mpg} usg=${stats?.usageAvg} ppg=${stats?.ppg}`
      );
    }
  }

  // Vacated from UNRESOLVED
  const unresolvedIds = new Set(parts.unresolved.map((u) => u.playerEntityId));
  const vacatedSignals = research.contextSignals.filter(
    (s: PreseasonContextSignal) => s.type === 'VACATED_MINUTES'
  );
  let vacatedFromUnresolved = false;
  for (const s of vacatedSignals) {
    if (s.playerEntityId && unresolvedIds.has(s.playerEntityId)) {
      vacatedFromUnresolved = true;
      majorIssues.push(
        `VACATED_FROM_UNRESOLVED: ${s.type} ${s.playerEntityId}`
      );
    }
    // Also: vacated players must be DEPARTED
    if (
      s.playerEntityId &&
      !parts.departed.some((d) => d.playerEntityId === s.playerEntityId)
    ) {
      majorIssues.push(
        `VACATED_NOT_DEPARTED: ${s.type} ${s.displayName ?? s.playerEntityId}`
      );
    }
  }

  // Fabricated WOWY
  let fabricatedWowy = false;
  for (const w of research.wowyCandidates) {
    if (w.status === 'HAS_DATA' && (!w.sampleSize || w.metrics == null)) {
      fabricatedWowy = true;
      majorIssues.push(`FABRICATED_WOWY: ${w.label}`);
    }
  }

  // Evidence gaps
  const claimsMissingEvidence = [
    ...research.roleUsageShiftCandidates.filter(
      (c) => !c.claim.evidence || c.claim.evidence.length === 0
    ),
    ...research.researchQuestions.filter(
      (q) => !q.evidence || q.evidence.length === 0
    ),
  ];
  const evidenceGaps = claimsMissingEvidence.length;
  if (evidenceGaps > 0) {
    majorIssues.push(`EVIDENCE_GAPS: ${evidenceGaps}`);
  }

  // Projection language smell in factual claims
  const projectionRe =
    /\b(will be|projected to|expect(ed)? to|should start|likely starter)\b/i;
  for (const c of research.roleUsageShiftCandidates) {
    if (projectionRe.test(c.claim.text)) {
      majorIssues.push(`PROJECTION_LANGUAGE: ${c.displayName}`);
    }
  }

  // Recent competitive evidence shape (Record, not array)
  for (const s of research.contextSignals) {
    if (s.type === 'RECENT_COMPETITIVE_MINUTES_INCREASE') {
      const ev = s.evidence ?? {};
      const keys = Object.keys(ev).join(' ');
      const blob = `${keys} ${JSON.stringify(ev)}`;
      const hasRsPs =
        /regularSeasonGameCount|postseasonGameCount|dateRange/i.test(blob);
      if (!hasRsPs) {
        unexpected.push(
          `RECENT_COMPETITIVE evidence may lack RS/PS detail: ${s.displayName}`
        );
      }
    }
  }

  // Surprising star moves — always list for human eyes
  for (const d of parts.departed) {
    if (d.requiresHumanRosterReview) {
      unexpected.push(
        `Human-review departure: ${d.displayName}→${d.otherTeamAbbr} (${d.reviewReasons.join(',')})`
      );
    }
  }
  for (const a of parts.added) {
    if (a.requiresHumanRosterReview) {
      unexpected.push(
        `Human-review addition: ${a.displayName} from ${a.otherTeamAbbr ?? 'n/a'} (${a.reviewReasons.join(',')})`
      );
    }
  }

  const humanReviewFlags = rosterStatuses
    .filter((r) => r.requiresHumanRosterReview)
    .map(
      (r) => `${r.displayName}[${r.status}]:${r.reviewReasons.join('+')}`
    );

  return {
    team: slug,
    name: research.team.name,
    rsValid,
    rsRecord: rs.record,
    rsGp: rs.gamesPlayed,
    add: parts.added.length,
    dep: parts.departed.length,
    ret: parts.returning.length,
    unres: parts.unresolved.length,
    humanReviewFlags,
    evidenceGaps,
    majorIssues,
    suspiciousSupported,
    unexpected,
    vacatedFromUnresolved,
    fabricatedWowy,
    cupChampionshipExcluded,
  };
}

async function main() {
  const lines: string[] = [];
  const audits: TeamAudit[] = [];
  const generatedAt = new Date().toISOString();

  lines.push('# Preseason Research 10-Team Stress Test (V1.2.2)');
  lines.push('');
  lines.push(`**Season:** ${SEASON}`);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push('');
  lines.push('Research packets only. No editorial. No generate:all.');
  lines.push('');
  lines.push('## Team selection');
  lines.push('');
  for (const t of STRESS_TEAMS) {
    lines.push(`- **${t}** — ${SELECTION_REASONS[t]}`);
  }
  lines.push('');

  for (const slug of STRESS_TEAMS) {
    console.error(`Generating ${slug}...`);
    const { research, rosterStatuses, researchPath } = await runResearchPacket({
      team: slug,
      season: SEASON,
    });
    const audit = auditTeam(slug, research, rosterStatuses);
    audits.push(audit);

    lines.push(`## ${slug} — ${research.team.name}`);
    lines.push('');
    lines.push(`- Path: \`${researchPath}\``);
    lines.push(
      `- RS: available=${research.snapshot.regularSeason.available} record=${research.snapshot.regularSeason.record} GP=${research.snapshot.regularSeason.gamesPlayed} scope=${research.snapshot.regularSeason.metricsScope} valid=${audit.rsValid}`
    );
    lines.push(
      `- All-games internal: record=${research.snapshot.allGamesInternal.record} GP=${research.snapshot.allGamesInternal.gamesPlayed} includesPS=${research.snapshot.allGamesInternal.includesPostseason}`
    );
    lines.push(
      `- Continuity: add=${audit.add} dep=${audit.dep} ret=${audit.ret} unres=${audit.unres}`
    );
    lines.push(
      `- Departures: ${audit.suspiciousSupported.join('; ') || '(none)'}`
    );
    lines.push(
      `- Unresolved: ${partitionRosterStatuses(rosterStatuses)
        .unresolved.map((u) => u.displayName)
        .join(', ') || '(none)'}`
    );
    lines.push(
      `- Human review: ${audit.humanReviewFlags.join('; ') || '(none)'}`
    );
    lines.push(
      `- Vacated→unresolved=${audit.vacatedFromUnresolved}; fabricatedWowy=${audit.fabricatedWowy}; evidenceGaps=${audit.evidenceGaps}`
    );
    lines.push(
      `- WOWY: ${research.wowyCandidates.map((w) => `${w.status}:${w.label}`).join('; ') || '(none)'}`
    );
    lines.push(
      `- Role shifts: ${research.roleUsageShiftCandidates.length}; watch: ${research.playersToWatchCandidates.length}; signals: ${research.contextSignals.map((s) => s.type).join(',')}`
    );
    if (audit.majorIssues.length) {
      lines.push(`- **MAJOR ISSUES:** ${audit.majorIssues.join(' | ')}`);
    }
    if (audit.unexpected.length) {
      lines.push(`- Unexpected/review: ${audit.unexpected.join(' | ')}`);
    }
    lines.push('');
  }

  lines.push('## Audit table');
  lines.push('');
  lines.push(
    '| Team | RS Valid | Add | Dep | Ret | Unres | Human Review Flags | Evidence Gaps | Major Issue |'
  );
  lines.push(
    '| ---- | -------: | --: | --: | --: | ----: | -----------------: | ------------: | ----------- |'
  );
  for (const a of audits) {
    lines.push(
      `| ${a.team} | ${a.rsValid ? 'Y' : 'N'} (${a.rsRecord}/${a.rsGp}) | ${a.add} | ${a.dep} | ${a.ret} | ${a.unres} | ${a.humanReviewFlags.length} | ${a.evidenceGaps} | ${a.majorIssues.join('; ') || '—'} |`
    );
  }
  lines.push('');

  lines.push('## Confirmed suspicious-but-supported moves');
  lines.push('');
  for (const a of audits) {
    for (const m of a.suspiciousSupported) {
      if (a.humanReviewFlags.some((f) => m.startsWith(f.split('[')[0]!))) {
        lines.push(`- **${a.team}** — ${m} — evidence-backed, human review flagged`);
      } else {
        lines.push(`- **${a.team}** — ${m} — evidence-backed`);
      }
    }
  }
  lines.push('');

  lines.push('## Unexpected / questionable');
  lines.push('');
  const unexp = audits.flatMap((a) =>
    a.unexpected.map((u) => `- **${a.team}** — ${u}`)
  );
  if (unexp.length === 0) lines.push('- (none beyond review flags)');
  else lines.push(...unexp);
  lines.push('');

  const anyMajor = audits.some((a) => a.majorIssues.length > 0);
  const allRsValid = audits.every((a) => a.rsValid);
  const noFalseDep = !audits.some((a) =>
    a.majorIssues.some((m) => m.startsWith('FALSE_DEPARTED'))
  );
  const noVacUnres = !audits.some((a) => a.vacatedFromUnresolved);
  const noFabWowy = !audits.some((a) => a.fabricatedWowy);

  lines.push('## Batch gate');
  lines.push('');
  lines.push(`- All RS valid: ${allRsValid}`);
  lines.push(`- No false DEPARTED: ${noFalseDep}`);
  lines.push(`- No vacated-from-UNRESOLVED: ${noVacUnres}`);
  lines.push(`- No fabricated WOWY: ${noFabWowy}`);
  lines.push(`- Any major issues: ${anyMajor}`);
  lines.push('');

  const safe =
    allRsValid && noFalseDep && noVacUnres && noFabWowy && !anyMajor;
  lines.push(
    safe
      ? 'Stress batch: **PASS** under V1.2.2 failure criteria.'
      : 'Stress batch: **FAIL** — see major issues above.'
  );
  lines.push('');

  const out = path.join(
    process.cwd(),
    'reports/product/preseason-preview-research-10-team-canary-v1.2.2.md'
  );
  await fs.writeFile(out, `${lines.join('\n')}\n`, 'utf8');

  // Machine-readable summary for the product report
  const summaryPath = path.join(
    process.cwd(),
    'reports/product/preseason-preview-research-10-team-audit-v1.2.2.json'
  );
  await fs.writeFile(
    summaryPath,
    JSON.stringify(
      {
        generatedAt,
        season: SEASON,
        teams: STRESS_TEAMS,
        selectionReasons: SELECTION_REASONS,
        audits,
        safe,
        regularSeasonScopeConstant: REGULAR_SEASON_SCOPE,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        ok: safe,
        path: out,
        summaryPath,
        majorIssueTeams: audits
          .filter((a) => a.majorIssues.length)
          .map((a) => a.team),
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
