import 'dotenv/config';
import { spawn } from 'node:child_process';

type CliArgs = {
  season: number;
  dryRun: boolean;
  overwrite: boolean;
};

type Step = { label: string; args: string[] };

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

export function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  const seasonRaw = flags.season;
  const season = typeof seasonRaw === 'string' ? Number(seasonRaw) : 2024;
  if (!Number.isInteger(season) || season < 1900 || season > 3000) {
    fatal('Invalid --season. Example: --season=2024');
  }
  return {
    season,
    dryRun: flags['dry-run'] === true,
    overwrite: flags.overwrite === true,
  };
}

async function runStep(label: string, args: string[]): Promise<void> {
  console.log(`\n[step] ${label}`);
  console.log(`       npx ${args.join(' ')}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Step failed: ${label} (exit ${code ?? 'unknown'})`));
    });
  });
}

export function buildSteps(args: CliArgs): Step[] {
  const seasonFlag = `--season=${args.season}`;
  const overwriteFlag = args.overwrite ? ['--overwrite'] : [];
  if (args.dryRun) {
    return [
      {
        label: 'Archive BallDontLie raw pages (dry-run)',
        args: [
          'tsx',
          'scripts/archive/backfill-balldontlie-season.ts',
          seasonFlag,
          '--entities=games,player_stats',
          '--dry-run',
        ],
      },
      {
        label: 'Transform games to curated (dry-run)',
        args: ['tsx', 'scripts/transform/raw-games-to-curated-parquet.ts', seasonFlag, '--dry-run'],
      },
      {
        label: 'Transform player_game_logs to curated (dry-run)',
        args: [
          'tsx',
          'scripts/transform/raw-player-game-logs-to-curated-parquet.ts',
          seasonFlag,
          '--dry-run',
        ],
      },
      {
        label: 'Feature builder compatibility check (dry-run)',
        args: ['tsx', 'scripts/features/build-player-game-features-v1.ts', seasonFlag, '--dry-run'],
      },
    ];
  }
  return [
    {
      label: 'Archive BallDontLie raw pages',
      args: [
        'tsx',
        'scripts/archive/backfill-balldontlie-season.ts',
        seasonFlag,
        '--entities=games,player_stats',
        ...overwriteFlag,
      ],
    },
    {
      label: 'Transform games to curated',
      args: ['tsx', 'scripts/transform/raw-games-to-curated-parquet.ts', seasonFlag, ...overwriteFlag],
    },
    {
      label: 'Transform player_game_logs to curated',
      args: [
        'tsx',
        'scripts/transform/raw-player-game-logs-to-curated-parquet.ts',
        seasonFlag,
        ...overwriteFlag,
      ],
    },
    {
      label: 'Feature builder compatibility check (dry-run)',
      args: ['tsx', 'scripts/features/build-player-game-features-v1.ts', seasonFlag, '--dry-run'],
    },
    {
      label: 'Feature builder compatibility check (real run)',
      args: ['tsx', 'scripts/features/build-player-game-features-v1.ts', seasonFlag, ...overwriteFlag],
    },
  ];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('=== Previous Season Ingestion (Safety + Backfill) ===');
  console.log(`  season   : ${args.season}`);
  console.log(`  dryRun   : ${args.dryRun}`);
  console.log(`  overwrite: ${args.overwrite}`);
  console.log('  output prefixes:');
  console.log(`    curated/league=nba/season=${args.season}/entity=games/`);
  console.log(`    curated/league=nba/season=${args.season}/entity=player_game_logs/`);

  const steps = buildSteps(args);
  for (const step of steps) {
    await runStep(step.label, step.args);
  }
  if (args.dryRun) {
    console.log('\n[dry-run] complete. No writes were performed by this orchestrator.');
    return;
  }

  console.log('\n[complete] previous-season ingestion flow finished successfully.');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('[fatal] unhandled error:', err);
    process.exit(1);
  });
}
