/**
 * Package the Python CatBoost scorer Lambda into lambda/shadow-projection-scorer/.package
 * Does not invoke AWS. Does not include credentials.
 *
 *   npm run build:shadow-scorer-lambda
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const lambdaRoot = path.join(root, 'lambda/shadow-projection-scorer');
const pkg = path.join(lambdaRoot, '.package');

rmSync(pkg, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });
cpSync(path.join(lambdaRoot, 'handler.py'), path.join(pkg, 'handler.py'));
cpSync(path.join(lambdaRoot, 'requirements.txt'), path.join(pkg, 'requirements.txt'));

const pip = spawnSync(
  'python',
  ['-m', 'pip', 'install', '-r', path.join(lambdaRoot, 'requirements.txt'), '-t', pkg, '--upgrade'],
  { encoding: 'utf8' }
);
if (pip.status !== 0) {
  console.warn(pip.stdout || '');
  console.warn(pip.stderr || '');
  console.warn(
    'pip install into .package failed. Handler.py is copied. Install catboost/numpy/boto3 into the package before terraform apply.'
  );
} else {
  console.log('shadow-projection-scorer .package ready');
}
