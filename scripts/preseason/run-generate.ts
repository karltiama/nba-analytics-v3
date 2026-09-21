/**
 * Generate a preseason preview draft (packet → signals → editorial → validate → write).
 *
 * Usage:
 *   npx tsx scripts/preseason/run-generate.ts --team=DET --season=2026 --dry-run
 *   npm run preseason:generate -- --team DET --season 2026 --dry-run
 */

import 'dotenv/config';
import pool from '@/lib/db';
import { runPreseasonGenerate } from '@/lib/teams/preseason-preview/automation';

function readArg(name: string): string | null {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  const envKey = `PRESEASON_${name.toUpperCase()}`;
  return process.env[envKey]?.trim() || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const team = readArg('team');
  const season = readArg('season');
  if (!team || !season) {
    console.error('Required: --team DET --season 2026');
    process.exit(1);
  }

  const dryRun = hasFlag('dry-run');
  const { packet, draft, validationErrors, path } = await runPreseasonGenerate({
    team,
    season,
    dryRun,
  });

  console.log(
    JSON.stringify(
      {
        ok: validationErrors.length === 0,
        path,
        dryRun,
        team: draft.team,
        season: draft.season,
        review: draft.review,
        signalCount: draft.contextSignals.length,
        playersToWatch: draft.playersToWatch.length,
        roleWatch: draft.roleWatch.length,
        projectedRotation: draft.projectedRotation.status,
        editorialPresent: Boolean(
          draft.headline ||
            draft.dek ||
            draft.bigPicture.length ||
            draft.outlook ||
            draft.keyQuestions.length
        ),
        packetWarnings: packet.warnings.length,
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
