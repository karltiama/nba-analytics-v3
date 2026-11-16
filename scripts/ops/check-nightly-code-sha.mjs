import { spawnSync } from 'node:child_process';

const expected = 'mSJRZCHC0OmR4O7kx++30+gF7Y1GslxWcFABHSfmBBA=';
const result = spawnSync(
  'aws',
  [
    'lambda',
    'get-function',
    '--function-name',
    'nightly-bdl-updater',
    '--region',
    'us-east-1',
    '--query',
    'Configuration.CodeSha256',
    '--output',
    'text',
  ],
  { encoding: 'utf8' },
);
if (result.status !== 0) {
  process.stderr.write('nightly code sha check failed\n');
  process.exit(1);
}
const actual = result.stdout.trim();
if (actual !== expected) {
  process.stdout.write('mismatch\n');
  process.exit(1);
}
process.stdout.write('match\n');
