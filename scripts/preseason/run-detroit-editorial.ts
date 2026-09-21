/**
 * Exactly ONE real LLM editorial generation for Detroit (V1.1).
 * Leaves review.status = NEEDS_REVIEW. Does not publish or touch registry.
 */

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import pool from '@/lib/db';
import { runPreseasonGenerate } from '@/lib/teams/preseason-preview/automation';

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('OPENAI_API_KEY required for real editorial generation');
    process.exit(1);
  }

  const { packet, draft, validationErrors, path: draftPath } =
    await runPreseasonGenerate({
      team: 'DET',
      season: '2026',
      dryRun: false,
    });

  const reportLines: string[] = [];
  reportLines.push('# Detroit Editorial Generation Trace (V1.1)');
  reportLines.push('');
  reportLines.push(`**Generated:** ${draft.generatedAt}`);
  reportLines.push(`**Draft path:** ${draftPath}`);
  reportLines.push(`**Review status:** ${draft.review.status}`);
  reportLines.push(`**Validation errors:** ${validationErrors.length}`);
  reportLines.push('');
  reportLines.push('## Guardrail checks');
  reportLines.push('');
  reportLines.push(
    `- Invented players: validation player-id checks ${validationErrors.some((e) => e.includes('not in packet')) ? 'FAILED' : 'PASS (no unknown entity ids)'}`
  );
  reportLines.push(
    `- Projected rotation: ${draft.projectedRotation.status} (must be UNAVAILABLE)`
  );
  reportLines.push(
    `- WOWY context length: ${draft.wowyContext.length} (must be 0 without packet WOWY)`
  );
  reportLines.push(
    `- Public snapshot uses regular-season only: record=${draft.snapshot.regularSeasonRecord} allGamesExcluded=${draft.snapshot.allGamesMetricsExcludedFromPublicSnapshot}`
  );
  reportLines.push(
    `- All-games internal record (not for public label): ${packet.previousSeasonAllGames.record}`
  );
  reportLines.push('');
  reportLines.push('## Editorial sections');
  reportLines.push('');
  reportLines.push(`- headline: ${draft.headline ?? '(null)'}`);
  reportLines.push(`- dek: ${draft.dek ?? '(null)'}`);
  reportLines.push(`- bigPicture paragraphs: ${draft.bigPicture.length}`);
  reportLines.push(`- playersToWatch with copy: ${draft.playersToWatch.filter((p) => p.watching).length}`);
  reportLines.push(`- roleWatch with explanation: ${draft.roleWatch.filter((r) => r.explanation).length}`);
  reportLines.push(`- keyQuestions: ${draft.keyQuestions.length}`);
  reportLines.push(`- outlook: ${draft.outlook ? 'present' : '(null)'}`);
  reportLines.push('');
  reportLines.push('## Editorial trace');
  reportLines.push('');
  if (draft.editorialTrace.length === 0) {
    reportLines.push('_No editorialTrace returned by model._');
  } else {
    for (const t of draft.editorialTrace) {
      reportLines.push(`### ${t.section}`);
      reportLines.push('');
      reportLines.push(`- Claim: ${t.claimSummary}`);
      reportLines.push(
        `- Fact paths: ${t.supportingFactPaths.join(', ') || '(none)'}`
      );
      reportLines.push(
        `- Signals: ${t.supportingSignalTypes.join(', ') || '(none)'}`
      );
      reportLines.push('');
    }
  }
  reportLines.push('## Review warnings');
  reportLines.push('');
  for (const w of draft.review.warnings) reportLines.push(`- ${w}`);
  reportLines.push('');
  reportLines.push(
    'Public curated registry was not modified. Draft remains NEEDS_REVIEW.'
  );

  const reportPath = path.join(
    process.cwd(),
    'reports/product/preseason-preview-detroit-editorial-trace.md'
  );
  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: validationErrors.length === 0,
        draftPath,
        reportPath,
        review: draft.review.status,
        editorialPresent: Boolean(
          draft.headline || draft.bigPicture.length || draft.outlook
        ),
        traceSections: draft.editorialTrace.length,
        validationErrors,
      },
      null,
      2
    )
  );

  await pool.end();
  if (validationErrors.length > 0) process.exit(2);
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
