/**
 * Stamp the projection-ledger package with the git commit that was bundled.
 *
 * A dirty worktree stamps an empty SHA. Prospective writes then fail closed.
 * CI should build from a clean checkout of the commit being deployed.
 *
 *   npm run build:projection-ledger-lambda
 *   npx tsx scripts/ops/stamp-projection-ledger-revision.ts
 *
 * Writes:
 *   lambda/projection-ledger/.package/revision.json
 *   infra/projection-ledger.revision.auto.tfvars.json
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolvePackagedGitSha } from '@/lib/betting/projection-ledger/revision';

const root = path.resolve(__dirname, '../..');

function git(command: string): string {
  return execSync(command, { cwd: root, encoding: 'utf8' }).trim();
}

export function stampProjectionLedgerRevision(cwd = root): {
  gitSha: string;
  source: string;
  dirty: boolean;
} {
  const head = git('git rev-parse HEAD');
  const porcelain = git('git status --porcelain');
  const dirty = porcelain.length > 0;
  const resolved = resolvePackagedGitSha({ head, dirty });
  const payload = {
    gitSha: resolved.gitSha,
    source: resolved.source,
    dirty,
    stampedAt: new Date().toISOString(),
  };
  const packageDir = path.join(cwd, 'lambda/projection-ledger/.package');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, 'revision.json'), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(
    path.join(cwd, 'infra/projection-ledger.revision.auto.tfvars.json'),
    `${JSON.stringify({ projection_ledger_git_sha: resolved.gitSha }, null, 2)}\n`
  );
  return { gitSha: resolved.gitSha, source: resolved.source, dirty };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  const stamped = stampProjectionLedgerRevision();
  console.log(
    JSON.stringify({
      event: 'projection_ledger_revision_stamped',
      source: stamped.source,
      dirty: stamped.dirty,
      gitShaPresent: stamped.gitSha.length === 40,
    })
  );
}
