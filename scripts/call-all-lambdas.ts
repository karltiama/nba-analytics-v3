/**
 * Call all Lambda functions: run handlers locally in sequence.
 *
 * Usage:
 *   npx tsx scripts/call-all-lambdas.ts              # run all locally (default)
 *   npx tsx scripts/call-all-lambdas.ts --aws        # invoke deployed Lambdas via AWS CLI (4 functions)
 *
 * Local run: executes from each lambda/<name> with npx tsx index.ts so .env in that folder is used.
 * AWS run: requires AWS CLI configured; invokes nightly-bdl-updater, odds-pre-game-snapshot,
 *          injuries-snapshot, nba-player-props-ingestion-lambda (boxscore-scraper not in Terraform).
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const LOCAL_LAMBDAS = [
  'nightly-bdl-updater',
  'odds-pre-game-snapshot',
  'injuries-snapshot',
  'player-props-snapshot',
  'boxscore-scraper',
] as const;

const AWS_FUNCTIONS = [
  'nightly-bdl-updater',
  'odds-pre-game-snapshot',
  'injuries-snapshot',
  'nba-player-props-ingestion-lambda',
];

function runLocal(name: string): Promise<number> {
  return new Promise((resolve) => {
    const cwd = path.join(repoRoot, 'lambda', name);
    console.log(`\n--- ${name} (local) ---`);
    const child = spawn('npx', ['tsx', 'index.ts'], {
      cwd,
      shell: true,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

function runAws(functionName: string): Promise<number> {
  return new Promise((resolve) => {
    const outFile = path.join(repoRoot, 'infra', `lambda-response-${functionName}.json`);
    console.log(`\n--- ${functionName} (AWS invoke) ---`);
    const child = spawn(
      'aws',
      ['lambda', 'invoke', '--function-name', functionName, '--payload', '{}', outFile, '--region', process.env.AWS_REGION || 'us-east-1'],
      { shell: true, stdio: 'inherit' }
    );
    child.on('close', (code) => resolve(code ?? 0));
  });
}

async function main() {
  const useAws = process.argv.includes('--aws');

  if (useAws) {
    console.log('Invoking deployed Lambdas via AWS CLI...');
    for (const fn of AWS_FUNCTIONS) {
      const code = await runAws(fn);
      if (code !== 0) {
        console.error(`AWS invoke failed for ${fn} (exit ${code})`);
        process.exit(code);
      }
    }
    console.log('\n✅ All AWS Lambdas invoked.');
    return;
  }

  console.log('Running all Lambda handlers locally...');
  for (const name of LOCAL_LAMBDAS) {
    const code = await runLocal(name);
    if (code !== 0) {
      console.error(`Local run failed for ${name} (exit ${code})`);
      process.exit(code);
    }
  }
  console.log('\n✅ All local Lambda runs completed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
